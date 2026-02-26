# AriLink Deployment Architecture

## Overview

AriLink follows a **one VPS per client** model. Each client (dentist, plumber, lawyer, etc.) gets their own isolated VPS with a full AriLink deployment. A separate master dashboard (future) provides centralized management.

```
┌──────────────────────────────────────────────┐
│            YOUR INFRASTRUCTURE               │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  Master Dashboard (future)             │  │
│  │  • List all client VPSes               │  │
│  │  • Health / uptime monitoring          │  │
│  │  • Deploy / update / rollback          │  │
│  │  • Aggregated analytics                │  │
│  │                                        │  │
│  │  Access: Tailscale (your team only)    │  │
│  └──────────┬────────────────┬────────────┘  │
│             │                │                │
│       Tailscale mesh    Tailscale mesh        │
│             │                │                │
└─────────────┼────────────────┼────────────────┘
              │                │
      ┌───────▼──────┐ ┌──────▼───────┐
      │   VPS 1      │ │   VPS 2      │
      │  "Dr. Smith  │ │  "ABC        │
      │   Dental"    │ │   Plumbing"  │
      │              │ │              │
      │  ┌────────┐  │ │  ┌────────┐  │
      │  │AriLink │  │ │  │AriLink │  │
      │  │instance│  │ │  │instance│  │
      │  └───┬────┘  │ │  └───┬────┘  │
      │      │       │ │      │       │
      │  Cloudflare  │ │  Cloudflare  │
      │  Tunnel      │ │  Tunnel      │
      └──────┬───────┘ └──────┬───────┘
             │                │
             ▼                ▼
      drsmith.your       abcplumbing.your
      domain.com         domain.com
      (client access)    (client access)
```

---

## Per-Client VPS

### What Each VPS Runs

| Component | Details |
|-----------|---------|
| **AriLink** (Nuxt 4 + Nitro) | Dashboard, API, Socket.IO — port 3011 |
| **Asterisk** | PBX — SIP, ARI, call handling |
| **Parakeet** | Local STT service (GPU optional) |
| **Kokoro** | Local TTS service (GPU optional) |
| **Docker Compose** | Orchestrates all services |

### Deployment via CLI

```bash
# On a fresh VPS
npx arilink init      # Creates docker-compose.yml, .env, config
npx arilink start     # Pulls images and starts everything

# Updates
npx arilink update    # Pulls latest images, restarts
npx arilink status    # Health check
npx arilink logs      # Tail container logs
```

### Environment Isolation

Each VPS has its own:
- `.env` with unique credentials (`DASHBOARD_SECRET`, ARI creds, API keys)
- Asterisk configuration (dialplan, extensions, trunks)
- Knowledge base / assistant configurations
- Call recordings and logs (if enabled)
- Contact lists and campaign data

**No data is shared between client VPSes.** This is the gold standard for security and HIPAA compliance.

---

## Network Architecture

### Zero Open Ports (Recommended)

No incoming ports need to be open on client VPSes.

**For your team access — Tailscale:**
- Mesh VPN — all devices appear on the same private network
- Access any VPS via private IP: `http://100.x.x.x:3011`
- SSH: `ssh user@100.x.x.x`
- No configuration on the VPS firewall needed
- Free for up to 100 devices

**For client access — Cloudflare Tunnel:**
- `cloudflared` daemon on the VPS connects outbound to Cloudflare
- Client visits `drsmith.yourdomain.com`
- Cloudflare handles TLS, DDoS protection, and access policies
- MFA at the Cloudflare edge (email OTP, hardware key, etc.)
- No incoming ports needed — tunnel is outbound-only

```
Client browser
    │
    ▼ HTTPS
Cloudflare Edge (TLS, WAF, MFA)
    │
    ▼ Tunnel (outbound from VPS)
cloudflared on VPS
    │
    ▼ localhost:3011
AriLink dashboard
```

### Required Ports (If Not Using Tunnels)

If you're not using Cloudflare Tunnels, these ports must be open:

| Port | Service | Notes |
|------|---------|-------|
| 22 | SSH | Restrict to your IPs |
| 3011 | AriLink dashboard | Behind reverse proxy (nginx) with TLS |
| 5060 | SIP (UDP/TCP) | Between Asterisk and SIP trunk provider |
| 10000-20000 | RTP | Audio streams — restrict to SIP provider IPs |

**Never expose:**
- Port 8088 (ARI) — internal only
- Port 5001 (Kokoro TTS) — internal only
- Port 5000 (Parakeet STT) — internal only

---

## Master Dashboard (Future Project)

A separate, lightweight application for managing all client VPSes.

