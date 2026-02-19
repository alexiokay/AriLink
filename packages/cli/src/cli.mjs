#!/usr/bin/env node

import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";

const VERSION = "1.0.0";
const REPO_URL = "https://github.com/AriLink/arilink.git";
const IS_WIN = process.platform === "win32";

// ─── Colors (zero dependencies) ───
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const log = (msg) => console.log(msg);
const ok = (msg) => log(`${c.green}✓${c.reset} ${msg}`);
const warn = (msg) => log(`${c.yellow}!${c.reset} ${msg}`);
const err = (msg) => log(`${c.red}✗${c.reset} ${msg}`);
const info = (msg) => log(`${c.cyan}→${c.reset} ${msg}`);

// ─── Docker check ───

function hasDocker() {
  try {
    execSync("docker --version", { stdio: "pipe", shell: true });
    return true;
  } catch {
    return false;
  }
}

function requireDocker() {
  if (!hasDocker()) {
    err("Docker not found in PATH.");
    err("Install Docker Desktop: https://docs.docker.com/get-docker/");
    if (IS_WIN) {
      err("If Docker is installed, restart your terminal or add it to PATH.");
    }
    process.exit(1);
  }
}

// ─── Helpers ───

function getProjectDir() {
  return process.cwd();
}

function check(cmd) {
  try {
    execSync(cmd, { stdio: "pipe", shell: true });
    return true;
  } catch {
    return false;
  }
}

function isAriLinkProject(dir) {
  return existsSync(join(dir, "docker-compose.yml")) &&
    existsSync(join(dir, "docker")) &&
    existsSync(join(dir, "core"));
}

function isDirEmpty(dir) {
  try {
    const entries = readdirSync(dir);
    return entries.length === 0;
  } catch {
    return true;
  }
}

function runSync(cmd, dir) {
  execSync(cmd, { cwd: dir, stdio: "inherit", shell: true });
}

function runCompose(args, dir) {
  requireDocker();

  return new Promise((resolve) => {
    const child = spawn("docker", ["compose", ...args], {
      cwd: dir,
      stdio: "inherit",
      shell: true,
    });
    child.on("error", () => {
      err("Failed to run docker compose. Is Docker running?");
      process.exit(1);
    });
    child.on("close", (code) => resolve(code));
  });
}

async function ask(question, defaultValue = "") {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` ${c.dim}(${defaultValue})${c.reset}` : "";
  return new Promise((res) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      rl.close();
      res(answer.trim() || defaultValue);
    });
  });
}

async function choose(question, options) {
  log(`  ${question}`);
  options.forEach((opt, i) => {
    log(`    ${c.cyan}${i + 1}${c.reset}) ${opt.label}${opt.default ? ` ${c.dim}(default)${c.reset}` : ""}`);
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(`  ${c.dim}Choose [1-${options.length}]:${c.reset} `, (answer) => {
      rl.close();
      const idx = parseInt(answer) - 1;
      if (idx >= 0 && idx < options.length) {
        res(options[idx].value);
      } else {
        res(options.find((o) => o.default)?.value || options[0].value);
      }
    });
  });
}

// ─── Commands ───

