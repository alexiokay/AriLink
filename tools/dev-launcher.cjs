// Dev launcher that preloads network error suppressor into ALL Node.js processes
// (parent Nuxt CLI, forked Nitro workers, etc.) via NODE_OPTIONS.
// Usage: node tools/dev-launcher.cjs [-- extra nuxt args]

"use strict";

const path = require("path");
const { spawn } = require("child_process");

// Convert to forward slashes — Windows NODE_OPTIONS strips backslashes from --require paths
const suppressorPath = path.resolve(__dirname, "suppress-network-errors.cjs").replace(/\\/g, "/");

// Append --require to NODE_OPTIONS so every forked process also gets the suppressor
const existing = process.env.NODE_OPTIONS || "";
process.env.NODE_OPTIONS = `${existing} --require "${suppressorPath}"`.trim();

// Forward any extra args (e.g. --port 3011)
const extraArgs = process.argv.slice(2);
const nuxtArgs = ["nuxt", "dev", "--port", "3011", ...extraArgs];

const child = spawn("npx", nuxtArgs, {
  cwd: path.resolve(__dirname, "../dashboard"),
  stdio: "inherit",
  shell: true,
  env: process.env,
});

child.on("exit", (code) => process.exit(code || 0));
child.on("error", (err) => {
  console.error("Failed to start Nuxt dev server:", err.message);
  process.exit(1);
});
