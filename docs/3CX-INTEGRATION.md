# 3CX Integration Guide

This guide explains how to integrate your AriLink with 3CX to route calls to Ring Groups after voice capture.

> **📖 Prerequisites:** Make sure you've completed [FREEPBX-ARI-CONFIGURATION.md](./FREEPBX-ARI-CONFIGURATION.md) first (ARI user, basic dialplan, HTTP server).

---

## 🎯 Overview

**Goal:** After capturing the caller's name via transcription, immediately transfer the call to a 3CX Ring Group.

**Architecture:**
```
Asterisk/FreePBX (Your Server)
         ↓ SIP Trunk
    3CX Server
         ↓
   Ring Groups
```

---

## ✅ Feasibility

**YES, this integration is fully supported and commonly implemented.**

Based on extensive community documentation and real-world deployments:
- Asterisk and 3CX are SIP-compliant and work together
- Generic SIP Trunks are the recommended method
- Ring Groups can be reached via trunk dialing
- Immediate call bridging is supported in ARI

---

## 📋 Prerequisites

### What You Need

1. **3CX Server Access**
   - Admin credentials
   - IP address or FQDN
   - Network access from Asterisk server

2. **3CX Ring Group**
   - Ring Group extension number (e.g., 600, 700)
   - Ring strategy configured (Ring All, Hunt, etc.)

3. **Network Configuration**
   - Both servers can communicate on ports 5060 (SIP) and 10000-20000 (RTP)
   - Firewall rules allow SIP/RTP traffic
   - Low latency connection (<50ms recommended)

---

## 🔧 Configuration Steps

### Part 1: Configure 3CX Side

#### Step 1: Create Generic SIP Trunk

1. **Log into 3CX Management Console**
2. **Navigate to:** SIP Trunks → Add SIP Trunk
3. **Select:** Generic SIP Trunk (not Bridge Trunk)

#### Step 2: Configure Trunk Settings

**Main Settings:**
```
Trunk Name: Asterisk-Server
Type: Generic
Main Trunk No: (auto-assign)
Registrar/Server: [Your Asterisk IP] (e.g., 192.168.178.11)
Port: 5060
```

**Authentication:**
- **Option A - IP Authentication** (Recommended for local networks):
  ```
  Authentication: None
  Allowed IP: [Your Asterisk IP]
  ```

- **Option B - Username/Password:**
  ```
  Authentication ID: asterisk_user
  Username: asterisk_user
  Password: [strong password]
  ```

**Advanced Settings:**
```
Delivery Method: Direct to extensions
Maximum Channels: 10 (or as needed)
SIP Transport: UDP
Codec Preference: ulaw, alaw, G.722
```

#### Step 3: Create Inbound Rule

1. **Navigate to:** Inbound Rules → Add Rule
2. **Configure:**
   ```
   Rule Name: From Asterisk to Ring Group
   Trunk: Asterisk-Server
   DID/Extension Pattern: * (or specific pattern)
   Route to: Ring Group → [Your Ring Group]
   ```

#### Step 4: Test Trunk Status

- Check trunk status in 3CX dashboard
- Should show "Registered" or "Connected"

---

### Part 2: Configure Asterisk/FreePBX Side

#### Step 1: Create SIP Trunk in FreePBX

1. **Navigate to:** Connectivity → Trunks → Add Trunk → Add SIP (chan_pjsip) Trunk

2. **General Settings:**
   ```
   Trunk Name: 3cx-trunk
   Outbound CallerID: [Your business number]
   Maximum Channels: 10
   ```

3. **pjsip Settings - General Tab:**
   ```
   Username: asterisk_user (if using auth)
   Secret: [password] (if using auth)
   Authentication: Outbound
   Registration: None (if using IP auth)
   SIP Server: [3CX IP address]
   SIP Server Port: 5060
   Context: from-pstn
   ```

4. **pjsip Settings - Advanced Tab:**
   ```
   Context: from-pstn
   Transport: transport-udp
   Allowed Codecs: ulaw, alaw, g722
   DTMFmode: RFC4733
   ```

5. **Click:** Submit → Apply Config

#### Step 2: Create Outbound Route

1. **Navigate to:** Connectivity → Outbound Routes → Add Route

2. **Route Settings:**
   ```
   Route Name: To-3CX-RingGroups
   Route CID: [optional]
   ```

3. **Dial Patterns:**
   ```
   Match Pattern: 6XX (if Ring Groups are 600-699)
   Prepend: (leave empty)
   Prefix: (leave empty)
   ```

4. **Trunk Sequence:**
   - Select: `3cx-trunk`
   - Move to top of sequence

