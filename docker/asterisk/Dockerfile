FROM andrius/asterisk:23

# Switch to root for config and entrypoint setup
USER root

# Copy custom configuration
COPY config/ari.conf /etc/asterisk/ari.conf
COPY config/http.conf /etc/asterisk/http.conf
COPY config/extensions.conf /etc/asterisk/extensions.conf
COPY config/pjsip.conf /etc/asterisk/pjsip.conf
COPY config/modules.conf /etc/asterisk/modules.conf
COPY config/rtp.conf /etc/asterisk/rtp.conf

# Copy entrypoint, make executable, strip any Windows CRLF
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && sed -i 's/\r$//' /entrypoint.sh

# Ensure asterisk owns its config
RUN chown -R asterisk:asterisk /etc/asterisk/

# SIP signaling + ARI HTTP + RTP media
EXPOSE 5060/udp 8088 10000-10100/udp

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=10s \
  CMD asterisk -rx "ari show status" | grep -q "Enabled" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
