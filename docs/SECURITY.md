# AriLink Security Guide

## Authentication

AriLink supports optional dashboard authentication via a shared secret.

### Setup

Add to your `.env`:

```env
DASHBOARD_SECRET=your-strong-secret-here
```

When **not set**, auth is completely disabled (backward compatible, good for local dev).

When **set**, all API routes and Socket.IO connections require authentication.

### How It Works

```
User visits /dashboard
    │
    ▼
Client middleware checks GET /api/auth/check
    │
    ├─ authEnabled: false → proceed normally (no secret set)
    │
    ├─ authenticated: true → proceed (valid cookie)
    │
    └─ authenticated: false → redirect to /login
                                  │
                                  ▼
                          User enters secret
                                  │
                                  ▼
                      POST /api/auth/login
                          │
                          ├─ Valid → httpOnly cookie set (30 days) → redirect to /
                          └─ Invalid → "Invalid secret" error
```

### Components

| File | Purpose |
|------|---------|
| `server/middleware/auth.ts` | Nitro middleware — checks all `/api/*` requests |
| `server/api/auth/check.get.ts` | Returns auth status (enabled + authenticated) |
| `server/api/auth/login.post.ts` | Validates secret, sets httpOnly cookie |
| `server/api/auth/logout.post.ts` | Clears auth cookie |
| `server/plugins/00.socket-io.ts` | Socket.IO connection middleware |
| `app/composables/useAuth.ts` | Client-side auth state |
| `app/middleware/auth.global.ts` | Client-side route guard |
| `app/pages/login.vue` | Login page |

### Public Endpoints (No Auth Required)

These endpoints are accessible without authentication:

- `/api/auth/*` — login, logout, check
- `/api/setup-status` — setup wizard check
- `/api/setup/*` — setup wizard endpoints
- `/api/detect-ip` — IP detection for setup
- `/api/pro-status` — license check
- `/api/pro-activate` — license activation

### Cookie Details

- **Name**: `arilink-token`
- **httpOnly**: Yes (JavaScript cannot read it — XSS safe)
- **sameSite**: Strict (no CSRF)
- **maxAge**: 30 days
- **path**: `/`

### Socket.IO Auth

Socket.IO connections are authenticated via the same cookie. The browser sends cookies automatically with the initial polling handshake. If rejected, the client receives a `connect_error` with message "Authentication required" and redirects to `/login`.

### Recommendations

- Use a strong secret (32+ characters): `openssl rand -hex 32`
- In production, always use HTTPS (Cloudflare Tunnel handles this)
- The secret is never exposed to the client — it's stored in an httpOnly cookie
- Rotate the secret by updating `.env` and restarting — all sessions invalidate immediately

---

## Path Traversal Protection

All file-serving API routes validate that resolved paths stay within their expected directories.

### Protected Endpoints

**Campaign results** (`server/api/campaigns/[file].get.ts`):
- `basename()` strips directory components from the filename
- Rejects any input where `basename(file) !== file` (catches `../` attempts)
- Verifies resolved path starts with the `campaign-results/` directory

**Contact lists** (`server/api/contact-lists.delete.ts`):
- `basename()` strips directory components
- Regex validation: only `[a-zA-Z0-9_-]` allowed in IDs
- Verifies resolved path starts with the `contact-lists/` directory

### Pattern

For any API that accepts a filename/path from the user:

```typescript
import { basename, resolve } from "path";

// 1. Strip directory components
const safeFile = basename(userInput);

// 2. Validate characters (if applicable)
if (!/^[a-zA-Z0-9_.-]+$/.test(safeFile)) {
  throw createError({ statusCode: 400, message: "Invalid filename" });
}

// 3. Resolve and verify containment
const baseDir = resolve(rootDir, "expected-directory");
const filePath = resolve(baseDir, safeFile);
if (!filePath.startsWith(baseDir)) {
  throw createError({ statusCode: 400, message: "Invalid path" });
}
```

---

## TTS Concurrent Call Safety

The TTS client (`core/TtsClient.ts`) serializes synthesis requests to prevent audio chunks from being routed to the wrong call.

### The Problem

The Kokoro TTS WebSocket protocol sends binary audio chunks without session ID tagging. If two calls request TTS simultaneously, chunks could be delivered to the wrong session.

### The Solution

A **synthesis queue** ensures only one request is in-flight at a time:

```
Call A requests "Hello"  ─┐
                          ├─► Queue: [A, B]
Call B requests "Goodbye" ─┘
                              │
                              ▼
                      Send A to Kokoro
                      Receive A's audio chunks → route to A
                      A completes (tts_done)
                              │
                              ▼
                      Send B to Kokoro
                      Receive B's audio chunks → route to B
                      B completes (tts_done)
```

- `drainQueue()` sends the next request only after the current one finishes
- `handleAudioChunk()` always routes to the single `active` entry
- Timeout (15s) prevents stuck requests from blocking the queue
- On disconnect, both active and queued requests are rejected

---

## Environment Variable Security

### Sensitive Keys

The following keys are marked `sensitive: true` in the env schema and should never be exposed in logs or client-side code:

- `PRO_LICENSE_KEY`
- `ASTERISK_LOGIN`, `ASTERISK_PASSWORD`
- `GOOGLE_CREDENTIALS_JSON`
- `LLM_API_KEY`
- `ELEVENLABS_API_KEY`
- `SIP_ACCOUNTS`
- `SSH_PASSWORD`
- `MISTRAL_API_KEY`

### Allowed Keys Whitelist

The env API only accepts updates to keys defined in `ENV_SCHEMA` (see `server/utils/env-parser.ts`). Arbitrary key injection is not possible.

---

## Checklist

- [ ] Set `DASHBOARD_SECRET` in `.env` for production
- [ ] Use HTTPS (via Cloudflare Tunnel or reverse proxy)
- [ ] Use `wss://` for SIP WebSocket connections
- [ ] Keep `.env` out of version control (already in `.gitignore`)
- [ ] Use strong passwords for Asterisk ARI credentials
- [ ] Set up `fail2ban` on the VPS for SSH and SIP brute-force protection
- [ ] Configure firewall — only allow necessary ports (SIP, RTP range)
- [ ] Regularly update OS packages and Docker images