5. **Click:** Submit → Apply Config

#### Step 3: Test SIP Trunk

**From Asterisk CLI:**
```bash
# SSH into FreePBX
ssh root@[FreePBX-IP]

# Enter Asterisk CLI
asterisk -rvvv

# Check PJSIP endpoints
pjsip show endpoints

# Check PJSIP registration
pjsip show registrations

# Test OPTIONS ping to 3CX
pjsip send notify test_notification 3cx-trunk
```

---

### Part 3: Create Custom Dialplan (Recommended)

This gives you more control over the routing logic.

#### Create Custom Context

1. **SSH into FreePBX:**
   ```bash
   ssh root@[FreePBX-IP]
   ```

2. **Edit custom dialplan:**
   ```bash
   nano /etc/asterisk/extensions_custom.conf
   ```

3. **Add custom context:**
   ```asterisk
   [to-3cx]
   ; Route calls to 3CX Ring Groups
   ; Usage: Dial(Local/600@to-3cx) for Ring Group 600

   exten => _6XX,1,NoOp(=== Routing to 3CX Ring Group ${EXTEN} ===)
   exten => _6XX,n,Set(CALLERID(num)=${CALLERID(num)})
   exten => _6XX,n,Set(CALLERID(name)=${CALLERID(name)})
   exten => _6XX,n,Dial(PJSIP/${EXTEN}@3cx-trunk,30,rtT)
   exten => _6XX,n,GotoIf($["${DIALSTATUS}" = "ANSWER"]?answered:failed)
   exten => _6XX,n(answered),Hangup()
   exten => _6XX,n(failed),NoOp(Call to 3CX failed: ${DIALSTATUS})
   exten => _6XX,n,Playback(cannot-complete-as-dialed)
   exten => _6XX,n,Hangup()

   ; Catch-all for other extensions
   exten => _XXX,1,NoOp(=== Routing to 3CX Extension ${EXTEN} ===)
   exten => _XXX,n,Dial(PJSIP/${EXTEN}@3cx-trunk,30,rtT)
   exten => _XXX,n,Hangup()
   ```

4. **Reload dialplan:**
   ```bash
   asterisk -rx "dialplan reload"
   ```

---

## 💻 Code Implementation

### Update Environment Variables

Add to your `.env` file:

```env
# 3CX Integration
RING_GROUP_3CX=600
TRUNK_3CX=3cx-trunk
```

### Update `.env.example`

```env
# 3CX Integration (Required for client deployment)
RING_GROUP_3CX=600                    # Ring Group extension in 3CX
TRUNK_3CX=3cx-trunk                   # SIP trunk name configured in FreePBX
```

### Implementation in AriControllerServer.ts

Find the section where you handle transcription results (around line 200-250), and add the 3CX transfer logic:

