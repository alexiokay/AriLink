# 🛠️ FreePBX Server Installation and Configuration Guide

https://www.freepbx.org/get-started/

[![Debian](https://img.shields.io/badge/Debian-12-purple.svg)](https://www.debian.org/)
[![FreePBX](https://img.shields.io/badge/FreePBX-17-orange.svg)](https://www.freepbx.org/)
[![Asterisk](https://img.shields.io/badge/Asterisk-20-red.svg)](https://www.asterisk.org/)

<div align="center">
  <img src="https://www.freepbx.org/wp-content/uploads/Sangoma_FreePBX_Logo_RGB_hori-pos-e1588854523908.png" alt="FreePBX Logo" width="300"/>
  <br>
  <em>Complete guide to setting up and configuring your FreePBX server for use with AriLink</em>
</div>

---

## 🚀 Quick Start Guide

**Already have FreePBX VM running?** Here's how to access it:

1. **Find the IP address** - In the VM console, run:
   ```bash
   hostname -I
   ```
2. **Access web interface** - Open browser on host machine: `http://<VM-IP-ADDRESS>`
3. **First time?** Create admin credentials when prompted
4. **Configure ARI** - See [Configuring ARI](#-configuring-ari-asterisk-rest-interface) section below

---

## 📑 Table of Contents
- [Quick Start Guide](#-quick-start-guide)
- [Virtual Machine Setup](#-virtual-machine-setup)
- [Network Configuration](#-network-configuration)
- [FreePBX Installation](#-freepbx-installation)
- [Configuring ARI](#-configuring-ari-asterisk-rest-interface)
- [Speech Recognition Configuration](#-speech-recognition-configuration)
- [SIP Trunk Configuration](#-sip-trunk-configuration)
- [Testing the Setup](#-testing-the-setup)
- [Additional Resources](#-additional-resources)

---

## 💻 Virtual Machine Setup

<img src="https://cdn-icons-png.flaticon.com/512/6119/6119533.png" alt="VM" width="50" align="right"/>

<details open>
<summary><b>Step-by-step VM Configuration</b></summary>
<p>

1. Create a new virtual machine with the following specifications:
   - Set network adapter to **Bridged** (use the same adapter as your host machine)
   - Configure adequate storage (minimum 20GB recommended)
   - Set boot order: first boot from installation media, then from disk

2. Install Debian 12 as the base operating system
   - Follow the standard Debian installation procedure
   - Select minimal installation options
   - After installation, change boot order: first boot from disk, then from installation media

</p>
</details>

## 🌐 Network Configuration

<img src="https://cdn-icons-png.flaticon.com/512/1373/1373315.png" alt="Network" width="50" align="right"/>

### 🔍 Finding Your FreePBX IP Address

After installation, you need to find your FreePBX server's IP address to access it:

<details open>
<summary><b>Finding the IP Address</b></summary>
<p>

**Inside the FreePBX VM console**, run one of these commands:

```bash
# Option 1: Simple and clear (recommended)
ip a

# Option 2: Just show the IP address
hostname -I

```

Look for an IP address like `192.168.x.x` or `10.x.x.x` under your network interface (usually `eth0` or `ens33`).

**Example output:**
```
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP>
    inet 192.168.1.20/24 brd 192.168.1.255
```
In this example, the IP address is **192.168.1.20**

</p>
</details>

### 🌍 Accessing FreePBX Web Interface

<details open>
<summary><b>First Time Access</b></summary>
<p>

1. Open a web browser on your **host machine** (not the VM)
2. Navigate to: `http://<YOUR-VM-IP-ADDRESS>`
   - Example: `http://192.168.1.20`

**Default Credentials (Sangoma Distribution):**
- **Username:** `admin`
- **Password:** `SangomaDefaultPassword`

**Note:** If using the official Sangoma FreePBX ISO, these are the default credentials. You should change them immediately after first login!

3. **First time with Debian install?** You'll be prompted to create an admin account
4. Follow the setup wizard to complete initial configuration

</p>
</details>

<details>
<summary><b>🔧 Configuring Static IP in FreePBX</b></summary>
<p>

To set a static IP address in FreePBX web interface:

1. **Navigate to:** `Admin` → `System Admin` → `Network Settings`
2. **Select your network interface** (usually `eth0` or `ens33`)
3. **Configure the following:**
   - **Static IP**: Enable static IP mode
   - **IP Address**: Set your desired IP (e.g., `192.168.1.20`)
   - **Netmask**: Usually `255.255.255.0` for `/24` networks
   - **Gateway**: Your router's IP (e.g., `192.168.1.1`)
   - **DNS Servers**: Primary and secondary DNS (e.g., `8.8.8.8`, `8.8.4.4`)
4. **Click Apply** and wait for the network to restart
5. **Access FreePBX** using the new IP address

**Alternative: Command Line Configuration**

For Sangoma distribution, edit the network configuration file:
```bash
nano /etc/sysconfig/network-scripts/ifcfg-eth0
```

Set the following values:
```
BOOTPROTO=static
IPADDR=192.168.1.20
NETMASK=255.255.255.0
GATEWAY=192.168.1.1
DNS1=8.8.8.8
DNS2=8.8.4.4
```

Restart networking:
```bash
systemctl restart network
```

</p>
</details>

### ⚙️ Network Configuration (Advanced)

Ensure your network configuration matches your host network settings:

<details>
<summary><b>Sangoma FreePBX Distro Configuration</b></summary>
<p>

1. Edit the Apache HTTP configuration:
   ```bash
   nano /etc/httpd/conf/httpd.conf
   ```
   - Set the server name to match your host IP address

2. Edit the network interface configuration:
   ```bash
   nano /etc/sysconfig/network-scripts/ifcfg-eth0
   ```
   - Set the IP address to be in the same subnet as your host machine (change only the last octet)
   - Example: If host is `192.168.1.10`, set VM to something like `192.168.1.20`

</p>
</details>

<details>
<summary><b>⚠️ Troubleshooting: Can't Access Web Interface</b></summary>
<p>

If you can't access the FreePBX web interface:

1. **Check VM is running**: Ensure the FreePBX VM is powered on
2. **Verify IP address**: Run `ip addr show` in the VM console
3. **Test connectivity**: From host machine, run:
   ```bash
   ping <VM-IP-ADDRESS>
   ```
4. **Check firewall**: Ensure port 80/443 is open. If your IP is banned, unban it:
   ```bash
   sudo fwconsole firewall f2bs
   sudo fwconsole firewall trust <YOUR-IP-ADDRESS>
   sudo fwconsole firewall restart
   sudo iptables -D fail2ban-SIP 1
   sudo iptables -D fail2ban-PBX-GUI 1
   ```
5. **Verify network mode**: VM should use **Bridged** network adapter
6. **Check Apache service**:
   ```bash
   systemctl status httpd
   # If not running, start it:
   systemctl start httpd 
   or
   systemctl start apache2 
   ```


</p>
</details>

## 📥 FreePBX Installation

<img src="https://cdn-icons-png.flaticon.com/512/2344/2344139.png" alt="Install" width="50" align="right"/>

<details open>
<summary><b>Installation Options</b></summary>
<p>

**Option 1: Pre-built ISO (Recommended for beginners)**
1. Download the FreePBX ISO from [FreePBX Downloads](https://www.freepbx.org/downloads/)
2. Boot your VM from the ISO
3. Follow the installation wizard
4. The system will be ready to use after installation

**Option 2: Manual Installation on Debian 12**
1. Install Debian 12 first
2. Download and run the FreePBX installation script:
   ```bash
   cd /tmp
   wget https://raw.githubusercontent.com/FreePBX/sng_freepbx_debian_install/master/sng_freepbx_debian_install.sh
   chmod +x sng_freepbx_debian_install.sh
   sudo ./sng_freepbx_debian_install.sh
   ```
3. Follow the prompts during installation
4. Installation may take 30-60 minutes depending on your system

</p>
</details>

<details>
<summary><b>⚠️ Troubleshooting: GitHub Connection Issues</b></summary>
<p>

If you encounter "raw.github not resolved" errors, add GitHub to your known hosts:
   ```bash
   nano /etc/hosts
   ```
   Add this line:
   ```
   185.199.110.133 raw.githubusercontent.com
   ```

</p>
</details>

<details>
<summary><b>⚠️ Troubleshooting: Script Errors at Line 1174</b></summary>
<p>

If you get error with line 1174, this is often related to date/time synchronization:

1. Check your current date:
   ```bash
   date
   ```

2. If incorrect, install NTP and synchronize time:
   ```bash
   apt install ntp -y
   systemctl start ntp
   timedatectl set-ntp true
   ```

3. Re-run the installation script:
   ```bash
   sudo bash /tmp/sng_freepbx_debian_install.sh
   ```

</p>
</details>

## 🔌 Configuring ARI (Asterisk REST Interface)

<img src="https://cdn-icons-png.flaticon.com/512/2885/2885417.png" alt="API" width="50" align="right"/>

> **📖 For detailed ARI + Dialplan configuration, see [FREEPBX-ARI-CONFIGURATION.md](FREEPBX-ARI-CONFIGURATION.md)**
> That guide covers config file method, custom dialplan, SIP trunk setup, NAT, and firewall.

<details open>
<summary><b>ARI Configuration Steps (GUI Method)</b></summary>
<p>

1. Access the FreePBX web interface using your browser: `http://<your-vm-ip>`

2. Configure ARI in the web interface:
   - Navigate to: **Settings** → **Advanced Settings** → **Asterisk REST API**
   - Enable the interface
   - Add origins (your host IP address and any other authorized IPs) for example: localhost:8088, http://[IP_ADDRESS]

3. Edit the HTTP configuration to allow connections from other hosts:
   ```bash
   nano /etc/asterisk/http_additional.conf
   ```
   - Change `bindaddr` to `0.0.0.0` to accept connections from all interfaces
   - Alternatively, configure the binding address in **Asterisk Built-in Mini-HTTP Server Settings** under **Advanced Settings**

4. Retrieve ARI credentials for your application:
   - Navigate to: **Settings** → **Advanced Settings** 
   - Check **Display readonly settings** (and optionally **Override readonly settings** if you want to change credentials)
   - Search for **ARI username**
   - Copy the credentials to your `.env` file in the AriLink application

</p>
</details>

## 🎙️ Speech Recognition Configuration

<img src="https://cdn-icons-png.flaticon.com/512/4127/4127185.png" alt="Speech" width="50" align="right"/>

<details>
<summary><b>Speech Recognition Options</b></summary>
<p>

The default configuration uses Google Speech API, but you can consider these alternatives:

| Provider | Type | Features |
|----------|------|----------|
| [OpenAI Whisper](https://github.com/openai/whisper) | Open-source | Self-hosted, multiple languages |
| [MCP-Elevenlab-Scribe-ASR](https://github.com/aromanstatue/MCP-Elevenlab-Scribe-ASR) | Open-source wrapper | High quality, API-based |
| [Eleven Labs Scribe](https://elevenlabs.io/scribe) | Commercial | Best quality, low latency |
| [PersonaPlex](https://research.nvidia.com/labs/adlr/personaplex/) | Research | Best quality, low latency |

</p>
</details>

## 📞 SIP Trunk Configuration

<img src="https://cdn-icons-png.flaticon.com/512/5778/5778578.png" alt="SIP" width="50" align="right"/>

> **📖 For SIP trunk setup, see [FREEPBX-ARI-CONFIGURATION.md](FREEPBX-ARI-CONFIGURATION.md#3%EF%B8%8F%E2%83%A3-create-sip-trunk-optional)**
> **📖 For 3CX-specific integration, see [3CX-INTEGRATION.md](3CX-INTEGRATION.md)**

<details open>
<summary><b>Setting up SIP Trunks (General)</b></summary>
<p>

Configure your SIP trunk provider in FreePBX:

1. Navigate to: **Connectivity** → **Trunks** → **Add Trunk**

2. Important settings for optimal audio quality:
   - Set **DTMF Mode** to **RFC4733**
   - Enable **Transport** options for **TLS** and **SRTP** if supported by your provider
   - Set **Codec Priority** to prioritize higher quality codecs (G.722, OPUS)

</p>
</details>

<details>
<summary><b>Outgoing Call Configuration</b></summary>
<p>

For outgoing calls, configure outbound routes in FreePBX:
- Navigate to: **Connectivity** → **Outbound Routes**
- Create a route that uses your trunk for outgoing calls

</p>
</details>

<details>
<summary><b>Incoming Call Configuration</b></summary>
<p>

For incoming calls, configure inbound routes in FreePBX:
- Navigate to: **Connectivity** → **Inbound Routes**
- Create a route that directs incoming calls to the appropriate destination

</p>
</details>

## 🎵 Custom Audio Files (IVR Prompts)

<img src="https://cdn-icons-png.flaticon.com/512/2956/2956769.png" alt="Audio" width="50" align="right"/>

<details open>
<summary><b>Uploading Voice Prompts for ARI Playback</b></summary>
<p>

Audio files used in your ARI code must be uploaded to the FreePBX server filesystem.

### 📁 Upload Location:

```bash
/var/lib/asterisk/sounds/custom/
```

u can use winSCP to upload files login as root

### 📋 File Requirements:

| Property | Recommended Value |
|----------|-------------------|
| **Format** | WAV (16-bit PCM) or GSM |
| **Sample Rate** | 8000 Hz or 16000 Hz |
| **Channels** | Mono (1 channel) |
| **Naming** | Use lowercase, no spaces (e.g., `welcome_message.wav`) |

### 📤 Upload Methods:

**Option 1: SCP (From your development machine)**
```bash
scp my-prompt.wav root@192.168.1.20:/var/lib/asterisk/sounds/custom/
```

**Option 2: SFTP Client (WinSCP, FileZilla)**
- Connect to FreePBX server via SFTP
- Navigate to `/var/lib/asterisk/sounds/custom/`
- Upload your `.wav` files

**Option 3: FreePBX Web Interface**
- Navigate to: **Admin** → **Sound Languages** → **System Recordings**
- Upload and it will be stored automatically

### 🔐 Set Permissions (After Upload):

```bash
ssh root@192.168.1.20
chown asterisk:asterisk /var/lib/asterisk/sounds/custom/*.wav
chmod 644 /var/lib/asterisk/sounds/custom/*.wav
```

### 💻 Using in Your Code:

Your TypeScript code already references these files correctly:

```typescript
// Example from AriControllerServer.ts
channel.play(
  { media: "sound:custom/welcome_2" },  // Plays /var/lib/asterisk/sounds/custom/welcome_2.wav
  (err, playback) => { /* ... */ }
);

// Another example
this.playAudio(channel, "custom/try_again");  // Plays /var/lib/asterisk/sounds/custom/try_again.wav
```

**Path Format**: `sound:custom/filename` (without extension)

</p>
</details>

## 📋 Dialplan Configuration (Call Routing)

<img src="https://cdn-icons-png.flaticon.com/512/3064/3064197.png" alt="Dialplan" width="50" align="right"/>

> **📖 For step-by-step dialplan setup, see [FREEPBX-ARI-CONFIGURATION.md](FREEPBX-ARI-CONFIGURATION.md#2%EF%B8%8F%E2%83%A3-configure-custom-dialplan)**
> **📖 For advanced routing options, see [DIALPLAN-CONFIG.md](DIALPLAN-CONFIG.md)**

<details open>
<summary><b>Routing Calls to AriLink Application</b></summary>
<p>

To route calls through your AriLink application for transcription, configure custom dialplan contexts.

**📖 Complete Dialplan Guide:**
👉 **[DIALPLAN-CONFIG.md](DIALPLAN-CONFIG.md)**

Covers:
- ✅ Route ALL calls through Stasis
- ✅ Route only specific extensions (e.g., only ext 101-110)
- ✅ Exclude emergency numbers (911)
- ✅ Selective internal vs external call routing
- ✅ Troubleshooting dialplan issues

### Quick Start:

Navigate to **Admin** → **Config Edit** → **extensions_custom.conf** and add:

```ini
[from-internal-custom]
exten => _X.,1,NoOp(ARI: Call from ${CALLERID(num)} to ${EXTEN})
 same => n,Stasis(stasis-app,${EXTEN},${CALLERID(num)})
 same => n,Hangup()
```

Reload dialplan:
```bash
asterisk -rx "dialplan reload"
```

For advanced configurations, see **[DIALPLAN-CONFIG.md](DIALPLAN-CONFIG.md)**.

</p>
</details>

## ✅ Testing the Setup

<img src="https://cdn-icons-png.flaticon.com/512/2858/2858204.png" alt="Testing" width="50" align="right"/>

<details>
<summary><b>Verification Steps</b></summary>
<p>

1. **Upload test audio file** to `/var/lib/asterisk/sounds/custom/`
2. **Configure dialplan** to route calls through Stasis
3. **Start your AriLink Server** and connect to FreePBX
4. **Make a test call** and verify:
   - Call routes to your application
   - Custom audio plays correctly
   - Speech recognition and transcription work
5. **Check logs** for any errors

</p>
</details>

## 📚 Additional Resources

<details>
<summary><b>Official Documentation</b></summary>
<p>

- [Official FreePBX Documentation](https://wiki.freepbx.org/)
- [Asterisk REST Interface (ARI) Documentation](https://wiki.asterisk.org/wiki/display/AST/Asterisk+REST+Interface+(ARI))
- [SIP Trunk Configuration Guide](https://wiki.freepbx.org/display/FPG/Trunks+Module)

</p>
</details>

---

<div align="center">
  <p>🔧 Connect your telephony system with confidence 🔧</p>
</div> 



## 📝 Quick Reference Notes

- Voice menu recordings must be uploaded directly to: `/var/lib/asterisk/sounds/custom/` or `/var/lib/asterisk/sounds/en/custom/`
- For ARI auth setup, see [FREEPBX-ARI-CONFIGURATION.md](FREEPBX-ARI-CONFIGURATION.md#1%EF%B8%8F%E2%83%A3-create-ari-user)
- For inbound route setup, see [FREEPBX-ARI-CONFIGURATION.md](FREEPBX-ARI-CONFIGURATION.md#2%EF%B8%8F%E2%83%A3-configure-custom-dialplan)
