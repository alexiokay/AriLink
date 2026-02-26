#!/bin/bash
set -e

ARI_USER="${ASTERISK_LOGIN:-arilink}"
ARI_PASS="${ASTERISK_PASSWORD:-arilink123}"
STASIS_APP="${STASIS_APP_NAME:-stasis-app}"

echo "[AriLink Asterisk] Configuring ARI user: $ARI_USER"
echo "[AriLink Asterisk] Stasis app name: $STASIS_APP"

# ─── Sound Files (auto-download on first run) ───
# With bind mounts, /var/lib/asterisk/sounds starts empty on first run.
# Download core English sounds if the directory has no .ulaw files yet.
if [ ! -f /var/lib/asterisk/sounds/en/beep.ulaw ]; then
  echo "[AriLink Asterisk] Downloading core English sounds (first run)..."
  mkdir -p /var/lib/asterisk/sounds/en
  cd /var/lib/asterisk/sounds/en
  curl -sSL https://downloads.asterisk.org/pub/telephony/sounds/asterisk-core-sounds-en-ulaw-current.tar.gz | tar xz
  echo "[AriLink Asterisk] Core sounds installed ($(ls -1 *.ulaw 2>/dev/null | wc -l) files)"
  cd /
else
  echo "[AriLink Asterisk] Core sounds already present — skipping download"
fi
mkdir -p /var/lib/asterisk/sounds/custom
chown -R asterisk:asterisk /var/lib/asterisk/sounds/

# Copy staged configs into /etc/asterisk (which is a Docker VOLUME).
# This ensures fresh configs on every container start, even if the volume persists.
cp -f /opt/arilink-config/*.conf /etc/asterisk/

# Substitute placeholders in config files
for conf in /etc/asterisk/ari.conf /etc/asterisk/extensions.conf; do
  if [ -f "$conf" ]; then
    sed -i "s/__ARI_USER__/$ARI_USER/g" "$conf"
    sed -i "s/__ARI_PASS__/$ARI_PASS/g" "$conf"
    sed -i "s/__STASIS_APP__/$STASIS_APP/g" "$conf"
  fi
done

# ─── NAT / WebRTC Configuration ───
# Detect the external IP for WebRTC ICE candidates.
# Without this, Asterisk advertises its container IP (172.x.x.x) and browsers can't reach it.

# Get container's own IP (for local_net and ICE candidate mapping)
CONTAINER_IP=$(hostname -I | awk '{print $1}')
CONTAINER_SUBNET=$(echo "$CONTAINER_IP" | sed 's/\.[0-9]*$/.0\/16/')

# Determine external IP
HOST_IP=""
if [ -n "$EXTERNAL_IP" ]; then
  # Explicit override via env var (recommended for VPS / production)
  HOST_IP="$EXTERNAL_IP"
  echo "[AriLink Asterisk] Using EXTERNAL_IP from env: $HOST_IP"
elif getent ahostsv4 host.docker.internal > /dev/null 2>&1; then
  # Docker Desktop (Windows/Mac) — use host.docker.internal
  HOST_IP=$(getent ahostsv4 host.docker.internal | awk 'NR==1{print $1}')
  echo "[AriLink Asterisk] Auto-detected Docker Desktop host: $HOST_IP"
else
  # Fallback: default gateway (Linux Docker)
  HOST_IP=$(ip route | awk '/default/ {print $3}')
  echo "[AriLink Asterisk] Using default gateway as host IP: $HOST_IP"
fi

if [ -n "$HOST_IP" ]; then
  echo "[AriLink Asterisk] NAT config: container=$CONTAINER_IP, external=$HOST_IP"

  # Add external_media_address to BOTH transports for NAT traversal.
  # This tells Asterisk to advertise HOST_IP in SDP c= line instead of container IP.
  sed -i "/^\[transport-udp\]/,/^\[/ {
    /^bind=/ a\\
external_media_address=$HOST_IP\\
external_signaling_address=$HOST_IP\\
local_net=$CONTAINER_SUBNET
  }" /etc/asterisk/pjsip.conf

  sed -i "/^\[transport-ws\]/,/^\[/ {
    /^bind=/ a\\
external_media_address=$HOST_IP\\
external_signaling_address=$HOST_IP\\
local_net=$CONTAINER_SUBNET
  }" /etc/asterisk/pjsip.conf

  # ─── ICE Host Candidate Mapping ───
  # This is the KEY fix for Docker WebRTC audio.
  # Format: [ice_host_candidates] section with "local_ip => advertised_ip"
  # Tells Asterisk to replace container IP with host IP in ICE candidates.
  # IMPORTANT: stunaddr must NOT be set when using ice_host_candidates.
  cat >> /etc/asterisk/rtp.conf << EOF

[ice_host_candidates]
$CONTAINER_IP => $HOST_IP
EOF

  echo "[AriLink Asterisk] ICE host candidate: $CONTAINER_IP => $HOST_IP"
else
  echo "[AriLink Asterisk] WARNING: Could not detect host IP — using STUN fallback"
  # No explicit mapping available — fall back to STUN for NAT discovery
  sed -i '/^\[general\]/,/^\[/ {
    /^icesupport=yes/ a\
stunaddr=stun.l.google.com:19302
  }' /etc/asterisk/rtp.conf
fi

# Ensure correct ownership
chown -R asterisk:asterisk /etc/asterisk/

echo "[AriLink Asterisk] Starting Asterisk..."
exec asterisk -fvvv
