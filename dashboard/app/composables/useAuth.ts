/**
 * Client-side auth composable.
 * Checks /api/auth/check on first load, provides login/logout helpers.
 */
export function useAuth() {
  const authenticated = useState("auth-ok", () => false);
  const authEnabled = useState("auth-enabled", () => false);
  const checking = useState("auth-checking", () => true);

  async function check() {
    try {
      const data = await $fetch<{ authEnabled: boolean; authenticated: boolean }>(
        "/api/auth/check"
      );
      authEnabled.value = data.authEnabled;
      authenticated.value = data.authenticated;
    } catch {
      authEnabled.value = true;
      authenticated.value = false;
    } finally {
      checking.value = false;
    }
  }

  async function login(secret: string) {
    await $fetch("/api/auth/login", {
      method: "POST",
      body: { secret },
    });
    authenticated.value = true;
  }

  async function logout() {
    await $fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    authenticated.value = false;
    navigateTo("/login");
  }

  return { authenticated, authEnabled, checking, check, login, logout };
}
