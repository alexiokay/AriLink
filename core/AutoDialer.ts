const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const { AssistantFactory } = require("./AssistantFactory");
const { sessionManager } = require("./CallSession");

interface PhoneListEntry {
  phone: string;
  name?: string;
}

interface CallResult {
  phone: string;
  name?: string;
  result: "answered" | "transferred" | "no_interest" | "no_answer" | "busy" | "failed";
  duration?: number;
  timestamp: string;
}

type CampaignStatus = "idle" | "running" | "paused" | "completed";

/**
 * AutoDialer - Campaign Engine
 *
 * Reads a phone list and originates outbound calls via ARI.
 * Each call is handled by an AutoDialerCallAssistant.
 *
 * Usage:
 *   const dialer = new AutoDialer(ariClient);
 *   dialer.loadPhoneList("./tools/phone-list.json");
 *   dialer.start();
 */
class AutoDialer extends EventEmitter {
  private client: any; // ARI client
  private phoneList: PhoneListEntry[] = [];
  private results: CallResult[] = [];
  private currentIndex: number = 0;
  private activeCalls: number = 0;
  private maxConcurrent: number;
  private status: CampaignStatus = "idle";
  private audioFile: string;
  private trunkName: string;
  private callerId: string;

  constructor(client: any) {
    super();
    this.client = client;

    // Load config from auto-dialer-call assistant config.json, fall back to env vars
    let assistantConfig: any = {};
    try {
      assistantConfig = require("../assistants/auto-dialer-call/config.json");
    } catch { /* config not found, use env vars */ }

    this.maxConcurrent = assistantConfig.campaign?.maxConcurrent
      || parseInt(process.env.AUTODIALER_MAX_CONCURRENT || "1", 10);
    this.audioFile = assistantConfig.prompts?.welcome
      || process.env.AUTODIALER_AUDIO || "custom/autodialer_welcome";
    this.trunkName = assistantConfig.campaign?.trunk
      || process.env.AUTODIALER_TRUNK || process.env.TRANSFER_TRUNK || "from-internal";
    this.callerId = process.env.FROM_NUMBER || "unknown";
  }

  /**
   * Load phone list from a JSON file
   */
  loadPhoneList(filePath: string): void {
    const absolutePath = path.resolve(filePath);
    const raw = fs.readFileSync(absolutePath, "utf-8");
    this.phoneList = JSON.parse(raw);
    this.currentIndex = 0;
    this.results = [];
    console.log(`[AutoDialer] Loaded ${this.phoneList.length} numbers from ${absolutePath}`);
  }

  /**
   * Set phone list directly (instead of loading from file)
   */
  setPhoneList(list: PhoneListEntry[]): void {
    this.phoneList = list;
    this.currentIndex = 0;
    this.results = [];
    console.log(`[AutoDialer] Set ${this.phoneList.length} numbers`);
  }

  /**
   * Start the campaign
   */
  start(): void {
    if (this.phoneList.length === 0) {
      console.error("[AutoDialer] No phone list loaded");
      return;
    }

    if (this.status === "running") {
      console.warn("[AutoDialer] Campaign already running");
      return;
    }

    this.status = "running";
    console.log(`[AutoDialer] Campaign started. ${this.phoneList.length} numbers, max ${this.maxConcurrent} concurrent`);
    this.emit("campaignStarted", { total: this.phoneList.length });

    this.fillSlots();
  }

  /**
   * Pause the campaign (finish active calls but don't start new ones)
   */
  pause(): void {
    if (this.status !== "running") return;
    this.status = "paused";
    console.log(`[AutoDialer] Campaign paused. ${this.activeCalls} calls still active`);
    this.emit("campaignPaused");
  }

  /**
   * Resume a paused campaign
   */
  resume(): void {
    if (this.status !== "paused") return;
    this.status = "running";
    console.log("[AutoDialer] Campaign resumed");
    this.emit("campaignResumed");
    this.fillSlots();
  }

  /**
   * Stop the campaign entirely
   */
  stop(): void {
    this.status = "completed";
    console.log(`[AutoDialer] Campaign stopped. ${this.results.length}/${this.phoneList.length} processed`);
    this.saveResults();
    this.emit("campaignComplete", { results: this.results });
  }

