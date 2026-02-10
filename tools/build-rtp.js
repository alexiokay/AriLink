const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const rtpDir = path.join(rootDir, "rust-rtp-server");
const binDir = path.join(rootDir, "bin");

if (!fs.existsSync(binDir)) fs.mkdirSync(binDir);

// Find local Zig installation (tools/zig-*/zig or tools/zig-*/zig.exe)
function findLocalZig() {
  const zigDirs = fs.readdirSync(__dirname).filter((d) => d.startsWith("zig-"));
  for (const dir of zigDirs) {
    const zigPath = path.join(__dirname, dir, process.platform === "win32" ? "zig.exe" : "zig");
    if (fs.existsSync(zigPath)) return zigPath;
  }
  return null;
}

const targets = [
  { triple: null, out: "ari-rtp-server" + (process.platform === "win32" ? ".exe" : ""), label: "native" },
  { triple: "x86_64-unknown-linux-gnu", out: "ari-rtp-server-linux", label: "linux" },
];

for (const t of targets) {
  const label = t.label.toUpperCase();
  try {
    if (t.triple) {
      const zigPath = findLocalZig();
      if (!zigPath) {
        console.error(`[${label}] SKIPPED - Zig not found in tools/`);
        console.error(`  Download from https://ziglang.org/download/ and extract to tools/`);
        continue;
      }
      console.log(`\n[${label}] Building for ${t.triple} (zigbuild)...`);
      console.log(`[${label}] Using Zig: ${zigPath}`);
      // Set PATH so cargo-zigbuild finds our local zig
      const env = { ...process.env, PATH: path.dirname(zigPath) + path.delimiter + process.env.PATH };
      // Skip opus for cross-compilation (C library can't cross-link; slin16 is used anyway)
      execSync(`cargo zigbuild --release --no-default-features --target ${t.triple}`, { cwd: rtpDir, stdio: "inherit", env });
      const src = path.join(rtpDir, "target", t.triple, "release", "ari-rtp-server");
      fs.cpSync(src, path.join(binDir, t.out));
    } else {
      console.log(`\n[${label}] Building native...`);
      execSync("cargo build --release", { cwd: rtpDir, stdio: "inherit" });
      const ext = process.platform === "win32" ? ".exe" : "";
      const src = path.join(rtpDir, "target", "release", "ari-rtp-server" + ext);
      fs.cpSync(src, path.join(binDir, t.out));
    }
    const size = (fs.statSync(path.join(binDir, t.out)).size / 1024 / 1024).toFixed(1);
    console.log(`[${label}] -> bin/${t.out} (${size} MB)`);
  } catch (err) {
    if (t.triple) {
      console.error(`[${label}] FAILED - check cargo-zigbuild is installed: cargo install cargo-zigbuild`);
    } else {
      console.error(`[${label}] BUILD FAILED`);
      process.exit(1);
    }
  }
}

console.log("\nDone! Contents of bin/:");
fs.readdirSync(binDir).forEach((f) => {
  const size = (fs.statSync(path.join(binDir, f)).size / 1024 / 1024).toFixed(1);
  console.log(`  ${f} (${size} MB)`);
});
