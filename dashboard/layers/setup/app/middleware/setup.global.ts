export default defineNuxtRouteMiddleware(async (to) => {
  // Only run on client
  if (import.meta.server) return;

  const { setupComplete, check } = useSetupStatus();

  // Wait for initial check if not yet loaded
  if (setupComplete.value === null) {
    await check();
  }

  // If setup needed and not already on /setup, redirect there
  if (!setupComplete.value && !to.path.startsWith("/setup")) {
    return navigateTo("/setup");
  }
});