### Approach A: Pull-Based (Recommended for <50 clients)

The master dashboard polls each VPS over Tailscale.

```
Master                          Client VPS
  │                                │
  ├─ GET /api/health ──────────────►│ Returns: uptime, version,
  │◄──────────────────── 200 OK ───┤  active calls, services status
  │                                │
  ├─ GET /api/metrics ─────────────►│ Returns: call counts, durations,
  │◄──────────────────── 200 OK ───┤  resource usage
  │                                │
  (every 30s per VPS)
```

**To support this, AriLink needs one new endpoint:**

```typescript
// server/api/health.get.ts — already partially exists via services status
export default defineEventHandler(() => ({
  version: "1.0.0",
  uptime: process.uptime(),
  activeCalls: /* count */,
  services: /* current service statuses */,
}));
```

Everything else (deploy, update, SSH) happens via Tailscale + SSH directly.

### Approach B: Push-Based (For 50+ clients)

Each AriLink instance connects to a central hub via WebSocket.

```
Client VPS 1 ──── WebSocket ────►┐
Client VPS 2 ──── WebSocket ────►├── Master Hub
Client VPS 3 ──── WebSocket ────►┘
                                   │
                                   ▼
                            Real-time dashboard
                            showing all VPSes
```

- Each AriLink adds a "phone home" module
- Reports health/metrics every 30s
- Hub can push commands back (restart service, update config)
- More complex to build but scales better

### Master Dashboard Features

| Feature | Priority | Implementation |
|---------|----------|---------------|
| VPS inventory | P0 | Simple JSON/DB with VPS name, IP, client info |
| Health monitoring | P0 | Poll `/api/health` per VPS, show green/red |
| Alert on downtime | P0 | If health check fails 3x → email/Slack alert |
| One-click SSH | P1 | Open terminal to VPS via Tailscale |
| Bulk update | P1 | Run `arilink update` on selected VPSes |
| Call analytics | P2 | Aggregate call stats across all clients |
| Billing tracker | P2 | Per-minute usage per client |
| Auto-provisioning | P3 | API to spin up new VPS + deploy AriLink |

---

## Multi-Agent on a Single VPS (Lead Gen Model)

An alternative to one-client-per-VPS: run **one VPS with multiple phone numbers**, each routed to a different assistant. This is ideal for a lead generation business where you manage many small clients from a single server.

```
              SIP Trunk Provider
              (multiple DIDs)
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
+1-555-0101    +1-555-0202    +1-555-0303
(Dr. Smith)    (ABC Plumbing) (Law Office)
    │               │               │
    └───────────────┼───────────────┘
                    │
              ┌─────▼─────┐
              │  Asterisk  │
              │  (routes   │
              │   by DID)  │
              └─────┬──────┘
                    │ ARI StasisStart
                    ▼
            ┌───────────────┐
            │ AriLink       │
            │               │
            │ routing.json  │
            │ maps DIDs to  │
            │ assistants    │
            └───────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   dental-ai   plumber-ai   lawyer-ai
   assistant    assistant    assistant
```

### How DID Routing Works

When an inbound call arrives, Asterisk passes the dialed number (DID/extension) and caller ID to AriLink. The `AssistantFactory.createFromRouting()` method checks `config/routing.json` in order:

1. **Extension/DID routes** — match `channel.dialplan.exten` (the number that was dialed)
2. **Caller ID routes** — match the caller's phone number
3. **`DEFAULT_ASSISTANT` env var** — fallback
4. **`ivr-transfer`** — hardcoded last resort

### Routing Configuration

`config/routing.json`:

```json
{
  "extensionRoutes": [
    { "pattern": "5550101", "assistant": "dental-ai" },
    { "pattern": "5550202", "assistant": "plumber-ai" },
    { "pattern": "555030[0-9]", "assistant": "lawyer-ai" }
  ],
  "callerIdRoutes": [
    { "pattern": "^\\+48", "assistant": "polish-greeting" }
  ]
}
```

- **`pattern`** supports regex (anchored with `^...$` automatically) or exact match
- **`assistant`** is the folder name under `assistants/` (the slug)
- Routes are evaluated top-to-bottom, first match wins
- Routing config can be edited live via `PUT /api/routing` — takes effect immediately

### Per-Assistant Customization

Each assistant gets its own folder under `assistants/`:

```
assistants/
├── dental-ai/
│   ├── config.json        # name, prompts, behavior, transfer numbers
│   └── DentalAiAssistant.ts   # (or use brain: "ivr-transfer" in config)
├── plumber-ai/
│   ├── config.json
│   └── PlumberAiAssistant.ts
└── lawyer-ai/
    └── config.json        # brain: "direct-dial" → uses BrainHarness
```

