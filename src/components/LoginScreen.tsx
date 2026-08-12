"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  callbackUrl,
  cleanAccountIntent,
  cleanInstructorInvitationToken,
  cleanReturnPath,
  getMarketplaceClient,
  instructorInvitationTokenHash,
  marketplaceConfigured,
  readableError,
  type AccountIntent,
  type InstructorInvitationLifecycle
} from "@/lib/marketplace";
import {
  billingCycles,
  commercialTerms,
  guaranteeCoverage,
  invitationClaimWindow,
  profileSubmissionWindow
} from "@/lib/commercialTerms";
import styles from "./Marketplace.module.css";

function accountEntryPath(intent: AccountIntent | null, returnPath: string, invitationToken: string | null): string {
  if (!intent) return returnPath;

  const params = new URLSearchParams({ intent });
  if (invitationToken) params.set("invite", invitationToken);
  if (returnPath !== "/account/") params.set("returnTo", returnPath);
  return `/account/?${params.toString()}`;
}

function invitationDeadline(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | "claim" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState("/account/");
  const [intent, setIntent] = useState<AccountIntent | null>(null);
  const [invitationToken, setInvitationToken] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InstructorInvitationLifecycle | null>(null);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const returnPath = cleanReturnPath(params.get("next"));
    const token = cleanInstructorInvitationToken(params.get("invite"));
    const requestedIntent = token ? "instructor" : cleanAccountIntent(params.get("role"));
    const entryPath = accountEntryPath(requestedIntent, returnPath, token);
    setIntent(requestedIntent);
    setInvitationToken(token);
    setNext(entryPath);

    const client = getMarketplaceClient();
    if (!client) return () => { active = false; };
    const marketplaceClient = client;

    async function loadEntry() {
      const { data: sessionData } = await marketplaceClient.auth.getSession();
      if (!active) return;
      setHasSession(Boolean(sessionData.session));

      if (!token) {
        if (sessionData.session) window.location.replace(entryPath);
        return;
      }

      setInvitationLoading(true);
      try {
        const tokenHash = await instructorInvitationTokenHash(token);
        const { data, error: invitationError } = await marketplaceClient.rpc("get_instructor_invitation_lifecycle", {
          p_token_hash: tokenHash
        });
        if (invitationError) throw invitationError;
        if (active) setInvitation(data as InstructorInvitationLifecycle);
      } catch (invitationError) {
        if (active) setError(readableError(invitationError));
      } finally {
        if (active) setInvitationLoading(false);
      }
    }

    void loadEntry();
    return () => { active = false; };
  }, []);

  async function claimInvitation() {
    const client = getMarketplaceClient();
    if (!client || !invitationToken) return;
    setBusy("claim");
    setError(null);
    setMessage(null);
    try {
      const tokenHash = await instructorInvitationTokenHash(invitationToken);
      const { data, error: claimError } = await client.rpc("claim_instructor_invitation", {
        p_token_hash: tokenHash
      });
      if (claimError) throw claimError;
      setInvitation(data as InstructorInvitationLifecycle);
      setMessage("Invitation claimed. Sign in with the email address that received it to continue.");
    } catch (claimError) {
      setError(readableError(claimError));
    } finally {
      setBusy(null);
    }
  }

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
      setMessage("Check your email for a secure sign-in link. You can open it on any device and in any browser.");
    } catch (authError) {
      setError(readableError(authError));
    } finally {
      setBusy(null);
    }
  }

  const invited = Boolean(invitationToken);
  const invitationUnclaimed = invitation
    ? ["pending", "sending", "sent", "delivery_failed"].includes(invitation.status)
    : false;
  const invitationExpired = invitation?.status === "expired" || invitation?.status === "claim_expired";
  const expiredClaimWithAccount = invitation?.status === "claim_expired" && Boolean(invitation.accountCreatedAt);
  const authenticationAvailable = !invited
    || invitation?.status === "claimed"
    || invitation?.status === "accepted"
    || expiredClaimWithAccount;
  const initialDeadline = invitationDeadline(invitation?.initialClaimDeadlineAt ?? null);
  const submissionDeadline = invitationDeadline(invitation?.profileSubmissionDeadlineAt ?? null);
  const title = intent === "instructor"
    ? invited ? "Your private instructor invitation" : "Sign in to build your instructor profile"
    : intent === "organizer"
      ? "Sign in to contact instructors"
      : "Sign in to Hire Line Dancers";
  const subtitle = intent === "instructor"
    ? invited
      ? "Review the invitation first. Nothing is claimed until you choose the button below."
      : "Create your instructor workspace, complete your profile, and save a card securely to submit it for review. No subscription starts and no charge is made before approval."
    : intent === "organizer"
      ? "Create a planner account to contact instructors and keep your event inquiries organized."
      : "Browse instructors without an account. Sign in when you are ready to send an inquiry, or to manage your instructor profile.";

  return (
    <section className={`${styles.shell} ${styles.narrow}`}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.subtitle}>{subtitle}</p>

      <div className={styles.card}>
        {!marketplaceConfigured ? (
          <p className={styles.error}>Authentication is not configured in this deployment yet.</p>
        ) : invitationLoading ? (
          <p className={styles.notice}>Checking your private invitation...</p>
        ) : invited && invitationUnclaimed ? (
          <div className={styles.stack}>
            <h2>Claim your invitation</h2>
            <p>
              Claim by {initialDeadline ?? "the date in your invitation email"}. Claiming starts a {profileSubmissionWindow} window to sign in with the invited email, create your instructor account, and complete your profile{invitation?.grantsLifetimeAccess ? "." : " and payment setup."}
            </p>
            {invitation?.grantsLifetimeAccess ? (
              <p className={styles.notice}>This invitation includes complimentary lifetime instructor access.</p>
            ) : invitation?.offerCode === commercialTerms.offer.outreachOfferCode ? (
              <p className={styles.notice}>Complete the steps on time to earn your first {billingCycles} free. Stripe saves your card during submission, but no subscription starts and no charge is made before approval. Every new paid membership also includes the request-based {guaranteeCoverage} booking guarantee.</p>
            ) : null}
            <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void claimInvitation()}>
              {busy === "claim" ? "Claiming invitation..." : "Claim invitation"}
            </button>
          </div>
        ) : invited && invitationExpired && !expiredClaimWithAccount ? (
          <div className={styles.stack}>
            <h2>This invitation window has ended</h2>
            <p className={styles.error}>
              {invitation?.status === "claim_expired"
                ? invitation?.grantsLifetimeAccess
                  ? `The ${profileSubmissionWindow} account and profile submission window has ended.`
                  : `The ${profileSubmissionWindow} account, profile, and payment-setup window has ended.`
                : `The ${invitationClaimWindow} invitation claim window has ended.`}
            </p>
            <Link className={styles.secondaryButton} href="/instructors/join/">View instructor membership options</Link>
          </div>
        ) : authenticationAvailable ? (
          hasSession && invited ? (
            <div className={styles.stack}>
              <p className={styles.notice}>
                {expiredClaimWithAccount
                  ? invitation?.grantsLifetimeAccess
                    ? "Your instructor account and lifetime access are ready. The profile submission window ended, but your lifetime access remains active."
                    : "Your instructor account is ready, but the private offer submission window has ended. Continue to finish your profile without the invitation offer."
                  : invitation?.status === "accepted"
                  ? "This invitation has already been accepted. Continue to open the linked account."
                  : invitation?.grantsLifetimeAccess
                    ? `Invitation claimed. Continue by ${submissionDeadline ?? "your submission deadline"} to create your account and submit a complete profile.`
                    : `Invitation claimed. Continue by ${submissionDeadline ?? "your submission deadline"} to create your account, complete your profile, and finish payment setup.`}
              </p>
              <button className={styles.button} type="button" onClick={() => window.location.assign(next)}>
                Continue with signed-in account
              </button>
            </div>
          ) : (
            <>
              {invited ? (
                <p className={styles.notice}>
                  {expiredClaimWithAccount
                    ? invitation?.grantsLifetimeAccess
                      ? "Sign in with the email address linked to your instructor account. Your lifetime access remains active, and you can still finish your profile."
                      : "Sign in with the email address linked to your instructor account. The private offer submission window has ended, but you can still finish your profile."
                    : `Sign in with the exact email address that received this invitation${invitation?.status === "claimed" && submissionDeadline ? ` by ${submissionDeadline}` : ""}.`}
                </p>
              ) : null}
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
          )
        ) : invited && error ? null : (
          <p className={styles.notice}>This invitation is not available.</p>
        )}

        {message ? <p className={styles.success} role="status">{message}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
      <p className={styles.help}>By continuing, you agree to the site terms and privacy policy.</p>
    </section>
  );
}