```typescript
// Add near the top with other imports
const RING_GROUP_3CX = process.env.RING_GROUP_3CX || "600";
const TRUNK_3CX = process.env.TRUNK_3CX || "3cx-trunk";

// Add helper method to AriControllerServer class
private async transferTo3CXRingGroup(
  session: CallSession,
  callerName: string
): Promise<void> {
  console.log(`[3CX Transfer] Initiating transfer to Ring Group ${RING_GROUP_3CX}`);
  console.log(`[3CX Transfer] Caller name: ${callerName}`);

  try {
    // Option 1: Using custom dialplan context (RECOMMENDED)
    const endpoint = `Local/${RING_GROUP_3CX}@to-3cx`;

    // Option 2: Direct PJSIP endpoint (alternative)
    // const endpoint = `PJSIP/${RING_GROUP_3CX}@${TRUNK_3CX}`;

    const outgoingChannelParams = {
      endpoint: endpoint,
      app: "stasis-app",
      callerId: session.callerNumber,
      appArgs: "to-3cx",
      headers: {
        "X-Session-ID": session.id,
        "X-Caller-Name": callerName,
        "X-Transfer-Time": new Date().toISOString(),
      },
    };

    console.log(`[3CX Transfer] Originating call to ${endpoint}`);

    // Originate call to 3CX
    this.client.channels.originate(
      outgoingChannelParams,
      async (err: any, outgoingChannel: any) => {
        if (err) {
          console.error(`[3CX Transfer] Failed to originate:`, err);

          // Play error message to caller
          await session.channel.play({
            media: "sound:custom/transfer-failed",
          });

          return;
        }

        console.log(`[3CX Transfer] Outgoing channel created: ${outgoingChannel.id}`);

        // Wait for channel to be answered
        outgoingChannel.on("StasisStart", async (event: any) => {
          console.log(`[3CX Transfer] 3CX Ring Group answered`);

          // Bridge the caller to the 3CX Ring Group IMMEDIATELY
          try {
            await this.client.bridges.addChannel({
              bridgeId: session.bridgeId,
              channel: outgoingChannel.id,
            });

            console.log(`[3CX Transfer] ✅ Successfully bridged to Ring Group`);

            // Optionally play a brief tone
            // await session.channel.play({ media: "sound:beep" });

          } catch (bridgeErr) {
            console.error(`[3CX Transfer] Failed to bridge:`, bridgeErr);
          }
        });

        // Handle hangup
        outgoingChannel.on("ChannelHangupRequest", () => {
          console.log(`[3CX Transfer] 3CX side hung up`);
        });
      }
    );

  } catch (error) {
    console.error(`[3CX Transfer] Error:`, error);

    // Play error message to caller
    await session.channel.play({
      media: "sound:custom/transfer-failed",
    });
  }
}

// Modify your transcription handler to trigger transfer
// Find where you handle DTMF "1" and transcription:
private async handleTranscription(
  session: CallSession,
  text: string,
  isFinal: boolean
): Promise<void> {
  console.log(`[Transcription] ${isFinal ? "FINAL" : "interim"}: "${text}"`);

  // For IMMEDIATE transfer, use interim results
  // Transfer as soon as we have a substantial transcription
  if (text.trim().length >= 3) {
    console.log(`[3CX Transfer] Triggering transfer with name: "${text}"`);

    // Store the name
    session.callerName = text.trim();

    // IMMEDIATELY initiate transfer (don't wait for final result)
    await this.transferTo3CXRingGroup(session, text.trim());

    // Stop transcription to save resources
    if (session.transcriber) {
      session.transcriber.stop();
    }
  }
}
```

### Immediate Transfer Logic

For the **CRITICAL requirement** of immediate transfer:

```typescript
// In your transcription callback:
private transcriptionCallback(
  sessionId: string,
  text: string,
  isFinal: boolean
): void {
  const session = this.sessions.get(sessionId);
  if (!session) return;

  console.log(`[Session ${sessionId}] Transcription: "${text}" (final: ${isFinal})`);

  // IMMEDIATE TRANSFER: Don't wait for final result
  // Trigger on first substantial interim transcription
  if (!session.transferInitiated && text.trim().length >= 3) {
    session.transferInitiated = true;

    // Transfer immediately (async, don't wait)
    this.transferTo3CXRingGroup(session, text.trim())
      .catch(err => {
        console.error(`[Session ${sessionId}] Transfer failed:`, err);
        session.transferInitiated = false; // Allow retry
      });
  }
}
```

---

## 🧪 Testing

### Test Plan

#### 1. Test SIP Trunk Connectivity

**From Asterisk CLI:**
```bash
# Check trunk registration
pjsip show endpoints | grep 3cx

# Test dial to 3CX
originate PJSIP/600@3cx-trunk application Playback demo-congrats
```

**Expected:** Should ring 3CX Ring Group 600

#### 2. Test from ARI Server

**Manual Test Call:**
```bash
# Start your ARI server
npm start

# Make test call to your FreePBX number
# Press 1 when prompted
# Speak your name
# Should immediately transfer to 3CX Ring Group
```

#### 3. Test Edge Cases

- **No speech:** Should timeout or retry
- **Unclear speech:** Should still transfer (capture whatever text)
- **3CX unavailable:** Should play error message
- **Ring Group busy:** Should handle appropriately

### Debugging

**Enable SIP debugging:**
```bash
# In Asterisk CLI
pjsip set logger on
pjsip set logger verbose on

# Watch call flow
tail -f /var/log/asterisk/full | grep -E "3cx|PJSIP"
```

**Check 3CX Logs:**
1. Log into 3CX Management Console
2. Navigate to: Logs → Call History
3. Filter by trunk: Asterisk-Server
4. Check call success/failure

---

## ⚠️ Common Issues & Solutions

### Issue 1: Trunk Not Registering

**Symptoms:** Trunk shows "Not Registered" in FreePBX

**Solutions:**
- Verify IP addresses are correct
- Check firewall allows port 5060
- Try IP authentication instead of username/password
- Check 3CX trunk is enabled and online

### Issue 2: Calls Not Reaching 3CX

**Symptoms:** Call originates but never reaches 3CX

**Solutions:**
- Verify outbound route is configured correctly
- Check dial pattern matches Ring Group extension
- Verify trunk is selected in route
- Check Asterisk CLI for error messages

