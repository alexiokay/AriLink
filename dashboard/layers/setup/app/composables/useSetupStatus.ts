interface SetupStatusResponse {
  setupComplete: boolean;
  missingKeys: string[];
  configured: {
    pbx: boolean;
    credentials: boolean;
    transcription: boolean;
    listener: boolean;
  };
}

export function useSetupStatus() {
  const setupComplete = useState<boolean | null>("setup-complete", () => null);
  const configured = useState<SetupStatusResponse["configured"] | null>("setup-configured", () => null);
  const loading = useState("setup-loading", () => false);

  async function check() {
    loading.value = true;
    try {
      const data = await $fetch<SetupStatusResponse>("/api/setup-status");
      setupComplete.value = data.setupComplete;
      configured.value = data.configured;
    } catch {
      // If API fails, assume setup needed (safer default)
      setupComplete.value = false;
    } finally {
      loading.value = false;
    }
  }

  function markComplete() {
    setupComplete.value = true;
  }

  return { setupComplete, configured, loading, check, markComplete };
}
