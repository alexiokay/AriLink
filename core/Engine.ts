const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

/**
 * Engine — standalone core that runs the ARI backend.
 *
 * Two modes:
 *   1. Embedded (Nuxt/Nitro): pass an existing Socket.IO instance via `options.io`
 *   2. Standalone: omit `io` and Engine creates its own HTTP + Socket.IO server
 *
 * Usage (standalone):
 *   const engine = new Engine({ port: 3012 });
 *   await engine.start();
 *
 * Usage (embedded in Nitro):
 *   const engine = new Engine({ io: existingSocketIO, rootDir });
 *   await engine.start();
 */
class Engine extends EventEmitter {
  private io: any;
  private httpServer: any | null = null;
  private controller: any | null = null;
  private callHistory: any | null = null;
  private dashboard: any | null = null;
  private rustProcess: any | null = null;
  private parakeetProcess: any | null = null;
  private dockerManager: any | null = null;
  private contacts: any = null;
  private port: number;
  private rootDir: string;

  constructor(options?: { io?: any; port?: number; rootDir?: string }) {
    super();
    this.port = options?.port || parseInt(process.env.ENGINE_PORT || "3012", 10);
    this.rootDir = options?.rootDir || path.resolve(__dirname, "..");

    if (options?.io) {
      // Embedded mode: use provided Socket.IO instance (from Nitro plugin)
      this.io = options.io;
    } else {
      // Standalone mode: create own HTTP server + Socket.IO
      const http = require("http");
      this.httpServer = http.createServer();
      const { Server: SocketIOServer } = require("socket.io");
      this.io = new SocketIOServer(this.httpServer, {
        cors: { origin: "*", methods: ["GET", "POST"] },
      });
    }
  }

  async start(): Promise<void> {
    console.log("[Engine] Starting...");
    console.log(`[Engine] Root dir: ${this.rootDir}`);

    // Load .env (dotenv won't overwrite existing vars)
    this.loadEnv();

    // Load contacts
    this.loadContacts();

    // Docker container management (works when socket is mounted)
    const { DockerManager } = require("./DockerManager");
    this.dockerManager = new DockerManager();
    const dockerOk = await this.dockerManager.isAvailable();
    console.log(`[Engine] Docker management: ${dockerOk ? "available" : "not available"}`);

    // Create CallHistory (SQLite)
    const { CallHistory } = require("./CallHistory");
    this.callHistory = new CallHistory();

    // Create DashboardServer (wires Socket.IO events)
    const { DashboardServer } = require("./DashboardServer");
    this.dashboard = new DashboardServer(
      this.io,
      (action: string, data: any) => {
        if (action === "restartParakeet") {
          this.restartParakeet();
          return;
        }
        if (action === "restartContainer") {
          this.handleContainerRestart(data.service);
          return;
        }
        if (this.controller) {
          this.controller.handleDashboardAction(action, data);
        }
      },
      () => this.controller?.getClient() || null,
      this.callHistory
    );

    // Start Rust RTP server (if configured)
    await this.startRustRtp();

    // Start Parakeet transcription service in the background (don't block engine startup)
    this.startParakeet().then(() => {
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("transcription", "connected", "Parakeet ready");
      }
    }).catch(() => {
      // Errors already logged and dashboard updated inside startParakeet()
    });

    // Create ARI controller
    const { AriControllerServer } = require("./AriControllerServer");
    const pbxIP = process.env.PBX_IP || "";
    const useRustRtp = process.env.USE_RUST_RTP === "true";
    const rustServerUrl = process.env.RUST_SERVER_URL || "http://localhost:9900";

    this.controller = new AriControllerServer(
      pbxIP,
      useRustRtp ? rustServerUrl : undefined,
      { dashboard: this.dashboard, callHistory: this.callHistory }
    );

    this.controller.on("close", () => {
      console.log("[Engine] Controller closed");
    });

    // Connect to ARI (or just transcription WS if FreePBX is unreachable)
    if (pbxIP) {
      const ariReachable = await this.checkAriReachable(pbxIP);
      if (ariReachable) {
        try {
          await this.controller.start(this.contacts);
          console.log("[Engine] ARI backend started successfully");
        } catch (err: any) {
          const errMsg = typeof err === "string" ? err : (err.message || String(err));
          console.error("[Engine] Failed to start ARI backend:", errMsg);
          console.error("[Engine] Engine will run but ARI features are unavailable");
        }
      } else {
        console.warn(`[Engine] FreePBX unreachable at ${pbxIP}:8088 — skipping ARI connection`);
        if (this.dashboard) {
          this.dashboard.updateServiceStatus("asterisk", "error", `${pbxIP} unreachable`);
        }
        this.controller.connectTranscriptionWS();
        this.controller.connectTTS();
      }
    } else {
      console.warn("[Engine] PBX_IP not set — ARI will not connect");
      this.controller.connectTranscriptionWS();
      this.controller.connectTTS();
    }

