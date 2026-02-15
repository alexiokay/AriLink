# FreePBX Configuration for AriLink

Configure an **existing FreePBX installation** to work with AriLink.

> **📦 Need to install FreePBX first?** See [freepbx-setup.md](./freepbx-setup.md) for VM setup and FreePBX installation.
>
> **This guide assumes you already have:**
> - FreePBX installed and running
> - Web access to FreePBX admin panel
> - SSH/console access to the server

---

## 📋 What This Guide Covers

This guide shows you how to configure FreePBX for:
- ✅ **ARI (Asterisk REST Interface)** - Allows Node.js to control Asterisk
- ✅ **Custom Dialplan** - Routes calls to your Stasis application
- ✅ **NAT & Firewall** - Proper network configuration
- ✅ **Testing & Verification** - Ensure everything works

> **🔗 For 3CX SIP Trunk setup**, see [3CX-INTEGRATION.md](./3CX-INTEGRATION.md) - covers both Asterisk-side and 3CX-side trunk configuration.
> **🔗 For advanced dialplan routing**, see [DIALPLAN-CONFIG.md](./DIALPLAN-CONFIG.md) - multiple routing strategies.

---

## 📋 Prerequisites

- FreePBX installed and accessible
- SSH/console access to FreePBX server
- Public IP or domain for your FreePBX server (if accepting external calls)

---

## 1️⃣ Create ARI User

ARI (Asterisk REST Interface) allows your Node.js application to control Asterisk.

> **Important: FreePBX vs plain Asterisk**
>
> FreePBX auto-generates `ari.conf` and `ari_additional.conf` from its database on every reload and reboot. **Do NOT edit these files directly** — FreePBX will overwrite your changes and ARI endpoints may fail to register after reboot.
>
> - **FreePBX**: Always use **Method A** (GUI) for user management.
> - **Plain Asterisk** (no FreePBX): Use **Method B** (config file) — you own the config files.

### Method A: Via FreePBX GUI (recommended for FreePBX)

**Settings** → **Asterisk REST Interface Users**

