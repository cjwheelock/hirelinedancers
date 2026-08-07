"use client";

import { useEffect, useRef, useState } from "react";
import { cleanReturnPath, getMarketplaceClient, readableError } from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

export function AuthCallback() {
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function finishSignIn() {
      const client = getMarketplaceClient();
      if (!client) {
        setError("Authentication is not configured in this deployment.");
        return;
      }

      const url = new URL(window.location.href);
      const next = cleanReturnPath(url.searchParams.get("next"));
      const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      if (providerError) {
        setError(providerError);
        return;
      }

      try {
        let completedSession = null;
        const tokenHash = url.searchParams.get("token_hash");
        const verificationType = url.searchParams.get("type");
        const code = url.searchParams.get("code");

        if (tokenHash || code) {
          url.searchParams.delete("token_hash");
          url.searchParams.delete("type");
          url.searchParams.delete("code");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        }

        if (tokenHash && code) {
          throw new Error("The sign-in link is invalid. Please request a new one.");
        }

        if (tokenHash) {
          if (verificationType !== "email") {
            throw new Error("The sign-in link is invalid. Please request a new one.");
          }

          const { data, error: verificationError } = await client.auth.verifyOtp({
            token_hash: tokenHash,
            type: "email"
          });
          if (verificationError) throw verificationError;
          completedSession = data.session;
        } else if (code) {
          const { data, error: exchangeError } = await client.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          completedSession = data.session;
        }

        if (!completedSession) {
          const { data, error: sessionError } = await client.auth.getSession();
          if (sessionError) throw sessionError;
          completedSession = data.session;
        }

        if (!completedSession) throw new Error("The sign-in link is invalid or has expired. Please request a new one.");
        window.location.replace(next);
      } catch (authError) {
        setError(readableError(authError));
      }
    }

    void finishSignIn();
  }, []);

  return (
    <section className={`${styles.shell} ${styles.narrow}`}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Secure sign-in</p>
        <h1>{error ? "We could not sign you in" : "Finishing your sign-in"}</h1>
        {error ? (
          <>
            <p className={styles.error} role="alert">{error}</p>
            <a className={styles.button} href="/sign-in/">Try again</a>
          </>
        ) : (
          <p className={styles.notice} role="status">Please wait while we open your account.</p>
        )}
      </div>
    </section>
  );
}