  /**
   * Get campaign status
   */
  getStatus(): { status: CampaignStatus; progress: number; total: number; activeCalls: number; results: CallResult[] } {
    return {
      status: this.status,
      progress: this.currentIndex,
      total: this.phoneList.length,
      activeCalls: this.activeCalls,
      results: this.results,
    };
  }

  /**
   * Fill available call slots with new calls
   */
  private fillSlots(): void {
    while (
      this.status === "running" &&
      this.activeCalls < this.maxConcurrent &&
      this.currentIndex < this.phoneList.length
    ) {
      const entry = this.phoneList[this.currentIndex];
      this.currentIndex++;
      this.dialNumber(entry);
    }

    // Check if campaign is complete
    if (this.currentIndex >= this.phoneList.length && this.activeCalls === 0) {
      this.status = "completed";
      console.log(`[AutoDialer] Campaign complete. ${this.results.length} calls processed`);
      this.printSummary();
      this.saveResults();
      this.emit("campaignComplete", { results: this.results });
    }
  }

  /**
   * Originate a call to a single number
   */
  private async dialNumber(entry: PhoneListEntry): Promise<void> {
    const { phone, name } = entry;
    this.activeCalls++;

    const sessionId = sessionManager.generateSessionId();
    const appName = process.env.STASIS_APP_NAME || "stasis-app";

    console.log(`[AutoDialer][${sessionId}] Dialing ${phone} (${name || "unknown"}) [${this.activeCalls}/${this.maxConcurrent} active]`);

    const endpoint = `PJSIP/${phone}@${this.trunkName}`;

    try {
      this.client.channels.originate(
        {
          endpoint,
          app: appName,
          callerId: this.callerId,
          appArgs: `dialed,autodialer,${sessionId}`,
          timeout: 30,
          headers: {
            "X-Session-ID": sessionId,
            "X-AutoDialer": "true",
            "X-Phone": phone,
          },
        },
        (err: any, channel: any) => {
          if (err) {
            console.error(`[AutoDialer][${sessionId}] Failed to dial ${phone}:`, err.message || err);
            this.recordResult(entry, "failed");
            this.activeCalls--;
            this.fillSlots();
            return;
          }

          console.log(`[AutoDialer][${sessionId}] Channel created for ${phone}: ${channel.id}`);

          // Track the channel for this auto-dialer call
          this.setupOutboundCall(sessionId, entry, channel);
        }
      );
    } catch (error: any) {
      console.error(`[AutoDialer][${sessionId}] Error originating call to ${phone}:`, error.message);
      this.recordResult(entry, "failed");
      this.activeCalls--;
      this.fillSlots();
    }
  }

