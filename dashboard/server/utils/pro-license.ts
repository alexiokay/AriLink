import { verify } from "crypto";

/**
 * Ed25519 public key for license verification.
 * Safe to embed in open source — only the developer holds the private key.
 * Nobody can forge valid license keys without the private key.
 */
const ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAaCFxEnC/8U5ZIoLZweKg4ncu80TJHDGACClm0swzYE=
-----END PUBLIC KEY-----`;

export interface ProLicensePayload {
  tier: "pro-pack" | "installation";
  id: string;
  iat: number;
  email?: string;
}

export interface ProStatus {
  active: boolean;
  tier: "pro-pack" | "installation" | null;
  licenseId: string | null;
}

/**
 * Parse and cryptographically verify an ARILINK-{payload}.{sig} license key.
 * Returns the decoded payload on success, or null on any failure.
 */
export function verifyLicenseKey(key: string): ProLicensePayload | null {
  try {
    if (!key.startsWith("ARILINK-")) return null;

    const rest = key.slice("ARILINK-".length);
    const dotIdx = rest.indexOf(".");
    if (dotIdx < 0) return null;

    const payloadB64 = rest.slice(0, dotIdx);
    const signatureB64 = rest.slice(dotIdx + 1);

    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf-8");
    const payload: ProLicensePayload = JSON.parse(payloadJson);

    if (!payload.tier || !payload.id || !payload.iat) return null;
    if (!["pro-pack", "installation"].includes(payload.tier)) return null;

    // Ed25519 verification: signature is over the base64url payload string bytes
    const payloadBuffer = Buffer.from(payloadB64, "utf-8");
    const signatureBuffer = Buffer.from(signatureB64, "base64url");

    const isValid = verify(null, payloadBuffer, ED25519_PUBLIC_KEY, signatureBuffer);
    return isValid ? payload : null;
  } catch {
    return null;
  }
}

/** Check Pro status via license key in PRO_LICENSE_KEY env var. */
export function getProStatus(): ProStatus {
  const key = process.env.PRO_LICENSE_KEY;
  if (key) {
    const payload = verifyLicenseKey(key);
    if (payload) {
      return {
        active: true,
        tier: payload.tier,
        licenseId: payload.id,
      };
    }
  }

  return { active: false, tier: null, licenseId: null };
}
