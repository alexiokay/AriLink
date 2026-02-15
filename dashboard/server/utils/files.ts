import { existsSync, lstatSync, readdirSync, rmSync, mkdirSync, renameSync, readFileSync } from "fs";
import { resolve, join, basename } from "path";
import { exec as cpExec } from "child_process";
import Client from "ssh2-sftp-client";

export interface FileEntry {
  name: string;
  size: number;
  modifyTime: number;
  type: "file" | "directory";
}

export class FilesManager {
  private sftp: Client | null = null;
  private sftpCredKey: string = "";

  get isRemote() {
    return !!process.env.SSH_HOST && process.env.SSH_HOST !== "localhost";
  }

  private sshCredentialKey() {
    return `${process.env.SSH_HOST}:${process.env.SSH_PORT}:${process.env.SSH_USER}:${process.env.SSH_PASSWORD}`;
  }

  private async getSftp() {
    const key = this.sshCredentialKey();
    if (this.sftp && this.sftpCredKey !== key) {
      // Credentials changed — reconnect
      await this.close();
    }
    if (!this.sftp) {
      this.sftp = new Client();
      this.sftpCredKey = key;
      await this.sftp.connect({
        host: process.env.SSH_HOST,
        port: parseInt(process.env.SSH_PORT || "22"),
        username: process.env.SSH_USER,
        password: process.env.SSH_PASSWORD,
        privateKey: process.env.SSH_KEY_PATH && existsSync(process.env.SSH_KEY_PATH)
          ? readFileSync(process.env.SSH_KEY_PATH) : undefined,
      });
    }
    return this.sftp;
  }

  async list(path: string): Promise<FileEntry[]> {
    if (this.isRemote) {
      // Use find via SSH exec — much faster than SFTP readdir for large directories
      // Output: name\tsize\tmtime_epoch\ttype(d/f)
      const cmd = `find ${JSON.stringify(path)} -maxdepth 1 -mindepth 1 -printf '%f\\t%s\\t%T@\\t%y\\n' 2>/dev/null`;
      try {
        const result = await this.exec(cmd);
        if (result.code === 0 && result.stdout.trim()) {
          return result.stdout.trim().split("\n").map((line) => {
            const parts = line.split("\t");
            return {
              name: parts[0] || "",
              size: parseInt(parts[1] || "0") || 0,
              modifyTime: parseFloat(parts[2] || "0") * 1000 || 0,
              type: parts[3] === "d" ? "directory" as const : "file" as const,
            };
          }).filter((e) => e.name);
        }
      } catch {
        // Fallback to SFTP if find command fails (e.g. busybox without -printf)
      }
      const client = await this.getSftp();
      const list = await client.list(path);
      return list.map((item) => ({
        name: item.name,
        size: item.size,
        modifyTime: item.modifyTime,
        type: item.type === "d" ? "directory" : "file",
      }));
    } else {
      const fullPath = resolve(path);
      if (!existsSync(fullPath)) return [];
      const items = readdirSync(fullPath);
      return items.map((name) => {
        const stats = lstatSync(join(fullPath, name));
        return {
          name,
          size: stats.size,
          modifyTime: stats.mtimeMs,
          type: stats.isDirectory() ? "directory" : "file",
        };
      });
    }
  }

  async delete(path: string): Promise<void> {
    if (this.isRemote) {
      const client = await this.getSftp();
      const stats = await client.stat(path);
      if (stats.isDirectory) {
        await client.rmdir(path, true);
      } else {
        await client.delete(path);
      }
    } else {
      rmSync(path, { recursive: true, force: true });
    }
  }

  async mkdir(path: string): Promise<void> {
    if (this.isRemote) {
      const client = await this.getSftp();
      await client.mkdir(path, true);
    } else {
      mkdirSync(path, { recursive: true });
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.isRemote) {
      const client = await this.getSftp();
      await client.rename(oldPath, newPath);
    } else {
      renameSync(oldPath, newPath);
    }
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    if (this.isRemote) {
      const client = await this.getSftp();
      await client.put(localPath, remotePath);
    } else {
      const destDir = resolve(remotePath, "..");
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      renameSync(localPath, remotePath);
    }
  }

  getIsRemote() {
    return !!process.env.SSH_HOST && process.env.SSH_HOST !== "localhost";
  }

  async exec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    if (this.isRemote) {
      const { Client: SSHClient } = await import("ssh2");
      return new Promise((res, rej) => {
        const conn = new SSHClient();
        conn.on("ready", () => {
          conn.exec(command, (err: any, stream: any) => {
            if (err) { conn.end(); return rej(err); }
            let stdout = "", stderr = "";
            stream.on("data", (d: Buffer) => stdout += d.toString());
            stream.stderr.on("data", (d: Buffer) => stderr += d.toString());
            stream.on("close", (code: number) => {
              conn.end();
              res({ stdout, stderr, code: code || 0 });
            });
          });
        });
        conn.on("error", rej);
        conn.connect({
          host: process.env.SSH_HOST,
          port: parseInt(process.env.SSH_PORT || "22"),
          username: process.env.SSH_USER,
          password: process.env.SSH_PASSWORD,
          privateKey: process.env.SSH_KEY_PATH && existsSync(process.env.SSH_KEY_PATH)
            ? readFileSync(process.env.SSH_KEY_PATH)
            : undefined,
        });
      });
    } else {
      return new Promise((res) => {
        cpExec(command, (err, stdout, stderr) => {
          res({ stdout, stderr, code: err?.code || 0 });
        });
      });
    }
  }

  async close() {
    if (this.sftp) {
      await this.sftp.end();
      this.sftp = null;
    }
  }
}

// In Nitro, we can use a singleton for the request or a shared instance
let instance: FilesManager | null = null;
export function useFilesManager() {
  if (!instance) instance = new FilesManager();
  return instance;
}