async function cmdInit() {
  log("");
  log(`${c.bold}${c.magenta}  AriLink${c.reset} ${c.dim}v${VERSION}${c.reset}`);
  log(`${c.dim}  AI-powered telephony platform${c.reset}`);
  log("");

  // ── Check prerequisites ──
  if (!hasDocker()) {
    err("Docker is not installed: https://docs.docker.com/get-docker/");
    if (IS_WIN) err("If Docker is installed, restart your terminal or add it to PATH.");
    process.exit(1);
  }
  if (!check("docker compose version")) {
    err("Docker Compose is not available. Update Docker Desktop.");
    process.exit(1);
  }
  if (!check("git --version")) {
    err("Git is not installed: https://git-scm.com/downloads");
    process.exit(1);
  }
  ok("Docker + Git found");

  const dir = getProjectDir();

  // ── Check if already initialized ──
  if (isAriLinkProject(dir)) {
    warn("AriLink is already initialized here.");
    info("Run 'arilink update' to pull latest changes.");
    info("Run 'arilink start' to start services.");
    return;
  }

  // ── Clone repository ──
  if (!isDirEmpty(dir)) {
    warn("Current directory is not empty.");
    const proceed = await ask("Clone AriLink here anyway? (y/N)", "N");
    if (proceed.toLowerCase() !== "y") {
      info("Tip: create a new directory first, then run arilink init inside it.");
      return;
    }
  }

  log("");
  info("Cloning AriLink repository...");
  try {
    runSync(`git clone ${REPO_URL} .`, dir);
    ok("Repository cloned");
  } catch (e) {
    err("Failed to clone repository. Check your internet connection.");
    process.exit(1);
  }

  // ── Interactive setup ──
  log("");
  log(`${c.bold}  Configuration${c.reset}`);
  log("");

  const ariUser = await ask("ARI username", "arilink");
  const ariPass = await ask("ARI password", "arilink123");
  const stasisApp = await ask("Stasis app name", "stasis-app");

  const lang = await choose("Speech recognition language", [
    { label: "English (en-US)", value: "en-US", default: true },
    { label: "Polish (pl-PL)", value: "pl-PL" },
    { label: "German (de-DE)", value: "de-DE" },
    { label: "French (fr-FR)", value: "fr-FR" },
    { label: "Spanish (es-ES)", value: "es-ES" },
  ]);

  const assistant = await choose("Default assistant", [
    { label: "IVR Transfer — AI answers, transfers to human", value: "ivr-transfer", default: true },
    { label: "Direct Dial — Simple call routing", value: "direct-dial" },
    { label: "Auto Dialer — Outbound campaign calls", value: "auto-dialer" },
  ]);

  // ── Write .env ──
  // The repo already has docker-compose.yml, Dockerfiles, and Asterisk configs
  // with env var placeholders. We just need the .env file.
  const envContent = `# AriLink Configuration — Generated by arilink init
# Edit this file to change settings, then run: arilink start

# ─── Asterisk / ARI ───
ASTERISK_LOGIN=${ariUser}
ASTERISK_PASSWORD=${ariPass}
STASIS_APP_NAME=${stasisApp}

# ─── Transcription ───
SPEECH_LANG=${lang}

# ─── Assistant ───
DEFAULT_ASSISTANT=${assistant}

# ─── Server ───
WSS_PORT=3044
USE_RUST_RTP=false
`;

  writeFileSync(join(dir, ".env"), envContent);
  ok("Created .env");

  // Create data/logs dirs (gitignored, used as Docker volumes)
  mkdirSync(join(dir, "data"), { recursive: true });
  mkdirSync(join(dir, "logs"), { recursive: true });

  log("");
  log(`${c.green}${c.bold}  AriLink initialized!${c.reset}`);
  log("");
  log(`  ${c.bold}Next steps:${c.reset}`);
  log(`    ${c.cyan}arilink start${c.reset}        Build & start all services (first run takes a few minutes)`);
  log(`    ${c.cyan}arilink open${c.reset}         Open dashboard in browser`);
  log("");
  log(`  ${c.bold}SIP phone (Zoiper / Linphone):${c.reset}`);
  log(`    Server:    ${c.bold}localhost:5060${c.reset}`);
  log(`    Extension: ${c.bold}1001${c.reset}`);
  log(`    Password:  ${c.bold}demo1001${c.reset}`);
  log("");
  log(`  ${c.dim}First 'arilink start' builds Docker images from source (~5-10 min).`);
  log(`  Subsequent starts are instant. Parakeet downloads the AI model (~2GB) on first run.${c.reset}`);
  log("");
}

async function cmdStart() {
  const dir = getProjectDir();
  if (!isAriLinkProject(dir)) {
    err("Not an AriLink project. Run 'arilink init' first.");
    process.exit(1);
  }
  if (!existsSync(join(dir, ".env"))) {
    err("No .env file found. Run 'arilink init' to generate one.");
    process.exit(1);
  }

  log("");
  info("Starting AriLink services...");
  info("Building images from source (fast after first run)");
  log("");

  const code = await runCompose(["up", "--build", "-d"], dir);
  if (code === 0) {
    log("");
    ok("All services started");
    log("");
    log(`  ${c.bold}Dashboard:${c.reset}  http://localhost:3011`);
    log(`  ${c.bold}ARI API:${c.reset}    http://localhost:8088/ari`);
    log(`  ${c.bold}SIP:${c.reset}        localhost:5060 (ext 1001 / demo1001)`);
    log("");
    log(`  ${c.dim}arilink status${c.reset}   — check health`);
    log(`  ${c.dim}arilink logs${c.reset}     — view logs`);
    log(`  ${c.dim}arilink open${c.reset}     — open dashboard`);
    log("");
  }
}

async function cmdStop() {
  const dir = getProjectDir();
  if (!isAriLinkProject(dir)) {
    err("Not an AriLink project.");
    process.exit(1);
  }

  info("Stopping AriLink services...");
  const code = await runCompose(["stop"], dir);
  if (code === 0) {
    ok("All services stopped");
    log(`  ${c.dim}arilink start${c.reset}  — restart services (instant)`);
    log(`  ${c.dim}arilink down${c.reset}   — stop & remove containers`);
  }
}

