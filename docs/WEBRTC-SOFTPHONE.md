# WebRTC Softphone — Asterisk Configuration Guide

The AriLink dashboard includes a browser-based softphone that connects directly to Asterisk via WebSocket + WebRTC (using SIP.js). This guide covers the one-time Asterisk setup required.

## Prerequisites

- Asterisk 18+ with PJSIP (FreePBX or plain Asterisk)
- TLS certificate (self-signed or Let's Encrypt)
- Port 8089/TCP accessible from the browser

## 1. Enable HTTPS/WSS in Asterisk

### On FreePBX (GUI)

Go to **Settings > Advanced Settings > Asterisk Builtin mini-HTTP server**:

| Setting | Value | Why |
|---------|-------|-----|
| Enable the mini-HTTP Server | **Yes** | Required for WebSocket |
| Enable TLS for the mini-HTTP Server | **Yes** | Browsers require WSS (not WS) |
| HTTP Bind Address | `0.0.0.0` | Accept connections from any IP |
| HTTPS Bind Address | **`0.0.0.0`** | **Critical!** Default `127.0.0.1` blocks external connections |
| HTTPS Bind Port | `8089` | Standard WSS port |
| HTTPS TLS Certificate Location | Your cert path (e.g., `/etc/asterisk/keys/integration/certificate.pem`) | |
| HTTPS TLS Private Key Location | Your key path (e.g., `/etc/asterisk/keys/integration/webserver.key`) | |

Then under **Asterisk REST Interface**:

| Setting | Value | Why |
|---------|-------|-----|
| Allowed Origins | `localhost:8088, YOUR_DASHBOARD_IP:3011` | Add your AriLink dashboard address |

Click **Submit**, then **Apply Config**.

### On plain Asterisk (config files)

Edit `/etc/asterisk/http.conf`:

```ini
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088
tlsenable=yes
tlsbindaddr=0.0.0.0:8089
tlscertfile=/etc/asterisk/keys/asterisk.pem
tlsprivatekey=/etc/asterisk/keys/asterisk.key
```

### Generate a self-signed certificate (if needed)

Skip this if your FreePBX already has certificates configured (check the paths above).

```bash
mkdir -p /etc/asterisk/keys
openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout /etc/asterisk/keys/asterisk.key \
  -out /etc/asterisk/keys/asterisk.pem \
  -subj "/CN=$(hostname)"

chown asterisk:asterisk /etc/asterisk/keys/*
chmod 640 /etc/asterisk/keys/*
```

### Accept the certificate in your browser

Browsers silently block WSS connections to self-signed certificates. You **must** either:
- Navigate to `https://PBX_IP:8089` in your browser and accept the certificate, OR
- Use a proper certificate (Let's Encrypt, etc.)

## 2. Create a WebSocket Transport

### On FreePBX (GUI)

1. Go to **Settings > Asterisk SIP Settings > SIP Settings** tab
2. Find the transport list (udp / tcp / tls / ws / wss checkboxes)
3. Make sure **`udp`** is enabled on port **5060** (required for SIP signaling)
4. Enable **`ws`** and **`wss`**
5. Click **Submit**, then **Apply Config**

This tells FreePBX to generate the WSS transport automatically. If you don't see ws/wss options in your FreePBX version, add it manually via SSH:

```bash
cat >> /etc/asterisk/pjsip_custom.conf << 'EOF'

[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0
EOF
```

Then in FreePBX GUI: **Apply Config** (or `fwconsole reload`).

### On plain Asterisk

Add to `/etc/asterisk/pjsip.conf`:

```ini
[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0
```

## 3. Create WebRTC PJSIP Endpoints

Each softphone account needs a PJSIP endpoint with specific WebRTC settings. Without these, calls will fail with **488 Not Acceptable Here**.

### On FreePBX (GUI)

1. **Applications > Extensions > Add New SIP [pjsip] Extension**
2. Set the extension number (e.g., 6001) and a password
3. Note the credentials from the **General** tab — you'll need these for the softphone config:

| Field | Where to find it | Maps to |
|-------|-----------------|---------|
| **Extension Number** | General tab, top of the page (e.g., `6001`) | `extension` in SIP_ACCOUNTS |
| **Secret** | General tab → "Secret" field (auto-generated, e.g., `684e3ade31da...`) | `password` in SIP_ACCOUNTS |
| **Password For New User** | General tab → User Manager Settings section | Do NOT use — this is for the FreePBX web portal |

> **Important:** FreePBX shows **two** passwords on the extension page. You need the **Secret** (SIP registration password), **not** "Password For New User" (that one is for the FreePBX User Control Panel web login). If registration fails, try the other one to be sure.

4. Under the **Advanced** tab, set **ALL** of the following:

| Setting | Value | Required |
|---------|-------|----------|
| Force WebSocket Mode | **pjsip** | Yes |
| Enable AVPF | **Yes** | Yes |
| Enable ICE Support | **Yes** | Yes |
| Enable rtcp Mux | **Yes** | Yes |
| Enable WebRTC defaults | **Yes** | Yes |
| Media Encryption | **DTLS-SRTP** | Yes |

5. Under the **DTLS** section (same Advanced tab):

| Setting | Value | Required |
|---------|-------|----------|
| Enable DTLS | **Yes** | Yes |
| Auto Generate Certificate | **Yes** | Yes |
| DTLS Verify | Fingerprint | |
| DTLS Setup | Act/Pass | |

6. Click **Submit**, then **Apply Config** (red bar at top)

> **Important:** After clicking Submit, you MUST click **Apply Config** — otherwise the settings will NOT take effect. You can verify with SSH: `asterisk -rx "pjsip show endpoint 6001" | grep webrtc` should show `webrtc: yes`.

If the GUI settings don't apply (check with the command above), force it via SSH:

```bash
cat >> /etc/asterisk/pjsip_custom_post.conf << 'EOF'

[6001](+)
webrtc=yes
dtls_auto_generate_cert=yes
EOF

fwconsole reload
```

### On plain Asterisk (config files)

```ini
[6001]
type=endpoint
transport=transport-wss
webrtc=yes
context=from-internal
disallow=all
allow=opus,ulaw
auth=6001-auth
aors=6001-aor
dtls_auto_generate_cert=yes

[6001-auth]
type=auth
auth_type=userpass
username=6001
password=YourSecurePassword

[6001-aor]
type=aor
max_contacts=1
remove_existing=yes
```

Create as many endpoints as you need (6001, 6002, etc.) for different test accounts.

## 4. Reload Asterisk

```bash
asterisk -rx "module reload res_http_websocket.so"
asterisk -rx "pjsip reload"
```

On FreePBX you can also just click **Apply Config** in the GUI.

## 5. Configure AriLink Environment

Add these to your `.env` file:

```bash
# WebRTC Softphone
SIP_WS_URL=wss://192.168.1.20:8089/ws
SIP_DOMAIN=192.168.1.20
SIP_ACCOUNTS=[{"extension":"6001","password":"YourSecurePassword","label":"Test Line 1"},{"extension":"6002","password":"AnotherPassword","label":"Test Line 2"}]
STUN_SERVER=stun:stun.l.google.com:19302
SIP_CODECS=opus,PCMU,PCMA,G722,telephone-event
```

| Variable | Description | Default |
|----------|-------------|---------|
| `SIP_WS_URL` | WebSocket URL to Asterisk (wss:// for prod, ws:// for dev) | — |
| `SIP_DOMAIN` | SIP domain (PBX IP or hostname) | — |
| `SIP_ACCOUNTS` | JSON array of `{extension, password, label}` objects | `[]` |
| `STUN_SERVER` | STUN server for ICE/NAT traversal | `stun:stun.l.google.com:19302` |
| `SIP_CODECS` | Comma-separated audio codecs in priority order | `opus,PCMU,PCMA,G722,telephone-event` |

Replace the IP and credentials with your actual values.

## 6. Verify

### Test WebSocket connectivity

Open browser DevTools console and run:

```js
const ws = new WebSocket("wss://YOUR_PBX_IP:8089/ws");
ws.onopen = () => console.log("WSS connected!");
ws.onerror = (e) => console.log("WSS error:", e);
```

If this fails, check:
- Firewall allows port 8089/TCP
- TLS certificate is accepted by browser
- `http.conf` has `tlsenable=yes`

### Test SIP registration

Check Asterisk CLI:

```bash
asterisk -rx "pjsip show registrations"
asterisk -rx "pjsip show endpoints"
```

After the dashboard softphone connects, you should see the WebRTC endpoint registered.

## Development vs Production

### Quick start (development only)

If TLS/WSS isn't working yet, you can use plain WebSocket for local testing:

```bash
SIP_WS_URL=ws://192.168.1.20:8088/ws
```

This only works when the dashboard is served over HTTP (not HTTPS), since browsers block mixed content (`ws://` from an `https://` page).

### Production: WSS is required

For production you **must** use `wss://` (TLS). If port 8089 refuses connections, SSH into FreePBX and diagnose:

```bash
# 1. Is TLS actually enabled?
asterisk -rx "http show status"
# Look for "HTTPS Server Enabled and Bound to 0.0.0.0:8089"

# 2. Do the certificate files exist and are readable?
ls -la /etc/asterisk/keys/integration/certificate.pem
ls -la /etc/asterisk/keys/integration/webserver.key

# 3. Check Asterisk logs for TLS errors
grep -i "tls\|ssl\|cert" /var/log/asterisk/full | tail -20
```

The most common cause: the cert paths in FreePBX Advanced Settings point to files that **don't exist**, so Asterisk silently skips starting the HTTPS listener. Fix the paths (or generate a self-signed cert — see Section 1), then reload:

```bash
asterisk -rx "module reload res_http_websocket.so"
```

Verify with curl:

```bash
curl -k https://YOUR_PBX_IP:8089/ws
# Should return "426 Upgrade Required" — this means WSS is ready
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "WebSocket connection failed" | Accept self-signed cert at `https://PBX_IP:8089` |
| Port 8089 connection refused | TLS cert paths are wrong or missing — see "Production: WSS is required" above |
| "403 Forbidden" on WSS | Ensure `res_http_websocket.so` is loaded: `module load res_http_websocket.so` |
| No audio after connect | Check STUN server config, firewall rules for UDP (RTP ports 10000-20000) |
| "Registration failed" | Verify username/password match PJSIP auth config |
| "488 Not Acceptable Here" on INVITE | Extension missing WebRTC settings — see Section 3 (AVPF, ICE, DTLS-SRTP, WebRTC defaults must ALL be enabled) |
| One-way audio | Ensure `webrtc=yes` is set (enables ICE/DTLS for NAT traversal) |