    // Start auto-dialer if configured via env
    this.startAutoDialer();

    // If standalone mode, start listening
    if (this.httpServer) {
      this.httpServer.listen(this.port, () => {
        console.log(`[Engine] Standalone Socket.IO server on port ${this.port}`);
      });
    }

    this.emit("started");
    console.log("[Engine] Ready");
  }

  async stop(): Promise<void> {
    console.log("[Engine] Shutting down...");

    try {
      if (this.controller) await this.controller.close();
    } catch {}

    if (this.rustProcess && typeof this.rustProcess.kill === "function") {
      console.log("[Engine] Stopping Rust RTP server...");
      this.rustProcess.kill("SIGTERM");
    }
    this.rustProcess = null;

    if (this.parakeetProcess && typeof this.parakeetProcess.kill === "function") {
      console.log("[Engine] Stopping Parakeet transcription service...");
      this.parakeetProcess.kill("SIGTERM");
    }
    this.parakeetProcess = null;

    if (this.callHistory) {
      try { this.callHistory.close(); } catch {}
    }

    // Only close Socket.IO + HTTP if we own them (standalone mode)
    if (this.httpServer) {
      this.io.close();
      this.httpServer.close();
    }

    this.controller = null;
    this.dashboard = null;
    this.callHistory = null;

    console.log("[Engine] Shutdown complete");
    this.emit("stopped");
  }

  // ── Public getters (used by Nitro bootstrap to populate serverState) ──

  getController() { return this.controller; }
  getCallHistory() { return this.callHistory; }
  getDashboard() { return this.dashboard; }
  getRustProcess() { return this.rustProcess; }
  getParakeetProcess() { return this.parakeetProcess; }
  getDockerManager() { return this.dockerManager; }
  getIO() { return this.io; }

  // ── Docker container management ──

  private async handleContainerRestart(service: string): Promise<void> {
    if (!this.dockerManager || !(await this.dockerManager.isAvailable())) {
      console.warn("[Engine] Docker management not available, cannot restart");
      return;
    }

    // Map service slug to dashboard status key
    const statusKeyMap: Record<string, string> = {
      parakeet: "transcription",
      kokoro: "tts",
      asterisk: "asterisk",
      "rust-rtp": "rustRtp",
    };
    const statusKey = statusKeyMap[service];

    if (statusKey && this.dashboard) {
      this.dashboard.updateServiceStatus(statusKey, "connecting", `Restarting ${service} container...`);
    }

    try {
      await this.dockerManager.restartContainer(service);
      console.log(`[Engine] Container ${service} restarted successfully`);

      // After restart, reconnect the relevant service client
      if (service === "parakeet" && this.controller) {
        setTimeout(() => {
          this.controller?.handleDashboardAction("reconnectTranscription", {});
        }, 3000);
      } else if (service === "kokoro" && this.controller) {
        setTimeout(() => {
          this.controller?.handleDashboardAction("reconnectTts", {});
        }, 3000);
      } else if (service === "asterisk" && this.controller) {
        setTimeout(() => {
          this.controller?.handleDashboardAction("reconnectAri", {});
        }, 5000);
      }
    } catch (err: any) {
      console.error(`[Engine] Failed to restart ${service}: ${err.message}`);
      if (statusKey && this.dashboard) {
        this.dashboard.updateServiceStatus(statusKey, "error", `Restart failed: ${err.message}`);
      }
    }
  }

  // ── Private helpers ──

  private loadEnv(): void {
    const dotenv = require("dotenv");
    const envPath = path.resolve(this.rootDir, ".env");
    const result = dotenv.config({ path: envPath });
    if (result.error) {
      console.warn(`[Engine] dotenv: ${result.error.message}`);
    } else {
      const count = Object.keys(result.parsed || {}).length;
      console.log(`[Engine] Loaded ${count} env vars from ${envPath}`);
    }
  }

  private loadContacts(): void {
    try {
      const raw = fs.readFileSync(
        path.resolve(this.rootDir, "tools/contacts.json"),
        "utf-8"
      );
      this.contacts = JSON.parse(raw);
      console.log("[Engine] Contacts loaded:", Object.keys(this.contacts).length);
    } catch {
      console.log("[Engine] No contacts file (optional)");
    }
  }

  private async startRustRtp(): Promise<void> {
    const useRust = process.env.USE_RUST_RTP === "true";
    const rustServerUrl = process.env.RUST_SERVER_URL || "http://localhost:9900";

    if (!useRust) return;

    const alreadyHealthy = await this.checkHealth(rustServerUrl);
    if (alreadyHealthy) {
      console.log("[Engine] Rust RTP server already running, reusing");
      return;
    }

    try {
      this.rustProcess = await this.spawnRustServer(rustServerUrl);
    } catch (err: any) {
      console.error(`[Engine] ${err.message}`);
      console.error("[Engine] Continuing without Rust RTP server");
    }
  }

  private startAutoDialer(): void {
    const phoneListPath = process.env.AUTODIALER_PHONE_LIST;
    if (!phoneListPath || !this.controller?.getClient()) return;

    try {
      const { AutoDialer } = require("./AutoDialer");
      const autoDialer = new AutoDialer(this.controller.getClient());
      autoDialer.loadPhoneList(phoneListPath);
      autoDialer.start();
      autoDialer.on("campaignComplete", () => {
        console.log("[Engine] Auto-dialer campaign finished");
      });
    } catch (err: any) {
      console.error("[Engine] Failed to start auto-dialer:", err.message);
    }
  }

  private async checkHealth(baseUrl: string): Promise<boolean> {
    try {
      const resp = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private async checkAriReachable(pbxIP: string, timeoutMs = 3000): Promise<boolean> {
    try {
      const resp = await fetch(`http://${pbxIP}:8088/ari/api-docs/resources.json`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Any HTTP response means Asterisk HTTP is running (even 404 = ARI module not loaded yet)
      return resp.ok || resp.status === 401 || resp.status === 404;
    } catch {
      return false;
    }
  }

  private checkTcpPort(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
    const net = require("net");
    return new Promise((res) => {
      const socket = net.createConnection({ host, port });
      const timer = setTimeout(() => { socket.destroy(); res(false); }, timeoutMs);
      socket.on("connect", () => { clearTimeout(timer); socket.destroy(); res(true); });
      socket.on("error", () => { clearTimeout(timer); socket.destroy(); res(false); });
    });
  }

  private async waitForTcpPort(host: string, port: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ready = await this.checkTcpPort(host, port);
      if (ready) return;
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`[Engine] Waiting for Parakeet on port ${port}... (${elapsed}s)`);
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error(`Parakeet did not become ready within ${timeoutMs / 1000}s`);
  }

  private async startParakeet(): Promise<void> {
    const autoStart = process.env.AUTO_START_TRANSCRIPTION === "true";
    if (!autoStart) return;

    // Parse the first transcription service URL
    const raw = process.env.TRANSCRIPTION_SERVICES || "";
    const firstService = raw.split(",")[0].trim();

    if (!firstService || firstService === "google" || !firstService.startsWith("ws://")) {
      console.log("[Engine] AUTO_START_TRANSCRIPTION is set but first service is not a local ws:// URL, skipping");
      return;
    }

    let host: string;
    let port: number;
    try {
      const parsed = new URL(firstService);
      host = parsed.hostname;
      port = parseInt(parsed.port, 10) || 5000;
    } catch {
      console.error("[Engine] Failed to parse TRANSCRIPTION_SERVICES URL, skipping Parakeet auto-start");
      return;
    }

    // Only auto-spawn for local services
    if (!["localhost", "127.0.0.1", "0.0.0.0"].includes(host)) {
      console.log(`[Engine] Transcription service is remote (${host}), skipping auto-start`);
      return;
    }

    // Check if already running
    const probeHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    const alreadyRunning = await this.checkTcpPort(probeHost, port);
    if (alreadyRunning) {
      console.log("[Engine] Parakeet transcription service already running, reusing");
      return;
    }

    // If the launcher already pre-spawned Parakeet, just wait for it to become ready
    if (process.env.PARAKEET_PRE_SPAWNED === "true") {
      console.log("[Engine] Parakeet was pre-spawned by launcher, waiting for it to be ready...");
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("transcription", "connecting", "Waiting for Parakeet...");
      }
      try {
        await this.waitForTcpPort(probeHost, port, 90000);
        console.log("[Engine] Parakeet transcription service is ready");
      } catch (err: any) {
        console.error(`[Engine] ${err.message}`);
        console.error("[Engine] Continuing without Parakeet (start it manually)");
        if (this.dashboard) {
          this.dashboard.updateServiceStatus("transcription", "error", err.message);
        }
      }
      return;
    }

    if (this.dashboard) {
      this.dashboard.updateServiceStatus("transcription", "connecting", "Starting Parakeet...");
    }

    try {
      this.parakeetProcess = await this.spawnParakeetServer(probeHost, port);
      console.log("[Engine] Parakeet transcription service is ready");
    } catch (err: any) {
      console.error(`[Engine] ${err.message}`);
      console.error("[Engine] Continuing without Parakeet (start it manually)");
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("transcription", "error", err.message);
      }
    }
  }

  private async restartParakeet(): Promise<void> {
    console.log("[Engine] Restarting Parakeet transcription service...");

    if (this.dashboard) {
      this.dashboard.updateServiceStatus("transcription", "connecting", "Restarting Parakeet...");
    }

    // Parse URL from TRANSCRIPTION_SERVICES
    const raw = process.env.TRANSCRIPTION_SERVICES || "";
    const firstService = raw.split(",")[0].trim();
    if (!firstService || !firstService.startsWith("ws://")) {
      console.error("[Engine] Cannot restart Parakeet: no local ws:// service configured");
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("transcription", "error", "No local service configured");
      }
      return;
    }

    let host: string;
    let port: number;
    try {
      const parsed = new URL(firstService);
      host = parsed.hostname;
      port = parseInt(parsed.port, 10) || 5000;
    } catch {
      console.error("[Engine] Cannot restart Parakeet: failed to parse URL");
      return;
    }

    const probeHost = host === "0.0.0.0" ? "127.0.0.1" : host;

    // Kill existing process
    if (this.parakeetProcess && typeof this.parakeetProcess.kill === "function") {
      this.parakeetProcess.kill("SIGTERM");
      this.parakeetProcess = null;

      // Wait for port to be released (poll up to 10s)
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const stillUp = await this.checkTcpPort(probeHost, port, 500);
        if (!stillUp) break;
        if (i === 19) {
          console.error("[Engine] Parakeet port still in use after 10s, aborting restart");
          if (this.dashboard) {
            this.dashboard.updateServiceStatus("transcription", "error", `Port ${port} still in use`);
          }
          return;
        }
      }
    }

    try {
      this.parakeetProcess = await this.spawnParakeetServer(probeHost, port);
      console.log("[Engine] Parakeet restarted successfully");
      // Reconnect the transcription WebSocket (Node → Rust → Parakeet)
      if (this.controller) {
        this.controller.handleDashboardAction("reconnectTranscription", {});
      }
    } catch (err: any) {
      console.error(`[Engine] Parakeet restart failed: ${err.message}`);
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("transcription", "error", err.message);
      }
    }
  }

  private async spawnParakeetServer(host: string, port: number): Promise<any> {
    // Safety: refuse to spawn if port is already in use
    const portBusy = await this.checkTcpPort(host, port, 1000);
    if (portBusy) {
      throw new Error(`Port ${port} already in use — another transcription service is running`);
    }

    const isWin = process.platform === "win32";
    const serviceDir = path.resolve(this.rootDir, "transcription-services/parakeet-service");

    // Find Python executable in venv
    const venvPython = isWin
      ? path.resolve(serviceDir, ".venv/Scripts/python.exe")
      : path.resolve(serviceDir, ".venv/bin/python");

    if (!fs.existsSync(venvPython)) {
      throw new Error(
        `Parakeet venv not found at ${venvPython}. ` +
        `Run: cd transcription-services/parakeet-service && python -m venv .venv && pip install -r requirements.txt`
      );
    }

    return new Promise((res, rej) => {

      const device = process.env.TRANSCRIPTION_DEVICE || "cuda";
      const args = [
        "server.py",
        "--model", "nvidia/parakeet-tdt-0.6b-v3",
        "--device", device,
        "--host", "0.0.0.0",
        "--port", String(port),
      ];

      console.log(`[Engine] Starting Parakeet: ${venvPython} ${args.join(" ")}`);
      const proc = spawn(venvPython, args, {
        cwd: serviceDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let settled = false;
      let exited = false;

      proc.stdout.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          console.log(`[Parakeet] ${line}`);
          // Watch for readiness sentinel from server.py
          if (!settled && line.includes("Service ready!")) {
            settled = true;
            clearInterval(progressTimer);
            res(proc);
          }
        }
      });
      proc.stderr.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          console.log(`[Parakeet] ${line}`);
        }
      });
      proc.on("error", (err: Error) => {
        if (!settled) {
          settled = true;
          clearInterval(progressTimer);
          rej(new Error(`Failed to start Parakeet: ${err.message}`));
        }
      });
      proc.on("exit", (code: number) => {
        exited = true;
        console.log(`[Engine] Parakeet exited with code ${code}`);
        if (!settled) {
          settled = true;
          clearInterval(progressTimer);
          rej(new Error(`Parakeet exited with code ${code} before becoming ready`));
        }
      });

      // Progress logging + TCP fallback readiness check every 5s
      const maxWait = 90000;
      let elapsed = 0;

      const progressTimer = setInterval(() => {
        if (settled || exited) { clearInterval(progressTimer); return; }
        elapsed += 5000;
        console.log(`[Engine] Waiting for Parakeet model loading... (${elapsed / 1000}s / ${maxWait / 1000}s)`);

        // TCP fallback: check if port is listening
        this.checkTcpPort(host, port).then((ready) => {
          if (ready && !settled && !exited) {
            settled = true;
            clearInterval(progressTimer);
            res(proc);
          }
        });

        if (elapsed >= maxWait && !settled && !exited) {
          settled = true;
          clearInterval(progressTimer);
          rej(new Error(`Parakeet did not become ready within ${maxWait / 1000}s`));
        }
      }, 5000);
    });
  }

  private spawnRustServer(url: string): Promise<any> {
    // NOTE: Promise params "res"/"rej" to avoid shadowing path.resolve
    return new Promise((res, rej) => {
      const isWin = process.platform === "win32";
      const ext = isWin ? ".exe" : "";
      const binDir = path.resolve(this.rootDir, "bin");
      const rtpServerDir = path.resolve(this.rootDir, "rust-rtp-server");

      const deployedBin = isWin
        ? path.resolve(binDir, "ari-rtp-server.exe")
        : path.resolve(binDir, "ari-rtp-server-linux");
      const deployedBinFallback = path.resolve(binDir, "ari-rtp-server" + ext);
      const releaseBin = path.resolve(rtpServerDir, "target/release/ari-rtp-server" + ext);
      const debugBin = path.resolve(rtpServerDir, "target/debug/ari-rtp-server" + ext);

      let binPath: string;
      if (fs.existsSync(deployedBin)) binPath = deployedBin;
      else if (fs.existsSync(deployedBinFallback)) binPath = deployedBinFallback;
      else if (fs.existsSync(releaseBin)) binPath = releaseBin;
      else if (fs.existsSync(debugBin)) {
        binPath = debugBin;
        console.log("[Engine] Warning: using debug build of Rust RTP");
      } else {
        rej(new Error("Rust RTP binary not found. Run 'npm run build:rtp' first."));
        return;
      }

      console.log(`[Engine] Starting Rust RTP server: ${binPath}`);
      const proc = spawn(binPath, [], {
        cwd: rtpServerDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let settled = false;
      let exited = false;

      proc.stdout.on("data", (data: Buffer) => {
        const line = data.toString().trim();
        if (line) console.log(`[Rust] ${line}`);
      });
      proc.stderr.on("data", (data: Buffer) => {
        const line = data.toString().trim();
        if (line) console.log(`[Rust] ${line}`);
      });
      proc.on("error", (err: Error) => {
        if (!settled) {
          settled = true;
          rej(new Error(`Failed to start Rust RTP server: ${err.message}`));
        }
      });
      proc.on("exit", (code: number) => {
        exited = true;
        console.log(`[Engine] Rust RTP server exited with code ${code}`);
        if (!settled && code !== 0) {
          settled = true;
          rej(new Error(`Rust RTP server exited with code ${code}`));
        }
      });

      // Poll health endpoint until ready
      const maxWait = 10000;
      const interval = 200;
      let elapsed = 0;

      const check = () => {
        if (settled || exited) return;
        fetch(`${url}/health`)
          .then((resp) => {
            if (settled || exited) return;
            if (resp.ok) {
              settled = true;
              console.log("[Engine] Rust RTP server is ready");
              res(proc);
            } else {
              retry();
            }
          })
          .catch(() => retry());
      };
      const retry = () => {
        if (settled || exited) return;
        elapsed += interval;
        if (elapsed >= maxWait) {
          settled = true;
          rej(new Error("Rust RTP server did not become ready in time"));
        } else {
          setTimeout(check, interval);
        }
      };
      setTimeout(check, 300);
    });
  }
}

module.exports.Engine = Engine;
export {};