async function cmdDown() {
  const dir = getProjectDir();
  if (!isAriLinkProject(dir)) {
    err("Not an AriLink project.");
    process.exit(1);
  }

  info("Stopping and removing AriLink containers...");
  const code = await runCompose(["down"], dir);
  if (code === 0) ok("All containers removed");
}

async function cmdStatus() {
  const dir = getProjectDir();
  if (!isAriLinkProject(dir)) {
    err("Not an AriLink project.");
    process.exit(1);
  }

  log("");
  log(`${c.bold}  AriLink Services${c.reset}`);
  log("");
  await runCompose(["ps"], dir);
  log("");
}

async function cmdLogs() {
  const dir = getProjectDir();
  if (!isAriLinkProject(dir)) {
    err("Not an AriLink project.");
    process.exit(1);
  }

  const service = process.argv[3] || "";
  const args = ["logs", "-f", "--tail", "100"];
  if (service) args.push(service);

  await runCompose(args, dir);
}

async function cmdUpdate() {
  const dir = getProjectDir();
  if (!isAriLinkProject(dir)) {
    err("Not an AriLink project.");
    process.exit(1);
  }

  log("");
  info("Pulling latest changes...");

  try {
    // Stash any local changes (like .env modifications)
    runSync("git stash --include-untracked --quiet 2>/dev/null || true", dir);

    // Pull latest
    runSync("git pull origin main", dir);

    // Restore local changes
    runSync("git stash pop --quiet 2>/dev/null || true", dir);

    ok("Repository updated");
  } catch (e) {
    err("Failed to pull updates. Check your git status.");
    process.exit(1);
  }

  log("");
  info("Rebuilding images with updated source...");
  log("");

  const code = await runCompose(["up", "--build", "-d"], dir);
  if (code === 0) {
    log("");
    ok("AriLink updated and restarted");
    log(`  ${c.dim}Dashboard: http://localhost:3011${c.reset}`);
    log("");
  }
}

async function cmdOpen() {
  const url = "http://localhost:3011";
  info(`Opening ${url}...`);

  try {
    if (IS_WIN) execSync(`start "" "${url}"`, { shell: true });
    else if (process.platform === "darwin") execSync(`open "${url}"`);
    else execSync(`xdg-open "${url}"`);
  } catch {
    warn(`Could not open browser. Visit ${c.bold}${url}${c.reset} manually.`);
  }
}

function cmdHelp() {
  log("");
  log(`${c.bold}${c.magenta}  AriLink${c.reset} ${c.dim}v${VERSION}${c.reset}`);
  log(`${c.dim}  AI-powered telephony platform${c.reset}`);
  log("");
  log(`  ${c.bold}Usage:${c.reset} arilink <command>`);
  log("");
  log(`  ${c.bold}Commands:${c.reset}`);
  log(`    ${c.cyan}init${c.reset}       Clone repo + interactive setup wizard`);
  log(`    ${c.cyan}start${c.reset}      Build & start all services`);
  log(`    ${c.cyan}stop${c.reset}       Stop all services (keeps containers)`);
  log(`    ${c.cyan}down${c.reset}       Stop & remove all containers`);
  log(`    ${c.cyan}restart${c.reset}    Restart all services`);
  log(`    ${c.cyan}update${c.reset}     Pull latest code + rebuild + restart`);
  log(`    ${c.cyan}status${c.reset}     Show service health and ports`);
  log(`    ${c.cyan}logs${c.reset}       Tail service logs (arilink logs [service])`);
  log(`    ${c.cyan}open${c.reset}       Open dashboard in browser`);
  log(`    ${c.cyan}help${c.reset}       Show this help`);
  log("");
  log(`  ${c.bold}Quick start:${c.reset}`);
  log(`    ${c.dim}$ mkdir my-callcenter && cd my-callcenter`);
  log(`    $ arilink init`);
  log(`    $ arilink start`);
  log(`    $ arilink open${c.reset}`);
  log("");
  log(`  ${c.bold}Update to latest:${c.reset}`);
  log(`    ${c.dim}$ arilink update${c.reset}     (pulls code + rebuilds images)`);
  log("");
}

// ─── Main ───

const command = process.argv[2];

const commands = {
  init: cmdInit,
  start: cmdStart,
  stop: cmdStop,
  down: cmdDown,
  restart: async () => { await cmdStop(); await cmdStart(); },
  update: cmdUpdate,
  status: cmdStatus,
  logs: cmdLogs,
  open: cmdOpen,
  help: cmdHelp,
  "--help": cmdHelp,
  "-h": cmdHelp,
  "--version": () => log(`arilink v${VERSION}`),
  "-v": () => log(`arilink v${VERSION}`),
};

if (command && commands[command]) {
  commands[command]();
} else if (!command) {
  cmdHelp();
} else {
  err(`Unknown command: ${command}`);
  cmdHelp();
  process.exit(1);
}
