#!/bin/bash
set -e

ARI_USER="${ASTERISK_LOGIN:-arilink}"
ARI_PASS="${ASTERISK_PASSWORD:-arilink123}"
STASIS_APP="${STASIS_APP_NAME:-stasis-app}"

echo "[AriLink Asterisk] Configuring ARI user: $ARI_USER"
echo "[AriLink Asterisk] Stasis app name: $STASIS_APP"

# Substitute placeholders in config files
for conf in /etc/asterisk/ari.conf /etc/asterisk/extensions.conf; do
  if [ -f "$conf" ]; then
    sed -i "s/__ARI_USER__/$ARI_USER/g" "$conf"
    sed -i "s/__ARI_PASS__/$ARI_PASS/g" "$conf"
    sed -i "s/__STASIS_APP__/$STASIS_APP/g" "$conf"
  fi
done

# Ensure correct ownership
chown -R asterisk:asterisk /etc/asterisk/

echo "[AriLink Asterisk] Starting Asterisk..."
exec asterisk -fvvv
