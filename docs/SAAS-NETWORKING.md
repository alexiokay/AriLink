# SaaS Networking: Connecting Cloud Dashboard to User's Local Server

## The Problem

The ARI Stasi Server core **must run locally** (same LAN as FreePBX/Asterisk) for low-latency RTP, ARI WebSocket, and transcription. But the SaaS dashboard lives in the cloud. Users are behind NAT/firewalls and **will not** configure their routers.

```
User's network (behind NAT)              Internet                Your cloud
┌──────────────────────────┐                                  ┌─────────────┐
│ FreePBX ◄──── ARI ────► Core engine ──── ??? ─────────────► │  Dashboard  │
│ (LAN only)               (Node.js)       how to connect?    │  (Nuxt SaaS)│
└──────────────────────────┘                                  └─────────────┘
```

This document covers every viable approach, their trade-offs, and the recommended architecture.

---

## Table of Contents

1. [Solution Comparison Matrix](#solution-comparison-matrix)
2. [Option 1: Outbound WebSocket (Recommended)](#option-1-outbound-websocket-recommended)
3. [Option 2: Cloudflare Tunnel](#option-2-cloudflare-tunnel)
4. [Option 3: FRP (Fast Reverse Proxy)](#option-3-frp-fast-reverse-proxy)
5. [Option 4: Rathole](#option-4-rathole)
6. [Option 5: Bore](#option-5-bore)
7. [Option 6: ngrok](#option-6-ngrok)
8. [Option 7: Tailscale](#option-7-tailscale)
9. [Option 8: SSH Reverse Tunnel](#option-8-ssh-reverse-tunnel)
10. [How Games Do It (Minecraft, Hytale)](#how-games-do-it)
11. [SaaS Challenges & Solutions](#saas-challenges--solutions)
12. [Recommended Architecture](#recommended-architecture)
13. [What Config the User Would Need](#what-config-the-user-would-need)
14. [What Can Break & How to Handle It](#what-can-break--how-to-handle-it)

---

## Solution Comparison Matrix

| Criterion | Outbound WS | Cloudflare Tunnel | FRP | Rathole | Bore | ngrok | Tailscale | SSH Tunnel |
|---|---|---|---|---|---|---|---|---|
| User installs extra software | **No** | Yes (cloudflared) | Yes (frpc) | Yes (rathole) | Yes (bore) | Yes (ngrok) | Yes (Tailscale) | Yes (autossh) |
| User creates third-party account | **No** | Yes (Cloudflare) | No | No | No | Yes (ngrok) | Yes (Tailscale) | No |
| You maintain relay infra | Yes (WS server) | **No** | Yes (VPS) | Yes (VPS) | Optional | **No** | **No** | Yes (VPS) |
| Free | **Yes** | Yes | Yes + VPS ($3-5/mo) | Yes + VPS | Yes | Barely | Yes (limits) | Yes + VPS |
| WebSocket support | **Native** | Native | TCP passthrough | TCP passthrough | TCP only | Yes | IP-level | TCP passthrough |
| Production reliability | You control | **Excellent** | Good | Good | Fair | Poor (free tier) | Excellent | Good |
| User effort | **None** | Medium | Medium | Medium | Low | Low | Medium | High |
| Traffic privacy | You see it | Cloudflare sees it | You see it | You see it | **Unencrypted!** | ngrok sees it | **E2E encrypted** | Encrypted |
| Multi-tenant ready | **Yes** | No (per-user setup) | Manual | Manual | No | No | No | Manual |

---

## Option 1: Outbound WebSocket (Recommended)

**How it works:** The user's core app initiates an outbound WebSocket (WSS) connection to your cloud dashboard. No inbound ports needed. The cloud sends commands down the same connection; the core pushes events back up. This is exactly how GitHub Actions self-hosted runners, Jenkins agents, and IoT devices work.

```
User's machine                              Your cloud
┌────────────────────┐                     ┌──────────────────┐
│ Core engine        │                     │ Dashboard SaaS   │
│                    │── WSS outbound ───► │                  │
│ Socket.IO client   │◄── commands ───────│ Socket.IO server │
│                    │─── events ─────────►│                  │
└────────────────────┘                     └──────────────────┘
     only needs outbound TCP 443
     (allowed on virtually ALL networks)
```

**Cost:** Free — it's a design pattern, not a product. You build both sides.

**User complexity:** **Zero.** User runs your Node.js app, it connects automatically. No tunnel binary, no third-party account, no config beyond an API key.

**Developer complexity:** Highest. You must build:
- WebSocket server managing persistent connections from many agents
- Auth flow (API key issued at signup, pasted into local `.env`)
- Message protocol (request/response multiplexing, event streaming)
- Reconnection with exponential backoff
- Heartbeats / dead connection detection
- Message queue for temporary disconnections

**However:** You already use Socket.IO, which has reconnection, multiplexing, heartbeats, and rooms built in. The core could literally be a Socket.IO *client* connecting to your cloud Socket.IO *server*.

**Reliability:** As reliable as you make it. Socket.IO handles reconnection automatically. WebSocket connections drop on network changes — backoff + queue handles this.

**Third-party dependency:** None.

**Security:** Strongest model. WSS = TLS encryption. Your own auth. No third-party sees traffic.

**Why this wins:** Zero friction for users. No extra software. No third-party accounts. You already have the Socket.IO infrastructure. The core just needs a "connect to cloud" mode.

---

## Option 2: Cloudflare Tunnel

**How it works:** A daemon called `cloudflared` runs on the user's machine and creates outbound connections to Cloudflare's edge network. Traffic arriving at a public URL (e.g., `user123.yourdomain.com`) gets routed through Cloudflare → tunnel → local service. No inbound ports opened.

```bash
# User runs:
cloudflared tunnel run my-tunnel
# Their local server is now accessible at user123.yourdomain.com
```

Quick Tunnel mode (zero config): `cloudflared tunnel --url http://localhost:3011` — generates a random `trycloudflare.com` subdomain instantly.

**Cost:** Free. Unlimited bandwidth. No per-tunnel fees. User needs a Cloudflare account (free) for named tunnels.

**User complexity:** Medium. Install `cloudflared` (~30MB binary), create Cloudflare account, create tunnel, run it. Manageable but it's an extra step.

**Developer complexity:** Low. Cloudflare handles relay infrastructure, SSL, DDoS protection. You just document the setup. No relay servers to maintain.

**Reliability:** Excellent. Cloudflare's global anycast network with automatic failover. `cloudflared` auto-reconnects and maintains multiple simultaneous connections to different data centers.

**Third-party dependency:** Cloudflare account. Domain name (for named tunnels). Traffic routes through Cloudflare.

**Security:** Encrypted between `cloudflared` and Cloudflare edge. **But Cloudflare terminates TLS** — they can theoretically inspect traffic in transit. Outbound-only model = no exposed ports.

**Best for:** Fallback option. If you want users to optionally expose their full server (for direct API access, debugging, or webhook callbacks from external services).

---

## Option 3: FRP (Fast Reverse Proxy)

**How it works:** You run `frps` (server) on a VPS with public IP. User runs `frpc` (client) locally. Client opens outbound connection to server. Server assigns a public port/subdomain and forwards traffic through the tunnel.

```toml
# User's frpc.toml
serverAddr = "relay.yourdomain.com"
serverPort = 7000
auth.token = "user-specific-token"

[[proxies]]
name = "dashboard"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3011
remotePort = 0  # auto-assign
```

**Cost:** Free, open source (Apache 2.0). 80k+ GitHub stars. You need a VPS (~$3-5/month) for the relay.

**User complexity:** Medium. Install binary, edit TOML config, run. Technical users handle it fine.

**Developer complexity:** Medium. You provision and maintain the relay VPS. Handle per-user auth tokens. SSL termination. Monitoring. Scaling.

**Reliability:** Good. Mature project, active development. Single point of failure = your relay VPS (add redundancy for production).

**Third-party dependency:** None (fully self-hosted). User connects to YOUR relay.

**Security:** TLS between client and server (built-in). Token-based auth. You control everything but you're also responsible for everything.

---

## Option 4: Rathole

**How it works:** Same architecture as FRP (server on VPS, client on local machine, outbound tunnel). Written in Rust. Key differences: ~500KiB binary, lower memory usage, higher throughput, Noise Protocol encryption, hot-reload config.

```toml
# User's client.toml
[client]
remote_addr = "relay.yourdomain.com:2333"

[client.services.dashboard]
token = "user-specific-secret"
local_addr = "127.0.0.1:3011"
```

**Cost:** Free, open source (Apache 2.0). VPS needed (~$3-5/month).

**User complexity:** Same as FRP. Slightly simpler config syntax.

**Developer complexity:** Same as FRP. Smaller binary = easier to distribute. Smaller community than FRP.

**Reliability:** Good. Rust memory safety. Less battle-tested than FRP but solid.

**Security:** Mandatory per-service tokens. Noise Protocol encryption (modern, well-regarded). Arguably better crypto defaults than FRP.

---

## Option 5: Bore

**How it works:** Minimal TCP tunnel. ~400 lines of Rust. Client connects to server, server assigns a random public port.

```bash
# User runs:
bore local 3011 --to bore.pub
# Output: "Listening on bore.pub:12345"
```

Free public relay at `bore.pub`. Self-hosting: `bore server`.

**Cost:** Free, open source (MIT). `bore.pub` is free with no SLA.

**User complexity:** Very low. One command.

**Developer complexity:** Very low. But intentionally minimal: no HTTP routing, no domains, no TLS, no multiplexing. Raw TCP forwarding with random port numbers. **Too bare-bones for production SaaS.**

**Reliability:** Fair. `bore.pub` has no SLA (one person's side project). Self-hosted is fine.

**Security:** ⚠️ **Traffic is NOT encrypted after auth.** You must layer TLS yourself (WSS). HMAC auth for tunnel creation only.

---

## Option 6: ngrok

**How it works:** Agent on local machine connects outbound to ngrok's cloud. Gets a public URL. ngrok reverse-proxies traffic through.

**Cost:** Free tier: 1 static domain, 20k requests/month, 1GB bandwidth, **2-hour session expiration** on free plan. Paid: $8+/month.

**User complexity:** Low. Download, add auth token, run.

**Why it's bad for this use case:**
- Free tier has interstitial warning page (injected into HTML responses)
- 2-hour session timeout = connection drops regularly
- 20k requests/month is nothing for real-time telephony
- ngrok terminates TLS and can inspect traffic
- User must create ngrok account
- Paid plan cost adds up ($8/user/month minimum)

**Verdict:** Good for demos, bad for production.

---

## Option 7: Tailscale

**How it works:** WireGuard-based mesh VPN. Each device gets a stable IP (100.x.y.z). NAT traversal via STUN/hole-punching with DERP relay fallback. End-to-end encrypted — even DERP relays can't read traffic.

**Cost:** Free: 3 users, 100 devices. Paid: $6/user/month.

**User complexity:** Medium. Install Tailscale, authenticate via SSO.

**Why it's problematic for SaaS:**
- Your cloud server needs to join the user's tailnet (or vice versa)
- Per-user network management doesn't scale for multi-tenant SaaS
- Users installing a VPN on their server may conflict with existing network config
- Architectural coupling between your infra and user's Tailscale network

**Best for:** Internal use, dev/staging, or enterprise customers who already use Tailscale.

**Security:** Strongest of all options — true E2E WireGuard encryption. DERP relays are encrypted pass-through.

---

## Option 8: SSH Reverse Tunnel

**How it works:** Classic approach.

```bash
# User runs:
autossh -M 0 -R 8080:localhost:3011 tunnel-user@relay.yourdomain.com \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes
```

**Cost:** Free. VPS needed ($3-5/month).

**User complexity:** High. Must understand SSH, set up keys, configure autossh, create systemd service for auto-start.

**Developer complexity:** Medium. Manage per-user SSH keys, restrict shell access (`ForceCommand`, `PermitOpen`), monitor tunnel health.

**Reliability:** SSH is rock-solid. autossh handles reconnection (15-90 second delay on drops).

**Verdict:** Too much user friction for a SaaS product. Fine for power users or internal tooling.

---

## How Games Do It

### Minecraft / Hytale / Game Servers

Minecraft **does NOT** have built-in NAT traversal. Hosting a server requires port forwarding. The community solved this with:

- **Playit.gg** — dominant solution. Agent on user's machine creates outbound tunnel to Playit's global relay. Other players connect to `player.joinmc.link`. Essentially FRP/ngrok purpose-built for games. Free tier with relay; $3/month for region selection.

- **UDP Hole Punching** (used by some P2P games, NOT Minecraft):
  1. Both peers connect to a STUN server to discover their external IP:port
  2. STUN server shares each peer's address with the other
  3. Both peers simultaneously send UDP packets to each other → "punches hole" in NAT
  4. Success rate: ~70-82%. Fails with symmetric NAT (~11% of networks)
  5. Fallback: TURN relay servers forward traffic when punching fails

- **Why hole punching doesn't work for us:** Our protocol is TCP/WebSocket. TCP hole punching is much harder than UDP and unreliable. Relay/tunnel is the correct approach for TCP.

### The Game Server Takeaway

Games solved the exact same problem we have. Their answer: **outbound tunnel agent + cloud relay**. That's Playit.gg (for games) and that's what our Outbound WebSocket option is (for telephony).

---

## SaaS Challenges & Solutions

### Networking

| Challenge | Solution |
|-----------|----------|
| User behind NAT/firewall | Core initiates **outbound** WSS to cloud. No inbound ports. |
| RTP audio streams are LAN-only | **Keep transcription local.** Only send text/metadata to cloud. Never send raw audio. |
| Connection drops (internet, NAT timeout) | Socket.IO auto-reconnect + local event queue. Core works offline. |
| Latency for real-time call control | **Core handles ALL real-time call logic locally.** Dashboard is monitoring + config, not call control. |

### Config & Credentials

| Challenge | Solution |
|-----------|----------|
| Asterisk credentials | **Never leave the user's machine.** Core reads local `.env`, only sends events/results to cloud. |
| PBX_IP, transcription URLs, etc. | Local setup wizard on first run. Core self-configures, then connects to cloud. |
| SSH keys for FreePBX | 100% local. If dashboard needs to run PBX commands, it sends a request down the WebSocket → core executes locally. |
| Different user setups | Core reports its own config/capabilities to cloud on connect. Dashboard adapts its UI. |

### Multi-Tenancy & Data

| Challenge | Solution |
|-----------|----------|
| Tenant isolation | Tenant ID on every record. Supabase RLS (Row-Level Security) or schema-per-tenant. Standard SaaS pattern. |
| User data responsibility (GDPR, PII) | **Don't store recordings in cloud.** Only metadata + transcription text. Recordings stay on user's machine. |
| Data ownership | Clear ToS: "your data stays on your machine." Cloud stores only display data. Export/delete anytime. |
| Cloud goes down | **Core works independently.** Calls continue. Dashboard is monitoring-only, not a dependency. |

### User Modifications & Breakage

| Challenge | Solution |
|-----------|----------|
| Users modify open-source core | **Versioned protocol** between core and cloud. Core reports version on connect. Dashboard warns "unsupported version." |
| Custom assistants | Dashboard doesn't care about internals. It only knows events: call started, transcription received, call ended. |
| Users break their config | Core validates locally, reports health to cloud: "Core: unhealthy — Asterisk connection failed." |
| Old versions | Minimum version requirement. Protocol version negotiation on connect. |

### Security

| Challenge | Solution |
|-----------|----------|
| Auth between core and cloud | **API key per tenant.** User generates key in dashboard, pastes into local `.env`. Core authenticates WSS with this key. |
| Encryption | WSS (TLS). Standard. |
| Users making spam calls | ToS: "You are responsible for TCPA/GDPR/local law compliance." Same as Twilio's model. |
| Call recording laws | Not your problem. Tool provider, not operator. ToS makes this explicit. |

---

## Recommended Architecture

### Phase 1: Agent Mode (MVP)

Add a "cloud agent" mode to the existing core. When configured, core connects outbound to your cloud dashboard via Socket.IO.

```
User's .env:
  CLOUD_API_KEY=sk_live_abc123...
  CLOUD_URL=wss://api.yourdomain.com    (optional, defaults to your server)
  # Everything else stays the same — PBX_IP, ASTERISK_LOGIN, etc.
```

```
What gets sent TO cloud:              What NEVER leaves user's machine:
─────────────────────────             ──────────────────────────────────
• Call events (started/ended)         • Asterisk credentials
• Transcription text                  • SSH keys
• Campaign progress                   • Raw RTP audio
• System health status                • .env file contents
• Assistant config (names, modes)     • Call recordings
• Call metadata (duration, caller)    • PBX configuration
```

```
Core (Socket.IO client)                    Cloud (Socket.IO server)
────────────────────────                   ────────────────────────
connect(CLOUD_URL, { auth: API_KEY })
        ──── WSS handshake ────►
                                           verify API_KEY → tenant lookup
        ◄─── "authenticated" ────

emit("health", { ari: ok, rtp: ok })
        ────────────────────────►
                                           update tenant dashboard

emit("call:started", { id, caller })
        ────────────────────────►
                                           real-time UI update

emit("transcription", { callId, text })
        ────────────────────────►
                                           store in tenant's DB

                                           emit("campaign:start", { config })
        ◄────────────────────────
execute campaign locally
```

### Phase 2: Premium Features

Things the cloud adds that users can't easily self-host:

- **Team management** — roles, permissions, multiple users per account
- **Cross-instance analytics** — stats across multiple PBX setups
- **Hosted transcription** — for users who don't want to run Parakeet
- **Alerts** — SMS/email on call failures, campaign completion
- **Integrations** — CRM sync, webhook builder
- **Campaign template marketplace**
- **White-labeling** — agencies rebrand for their clients

### Phase 3: Optional Cloudflare Tunnel

For users who need direct HTTP access to their core (webhooks from external services, direct API access):

```bash
# User optionally runs:
cloudflared tunnel run ari-stasi
# Now their core is accessible at https://user123.yourdomain.com
# Cloud dashboard can also reach their REST API directly
```

This is **optional** — the outbound WebSocket handles everything for the normal use case.

---

## What Config the User Would Need

### Minimal Setup (cloud-connected mode)

```env
# === EXISTING CONFIG (unchanged) ===
PBX_IP=192.168.1.100
ASTERISK_LOGIN=ari_user
ASTERISK_PASSWORD=secret
TRANSCRIPTION_SERVICES=ws://localhost:5000

# === NEW: Cloud connection (only addition) ===
CLOUD_API_KEY=sk_live_abc123def456
# That's it. One line.
```

### How the User Gets Their API Key

1. Sign up at `dashboard.yourdomain.com`
2. Go to Settings → API Keys → Generate
3. Copy key, paste into `.env`
4. Restart core: `npm start`
5. Dashboard shows "Core connected" within seconds

### What Happens When Things Go Wrong

| Scenario | What happens |
|----------|-------------|
| Cloud is down | Core continues running normally. Calls work. Events queue locally. When cloud recovers, queued events sync. |
| Internet drops | Same as above. Core is fully independent. |
| Wrong API key | Core logs auth error, retries with backoff, dashboard shows "Core disconnected." |
| User's Asterisk is down | Core detects, reports health to cloud, dashboard shows "PBX: unreachable." |
| Core version too old | Cloud rejects connection with "Please update to v2.x+". Core continues working locally. |
| User modified the protocol | Cloud receives unexpected data, logs warning, dashboard shows "Unsupported core version." |

---

## What Can Break & How to Handle It

### If Users Modify Core Code

Since it's open source, users **will** change things. The key principle: **the cloud dashboard must be resilient to unexpected data.**

```
Defense layers:
1. Protocol version — core sends version on connect, cloud validates
2. Schema validation — cloud validates every event against expected schema
3. Graceful degradation — unknown fields are ignored, missing fields get defaults
4. Feature flags — core reports capabilities, dashboard shows only supported features
```

### If Users Run Multiple Cores

Support it. Each core connects with the same API key but a different instance ID. Dashboard shows a list of connected cores.

### If Users Want to Self-Host Dashboard Too

Let them. Open-source the dashboard with a self-hosted mode. The cloud version is just the hosted + premium features version. This is the Grafana / GitLab model.

### If Users Reverse-Engineer the Protocol

They will. It's open source anyway. The premium value is in the hosted service (uptime, team features, analytics), not in the protocol secrecy.

---

## Cost Estimation

### For You (SaaS Operator)

| Component | Cost | Notes |
|-----------|------|-------|
| Cloud hosting (Vercel/Railway) | $0-20/month to start | Scales with users |
| Database (Supabase free tier) | $0 | 500MB, 50k monthly active users |
| Domain | $10/year | |
| WebSocket server (for agent connections) | $5-20/month VPS | Or serverless WebSocket (Cloudflare Durable Objects) |
| **Total to start** | **~$5-25/month** | |

### For Users

| Component | Cost | Notes |
|-----------|------|-------|
| Core software | Free (open source) | Runs on their existing machine |
| FreePBX/Asterisk | Free (open source) | Already have this |
| Parakeet transcription | Free (self-hosted) | Already have this |
| Cloud dashboard (free tier) | $0 | 1 core, basic features |
| Cloud dashboard (paid) | $X/month | Team features, analytics, etc. |

---

## Summary: The Simple Answer

**You don't need to open ports.** The core connects OUT to your cloud over a standard WebSocket (port 443, the same port used for HTTPS — allowed everywhere). This is how every modern agent-based SaaS works.

The user's only setup: paste one API key into their `.env`. Everything else is automatic.

No Cloudflare account. No tunnel binary. No router config. No VPN. Just one API key and it works.
