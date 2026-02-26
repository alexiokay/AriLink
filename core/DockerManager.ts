const { execFile } = require("child_process");

interface ContainerStatus {
  name: string;
  state: "running" | "exited" | "restarting" | "paused" | "dead" | "unknown";
  health: "healthy" | "unhealthy" | "starting" | "none" | "unknown";
  uptime: string;
}

/** Allowlisted services: slug → container name */
const SERVICE_MAP: Record<string, string> = {
  parakeet: "arilink-parakeet",
  kokoro: "arilink-kokoro",
  asterisk: "arilink-asterisk",
  "rust-rtp": "arilink-rust-rtp",
};

class DockerManager {
  private available: boolean | null = null;

  /** Check if Docker CLI can talk to the daemon (caches result) */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;

    if (process.env.DOCKER_MANAGEMENT === "false") {
      this.available = false;
      return false;
    }

    try {
      await this.exec(["info", "--format", "{{.ID}}"]);
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  /** Get status of a single container by service slug */
  async getContainerStatus(service: string): Promise<ContainerStatus | null> {
    const container = SERVICE_MAP[service];
    if (!container) return null;

    try {
      const format = "{{.State.Status}}|{{.State.Health.Status}}|{{.State.StartedAt}}";
      const output = await this.exec(["inspect", "--format", format, container]);
      const parts = output.trim().split("|");
      return {
        name: container,
        state: (parts[0] as ContainerStatus["state"]) || "unknown",
        health: (parts[1] as ContainerStatus["health"]) || "none",
        uptime: this.formatUptime(parts[2] || ""),
      };
    } catch {
      // Container doesn't exist or inspect failed
      return { name: container, state: "unknown", health: "unknown", uptime: "" };
    }
  }

  /** Get statuses of all managed containers */
  async getAllStatuses(): Promise<Record<string, ContainerStatus | null>> {
    const result: Record<string, ContainerStatus | null> = {};
    for (const slug of Object.keys(SERVICE_MAP)) {
      result[slug] = await this.getContainerStatus(slug);
    }
    return result;
  }

  /** Restart a container by service slug */
  async restartContainer(service: string): Promise<void> {
    const container = SERVICE_MAP[service];
    if (!container) throw new Error(`Unknown service: ${service}`);

    console.log(`[DockerManager] Restarting container: ${container}`);
    await this.exec(["restart", container], 60000);
    console.log(`[DockerManager] Container restarted: ${container}`);
  }

  /** Get list of manageable service slugs */
  getServiceSlugs(): string[] {
    return Object.keys(SERVICE_MAP);
  }

  private exec(args: string[], timeout = 10000): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("docker", args, { timeout, shell: false }, (err: any, stdout: string) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
  }

  private formatUptime(startedAt: string): string {
    if (!startedAt) return "";
    try {
      const started = new Date(startedAt);
      const seconds = Math.floor((Date.now() - started.getTime()) / 1000);
      if (seconds < 0) return "";
      if (seconds < 60) return `Up ${seconds}s`;
      if (seconds < 3600) return `Up ${Math.floor(seconds / 60)}m`;
      if (seconds < 86400) return `Up ${Math.floor(seconds / 3600)}h`;
      return `Up ${Math.floor(seconds / 86400)}d`;
    } catch {
      return "";
    }
  }
}

module.exports = { DockerManager };
