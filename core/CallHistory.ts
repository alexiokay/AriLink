const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

class CallHistory {
  private db: any;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || path.resolve(__dirname, "../data/calls.db");
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.cleanupOrphanedCalls();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        caller_id TEXT,
        caller_name TEXT,
        extension TEXT,
        channel_name TEXT,
        assistant TEXT,
        assistant_name TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_sec INTEGER,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS transcriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        call_id TEXT NOT NULL,
        text TEXT NOT NULL,
        is_final INTEGER NOT NULL DEFAULT 0,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (call_id) REFERENCES calls(id)
      );

      CREATE INDEX IF NOT EXISTS idx_transcriptions_call_id ON transcriptions(call_id);
      CREATE INDEX IF NOT EXISTS idx_calls_start_time ON calls(start_time);

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        call_id TEXT NOT NULL,
        type TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        timestamp TEXT NOT NULL,
        FOREIGN KEY (call_id) REFERENCES calls(id)
      );

      CREATE INDEX IF NOT EXISTS idx_events_call_id ON events(call_id);
    `);
  }

  /** Mark any 'active' calls from a previous run as ended (crash/restart recovery) */
  private cleanupOrphanedCalls() {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE calls SET end_time = ?, status = 'ended'
      WHERE status = 'active' AND end_time IS NULL
    `).run(now);
    if (result.changes > 0) {
      console.log(`[CallHistory] Cleaned up ${result.changes} orphaned active call(s) from previous run`);
    }
  }

  saveCall(data: {
    id: string;
    callerId: string;
    callerName: string;
    extension: string;
    channelName: string;
    assistant: string;
    assistantName: string;
    startTime: string;
  }) {
    this.db.prepare(`
      INSERT OR REPLACE INTO calls (id, caller_id, caller_name, extension, channel_name, assistant, assistant_name, start_time, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      data.id, data.callerId, data.callerName, data.extension,
      data.channelName, data.assistant, data.assistantName, data.startTime
    );
  }

  endCall(sessionId: string) {
    const endTime = new Date().toISOString();
    const call = this.db.prepare("SELECT start_time FROM calls WHERE id = ?").get(sessionId);
    let durationSec = 0;
    if (call?.start_time) {
      durationSec = Math.floor((Date.now() - new Date(call.start_time).getTime()) / 1000);
    }

    this.db.prepare(`
      UPDATE calls SET end_time = ?, duration_sec = ?, status = 'ended' WHERE id = ?
    `).run(endTime, durationSec, sessionId);
  }

  saveTranscription(data: {
    callId: string;
    text: string;
    isFinal: boolean;
    timestamp: string;
  }) {
    // Ensure the call record exists (transcription may arrive before saveCall in rare cases)
    this.db.prepare(`
      INSERT OR IGNORE INTO calls (id, start_time, status) VALUES (?, ?, 'active')
    `).run(data.callId, data.timestamp);

    this.db.prepare(`
      INSERT INTO transcriptions (call_id, text, is_final, timestamp) VALUES (?, ?, ?, ?)
    `).run(data.callId, data.text, data.isFinal ? 1 : 0, data.timestamp);
  }

  getCalls(options: { limit?: number; offset?: number; search?: string } = {}): {
    calls: any[];
    total: number;
  } {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    let where = "";
    const params: any[] = [];

    if (options.search) {
      where = "WHERE caller_id LIKE ? OR caller_name LIKE ? OR assistant LIKE ?";
      const pattern = `%${options.search}%`;
      params.push(pattern, pattern, pattern);
    }

    const total = this.db.prepare(`SELECT COUNT(*) as count FROM calls ${where}`).get(...params)?.count || 0;

    const calls = this.db.prepare(`
      SELECT * FROM calls ${where} ORDER BY start_time DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return { calls, total };
  }

  getCall(id: string): any {
    return this.db.prepare("SELECT * FROM calls WHERE id = ?").get(id);
  }

  getCallTranscriptions(callId: string): any[] {
    return this.db.prepare(
      "SELECT * FROM transcriptions WHERE call_id = ? ORDER BY id ASC"
    ).all(callId);
  }

  saveEvent(data: { callId: string; type: string; text: string; timestamp?: string }) {
    const ts = data.timestamp || new Date().toISOString();
    this.db.prepare(
      "INSERT INTO events (call_id, type, text, timestamp) VALUES (?, ?, ?, ?)"
    ).run(data.callId, data.type, data.text, ts);
  }

  getCallEvents(callId: string): any[] {
    return this.db.prepare(
      "SELECT type, text, timestamp FROM events WHERE call_id = ? ORDER BY id ASC"
    ).all(callId);
  }

  getMetrics(days = 7): {
    totalCalls: number;
    completedCalls: number;
    failedCalls: number;
    activeCalls: number;
    averageDuration: number;
    successRate: number;
    dailyStats: { date: string; calls: number; avgDuration: number }[];
    topAssistants: { assistant: string; count: number }[];
    topCallers: { callerId: string; callerName: string; count: number }[];
  } {
    const totalCalls = this.db.prepare("SELECT COUNT(*) as c FROM calls").get().c;
    const completedCalls = this.db.prepare("SELECT COUNT(*) as c FROM calls WHERE status = 'ended'").get().c;
    const activeCalls = this.db.prepare("SELECT COUNT(*) as c FROM calls WHERE status = 'active'").get().c;
    const failedCalls = totalCalls - completedCalls - activeCalls;

    const avgRow = this.db.prepare(
      "SELECT AVG(duration_sec) as avg FROM calls WHERE status = 'ended' AND duration_sec IS NOT NULL"
    ).get();
    const averageDuration = Math.round(avgRow.avg || 0);

    const successRate = totalCalls > 0
      ? Math.round((completedCalls / totalCalls) * 10000) / 100
      : 0;

    // Daily stats for last N days
    const dailyStats = this.db.prepare(`
      SELECT date(start_time) as date,
             COUNT(*) as calls,
             COALESCE(AVG(duration_sec), 0) as avgDuration
      FROM calls
      WHERE start_time >= date('now', ?)
      GROUP BY date(start_time)
      ORDER BY date ASC
    `).all(`-${days} days`).map((r: any) => ({
      date: r.date,
      calls: r.calls,
      avgDuration: Math.round(r.avgDuration),
    }));

    // Top assistants
    const topAssistants = this.db.prepare(`
      SELECT COALESCE(assistant_name, assistant, 'unknown') as assistant, COUNT(*) as count
      FROM calls
      GROUP BY assistant
      ORDER BY count DESC
      LIMIT 5
    `).all();

    // Top callers
    const topCallers = this.db.prepare(`
      SELECT caller_id as callerId, COALESCE(caller_name, caller_id) as callerName, COUNT(*) as count
      FROM calls
      WHERE caller_id IS NOT NULL AND caller_id != ''
      GROUP BY caller_id
      ORDER BY count DESC
      LIMIT 5
    `).all();

    return {
      totalCalls,
      completedCalls,
      failedCalls,
      activeCalls,
      averageDuration,
      successRate,
      dailyStats,
      topAssistants,
      topCallers,
    };
  }

  close() {
    this.db.close();
  }
}

module.exports.CallHistory = CallHistory;
export {};
