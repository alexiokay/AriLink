/**
 * LogCollector
 *
 * Intercepts console.log/warn/error, stores entries in a ring buffer
 * for real-time streaming, and persists to a JSONL file for history.
 *
 * - Real-time: new entries broadcast via onEntry callback
 * - Recent: in-memory ring buffer (configurable size)
 * - History: JSONL file with auto-rotation when it exceeds maxFileSize
 * - Pagination: getEntries reads from file for older entries
 *
 * Usage:
 *   const collector = new LogCollector({ logDir: "./logs" });
 *   collector.onEntry((entry) => io.emit("dashboard:log", entry));
 *   collector.install();
 */

const fs = require("fs");
const path = require("path");

interface LogEntry {
  id: number;
  level: "log" | "warn" | "error";
  message: string;
  timestamp: number;
}

interface LogCollectorOptions {
  maxBufferSize?: number;   // In-memory buffer size (default: 5000)
  logDir?: string;          // Directory for log files (default: "./logs")
  maxFileSize?: number;     // Max log file size in bytes before rotation (default: 10MB)
  maxRotated?: number;      // Number of rotated files to keep (default: 5)
}

class LogCollector {
  private buffer: LogEntry[] = [];
  private maxBufferSize: number;
  private nextId: number = 1;
  private listener: ((entry: LogEntry) => void) | null = null;
  private logFilePath: string;
  private logDir: string;
  private maxFileSize: number;
  private maxRotated: number;
  private writeStream: any = null;

  // Original console methods (saved before patching)
  private origLog: typeof console.log;
  private origWarn: typeof console.warn;
  private origError: typeof console.error;

  constructor(opts: LogCollectorOptions = {}) {
    this.maxBufferSize = opts.maxBufferSize || 5000;
    this.logDir = opts.logDir || path.resolve(process.cwd(), "logs");
    this.maxFileSize = opts.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxRotated = opts.maxRotated || 5;

    this.origLog = console.log.bind(console);
    this.origWarn = console.warn.bind(console);
    this.origError = console.error.bind(console);

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.logFilePath = path.join(this.logDir, "server.jsonl");

    // Resume id counter from existing file
    this.nextId = this.getLastIdFromFile() + 1;

    // Open write stream (append mode)
    this.writeStream = fs.createWriteStream(this.logFilePath, { flags: "a" });
  }

  /**
   * Read the last entry id from the log file (to resume numbering across restarts)
   */
  private getLastIdFromFile(): number {
    try {
      if (!fs.existsSync(this.logFilePath)) return 0;

      const stat = fs.statSync(this.logFilePath);
      if (stat.size === 0) return 0;

      // Read last few KB to find the last line
      const readSize = Math.min(stat.size, 4096);
      const fd = fs.openSync(this.logFilePath, "r");
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
      fs.closeSync(fd);

      const text = buf.toString("utf-8");
      const lines = text.split("\n").filter((l: string) => l.trim());
      if (lines.length === 0) return 0;

      const lastLine = lines[lines.length - 1];
      const parsed = JSON.parse(lastLine);
      return parsed.id || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Set the callback for new log entries (called in real-time)
   */
  onEntry(fn: (entry: LogEntry) => void) {
    this.listener = fn;
  }

  /**
   * Patch console.log/warn/error to capture output
   */
  install() {
    console.log = (...args: any[]) => {
      this.origLog(...args);
      this.capture("log", args);
    };
    console.warn = (...args: any[]) => {
      this.origWarn(...args);
      this.capture("warn", args);
    };
    console.error = (...args: any[]) => {
      this.origError(...args);
      this.capture("error", args);
    };
  }

  private capture(level: LogEntry["level"], args: any[]) {
    const message = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 0)))
      .join(" ");

    const entry: LogEntry = {
      id: this.nextId++,
      level,
      message,
      timestamp: Date.now(),
    };