  /**
   * Set up event handlers for an outbound auto-dialer call
   */
  private async setupOutboundCall(sessionId: string, entry: PhoneListEntry, channel: any): Promise<void> {
    const callStartTime = Date.now();

    // When the dialed party answers and enters Stasis
    channel.on("StasisStart", async (event: any, answeredChannel: any) => {
      console.log(`[AutoDialer][${sessionId}] ${entry.phone} answered`);

      // Create a bridge for this call
      try {
        const bridge = await this.client.bridges.create({ type: "mixing" });

        // Create session in session manager
        const session = sessionManager.createSession(sessionId, bridge, answeredChannel);

        // Add channel to bridge
        bridge.addChannel({ channel: answeredChannel.id }, (err: any) => {
          if (err) console.error(`[AutoDialer][${sessionId}] Bridge error:`, err);
        });

        // Create assistant for this call
        const assistant = AssistantFactory.createByType("auto-dialer-call", this.client, sessionId);
        sessionManager.setAssistant(sessionId, assistant);

        // Listen for transfer events
        // Priority: assistant config.json > .env vars
        assistant.on("transferToDestination", async (data: any) => {
          const config = assistant.getConfig();
          const destination = config.transfer?.destination || process.env.TRANSFER_DESTINATION;
          const trunk = config.transfer?.trunk || process.env.TRANSFER_TRUNK;

          if (!destination || !trunk) {
            console.error(`[AutoDialer][${sessionId}] Transfer not configured (set transfer in config.json or TRANSFER_DESTINATION/TRANSFER_TRUNK in .env)`);
            return;
          }

          console.log(`[AutoDialer][${sessionId}] Transferring ${entry.phone} to ${destination}`);

          // Originate to transfer destination and bridge
          const transferEndpoint = `PJSIP/${destination}@${trunk}`;
          this.client.channels.originate(
            {
              endpoint: transferEndpoint,
              app: process.env.STASIS_APP_NAME || "stasis-app",
              callerId: this.callerId,
              appArgs: "dialed",
            },
            (err: any, transferChannel: any) => {
              if (err) {
                console.error(`[AutoDialer][${sessionId}] Transfer failed:`, err);
                return;
              }

              transferChannel.on("StasisStart", (event: any, outChannel: any) => {
                bridge.addChannel({ channel: outChannel.id }, (err: any) => {
                  if (err) console.error(`[AutoDialer][${sessionId}] Bridge add error:`, err);
                  else console.log(`[AutoDialer][${sessionId}] Bridged to ${destination}`);
                });
                sessionManager.setOutgoingChannel(sessionId, outChannel);
              });
            }
          );
        });

        // Listen for call result
        assistant.on("callResult", (data: { result: string }) => {
          this.recordResult(entry, data.result as CallResult["result"], Date.now() - callStartTime);
        });

        // Let assistant handle the call
        await assistant.onCallStart(answeredChannel, entry.phone, entry.phone);

      } catch (err: any) {
        console.error(`[AutoDialer][${sessionId}] Error setting up call:`, err.message);
        this.recordResult(entry, "failed");
      }
    });

    // Channel destroyed before answering (busy, no answer, etc.)
    channel.on("ChannelDestroyed", (event: any) => {
      // Only record if no session exists (call wasn't answered)
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        const cause = event.cause_txt || "unknown";
        console.log(`[AutoDialer][${sessionId}] ${entry.phone} not answered: ${cause}`);

        if (cause.includes("BUSY")) {
          this.recordResult(entry, "busy");
        } else {
          this.recordResult(entry, "no_answer");
        }
      }
    });

    // StasisEnd - call left Stasis (hangup)
    channel.on("StasisEnd", async () => {
      console.log(`[AutoDialer][${sessionId}] ${entry.phone} StasisEnd`);

      const session = sessionManager.getSession(sessionId);
      if (session) {
        const assistant = sessionManager.getAssistant(sessionId);
        if (assistant) {
          await assistant.onCallEnd(channel);
        }
        await sessionManager.endSession(sessionId);
      }

      this.activeCalls--;
      this.fillSlots();
    });
  }

  /**
   * Record the result of a call
   */
  private recordResult(entry: PhoneListEntry, result: CallResult["result"], durationMs?: number): void {
    const callResult: CallResult = {
      phone: entry.phone,
      name: entry.name,
      result,
      duration: durationMs ? Math.round(durationMs / 1000) : undefined,
      timestamp: new Date().toISOString(),
    };

    this.results.push(callResult);
    console.log(`[AutoDialer] Result: ${entry.phone} → ${result}${durationMs ? ` (${Math.round(durationMs / 1000)}s)` : ""}`);

    this.emit("callCompleted", callResult);
  }

  /**
   * Save campaign results to a JSON file
   */
  private saveResults(): void {
    if (this.results.length === 0) return;

    try {
      const resultsDir = path.resolve(__dirname, "../campaign-results");
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filePath = path.join(resultsDir, `campaign-${timestamp}.json`);

      const counts: Record<string, number> = {};
      for (const r of this.results) {
        counts[r.result] = (counts[r.result] || 0) + 1;
      }

      const report = {
        campaignDate: new Date().toISOString(),
        totalNumbers: this.phoneList.length,
        totalProcessed: this.results.length,
        summary: counts,
        results: this.results,
      };

      fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
      console.log(`[AutoDialer] Results saved to ${filePath}`);
    } catch (err: any) {
      console.error(`[AutoDialer] Failed to save results:`, err.message);
    }
  }

  /**
   * Print campaign summary
   */
  private printSummary(): void {
    const counts: Record<string, number> = {};
    for (const r of this.results) {
      counts[r.result] = (counts[r.result] || 0) + 1;
    }

    console.log("\n[AutoDialer] ===== Campaign Summary =====");
    console.log(`  Total calls: ${this.results.length}`);
    for (const [result, count] of Object.entries(counts)) {
      console.log(`  ${result}: ${count}`);
    }
    console.log("  ========================================\n");
  }
}

module.exports.AutoDialer = AutoDialer;
export {};
