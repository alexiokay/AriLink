export default defineEventHandler(async () => {
  const engine = (process as any).__engine;
  const dockerManager = engine?.getDockerManager?.();

  if (!dockerManager || !(await dockerManager.isAvailable())) {
    return { available: false, services: {} };
  }

  const services = await dockerManager.getAllStatuses();
  return { available: true, services };
});
