"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  callbackUrl,
  cleanAccountIntent,
  cleanInstructorInvitationToken,
  cleanReturnPath,
  getMarketplaceClient,
  marketplaceConfigured,
  readableError,
  type AccountIntent
} from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

function accountEntryPath(intent: AccountIntent | null, returnPath: string, invitationToken: string | null): string {
  if (!intent) return returnPath;

  const params = new URLSearchParams({ intent });
  if (invitationToken) params.set("invite", invitationToken);
  if (returnPath !== "/account/") params.set("returnTo", returnPath);
  return `/account/?${params.toString()}`;
}

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState("/account/");
  const [intent, setIntent] = useState<AccountIntent | null>(null);
  const [invited, setInvited] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnPath = cleanReturnPath(params.get("next"));
    const invitationToken = cleanInstructorInvitationToken(params.get("invite"));
    const requestedIntent = invitationToken ? "instructor" : cleanAccountIntent(params.get("role"));
    const entryPath = accountEntryPath(requestedIntent, returnPath, invitationToken);
    setIntent(requestedIntent);
    setInvited(Boolean(invitationToken));
    setNext(entryPath);

    const client = getMarketplaceClient();
    void client?.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace(entryPath);
    });
  }, []);

  async function signInWithGoogle() {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy("google");
    setError(null);
    const { error: authError } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl(next)
      }
    });
    if (authError) {
      setError(authError.message);
      setBusy(null);
    }
  }

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy("email");
    setError(null);
    setMessage(null);

    try {
      const { error: authError } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: callbackUrl(next),
          shouldCreateUser: true
        }
      });
      if (authError) throw authError;
      setMessage("Check your email for a secure sign-in link. Open it on this same device and in the same browser you used to request it.");
    } catch (authError) {
      setError(readableError(authError));
    } finally {
      setBusy(null);
    }
  }

  const eyebrow = intent === "instructor" ? "For instructors" : intent === "organizer" ? "For organizers" : null;
  const title = intent === "instructor"
    ? invited ? "Sign in to accept your instructor invitation" : "Sign in to build your instructor profile"
    : intent === "organizer"
      ? "Sign in to contact instructors"
      : "Sign in to Hire Line Dancers";
  const subtitle = intent === "instructor"
    ? invited
      ? "Use the email address that received your private invitation. After signing in, you can create or update your instructor profile."
      : "Create your instructor workspace, complete your public profile, add photos and videos, and submit it for review."
    : intent === "organizer"
      ? "Create a planner account to contact instructors and keep your event inquiries organized."
      : "Browse instructors without an account. Sign in when you are ready to send an inquiry, or to manage your instructor profile.";

  return (
    <section className={`${styles.shell} ${styles.narrow}`}>
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.subtitle}>{subtitle}</p>

      <div className={styles.card}>
        {!marketplaceConfigured ? (
          <p className={styles.error}>Authentication is not configured in this deployment yet.</p>
        ) : (
          <>
            <button
              className={`${styles.button} ${styles.googleButton}`}
              type="button"
              disabled={busy !== null}
              onClick={() => void signInWithGoogle()}
            >
              {busy === "google" ? "Connecting to Google..." : "Continue with Google"}
            </button>

            <div className={styles.divider}>or use your email</div>

            <form className={styles.stack} onSubmit={sendMagicLink}>
              <label className={styles.field}>
                <span>Email address</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                />
              </label>
              <button className={styles.secondaryButton} disabled={busy !== null} type="submit">
                {busy === "email" ? "Sending link..." : "Email me a sign-in link"}
              </button>
            </form>
          </>
        )}

        {message ? <p className={styles.success} role="status">{message}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
      <p className={styles.help}>By continuing, you agree to the site terms and privacy policy.</p>
    </section>
  );
}
