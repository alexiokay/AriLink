import { spawn, ChildProcessWithoutNullStreams } from "child_process";

export class LocalTerminal {
  private shell: ChildProcessWithoutNullStreams | null = null;
  private socket: any;
  private mode: string;

  constructor(socket: any, mode = "local") {
    this.socket = socket;
    this.mode = mode;
  }

  private emitData(data: string) {
    this.socket.emit("terminal:data", { mode: this.mode, data });
  }

  async connect() {
    const isWindows = process.platform === "win32";
    const shellCmd = isWindows ? "powershell.exe" : "/bin/sh";
    const shellArgs = isWindows ? ["-NoLogo", "-ExecutionPolicy", "Bypass"] : [];

    console.log(`[LocalTerminal] Spawning shell: ${shellCmd} ${shellArgs.join(" ")}`);

    return new Promise((resolve, reject) => {
      try {
        this.shell = spawn(shellCmd, shellArgs);

        this.shell.stdout.on("data", (data) => {
          this.emitData(data.toString());
        });

        this.shell.stderr.on("data", (data) => {
          this.emitData(`\x1b[31m${data.toString()}\x1b[0m`);
        });

        this.shell.on("error", (err) => {
          console.error("[LocalTerminal] Process Error:", err);
          this.emitData(`\r\n*** Local Shell Error: ${err.message} ***\r\n`);
          reject(err);
        });

        this.shell.on("close", (code) => {
          console.log(`[LocalTerminal] Process closed with code: ${code}`);
          this.emitData(`\r\n*** Local Shell closed (exit code ${code}) ***\r\n`);
        });

        this.emitData(`\r\nAriLink Local System Shell (${process.platform})\r\n`);
        this.emitData(`Type 'exit' to close this session.\r\n\r\n`);

        console.log("[LocalTerminal] Connected and initial prompt sent");
        resolve(true);
      } catch (err) {
        console.error("[LocalTerminal] Spawn Exception:", err);
        reject(err);
      }
    });
  }

  write(data: string) {
    if (this.shell && this.shell.stdin) {
      this.shell.stdin.write(data);
    }
  }

  resize(cols: number, rows: number) {
    // ChildProcess spawn does not support TIOCSWINSZ
  }

  dispose() {
    if (this.shell) {
      console.log("[LocalTerminal] Disposing...");
      this.shell.kill();
      this.shell = null;
    }
  }
}

module.exports.LocalTerminal = LocalTerminal;
