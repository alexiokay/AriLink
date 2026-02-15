export default defineEventHandler((event) => {
  const query = getQuery(event);
  const limit = parseInt((query.limit as string) || "50", 10);
  const offset = parseInt((query.offset as string) || "0", 10);
  const search = (query.search as string) || "";

  if (!serverState.callHistory) {
    throw createError({ statusCode: 503, message: "Call history not initialized" });
  }

  return serverState.callHistory.getCalls({ limit, offset, search });
});
