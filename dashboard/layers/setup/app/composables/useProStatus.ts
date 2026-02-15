interface ProStatusResponse {
  active: boolean;
  tier: "pro-pack" | "installation" | null;
  licenseId: string | null;
}

export function useProStatus() {
  const proActive = useState<boolean | null>("pro-active", () => null);
  const proTier = useState<string | null>("pro-tier", () => null);
  const proLoading = useState("pro-loading", () => false);

  async function check() {
    proLoading.value = true;
    try {
      const data = await $fetch<ProStatusResponse>("/api/pro-status");
      proActive.value = data.active;
      proTier.value = data.tier;
    } catch {
      proActive.value = false;
    } finally {
      proLoading.value = false;
    }
  }

  /** Activate a license key. Returns error message or null on success. */
  async function activate(key: string): Promise<string | null> {
    try {
      await $fetch("/api/pro-activate", {
        method: "POST",
        body: { key },
      });
      await check();
      return null;
    } catch (err: any) {
      return err.data?.message || err.message || "Activation failed";
    }
  }

  return { proActive, proTier, proLoading, check, activate };
}