### Issue 3: One-Way Audio

**Symptoms:** Can hear one side but not the other

**Solutions:**
- Check RTP ports (10000-20000) are open in firewall
- Verify NAT settings in both systems
- Check codec compatibility (both should support ulaw/alaw)
- Review `externip` and `localnet` settings in Asterisk

### Issue 4: Caller ID Not Passing

**Symptoms:** 3CX shows wrong or no caller ID

**Solutions:**
- Set CallerID in originate command
- Check "Trust Remote Party ID" in 3CX trunk settings
- Verify Asterisk is sending P-Asserted-Identity headers

### Issue 5: DTMF Not Working

**Symptoms:** Cannot press buttons during call

**Solutions:**
- Set DTMF mode to RFC4733 on both sides
- Verify codec supports DTMF (ulaw/alaw do)
- Check RTP events are allowed

---

## 🎯 Performance Considerations

### Latency

**Target:** <100ms for call setup, <50ms for audio

**Optimization:**
- Place servers on same network/VLAN
- Use dedicated network link if possible
- Monitor network latency: `ping [3CX-IP]`

### Concurrent Calls

**Capacity:**
- SIP trunk can typically handle 10-50 concurrent calls
- Adjust "Maximum Channels" in trunk settings
- Monitor trunk usage in 3CX dashboard

### Audio Quality

**Best Practices:**
- Use ulaw or alaw (G.711) for best quality
- G.722 for HD audio (if supported)
- Avoid transcoding between different codecs
- Monitor jitter and packet loss

---

## 📊 Monitoring & Maintenance

### What to Monitor

1. **Trunk Status**
   - Check daily in 3CX dashboard
   - Set up alerts for trunk down

2. **Call Success Rate**
   - Review 3CX call logs
   - Track failed transfers
   - Monitor call duration

3. **Audio Quality**
   - Listen to recorded calls
   - Check for audio issues
   - Monitor jitter/packet loss

4. **System Resources**
   - CPU usage on both servers
   - Network bandwidth
   - Concurrent call count

### Maintenance Tasks

**Weekly:**
- Review failed calls
- Check error logs
- Verify trunk status

**Monthly:**
- Update both systems if patches available
- Review call statistics
- Optimize configuration if needed

---

## 🔗 References & Resources

### Official Documentation

- [3CX SIP Trunk Configuration](https://www.3cx.com/docs/manual/sip-trunks/)
- [Asterisk PJSIP Configuration](https://wiki.asterisk.org/wiki/display/AST/Configuring+res_pjsip)
- [FreePBX Trunk Configuration](https://wiki.freepbx.org/display/FPG/Trunks)

### Community Resources

- [SIP Trunk With pbx Asterisk | 3CX Forums](https://www.3cx.com/community/threads/sip-trunk-with-pbx-asterisk.126567/)
- [Setup Asterisk to connect to 3CX | 3CX Forums](https://www.3cx.com/community/threads/setup-asterisk-to-connect-to-3cx.6146/)
- [Connection between 3CX and ASTERISK | 3CX Forums](https://www.3cx.com/community/threads/connection-between-3cx-and-asterisk.117480/)
- [Asterisk to 3CX bridging | Asterisk Community](https://community.asterisk.org/t/asterisk-to-3cx-bridging/46845)

### Troubleshooting Guides

- [PBX Integration for 3CX, Asterisk & FreePBX](https://www.didforsale.com/pbx-integration-connect-3cx-asterisk-freepbx)
- [Trunk from Asterisk to 3CX | 3CX Forums](https://www.3cx.com/community/threads/trunk-from-asterisk-to-3cx-without-using-bridge-way.63325/)

---

## ✅ Pre-Launch Checklist

Before deploying to production:

- [ ] 3CX SIP trunk configured and showing "Connected"
- [ ] Asterisk/FreePBX trunk configured with correct settings
- [ ] Outbound route created and trunk selected
- [ ] Custom dialplan context created and tested
- [ ] Environment variables configured in `.env`
- [ ] Code updated with 3CX transfer logic
- [ ] Test call completed successfully end-to-end
- [ ] Audio quality verified (both directions)
- [ ] Immediate transfer working (<1 second delay)
- [ ] Edge cases tested (no speech, busy, unavailable)
- [ ] Monitoring and logging in place
- [ ] Client provided 3CX Ring Group extension number
- [ ] Firewall rules configured for SIP/RTP
- [ ] Documentation shared with client

---

*Last Updated: 2026-02-09*
*Integration Status: PENDING IMPLEMENTATION*
