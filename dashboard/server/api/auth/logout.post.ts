/**
 * POST /api/auth/logout
 * Clears the auth cookie.
 */
import { deleteCookie } from "h3";

export default defineEventHandler((event) => {
  deleteCookie(event, "arilink-token", { path: "/" });
  return { ok: true };
});
