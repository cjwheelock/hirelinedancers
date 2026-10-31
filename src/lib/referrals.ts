import { getMarketplaceClient } from "@/lib/marketplace";

// A referral code is the referrer's first name plus two (rarely three) digits.
const CODE_PATTERN = /^[A-Z]{1,12}[0-9]{2,3}$/;
const STORAGE_KEY = "hld_referral";
const VISIT_KEY = "hld_referral_visit";
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

export type StoredReferral = { code: string; capturedAt: number };

export function normalizeReferralCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function storedReferral(): StoredReferral | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as StoredReferral | null;
    const code = normalizeReferralCode(parsed?.code);
    if (!code || typeof parsed?.capturedAt !== "number" || Date.now() - parsed.capturedAt > MAX_AGE_MS) return null;
    return { code, capturedAt: parsed.capturedAt };
  } catch {
    return null;
  }
}

export function storeReferral(code: string) {
  const clean = normalizeReferralCode(code);
  const storage = safeStorage();
  if (!clean || !storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ code: clean, capturedAt: Date.now() }));
  } catch {
    // Storage can be unavailable in private browsing; the code still rides in the sign-in link.
  }
}

export function clearStoredReferral() {
  const storage = safeStorage();
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Saves a ?ref= code from the current address and counts the link visit once per browser. */
export function captureReferralFromUrl(href?: string): string | null {
  if (typeof window === "undefined") return null;
  let code: string | null = null;
  try {
    code = normalizeReferralCode(new URL(href ?? window.location.href).searchParams.get("ref"));
  } catch {
    return null;
  }
  if (!code) return null;
  storeReferral(code);

  const storage = safeStorage();
  let alreadyCounted = false;
  try {
    alreadyCounted = storage?.getItem(VISIT_KEY) === code;
    storage?.setItem(VISIT_KEY, code);
  } catch {
    alreadyCounted = false;
  }
  if (!alreadyCounted) {
    const client = getMarketplaceClient();
    void client?.rpc("record_referral_visit", { p_code: code });
  }
  return code;
}

export async function lookupReferralCode(value: string): Promise<{ code: string; referrerName: string } | null> {
  const code = normalizeReferralCode(value);
  const client = getMarketplaceClient();
  if (!code || !client) return null;
  const { data, error } = await client.rpc("lookup_referral_code", { p_code: code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? { code: row.code as string, referrerName: row.referrer_name as string } : null;
}

export function referralShareLink(code: string): string {
  const origin = typeof window === "undefined" ? "https://hirelinedancers.com" : window.location.origin;
  return `${origin}/instructors/join/?ref=${encodeURIComponent(code)}`;
}
