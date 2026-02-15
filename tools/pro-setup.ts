#!/usr/bin/env npx tsx
/**
 * AriLink Pro Setup — Automated FreePBX/Asterisk configuration
 *
 * This feature is part of the AriLink Pro Pack.
 * It automates the entire FreePBX/Asterisk setup via SSH:
 * - Network detection & PBX discovery
 * - ARI user & HTTP server configuration
 * - Custom dialplan for Stasis
 * - Firewall rules (firewalld / iptables / ufw)
 * - ARI reboot fix (FreePBX systemd service)
 * - .env file generation
 *
 * Get Pro Pack → https://github.com/sponsors/alexiokay
 */

console.log();
console.log("  ╔═══════════════════════════════════════╗");
console.log("  ║  AriLink Pro Setup                    ║");
console.log("  ╚═══════════════════════════════════════╝");
console.log();
console.log("  This command is available with the Pro Pack.");
console.log();
console.log("  What it does:");
console.log("    • Detects your network & finds your PBX");
console.log("    • Connects via SSH and configures ARI, HTTP, dialplan");
console.log("    • Sets up firewall rules & reboot fix");
console.log("    • Generates your .env automatically");
console.log();
console.log("  Get Pro Pack → https://github.com/sponsors/alexiokay");
console.log();
