/**
 * Client-side route guard.
 * Redirects to /login when DASHBOARD_SECRET is configured and user is not authenticated.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;

  const { authenticated, authEnabled, checking, check } = useAuth();

  // First load: fetch auth status
  if (checking.value) {
    await check();
  }

  // Auth not enabled — skip
  if (!authEnabled.value) return;

  // Always allow login and setup pages
  if (to.path === "/login" || to.path.startsWith("/setup")) return;

  // Not authenticated — redirect to login
  if (!authenticated.value) {
    return navigateTo("/login");
  }
});
