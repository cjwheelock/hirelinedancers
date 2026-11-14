"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMarketplaceClient, signInUrl } from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

type ConfirmState = "working" | "invalid" | "expired" | "confirmed" | "error";

/** Reads the one-time token from the URL fragment, so it never reaches a server log. */
export function confirmationTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function ConfirmGuestInquiry() {
  const [state, setState] = useState<ConfirmState>("working");

  useEffect(() => {
    const token = confirmationTokenFromHash(window.location.hash);
    // Drop the token from the address bar and history straight away.
    window.history.replaceState({}, "", window.location.pathname);
    if (!token) {
      setState("invalid");
      return;
    }
    const client = getMarketplaceClient();
    if (!client) {
      setState("error");
      return;
    }
    let active = true;
    void (async () => {
      const { data, error } = await client.functions.invoke("guest-inquiry", { body: { action: "confirm", token } });
      if (!active) return;
      const result = (data ?? {}) as { status?: string; next?: string; signInTokenHash?: string | null };
      let status = result.status;
      if (error && !status) {
        const context = (error as { context?: Response }).context;
        const payload = context && typeof context.json === "function" ? await context.json().catch(() => ({})) : {};
        status = (payload as { status?: string }).status;
      }
      if (status === "sent" && result.next) {
        if (result.signInTokenHash) {
          const params = new URLSearchParams({ next: result.next, token_hash: result.signInTokenHash, type: "email" });
          window.location.replace(`/auth/callback/?${params.toString()}`);
        } else {
          window.location.replace(signInUrl(result.next, "organizer"));
        }
        return;
      }
      setState(status === "expired" ? "expired" : status === "confirmed" ? "confirmed" : status === "invalid" ? "invalid" : "error");
    })();
    return () => { active = false; };
  }, []);

  if (state === "working") return <div className={styles.loading}>Confirming your inquiry...</div>;

  return (
    <section className={`${styles.shell} ${styles.narrow}`}>
      {state === "confirmed" ? (
        <>
          <h1 className={styles.title}>Your inquiry is confirmed</h1>
          <p className={styles.subtitle}>This inquiry was already confirmed and sent. Sign in with this email to read and respond.</p>
          <div className={styles.buttonRow} style={{ marginTop: 26 }}>
            <a className={styles.button} href={signInUrl("/account/", "organizer")}>Sign in</a>
          </div>
        </>
      ) : state === "expired" ? (
        <>
          <h1 className={styles.title}>This link has expired</h1>
          <p className={styles.subtitle}>Confirmation links last 7 days, and nothing was sent. Please send your inquiry again.</p>
          <div className={styles.buttonRow} style={{ marginTop: 26 }}>
            <Link className={styles.button} href="/instructors/">Find an instructor</Link>
          </div>
        </>
      ) : state === "invalid" ? (
        <>
          <h1 className={styles.title}>This link is not valid</h1>
          <p className={styles.subtitle}>Open the link from your confirmation email, or send your inquiry again.</p>
          <div className={styles.buttonRow} style={{ marginTop: 26 }}>
            <Link className={styles.button} href="/instructors/">Find an instructor</Link>
          </div>
        </>
      ) : (
        <>
          <h1 className={styles.title}>We could not confirm your inquiry</h1>
          <p className={styles.error} role="alert">Something went wrong. Open the link from your confirmation email again.</p>
        </>
      )}
    </section>
  );
}
