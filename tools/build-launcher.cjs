// Build launcher that sets NUXT_BUILD=true so the bootstrap plugin
// skips starting Engine/Rust/Parakeet during the prerender phase.
// Usage: node tools/build-launcher.cjs

"use strict";

const path = require("path");
const { spawn } = require("child_process");

process.env.NUXT_BUILD = "true";

const child = spawn("npx", ["nuxt", "build"], {
  cwd: path.resolve(__dirname, "../dashboard"),
  stdio: "inherit",
  shell: true,
  env: process.env,
});

child.on("exit", (code) => process.exit(code || 0));
child.on("error", (err) => {
  console.error("Failed to start nuxt build:", err.message);
  process.exit(1);
});
