/**
 * GET /api/auth/check
 * Returns whether auth is enabled and if the current request is authenticated.
 */
import { getCookie } from "h3";

export default defineEventHandler((event) => {
  const secret = process.env.DASHBOARD_SECRET;

  if (!secret) {
    return { authEnabled: false, authenticated: true };
  }

  const authHeader = getRequestHeader(event, "authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : getCookie(event, "arilink-token");

  return {
    authEnabled: true,
    authenticated: token === secret,
  };
});
