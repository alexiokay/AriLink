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

  close() {
    this.db.close();
  }
}

module.exports.CallHistory = CallHistory;
export {};
