const {
  AriTranscriber,
  AriTranscriberOptions,
} = require("./AriTranscriberServer");

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });

//? ---------------- Parse CLI arguments ----------------
function parseArgs(): { assistant?: string; phoneList?: string } {
  const args = process.argv.slice(2);
  const parsed: any = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--assistant" && args[i + 1]) {
      parsed.assistant = args[++i];
    } else if (args[i] === "--phone-list" && args[i + 1]) {
      parsed.phoneList = args[++i];
    }
  }

  return parsed;
}

const cliArgs = parseArgs();

// CLI args override env vars
if (cliArgs.assistant) {
  process.env.DEFAULT_ASSISTANT = cliArgs.assistant;
  console.log(`[Manager] Assistant override: ${cliArgs.assistant}`);
}
if (cliArgs.phoneList) {
  process.env.AUTODIALER_PHONE_LIST = cliArgs.phoneList;
  console.log(`[Manager] Phone list override: ${cliArgs.phoneList}`);
}

console.log("Hello, world!");

//? ---------------- Convert JSON file to hash map ----------------
function convertJSONFileToHashMap(filePath: any) {
  try {
    // Read the JSON file content
    const fileContent = fs.readFileSync(filePath, "utf8");

    // Parse the JSON content into a JavaScript object
    const jsonObject = JSON.parse(fileContent);

    // Create a new hash map
    const hashMap: any = {};

    // Iterate over the properties of the parsed object
    for (const key in jsonObject) {
      if (jsonObject.hasOwnProperty(key)) {
        // Assign each property as a key-value pair in the hash map
        hashMap[key] = jsonObject[key];
      }
    }

    return hashMap;
  } catch (error) {
    console.error("Error converting JSON file to hash map:", error);
    return null;
  }
}

const jsonFilePath = "./tools/contacts.json";
const contacts = convertJSONFileToHashMap(jsonFilePath);
console.log("Contacts:", contacts);

const { AriControllerServer } = require("./AriControllerServer");
const { AutoDialer } = require("./AutoDialer");

// Create an instance of AriControllerServer
const pbxIP = process.env.PBX_IP;
const accessKey = process.env.ASTERISK_LOGIN || "";
const secretKey = process.env.ASTERISK_PASSWORD || "";
const useRustRtp = process.env.USE_RUST_RTP === "true";
const rustServerUrl = process.env.RUST_SERVER_URL || "http://localhost:9900";

let transcriber: any = null;
let rustProcess: any = null;

/**
 * Start the Rust RTP server as a child process.
 * Resolves when the server is ready (health check passes).
 */
function startRustServer(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Find the binary: bin/ (deployed) > release build > debug build
    const isWin = process.platform === "win32";
    const ext = isWin ? ".exe" : "";
    const binDir = path.resolve(__dirname, "../bin");
    const rtpServerDir = path.resolve(__dirname, "../rust-rtp-server");
    // On Linux, check for cross-compiled binary name first (ari-rtp-server-linux)
    const deployedBin = isWin
      ? path.join(binDir, "ari-rtp-server.exe")
      : path.join(binDir, "ari-rtp-server-linux");
    const deployedBinFallback = path.join(binDir, "ari-rtp-server" + ext);
    const releaseBin = path.join(rtpServerDir, "target/release/ari-rtp-server" + ext);
    const debugBin = path.join(rtpServerDir, "target/debug/ari-rtp-server" + ext);

    let binPath: string;
    if (fs.existsSync(deployedBin)) {
      binPath = deployedBin;
    } else if (fs.existsSync(deployedBinFallback)) {
      binPath = deployedBinFallback;
    } else if (fs.existsSync(releaseBin)) {
      binPath = releaseBin;
    } else if (fs.existsSync(debugBin)) {
      binPath = debugBin;
      console.log("[Manager] Warning: using debug build, run 'npm run build:rtp' for better performance");
    } else {
      reject(new Error(`Rust RTP binary not found. Run 'npm run build:rtp' first.`));
      return;
    }

    console.log(`[Manager] Starting Rust RTP server: ${binPath}`);
    rustProcess = spawn(binPath, [], {
      cwd: rtpServerDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    rustProcess.stdout.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) console.log(`[Rust] ${line}`);
    });

    rustProcess.stderr.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) console.log(`[Rust] ${line}`);
    });

    rustProcess.on("error", (err: Error) => {
      reject(new Error(`Failed to start Rust RTP server: ${err.message}`));
    });

    rustProcess.on("exit", (code: number) => {
      console.log(`[Manager] Rust RTP server exited with code ${code}`);
      rustProcess = null;
    });

    // Poll health endpoint until ready
    const maxWait = 10000;
    const interval = 200;
    let elapsed = 0;

    const check = () => {
      fetch(`${url}/health`)
        .then((res) => {
          if (res.ok) {
            console.log("[Manager] Rust RTP server is ready");
            resolve();
          } else {
            retry();
          }
        })
        .catch(() => retry());
    };

    const retry = () => {
      elapsed += interval;
      if (elapsed >= maxWait) {
        reject(new Error("Rust RTP server did not become ready in time"));
      } else {
        setTimeout(check, interval);
      }
    };

    // Give it a moment to start before first check
    setTimeout(check, 300);
  });
}

async function main() {
  if (useRustRtp) {
    try {
      await startRustServer(rustServerUrl);
    } catch (err: any) {
      console.error(`[Manager] ${err.message}`);
      process.exit(1);
    }
  } else {
    // Legacy: Node.js handles RTP + transcription internally
    const options = {
      sslCert: "",
      sslKey: "path/to/ssl/private/key.key",
      wssPort: parseInt(process.env.WSS_PORT || "3044", 10),
      format: "slin16",
      speechLang: "en-US",
      speechModel: "default",
      speakerDiarization: false,
      listenServer: process.env.LISTENER_SERVER,
      audioOutput: "audio.raw",
    };
    transcriber = new AriTranscriber(options);
    console.log("[Manager] Using Node.js internal RTP + transcription");
  }

  const controller = new AriControllerServer(
    pbxIP, accessKey, secretKey,
    useRustRtp ? rustServerUrl : undefined
  );

  controller.on("close", () => {
    console.log("controller closed");
  });

  if (transcriber) {
    transcriber.on("close", () => {
      console.log("transcriber closed");
    });
  }

  // Handle SIGINT signal to gracefully stop the servers
  process.on("SIGINT", async () => {
    await controller.close();
    if (rustProcess) {
      console.log("[Manager] Stopping Rust RTP server...");
      rustProcess.kill("SIGTERM");
    }
    process.exit();
  });

  // Start the AriControllerServer
  await controller.start(contacts);

  // Start auto-dialer campaign if configured
  const phoneListPath = process.env.AUTODIALER_PHONE_LIST;
  if (phoneListPath) {
    const autoDialer = new AutoDialer(controller.getClient());
    try {
      autoDialer.loadPhoneList(phoneListPath);
      autoDialer.start();

      autoDialer.on("campaignComplete", (data: any) => {
        console.log("[Manager] Auto-dialer campaign finished");
      });
    } catch (err: any) {
      console.error("[Manager] Failed to start auto-dialer:", err.message);
    }
  }
}

main().catch((err) => {
  console.error("[Manager] Fatal error:", err);
  process.exit(1);
});

//TODO: add methods to start and stop the transcriber and controller in case if one of them fails or is closed
export {};
