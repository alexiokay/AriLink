export default defineEventHandler((event) => {
  const id = getRouterParam(event, "id");

  if (!serverState.callHistory) {
    throw createError({ statusCode: 503, message: "Call history not initialized" });
  }

  const call = serverState.callHistory.getCall(id);
  if (!call) {
    throw createError({ statusCode: 404, message: "Not found" });
  }

  const transcriptions = serverState.callHistory.getCallTranscriptions(id!);
  const events = serverState.callHistory.getCallEvents?.(id!) || [];
  return { call, transcriptions, events };
});