    // Add to memory buffer
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(Math.floor(this.maxBufferSize * 0.1));
    }

    // Write to file
    this.writeToFile(entry);

    // Notify listener
    if (this.listener) {
      try {
        this.listener(entry);
      } catch {
        // Never let listener errors affect logging
      }
    }
  }

  private writeToFile(entry: LogEntry) {
    if (!this.writeStream) return;

    try {
      this.writeStream.write(JSON.stringify(entry) + "\n");
    } catch {
      // Swallow write errors — logging should never crash the app
    }

    // Check file size for rotation (not on every write — check periodically)
    if (entry.id % 100 === 0) {
      this.checkRotation();
    }
  }

  private checkRotation() {
    try {
      const stat = fs.statSync(this.logFilePath);
      if (stat.size > this.maxFileSize) {
        this.rotate();
      }
    } catch {
      // File might not exist yet
    }
  }

  private rotate() {
    try {
      // Close current stream
      if (this.writeStream) {
        this.writeStream.end();
        this.writeStream = null;
      }

      // Shift existing rotated files: server.4.jsonl → server.5.jsonl, etc.
      for (let i = this.maxRotated; i >= 1; i--) {
        const from = i === 1
          ? this.logFilePath
          : path.join(this.logDir, `server.${i - 1}.jsonl`);
        const to = path.join(this.logDir, `server.${i}.jsonl`);

        if (fs.existsSync(from)) {
          if (i === this.maxRotated && fs.existsSync(to)) {
            fs.unlinkSync(to); // Delete oldest
          }
          fs.renameSync(from, to);
        }
      }

      // Open new write stream
      this.writeStream = fs.createWriteStream(this.logFilePath, { flags: "a" });
    } catch (err: any) {
      // Fallback: just reopen the stream
      this.writeStream = fs.createWriteStream(this.logFilePath, { flags: "a" });
    }
  }

  /**
   * Get entries for pagination. Checks memory buffer first, falls back to file.
   * Returns entries newest-first.
   *
   * @param limit  Max entries to return
   * @param before Return entries with id < before (for loading older entries)
   */
  getEntries(limit: number = 100, before?: number): LogEntry[] {
    // First try the memory buffer
    let entries = this.buffer;

    if (before !== undefined) {
      entries = entries.filter((e) => e.id < before);
    }

    // If we have enough in memory, return from buffer
    if (entries.length >= limit || before === undefined) {
      return entries.slice(-limit).reverse();
    }

    // Not enough in memory — read from file(s)
    const fileEntries = this.readFromFiles(limit, before);
    return fileEntries;
  }

  /**
   * Read entries from JSONL log files (current + rotated).
   * Returns newest-first, filtered by `before`.
   */
  private readFromFiles(limit: number, before?: number): LogEntry[] {
    const results: LogEntry[] = [];

    // Read from current file first, then rotated files
    const files = [this.logFilePath];
    for (let i = 1; i <= this.maxRotated; i++) {
      const rotated = path.join(this.logDir, `server.${i}.jsonl`);
      if (fs.existsSync(rotated)) {
        files.push(rotated);
      }
    }

    for (const file of files) {
      if (results.length >= limit) break;

      try {
        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n").filter((l: string) => l.trim());

        // Parse lines in reverse (newest first within each file)
        for (let i = lines.length - 1; i >= 0; i--) {
          if (results.length >= limit) break;

          try {
            const entry: LogEntry = JSON.parse(lines[i]);
            if (before !== undefined && entry.id >= before) continue;
            results.push(entry);
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Already newest-first from the reverse iteration
    return results.slice(0, limit);
  }

  /**
   * Get total number of entries (memory buffer + estimate from file)
   */
  getCount(): number {
    // The nextId - 1 gives the total entries ever written
    return this.nextId - 1;
  }

  /**
   * Close the write stream (for graceful shutdown)
   */
  close() {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }
}

module.exports.LogCollector = LogCollector;
export {};