1. Click **Add User**
2. Fill in:
   - **Username**: `asterisk-ari` (or any name)
   - **Password**: use **alphanumeric characters only** (special characters can break FreePBX's config generator)
   - **Read-Only**: No
3. Click **Submit**, then **Apply Config**

For the `[general]` section (enabling ARI), use `ari_general_custom.conf`:

```bash
sudo nano /etc/asterisk/ari_general_custom.conf
```

This file should ONLY contain general settings, **not user definitions**:

```ini
[general]
enabled=yes
pretty=yes
allowed_origins=*
```

Then apply:

```bash
fwconsole reload
```

> **Known FreePBX bug**: ARI HTTP endpoints may not register on boot despite modules being loaded. If ARI fails after VM/server restart, run:
> ```bash
> asterisk -rx "module reload res_ari.so"
> ```
> To automate this fix permanently, create a systemd service:
> ```bash
> cat > /etc/systemd/system/ari-fix.service << 'EOF'
> [Unit]
> Description=Reload ARI modules after Asterisk starts
> After=asterisk.service
> Requires=asterisk.service
>
> [Service]
> Type=oneshot
> ExecStartPre=/bin/sleep 15
> ExecStart=/usr/sbin/asterisk -rx "module reload res_ari.so"
> ExecStartPost=/usr/sbin/asterisk -rx "module reload res_http_websocket.so"
> RemainAfterExit=yes
>
> [Install]
> WantedBy=multi-user.target
> EOF
>
> systemctl daemon-reload
> systemctl enable ari-fix.service
> ```

### Method B: Via Config File (plain Asterisk only — NOT for FreePBX)

SSH into the Asterisk server and edit ARI configuration:

```bash
sudo nano /etc/asterisk/ari.conf
```

Add or modify:

```ini
[general]
enabled = yes
pretty = yes
allowed_origins=*

[asterisk-ari]
type = user
read_only = no
password = YOUR_STRONG_PASSWORD_HERE
```

Save and reload:

```bash
asterisk -rx "module reload res_ari.so"
```

### Update .env file:

```bash
ASTERISK_LOGIN=asterisk-ari
ASTERISK_PASSWORD=YOUR_STRONG_PASSWORD_HERE
PBX_IP=192.168.178.11
STASIS_APP_NAME=stasis-app
```

---

## 2️⃣ Configure Custom Dialplan

Since Stasis applications don't appear in FreePBX GUI destinations, we use custom dialplan.

### Edit extensions_custom.conf:

```bash
sudo nano /etc/asterisk/extensions_custom.conf
```

### Add these contexts:

```ini
; ============================================
; Stasis Application Context
; ============================================
[stasis-app]
exten => _X.,1,NoOp(AriLink - Incoming: ${CALLERID(num)})
 same => n,Stasis(stasis-app,${EXTEN},${CALLERID(num)})
 same => n,Hangup()

; ============================================
; Route ALL Trunk Calls to Stasis
; ============================================
[from-trunk-custom]
; Catch any incoming call from external trunks
exten => _X.,1,NoOp(External call from ${CALLERID(num)} to ${EXTEN})
 same => n,Goto(stasis-app,${EXTEN},1)

; ============================================
; Optional: Route Internal Calls to Stasis
; ============================================
; Uncomment if you want internal calls to go through your app too
;[from-internal-custom]
;exten => _X.,1,NoOp(Internal call from ${CALLERID(num)} to ${EXTEN})
; same => n,Goto(stasis-app,${EXTEN},1)
```

### Reload dialplan:

```bash
asterisk -rx "dialplan reload"
```

### Verify dialplan loaded:

```bash
asterisk -rx "dialplan show stasis-app"
```

You should see:

```
[ Context 'stasis-app' created by 'pbx_config' ]
  '_X.' =>          1. NoOp(AriLink - Incoming: ${CALLERID(num)})
                    2. Stasis(stasis-app,${EXTEN},${CALLERID(num)})
                    3. Hangup()
```

---

## 3️⃣ Create SIP Trunk (Optional)

Configure a SIP trunk if you need to transfer calls to an external system (e.g., 3CX, another PBX, or SIP provider).

> **📖 For 3CX-specific trunk setup**, see [3CX-INTEGRATION.md](./3CX-INTEGRATION.md).

---

## 4️⃣ Configure HTTP Server for ARI

Ensure ARI is accessible via HTTP.

```bash
sudo nano /etc/asterisk/http.conf
```

Verify these settings:

```ini
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088
```

Reload:

```bash
asterisk -rx "http reload"
```

---

## 5️⃣ Configure NAT Settings (if behind router/firewall)

**Settings** → **Asterisk SIP Settings** → **NAT Settings**

**External Address:**
- Enter your **public IP** or **domain** (e.g., from Cloudflare DNS)

**Local Networks:**
- `192.168.178.0/255.255.255.0` (adjust to your network)
- Or use CIDR: `192.168.178.0/24`

**Apply Config** when done.

---

## 6️⃣ Configure Transfer Destination (Optional)

If using an external system (3CX, another PBX) as transfer destination:

> **📖 For 3CX setup**, see [3CX-INTEGRATION.md](./3CX-INTEGRATION.md#part-1-configure-3cx-side).

---

## 7️⃣ Firewall & Port Forwarding

### Ports to Open:

**For SIP (signaling):**
- `5060/UDP` - SIP traffic

**For RTP (audio):**
- `10000-20000/UDP` - RTP media streams

### FreePBX Firewall (if enabled):

**Admin** → **Firewall**

**Services:**
- ✅ Asterisk (SIP)
- ✅ RTP

**Trusted Networks:**
- Add 3CX server IP (if local)
- Add your office IP (if remote management)

---

## 8️⃣ Verify Configuration

### Test ARI Connection:

From any computer:

```bash
curl -u asterisk-ari:your-password http://YOUR_FREEPBX_IP:8088/ari/asterisk/info
```

Expected: JSON response with Asterisk system info (42+ bytes)

### Test Dialplan:

```bash
asterisk -rx "dialplan show stasis-app"
```

Expected: Should show your `[stasis-app]` context with 3 steps

### Test SIP Trunk (if configured):

```bash
asterisk -rx "pjsip show endpoints"
```

Look for your trunk name in the list

---

## 9️⃣ Environment Variables

Update your `.env` file with all settings:

```bash
# ============================================
# FreePBX / Asterisk Configuration
# ============================================
PBX_IP=192.168.178.11
ASTERISK_LOGIN=asterisk-ari
ASTERISK_PASSWORD=your_strong_password

# ============================================
# Stasis Application
# ============================================
STASIS_APP_NAME=stasis-app

# ============================================
# Server Configuration
# ============================================
LISTENER_SERVER=0.0.0.0:8000
EXTERNAL_HOST=your-public-ip-or-domain
WSS_PORT=3044

# ============================================
# Transcription Services
# ============================================
TRANSCRIPTION_SERVICES=ws://localhost:5000
```

> **🔗 For transfer destination setup** (`TRANSFER_DESTINATION`, `TRANSFER_TRUNK`), see [.env.example](../.env.example).
> **🔗 For 3CX-specific setup**, see [3CX-INTEGRATION.md](./3CX-INTEGRATION.md).

---

## ✅ Setup Checklist

Before starting your Node.js server, verify:

- [ ] ARI user created (test with curl)
- [ ] Custom dialplan configured (`[stasis-app]` and `[from-trunk-custom]`)
- [ ] Dialplan reloaded and verified
- [ ] NAT settings configured (external address set)
- [ ] Firewall allows SIP (5060/UDP) and RTP (10000-20000/UDP)
- [ ] HTTP server enabled (port 8088)
- [ ] `.env` file updated with all credentials
- [ ] Transfer destination configured (if needed) - see `.env.example`

---

## 🚀 Start Your Application

```bash
cd /path/to/arilink
npm start
```

Expected output:

```
Starting ARI application: stasis-app
Listening on *:3011
WebSocket connection to AriTranscriber server established
```

---

## 🔧 Troubleshooting

### "Channel not entered into Stasis app"
- Check dialplan: `asterisk -rx "dialplan show stasis-app"`
- Verify app name matches in code and dialplan
- Check Asterisk logs: `tail -f /var/log/asterisk/full`

### "ARI connection failed"
- Test with curl (see step 8)
- Check HTTP server: `asterisk -rx "http show status"` — look for `/ari` in the registered URIs
- Verify credentials in `.env` match what's configured in ARI
- **FreePBX reboot issue**: If ARI worked before a reboot but not after, run `asterisk -rx "module reload res_ari.so"` — see the systemd fix in Step 1
- **Do not edit `ari.conf` directly on FreePBX** — use the GUI (Settings → Asterisk REST Interface Users). Direct edits get overwritten and can cause ARI endpoints to fail silently

### "SIP trunk not connecting"
- Check trunk credentials and IP addresses
- For 3CX-specific issues, see [3CX-INTEGRATION.md Troubleshooting](./3CX-INTEGRATION.md#%EF%B8%8F-common-issues--solutions)

### "No audio during call"
- Check RTP ports: `10000-20000/UDP` open
- Check NAT settings (external address configured)

---

## 📚 Related Documentation

- [3CX Integration Guide](./3CX-INTEGRATION.md)
- [Dialplan Configuration Options](./DIALPLAN-CONFIG.md)
- [Parakeet Transcription Setup](../parakeet-service/README.md)

---

## 🆘 Support

If you encounter issues:

1. Check Asterisk logs: `tail -f /var/log/asterisk/full`
2. Enable ARI debugging: `asterisk -rx "ari set debug all on"`
3. Check console output of your Node.js app
4. Review FreePBX system logs: **Admin** → **Logs**

---

**Last Updated:** 2026-02-10
