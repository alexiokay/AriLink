const EventEmitter = require("events");

/**
 * Represents the state and resources for a single call session.
 * Each incoming call gets its own CallSession with isolated bridge, channels, and transcription.
 */
interface CallSessionData {
  id: string;
  bridge: any; // ARI Bridge
  incomingChannel: any; // ARI Channel
  outgoingChannel?: any; // ARI Channel (dialed party)
  externalMediaChannelId?: string;
  startTime: Date;
  status: "pending" | "active" | "ended";
  noMatchCount: number;
}

/**
 * Manages all active call sessions with per-call isolation.
 */
class CallSessionManager extends EventEmitter {
  private sessions: Map<string, CallSessionData> = new Map();

  constructor() {
    super();
  }

  /**
   * Generate a unique call session ID
   */
  generateSessionId(): string {
    return `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a new call session
   */
  createSession(
    id: string,
    bridge: any,
    incomingChannel: any
  ): CallSessionData {
    const session: CallSessionData = {
      id,
      bridge,
      incomingChannel,
      outgoingChannel: undefined,
      externalMediaChannelId: undefined,
      startTime: new Date(),
      status: "pending",
      noMatchCount: 0,
    };

    this.sessions.set(id, session);
    console.log(`[SessionManager] Created session ${id}`);
    this.emit("sessionCreated", session);
    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): CallSessionData | undefined {
    return this.sessions.get(id);
  }

  /**
   * Get a session by channel ID (incoming or outgoing)
   */
  getSessionByChannelId(channelId: string): CallSessionData | undefined {
    for (const session of this.sessions.values()) {
      if (
        session.incomingChannel?.id === channelId ||
        session.outgoingChannel?.id === channelId
      ) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Get a session by bridge ID
   */
  getSessionByBridgeId(bridgeId: string): CallSessionData | undefined {
    for (const session of this.sessions.values()) {
      if (session.bridge?.id === bridgeId) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Get a session by external media channel ID
   */
  getSessionByExternalMediaId(
    externalMediaId: string
  ): CallSessionData | undefined {
    for (const session of this.sessions.values()) {
      if (session.externalMediaChannelId === externalMediaId) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Update session with outgoing channel
   */
  setOutgoingChannel(sessionId: string, channel: any): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.outgoingChannel = channel;
      session.status = "active";
      console.log(
        `[SessionManager] Session ${sessionId} outgoing channel set: ${channel.name}`
      );
    }
  }

  /**
   * Update session with external media channel ID
   */
  setExternalMediaChannelId(sessionId: string, channelId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.externalMediaChannelId = channelId;
      console.log(
        `[SessionManager] Session ${sessionId} external media: ${channelId}`
      );
    }
  }

  /**
   * Increment no-match counter for a session
   */
  incrementNoMatchCount(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.noMatchCount++;
      return session.noMatchCount;
    }
    return 0;
  }

  /**
   * End and cleanup a session
   */
  async endSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.log(`[SessionManager] Session ${sessionId} not found for cleanup`);
      return;
    }

    console.log(`[SessionManager] Ending session ${sessionId}`);
    session.status = "ended";

    // Hangup channels (if still active)
    try {
      if (session.incomingChannel) {
        await session.incomingChannel.hangup().catch(() => {});
      }
    } catch (err) {
      // Channel may already be hung up
    }

    try {
      if (session.outgoingChannel) {
        await session.outgoingChannel.hangup().catch(() => {});
      }
    } catch (err) {
      // Channel may already be hung up
    }

    // Destroy the bridge
    try {
      if (session.bridge) {
        await session.bridge.destroy().catch(() => {});
      }
    } catch (err) {
      // Bridge may already be destroyed
    }

    this.sessions.delete(sessionId);
    this.emit("sessionEnded", session);
    console.log(`[SessionManager] Session ${sessionId} cleaned up`);
  }

  /**
   * Get count of active sessions
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get all active session IDs
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * End all sessions (for graceful shutdown)
   */
  async endAllSessions(): Promise<void> {
    console.log(
      `[SessionManager] Ending all ${this.sessions.size} active sessions`
    );
    const endPromises = Array.from(this.sessions.keys()).map((id) =>
      this.endSession(id)
    );
    await Promise.all(endPromises);
  }
}

// Export singleton instance
const sessionManager = new CallSessionManager();

module.exports.CallSessionManager = CallSessionManager;
module.exports.sessionManager = sessionManager;
