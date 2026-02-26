/**
 * POST /api/auth/login
 * Validates the dashboard secret and sets an httpOnly cookie.
 */
import { setCookie } from "h3";

export default defineEventHandler(async (event) => {
  const secret = process.env.DASHBOARD_SECRET;

  if (!secret) {
    return { ok: true };
  }

  const body = await readBody(event);

  if (!body?.secret || body.secret !== secret) {
    throw createError({ statusCode: 401, message: "Invalid secret" });
  }

  setCookie(event, "arilink-token", secret, {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  return { ok: true };
});
