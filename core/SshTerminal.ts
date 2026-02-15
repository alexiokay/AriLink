import { Client } from "ssh2";
import { readFileSync, existsSync } from "fs";

export class SshTerminal {
  private client: Client;
  private shell: any = null;
  private socket: any;
  private mode: string;

  constructor(socket: any, mode = "remote") {
    this.socket = socket;
    this.mode = mode;
    this.client = new Client();
  }

  private emitData(data: string) {
    this.socket.emit("terminal:data", { mode: this.mode, data });
  }

  async connect(credentials?: {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    keyPath?: string;
  }) {
    const host = credentials?.host || process.env.SSH_HOST;
    const username = credentials?.username || process.env.SSH_USER;
    const password = credentials?.password || process.env.SSH_PASSWORD;
    const port = credentials?.port || parseInt(process.env.SSH_PORT || "22");
    const keyPath = credentials?.keyPath || process.env.SSH_KEY_PATH;

    if (!host) throw new Error("SSH Host is required");
    if (!username) throw new Error("SSH Username is required");

    return new Promise((resolve, reject) => {
      this.client
        .on("ready", () => {
          this.client.shell((err, stream) => {
            if (err) {
              this.emitData(`\r\n*** Shell error: ${err.message} ***\r\n`);
              return reject(err);
            }
            this.shell = stream;

            this.shell.on("data", (data: any) => {
              this.emitData(data.toString());
            });

            this.shell.on("close", () => {
              this.emitData("\r\n*** Connection closed ***\r\n");
              this.client.end();
            });

            resolve(true);
          });
        })
        .on("error", (err) => {
          this.emitData(`\r\n*** SSH Error: ${err.message} ***\r\n`);
          reject(err);
        });

      const connectConfig: any = {
        host,
        port,
        username,
        password,
        readyTimeout: 10000,
        privateKey: keyPath && existsSync(keyPath)
          ? readFileSync(keyPath)
          : undefined,
        debug: (msg: string) => {
          if (msg.includes('handshake') || msg.includes('kex') || msg.includes('error') || msg.includes('KEX')) {
            console.log(`[SSH debug] ${msg}`);
          }
        },
      };

      console.log(`[SSH] Connecting to ${host}:${port} as ${username}`);
      this.client.connect(connectConfig);
    });
  }

  write(data: string) {
    if (this.shell) {
      this.shell.write(data);
    }
  }

  resize(cols: number, rows: number) {
    if (this.shell) {
      this.shell.setWindow(rows, cols, 0, 0);
    }
  }

  dispose() {
    if (this.shell) this.shell.end();
    this.client.end();
  }
}
