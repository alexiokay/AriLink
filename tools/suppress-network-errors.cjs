// Preloaded via NODE_OPTIONS (--require) before Nuxt/Nitro starts.
// Patches the REAL process.emit to suppress network errors (ECONNRESET etc)
// that would otherwise crash Nuxt dev server via its unhandledRejection handler.
//
// Why this exists: Nitro's esbuild bundles `process` as a local variable in
// plugins, so patching process.emit inside a Nitro plugin only affects the
// bundled copy — the real Node.js process.emit remains unpatched. This preload
// script runs before any bundling and patches the actual global process.

"use strict";

const SUPPRESSED = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT",
  "EHOSTUNREACH", "ENETUNREACH", "EPIPE",
]);

function isNetworkError(err) {
  if (!err || typeof err !== "object") return false;
  if (SUPPRESSED.has(err.code)) return true;
  const msg = err.message || "";
  for (const code of SUPPRESSED) {
    if (msg.includes(code)) return true;
  }
  return false;
}

if (!process.__networkErrorSuppressor) {
  process.__networkErrorSuppressor = true;
  const origEmit = process.emit;
  process.emit = function (event) {
    if (event === "unhandledRejection" || event === "uncaughtException") {
      if (isNetworkError(arguments[1])) {
        console.warn(
          "[NetworkErrorSuppressor] Suppressed",
          event + ":",
          arguments[1]?.code || arguments[1]?.message
        );
        // Return true = "event was handled". Returning false causes Node.js to
        // escalate unhandledRejection → triggerUncaughtException, crashing the process.
        return true;
      }
    }
    return origEmit.apply(process, arguments);
  };
}
