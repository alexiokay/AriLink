const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });

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

interface AutoDialerOptions {
  name?: string;
  assistantSlug?: string;
  maxConcurrent?: number;
  callerId?: string;
}

/**
 * AutoDialer - Campaign Engine
 *
 * Reads a phone list and originates outbound calls via ARI.
 * Each call is handled by the selected assistant (defaults to auto-dialer-call).
 *
 * Usage:
 *   const dialer = new AutoDialer(ariClient, { name: "March Outreach", assistantSlug: "auto-dialer-call" });
 *   dialer.setPhoneList([{ phone: "123", name: "John" }]);
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
  private name: string;
  private assistantSlug: string;
  private audioFile: string;
  private trunkName: string;
  private callerId: string;
  private activeChannels: Set<any> = new Set();
  private cleanedSessions: Set<string> = new Set();

  constructor(client: any, options?: AutoDialerOptions) {
    super();
    this.client = client;
    this.name = options?.name || "";
    this.assistantSlug = options?.assistantSlug || "auto-dialer-call";

    // Load config from selected assistant's config.json, fall back to auto-dialer-call, then env vars
    let assistantConfig: any = {};
    try {
      assistantConfig = require(`../assistants/${this.assistantSlug}/config.json`);
    } catch {
      try {
        assistantConfig = require("../assistants/auto-dialer-call/config.json");
      } catch { /* config not found, use env vars */ }
    }

    this.maxConcurrent = options?.maxConcurrent
      || assistantConfig.campaign?.maxConcurrent
      || parseInt(process.env.AUTODIALER_MAX_CONCURRENT || "1", 10);
    this.audioFile = assistantConfig.prompts?.welcome
      || process.env.AUTODIALER_AUDIO || "custom/autodialer_welcome";
    this.trunkName = assistantConfig.campaign?.trunk
      || process.env.AUTODIALER_TRUNK || process.env.TRANSFER_TRUNK || "from-internal";
    this.callerId = options?.callerId || process.env.FROM_NUMBER || "unknown";
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
    console.log(`[AutoDialer] Campaign "${this.name || "unnamed"}" started. ${this.phoneList.length} numbers, max ${this.maxConcurrent} concurrent, assistant: ${this.assistantSlug}`);
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
    if (this.status === "completed") return;
    
    this.status = "completed";
    console.log(`[AutoDialer] Campaign STOPPED manually. Hanging up ${this.activeChannels.size} active calls.`);
    
    // Hard stop: hang up all active channels
    for (const channel of this.activeChannels) {
      try {
        channel.hangup();
      } catch (err) {
        // Ignored
      }
    }
    this.activeChannels.clear();

    this.saveResults();
    this.emit("campaignComplete", { results: this.results });
  }

  /**
   * Get campaign status
   */
  getStatus(): { status: CampaignStatus; progress: number; total: number; activeCalls: number; results: CallResult[]; name: string; assistantSlug: string } {
    return {
      status: this.status,
      progress: this.currentIndex,
      total: this.phoneList.length,
      activeCalls: this.activeCalls,
      results: this.results,
      name: this.name,
      assistantSlug: this.assistantSlug,
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

    const endpoint = `Local/${phone}@${this.trunkName}`;

    try {
      // appArgs: campaign,sessionId,assistantSlug,callerId,phone,name
      // AriControllerServer detects "campaign" and runs the full audio pipeline
      const encodedName = encodeURIComponent(name || "");
      this.client.channels.originate(
        {
          endpoint,
          app: appName,
          callerId: this.callerId,
          appArgs: `campaign,${sessionId},${this.assistantSlug},${this.callerId},${phone},${encodedName}`,
          timeout: 30,
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
   * Track lifecycle of a campaign call.
   * Session, bridge, assistant, and audio pipeline are all created by
   * AriControllerServer.handleCampaignCall() via the global stasisStart handler.
   * AutoDialer only tracks: channel (for Stop), results, and active call count.
   */
  private setupOutboundCall(sessionId: string, entry: PhoneListEntry, channel: any): void {
    const callStartTime = Date.now();
    let resultRecorded = false;

    // Track channel so we can hang it up on "Stop"
    this.activeChannels.add(channel);

    // Channel destroyed before answering (busy, no answer, etc.)
    channel.on("ChannelDestroyed", () => {
      if (!resultRecorded) {
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          // No session means call was never answered
          console.log(`[AutoDialer][${sessionId}] ${entry.phone} not answered`);
          resultRecorded = true;
          this.recordResult(entry, "no_answer");
        }
      }
      this.cleanupCall(sessionId, channel);
    });

    // StasisEnd — call left Stasis (hangup after being answered)
    channel.on("StasisEnd", () => {
      console.log(`[AutoDialer][${sessionId}] ${entry.phone} StasisEnd`);

      if (!resultRecorded) {
        resultRecorded = true;
        // Check if the assistant recorded a specific result (e.g. "transferred")
        const session = sessionManager.getSession(sessionId);
        const specificResult = session ? (session as any).campaignResult : undefined;
        this.recordResult(entry, specificResult || "answered", Date.now() - callStartTime);
      }

      this.cleanupCall(sessionId, channel);
    });
  }

  /**
   * Universal cleanup for a call session. 
   * Ensures activeCalls is decremented exactly once and triggers fillSlots.
   */
  private cleanupCall(sessionId: string, channel: any): void {
    if (this.cleanedSessions.has(sessionId)) return;
    this.cleanedSessions.add(sessionId);

    this.activeChannels.delete(channel);
    this.activeCalls--;
    
    // Use nextTick to avoid potential recursion if fillSlots starts new calls immediately
    process.nextTick(() => this.fillSlots());
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
      const safeName = this.name ? this.name.replace(/[^a-z0-9]+/gi, "-").substring(0, 30) + "-" : "";
      const filePath = path.join(resultsDir, `campaign-${safeName}${timestamp}.json`);

      const counts: Record<string, number> = {};
      for (const r of this.results) {
        counts[r.result] = (counts[r.result] || 0) + 1;
      }

      const report = {
        campaignName: this.name,
        assistantSlug: this.assistantSlug,
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
