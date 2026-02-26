FROM andrius/asterisk:23

# Switch to root for config and entrypoint setup
USER root

# Stage configs — /etc/asterisk is a Docker VOLUME in the base image,
# so COPY to it gets hidden by persisted volume data on recreate.
# Entrypoint copies from staging dir at runtime instead.
COPY config/ /opt/arilink-config/

# Copy entrypoint, make executable, strip any Windows CRLF
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && sed -i 's/\r$//' /entrypoint.sh

# Install ca-certificates for HTTPS downloads in entrypoint (sound files)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Ensure asterisk owns its config
RUN chown -R asterisk:asterisk /etc/asterisk/

# SIP signaling + ARI HTTP + RTP media
EXPOSE 5060/udp 8088 10000-10100/udp

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=10s \
  CMD asterisk -rx "ari show status" | grep -q "Enabled" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
