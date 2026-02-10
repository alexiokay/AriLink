# VPS Deployment Guide

Deploy FreePBX + AriLink on a VPS using Docker.

---

## 1. VPS Requirements

| Spec | Minimum | Recommended |
|------|---------|-------------|
| **CPU** | 2 vCPU | 4 vCPU |
| **RAM** | 4 GB | 8 GB |
| **Disk** | 40 GB SSD | 80 GB SSD |
| **OS** | Debian 12 / Ubuntu 22.04 | Debian 12 |
| **IP** | Static public IP | Static public IP |
| **Ports** | SIP not blocked | SIP not blocked |

**Tested providers:** Vultr, Hetzner, OVH

> **Important:** Some VPS providers block SIP ports (5060/UDP). Vultr and Hetzner do NOT block them.

---

## 2. Initial Server Setup

SSH into your VPS:

```bash
ssh root@YOUR_VPS_IP
```

### Install Docker

```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose plugin
apt install -y docker-compose-plugin

# Verify
docker --version
docker compose version
```

### Configure Firewall

```bash
# Install UFW
apt install -y ufw

# Allow SSH
ufw allow 22/tcp

# Allow Web (FreePBX GUI)
ufw allow 80/tcp
ufw allow 443/tcp

# Allow SIP
ufw allow 5060/udp
ufw allow 5060/tcp

# Allow RTP (audio)
ufw allow 10000:10100/udp

# Allow ARI (internal, optional for remote access)
ufw allow 8088/tcp

# Allow AriLink
ufw allow 3011/tcp

# Enable
ufw enable
```

---

## 3. Deploy AriLink

### Clone the repository

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/arilink.git
cd arilink
```

### Configure environment

```bash
cp .env.example .env
nano .env
```

Edit `.env` with your settings:

```bash
# FreePBX is in Docker - use container name
PBX_IP=freepbx

# ARI credentials (set these AFTER FreePBX first boot)
ASTERISK_LOGIN=admin
ASTERISK_PASSWORD=your_password_here

# Your VPS public IP
EXTERNAL_HOST=YOUR_VPS_PUBLIC_IP

# Transcription (optional - only if using voice features)
# TRANSCRIPTION_SERVICES=ws://parakeet:5000

# Stasis app
STASIS_APP_NAME=stasis-app
```

### Start everything

```bash
docker compose up -d
```

First boot takes 5-10 minutes (FreePBX initializes database, Asterisk modules, etc.)

### Check logs

```bash
# FreePBX startup progress
docker compose logs -f freepbx

# AriLink logs
docker compose logs -f arilink

# Both
docker compose logs -f
```

### Verify services are running

```bash
docker compose ps
```

Expected output:
```
NAME       STATUS          PORTS
freepbx    Up (healthy)    0.0.0.0:80->80/tcp, 0.0.0.0:5060->5060/udp, ...
arilink    Up              0.0.0.0:3011->3011/tcp, ...
```

---

## 4. Configure FreePBX

### Access Web GUI

Open browser: `http://YOUR_VPS_IP`

1. **Create admin account** (first time only)
2. **Activate FreePBX** (free registration)
3. **Apply Config** when prompted

### Set up ARI User

**Settings** -> **Advanced Settings**:
- Find **Asterisk REST Interface** settings
- Note the username/password
- Update your `.env` file to match

Then restart AriLink:
```bash
docker compose restart arilink
```

### Set up SIP Trunk

**Connectivity** -> **Trunks** -> **Add SIP Trunk**:
- Configure your Belgian SIP provider credentials
- Set outbound CallerID

### Set up IVR (if needed)

**Applications** -> **IVR** -> **Add IVR**:
- Upload welcome audio
- Configure DTMF options
- Set destinations

### Set up Inbound Routes

**Connectivity** -> **Inbound Routes** -> **Add Route**:
- **DID Number**: Your incoming number
- **Destination**: IVR or Stasis app (for AriLink)

---

## 5. Common Operations

### Stop all services
```bash
docker compose down
```

### Restart a single service
```bash
docker compose restart freepbx
docker compose restart arilink
```

### Update AriLink code
```bash
git pull
docker compose build arilink
docker compose up -d arilink
```

### View real-time logs
```bash
docker compose logs -f arilink
```

### Access Asterisk CLI
```bash
docker compose exec freepbx asterisk -rvvv
```

### Backup FreePBX data
```bash
# Backup volumes
docker compose down
tar -czf freepbx-backup-$(date +%Y%m%d).tar.gz \
  /var/lib/docker/volumes/arilink_freepbx-data \
  /var/lib/docker/volumes/arilink_freepbx-db
docker compose up -d
```

---

## 6. Upload Custom Audio Files

Place audio files in `assets/sounds/` on the host:

```bash
# From your local machine
scp welcome.wav root@YOUR_VPS_IP:/opt/arilink/assets/sounds/

# Or create the directory first
mkdir -p /opt/arilink/assets/sounds
```

These are mounted into FreePBX at `/var/lib/asterisk/sounds/custom/`.

Reference in FreePBX IVR as: `custom/welcome` (without extension)

---

## 7. SSL/HTTPS (Optional)

For HTTPS on FreePBX GUI, add to `docker-compose.yml` under freepbx environment:

```yaml
- ENABLE_LETSENCRYPT=TRUE
- LETSENCRYPT_HOST=pbx.yourdomain.com
- LETSENCRYPT_EMAIL=you@email.com
```

Or use a reverse proxy (Caddy/Nginx) in front.

---

## 8. Troubleshooting

### FreePBX won't start
```bash
docker compose logs freepbx | tail -50
```
Common issues: port conflicts, insufficient RAM

### AriLink can't connect to FreePBX
```bash
# Check if FreePBX ARI is accessible
docker compose exec arilink curl -u admin:password http://freepbx:8088/ari/asterisk/info
```

### No audio (one-way or no audio)
- Check RTP ports are open: `ufw status`
- Check NAT settings in FreePBX: **Settings** -> **Asterisk SIP Settings** -> **NAT**
- Set **External Address** to your VPS public IP
- Set **Local Networks** to Docker network (`172.16.0.0/12`)

### SIP registration fails
- Verify VPS provider doesn't block port 5060
- Check trunk credentials in FreePBX
- Test with: `docker compose exec freepbx asterisk -rx "pjsip show registrations"`

---

## Quick Reference

| Service | URL/Port | Purpose |
|---------|----------|---------|
| FreePBX GUI | `http://VPS_IP:80` | Web management |
| ARI | `http://VPS_IP:8088` | Asterisk REST API |
| AriLink | `http://VPS_IP:3011` | Node.js app |
| SIP | `VPS_IP:5060/UDP` | Phone registration |
| RTP | `VPS_IP:10000-10100/UDP` | Audio streams |
