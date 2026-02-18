export default defineEventHandler((event) => {
  const query = getQuery(event);
  const days = parseInt((query.days as string) || "7", 10);

  if (!serverState.callHistory) {
    throw createError({ statusCode: 503, message: "Call history not initialized" });
  }

  return serverState.callHistory.getMetrics(days);
});
