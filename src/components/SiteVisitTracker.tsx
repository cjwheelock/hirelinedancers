"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const VISITOR_KEY = "hld_visitor_id";
/** Set in browsers that have opened the admin panel, so staff browsing is not counted. */
export const INTERNAL_BROWSER_KEY = "hld_internal_browser";
const BOT_PATTERN = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|scrape/i;

function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export function markInternalBrowser() {
  writeStorage(INTERNAL_BROWSER_KEY, "1");
}

function visitorId(): string | null {
  const existing = readStorage(VISITOR_KEY);
  if (existing) return existing;
  try {
    const created = window.crypto.randomUUID();
    window.localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return null;
  }
}

/** Records one page view per navigation. Never runs on /admin. */
export function SiteVisitTracker() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);
  const firstView = useRef(true);

  useEffect(() => {
    if (!pathname || lastPath.current === pathname) return;
    lastPath.current = pathname;
    const isFirstView = firstView.current;
    firstView.current = false;

    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      markInternalBrowser();
      return;
    }
    if (!supabaseUrl || !supabaseAnonKey) return;
    if (["localhost", "127.0.0.1"].includes(window.location.hostname)) return;
    if (navigator.webdriver || BOT_PATTERN.test(navigator.userAgent)) return;
    if (readStorage(INTERNAL_BROWSER_KEY)) return;

    let referrer: string | null = null;
    const params = new URLSearchParams(isFirstView ? window.location.search : "");
    if (isFirstView && document.referrer) {
      try {
        const host = new URL(document.referrer).hostname;
        if (host && host !== window.location.hostname) referrer = host;
      } catch { /* unparseable referrer */ }
    }

    void fetch(`${supabaseUrl}/rest/v1/rpc/track_site_visit`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
      body: JSON.stringify({
        p_path: pathname,
        p_referrer: referrer,
        p_utm_source: params.get("utm_source"),
        p_utm_medium: params.get("utm_medium"),
        p_utm_campaign: params.get("utm_campaign"),
        p_visitor_id: visitorId()
      })
    }).catch(() => { /* analytics must never affect the page */ });
  }, [pathname]);

  return null;
}