With the **pluggable brain** architecture, you often don't need custom code per assistant. Just create a `config.json` that references a brain:

```json
{
  "name": "ABC Plumbing AI",
  "mode": "incoming",
  "brain": "ivr-transfer",
  "prompts": {
    "welcome": "sound:custom/abc_plumbing_welcome",
    "systemPrompt": "You are a receptionist for ABC Plumbing..."
  },
  "behavior": {
    "transferNumber": "5551234"
  }
}
```

### When to Use Multi-Agent vs One-Per-Client

| Factor | Multi-Agent (1 VPS) | One-Per-Client |
|--------|---------------------|----------------|
| **Cost** | Cheapest — one server | $20-100/month per client |
| **Isolation** | Shared resources, shared logs | Full isolation, HIPAA ready |
| **Scaling** | Limited by single server CPU/RAM | Horizontal — add more VPSes |
| **Management** | One server to maintain | N servers to maintain |
| **Best for** | Lead gen, small clients, demos | Healthcare, legal, enterprise |
| **Risk** | One crash affects all clients | Blast radius = one client |

### Multi-Agent VPS Sizing

| Concurrent Clients | CPU | RAM | GPU | Approx Cost |
|--------------------|-----|-----|-----|-------------|
| 5-10 | 4 vCPU | 16 GB | Optional | $40-60/mo |
| 10-25 | 8 vCPU | 32 GB | T4 recommended | $80-120/mo |
| 25-50 | 16 vCPU | 64 GB | T4 or A10 | $150-250/mo |

The bottleneck is STT/TTS — each concurrent call needs ~1 core for CPU inference or shared GPU time.

---

## VPS Sizing

### Minimum (No GPU — CPU inference)

For low-volume clients (< 50 calls/day):

| Resource | Spec |
|----------|------|
| CPU | 4 vCPU |
| RAM | 8 GB |
| Storage | 40 GB SSD |
| OS | Ubuntu 22.04 LTS |
| Cost | ~$20-40/month |

STT and TTS run on CPU. Slower but functional. Parakeet TDT 0.6B handles ~2-3x realtime on 4 cores.

### Recommended (With GPU)

For higher volume or lower latency:

| Resource | Spec |
|----------|------|
| CPU | 4 vCPU |
| RAM | 16 GB |
| GPU | NVIDIA T4 (16GB VRAM) or RTX 3060 |
| Storage | 80 GB SSD |
| OS | Ubuntu 22.04 LTS + NVIDIA drivers |
| Cost | ~$50-100/month (cloud GPU instances) |

GPU handles both Parakeet STT and Kokoro TTS with sub-200ms latency.

### Alternative: Shared GPU Server

Run STT/TTS on a single powerful GPU server, client VPSes connect over private network:

```
Client VPS 1 ─── ws://gpu-server:5000 ───►┐
Client VPS 2 ─── ws://gpu-server:5000 ───►├── GPU Server
Client VPS 3 ─── ws://gpu-server:5001 ───►┘   (Parakeet + Kokoro)
```

- Cheaper: one GPU serves multiple clients
- Trade-off: shared resource, network latency, single point of failure
- Works well with Tailscale (private network, no public exposure)

---

## Deployment Checklist

### Per-Client VPS Setup

- [ ] Provision VPS (Ubuntu 22.04, Docker pre-installed)
- [ ] Install Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh`
- [ ] Run `npx arilink init` to generate config
- [ ] Configure `.env`:
  - [ ] `DASHBOARD_SECRET` (strong, unique per client)
  - [ ] `PBX_IP`, `ASTERISK_LOGIN`, `ASTERISK_PASSWORD`
  - [ ] `TRANSCRIPTION_SERVICES`
  - [ ] `TTS_SERVICE`
  - [ ] `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`
- [ ] Run `npx arilink start`
- [ ] Set up Cloudflare Tunnel for client access
- [ ] Configure Asterisk SIP trunk to provider
- [ ] Upload assistant knowledge base
- [ ] Test inbound call flow end-to-end
- [ ] Set up monitoring (UptimeRobot, Grafana, or master dashboard)

### Security Hardening

- [ ] Firewall: deny all, allow only Tailscale + SIP provider IPs
- [ ] SSH: key-only auth, disable password login
- [ ] fail2ban for SSH and SIP
- [ ] Automatic security updates: `unattended-upgrades`
- [ ] HTTPS via Cloudflare Tunnel (automatic)
- [ ] Set `DASHBOARD_SECRET`
- [ ] Verify no unnecessary ports are open: `nmap -sV your-vps-ip`
