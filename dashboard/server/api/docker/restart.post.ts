const ALLOWED_SERVICES = new Set(["parakeet", "kokoro", "asterisk", "rust-rtp"]);

export default defineEventHandler(async (event) => {
  const body = await readBody<{ service: string }>(event);
  const service = body?.service;

  if (!service || !ALLOWED_SERVICES.has(service)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid service: ${service}` });
  }

  const engine = (process as any).__engine;
  const dockerManager = engine?.getDockerManager?.();

  if (!dockerManager || !(await dockerManager.isAvailable())) {
    throw createError({ statusCode: 503, statusMessage: "Docker management not available" });
  }

  try {
    await dockerManager.restartContainer(service);
    return { success: true, service };
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: err.message });
  }
});
