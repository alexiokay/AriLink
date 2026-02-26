/**
 * Server middleware: protect all /api/* routes with DASHBOARD_SECRET.
 * If DASHBOARD_SECRET is not set, auth is disabled (backward compatible).
 */
import { getCookie } from "h3";

const PUBLIC_PREFIXES = [
  "/api/auth/",
  "/api/setup-status",
  "/api/setup/",
  "/api/detect-ip",
  "/api/pro-status",
  "/api/pro-activate",
];

export default defineEventHandler((event) => {
  const secret = process.env.DASHBOARD_SECRET;

  // Auth disabled if no secret configured
  if (!secret) return;

  const path = getRequestURL(event).pathname;

  // Only protect /api/* routes
  if (!path.startsWith("/api/")) return;

  // Allow public endpoints (login, setup wizard, etc.)
  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return;

  // Check Authorization header first, then cookie
  const authHeader = getRequestHeader(event, "authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : getCookie(event, "arilink-token");

  if (token !== secret) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }
});
