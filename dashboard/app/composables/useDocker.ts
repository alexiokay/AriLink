interface ContainerStatus {
  name: string;
  state: "running" | "exited" | "restarting" | "paused" | "dead" | "unknown";
  health: "healthy" | "unhealthy" | "starting" | "none" | "unknown";
  uptime: string;
}

interface DockerStatus {
  available: boolean;
  services: Record<string, ContainerStatus | null>;
}

export function useDocker() {
  const status = useState<DockerStatus>("docker-status", () => ({
    available: false,
    services: {},
  }));

  const restarting = useState<Record<string, boolean>>("docker-restarting", () => ({}));
  const loading = useState<boolean>("docker-loading", () => true);

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function fetchStatus() {
    try {
      status.value = await $fetch<DockerStatus>("/api/docker/status");
    } catch {
      status.value = { available: false, services: {} };
    } finally {
      loading.value = false;
    }
  }

  function startPolling(intervalMs = 15000) {
    if (pollTimer) return;
    fetchStatus();
    pollTimer = setInterval(fetchStatus, intervalMs);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /** Map dashboard service key to Docker service slug */
  function dockerSlug(serviceKey: string): string | null {
    const map: Record<string, string> = {
      transcription: "parakeet",
      tts: "kokoro",
      asterisk: "asterisk",
      rustRtp: "rust-rtp",
    };
    return map[serviceKey] || null;
  }

  /** Get container status for a dashboard service key */
  function containerFor(serviceKey: string): ContainerStatus | null {
    const slug = dockerSlug(serviceKey);
    if (!slug) return null;
    return status.value.services[slug] || null;
  }

  return {
    status,
    restarting,
    loading,
    fetchStatus,
    startPolling,
    stopPolling,
    dockerSlug,
    containerFor,
  };
}
