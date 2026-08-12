"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, LoaderCircle, Mail, MailCheck, RotateCcw } from "lucide-react";
import { cities, eventTypes } from "@/data/site";
import {
  approvalEmailNeedsAttention,
  approvalEmailStatusCopy,
  approvalFailureCopy,
  normalizeApprovalEmailStatus,
  parseInstructorApprovalReadiness,
  parseInstructorApprovalReceipt,
  type ApprovalReadinessViewState,
  type ProfileApprovalViewState
} from "@/lib/adminApproval";
import {
  billingCycles,
  capitalizePolicyText,
  commercialTerms,
  currentGuaranteeTermsVersion,
  foundingOfferLabel,
  freePeriod,
  guaranteeCoverage,
  monthlyPriceWithCurrency,
  profileSubmissionWindow
} from "@/lib/commercialTerms";
import { useMarketplaceSession } from "@/hooks/useMarketplaceSession";
import { ImageCropDialog } from "./ImageCropDialog";
import {
  cleanAccountIntent,
  cleanInstructorInvitationToken,
  cleanReturnPath,
  getMarketplaceClient,
  instructorInvitationTokenHash,
  signInUrl,
  readableError,
  type AccountIntent,
  type AccountRole,
  type InstructorBillingRecovery,
  type InstructorInvitationLifecycle,
  type InstructorPrivateSettings,
  type InstructorProfile,
  type MarketplaceAccount,
  type MarketplaceInquiry
} from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

const danceStyles = [
  "Country line dancing",
  "Country swing",
  "Soul line dancing",
  "Pop line dancing",
  "Latin line dancing",
  "Beginner group instruction"
];

type ProfileMedia = {
  id: string;
  instructor_profile_id: string;
  media_type: "headshot" | "image" | "welcome_video" | "video";
  storage_path: string | null;
  external_url: string | null;
  mime_type: string | null;
  caption: string | null;
  alt_text: string | null;
  status: string;
  sort_order: number;
};

type InstructorTab = "profile" | "inquiries" | "membership";

type InstructorInvitationOfferStatus = Pick<
  InstructorInvitationLifecycle,
  "status" | "claimedAt" | "profileSubmissionDeadlineAt" | "accountCreatedAt" | "profileSubmittedAt" | "offerCode" | "offerEligible" | "offerEarnedAt"
> & {
  offerStatus: "pending" | "earned" | "ineligible" | "expired" | "redeemed";
  offerRedeemedAt: string | null;
  offerRedeemedCheckoutSessionId: string | null;
  offerRedeemedSubscriptionId: string | null;
};

export function AccountWorkspace({ adminOnly = false }: { adminOnly?: boolean }) {
  const { session, account, isAdmin, isOwner, loading, error, configured, refresh } = useMarketplaceSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<"admin" | "account" | "organizer">("admin");
  const [entryIntent, setEntryIntent] = useState<AccountIntent | null | undefined>(undefined);
  const [entryReturnTo, setEntryReturnTo] = useState<string | null>(null);
  const [entryInvitationToken, setEntryInvitationToken] = useState<string | null | undefined>(undefined);
  const [invitationClaim, setInvitationClaim] = useState<"idle" | "loading" | "ready" | "accepting" | "accepted" | "error">("idle");
  const [invitationLifecycle, setInvitationLifecycle] = useState<InstructorInvitationLifecycle | null>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invitationToken = cleanInstructorInvitationToken(params.get("invite"));
    setEntryInvitationToken(invitationToken);
    setEntryIntent(invitationToken ? "instructor" : cleanAccountIntent(params.get("intent")));
    const requestedReturn = params.get("returnTo");
    setEntryReturnTo(requestedReturn ? cleanReturnPath(requestedReturn) : null);
  }, []);

  useEffect(() => {
    if (loading || !configured || session || entryIntent === undefined || entryInvitationToken === undefined) return;
    const next = adminOnly ? "/admin/" : entryReturnTo ?? "/account/";
    const signInHref = entryInvitationToken
      ? `${signInUrl(next, "instructor")}&invite=${encodeURIComponent(entryInvitationToken)}`
      : signInUrl(next, entryIntent ?? undefined);
    window.location.replace(signInHref);
  }, [adminOnly, configured, entryIntent, entryInvitationToken, entryReturnTo, loading, session]);

  useEffect(() => {
    if (entryIntent === undefined || !account) return;
    if (entryInvitationToken) return;
    if ((account.role === entryIntent || (isAdmin && entryIntent === "organizer")) && entryReturnTo) {
      window.location.replace(entryReturnTo);
      return;
    }

    const url = new URL(window.location.href);
    if (!url.searchParams.has("intent") && !url.searchParams.has("returnTo")) return;
    url.searchParams.delete("intent");
    url.searchParams.delete("returnTo");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [account, entryIntent, entryInvitationToken, entryReturnTo, isAdmin]);

  useEffect(() => {
    if (!entryInvitationToken || !session || !configured) return;
    let active = true;
    setInvitationClaim("loading");
    setInvitationError(null);

    async function inspectInvitation() {
      const client = getMarketplaceClient();
      if (!client || !entryInvitationToken) return;
      try {
        const tokenHash = await instructorInvitationTokenHash(entryInvitationToken);
        const { data, error: inspectionError } = await client.rpc("get_instructor_invitation_lifecycle", {
          p_token_hash: tokenHash
        });
        if (inspectionError) throw inspectionError;
        if (!active) return;
        setInvitationLifecycle(data as InstructorInvitationLifecycle);
        setInvitationClaim("ready");
      } catch (inspectionError) {
        if (!active) return;
        setInvitationError(readableError(inspectionError));
        setInvitationClaim("error");
      }
    }

    void inspectInvitation();
    return () => { active = false; };
  }, [configured, entryInvitationToken, session]);

  useEffect(() => {
    if (!isAdmin) {
      setWorkspaceMode("account");
      return;
    }
    if (adminOnly || account?.role === "admin") {
      setWorkspaceMode("admin");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    const accountTabRequested = ["profile", "inquiries", "membership", "media"].includes(requestedTab ?? "");
    setWorkspaceMode(params.has("followup") || accountTabRequested ? "account" : "admin");
  }, [account?.role, adminOnly, isAdmin]);

  async function signOut() {
    const client = getMarketplaceClient();
    if (!client) return;
    setSigningOut(true);
    setSignOutError(null);
    const { error: localSignOutError } = await client.auth.signOut({ scope: "local" });
    if (localSignOutError) {
      setSignOutError(localSignOutError.message);
      setSigningOut(false);
      return;
    }
    window.location.replace("/");
  }

  async function restartInvitationSignIn() {
    const client = getMarketplaceClient();
    if (!client || !entryInvitationToken) return;
    setSigningOut(true);
    const { error: signOutError } = await client.auth.signOut({ scope: "local" });
    if (signOutError) {
      setInvitationError(signOutError.message);
      setSigningOut(false);
      return;
    }
    window.location.replace(`${signInUrl("/account/", "instructor")}&invite=${encodeURIComponent(entryInvitationToken)}`);
  }

  function finishInvitationEntry() {
    setEntryInvitationToken(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    url.searchParams.delete("intent");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function acceptInvitationForInstructor() {
    const client = getMarketplaceClient();
    if (!client || !entryInvitationToken || !account) return;
    setInvitationClaim("accepting");
    setInvitationError(null);
    try {
      const tokenHash = await instructorInvitationTokenHash(entryInvitationToken);
      const { error: acceptanceError } = await client.rpc("accept_instructor_invitation", {
        p_token_hash: tokenHash,
        p_full_name: account.full_name,
        p_company_name: account.company_name
      });
      if (acceptanceError) throw acceptanceError;
      setInvitationClaim("accepted");
      finishInvitationEntry();
      await refresh();
    } catch (acceptanceError) {
      setInvitationError(readableError(acceptanceError));
      setInvitationClaim("error");
    }
  }

  if (loading || entryIntent === undefined || entryInvitationToken === undefined) return <div className={styles.loading}>Loading your account...</div>;

  if (!configured) {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Account setup</p>
        <h1 className={styles.title}>Almost ready</h1>
        <p className={styles.error}>Supabase credentials were not included in this build.</p>
      </section>
    );
  }

  if (!session) {
    return <div className={styles.loading}>Opening sign in...</div>;
  }

  if (adminOnly && !isAdmin) {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Admin access</p>
        <h1 className={styles.title}>Access restricted</h1>
        <p className={styles.error}>This dashboard is available only to approved Hire Line Dancers administrators.</p>
        <a className={styles.secondaryButton} href="/account/">Open my account</a>
      </section>
    );
  }

  if (entryInvitationToken) {
    const deadline = invitationLifecycle?.profileSubmissionDeadlineAt
      ? new Date(invitationLifecycle.profileSubmissionDeadlineAt).toLocaleString()
      : null;
    const unclaimed = invitationLifecycle
      ? ["pending", "sending", "sent", "delivery_failed"].includes(invitationLifecycle.status)
      : false;
    const expiredWithoutAccount = (invitationLifecycle?.status === "expired"
      || invitationLifecycle?.status === "claim_expired")
      && !invitationLifecycle.accountCreatedAt;

    if (invitationClaim === "loading" || invitationClaim === "idle") {
      return <div className={styles.loading}>Checking your private invitation...</div>;
    }

    if (invitationClaim === "error" || !invitationLifecycle) {
      return (
        <section className={`${styles.shell} ${styles.narrow}`}>
          <p className={styles.eyebrow}>Instructor invitation</p>
          <h1 className={styles.title}>We could not open this invitation</h1>
          <p className={styles.error} role="alert">{invitationError ?? "The invitation is unavailable."}</p>
          <div className={styles.buttonRow}>
            <button className={styles.button} type="button" disabled={signingOut} onClick={() => void restartInvitationSignIn()}>
              {signingOut ? "Signing out..." : "Sign out and try another account"}
            </button>
            <a className={styles.secondaryButton} href="/account/">Open my account without this invitation</a>
          </div>
        </section>
      );
    }

    if (unclaimed) {
      return (
        <section className={`${styles.shell} ${styles.narrow}`}>
          <p className={styles.eyebrow}>Instructor invitation</p>
          <h1 className={styles.title}>Claim the invitation first</h1>
          <p className={styles.subtitle}>Opening this page did not claim anything. Return to the invitation screen and choose Claim invitation before continuing.</p>
          <a className={styles.button} href={`${signInUrl("/account/", "instructor")}&invite=${encodeURIComponent(entryInvitationToken)}`}>Review invitation</a>
        </section>
      );
    }

    if (expiredWithoutAccount) {
      return (
        <section className={`${styles.shell} ${styles.narrow}`}>
          <p className={styles.eyebrow}>Instructor invitation</p>
          <h1 className={styles.title}>This invitation window has ended</h1>
          <p className={styles.error}>The private account and profile submission window expired before an instructor account was created.</p>
          <div className={styles.buttonRow}>
            <Link className={styles.button} href="/instructors/join/">View instructor membership options</Link>
            <button className={styles.secondaryButton} type="button" disabled={signingOut} onClick={() => void restartInvitationSignIn()}>
              {signingOut ? "Signing out..." : "Try another account"}
            </button>
          </div>
        </section>
      );
    }

    if (account?.role && account.role !== "instructor") {
      return (
        <section className={`${styles.shell} ${styles.narrow}`}>
          <p className={styles.eyebrow}>Instructor invitation</p>
          <h1 className={styles.title}>Use the invited instructor account</h1>
          <p className={styles.error}>This invitation cannot be attached to a {account.role} account. Sign in with the exact email address that received it.</p>
          <button className={styles.button} type="button" disabled={signingOut} onClick={() => void restartInvitationSignIn()}>
            {signingOut ? "Signing out..." : "Sign out and try another account"}
          </button>
        </section>
      );
    }

    if (!account?.role && invitationLifecycle.status === "claimed") {
      return (
        <section className={`${styles.shell} ${styles.narrow}`}>
          <p className={styles.eyebrow}>Instructor invitation</p>
          <h1 className={styles.title}>Create your instructor account</h1>
          <p className={styles.subtitle}>
            Use the email address that received this invitation. Create the account and submit a complete profile{invitationLifecycle.grantsLifetimeAccess ? "" : " with payment setup"}{deadline ? ` by ${deadline}` : ` within the ${profileSubmissionWindow} window`}.
          </p>
          {invitationLifecycle.grantsLifetimeAccess ? (
            <p className={styles.notice}>This invitation includes complimentary lifetime instructor access.</p>
          ) : invitationLifecycle.offerCode === commercialTerms.offer.outreachOfferCode ? (
            <p className={styles.notice}>Complete payment setup and submit your profile on time to earn your first {billingCycles} free. If approved, your membership will start automatically with the offer applied. Every new paid membership also includes the request-based {guaranteeCoverage} booking guarantee.</p>
          ) : null}
          <OnboardingForm
            email={session.user.email ?? ""}
            initialName={account?.full_name ?? session.user.user_metadata.full_name ?? ""}
            fixedRole="instructor"
            invitationToken={entryInvitationToken}
            onComplete={async () => {
              setInvitationClaim("accepted");
              finishInvitationEntry();
              if (entryReturnTo) {
                window.location.replace(entryReturnTo);
                return;
              }
              await refresh();
            }}
          />
        </section>
      );
    }

    if (!account?.role) {
      return (
        <section className={`${styles.shell} ${styles.narrow}`}>
          <p className={styles.eyebrow}>Instructor invitation</p>
          <h1 className={styles.title}>Sign in with the linked account</h1>
          <p className={styles.error}>This invitation is already attached to an instructor account. Sign in with the email address that accepted it.</p>
          <button className={styles.button} type="button" disabled={signingOut} onClick={() => void restartInvitationSignIn()}>
            {signingOut ? "Signing out..." : "Sign out and try another account"}
          </button>
        </section>
      );
    }

    const missedSubmissionWindow = invitationLifecycle.status === "claim_expired";
    const lifetimeAccessRemains = missedSubmissionWindow && invitationLifecycle.grantsLifetimeAccess;
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Instructor invitation</p>
        <h1 className={styles.title}>{invitationLifecycle.status === "claimed" ? "Link your instructor workspace" : "Open your instructor workspace"}</h1>
        <p className={missedSubmissionWindow ? styles.notice : styles.subtitle}>
          {lifetimeAccessRemains
            ? "Your instructor account and lifetime access are ready. The profile submission window ended, but your lifetime access remains active and you can still finish your profile."
            : missedSubmissionWindow
              ? "Your instructor account is ready, but the private offer submission window has ended. You can still finish your profile."
            : invitationLifecycle.status === "claimed"
              ? invitationLifecycle.grantsLifetimeAccess
                ? `Confirm that you want to attach this invitation to the signed-in instructor account${deadline ? ` and submit your complete profile by ${deadline}` : ""}.`
                : `Confirm that you want to attach this invitation to the signed-in instructor account${deadline ? `, complete payment setup, and submit your complete profile by ${deadline}` : ""}.`
              : "Confirm the signed-in account to open the instructor workspace linked to this invitation."}
        </p>
        <div className={styles.buttonRow}>
          <button className={styles.button} type="button" disabled={invitationClaim === "accepting"} onClick={() => void acceptInvitationForInstructor()}>
            {invitationClaim === "accepting" ? "Opening workspace..." : invitationLifecycle.status === "claimed" ? "Accept and link invitation" : "Open instructor workspace"}
          </button>
          <button className={styles.secondaryButton} type="button" disabled={signingOut} onClick={() => void restartInvitationSignIn()}>
            {signingOut ? "Signing out..." : "Use another account"}
          </button>
        </div>
      </section>
    );
  }

  if (!account?.role && !isAdmin) {
    const isInstructorEntry = entryIntent === "instructor";
    const isOrganizerEntry = entryIntent === "organizer";
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>{isInstructorEntry ? "Instructor account" : isOrganizerEntry ? "Organizer account" : "One quick step"}</p>
        <h1 className={styles.title}>{isInstructorEntry ? "Set up your instructor workspace" : isOrganizerEntry ? "Set up your organizer workspace" : "How will you use Hire Line Dancers?"}</h1>
        <p className={styles.subtitle}>
          {isInstructorEntry
            ? "Add your account details, then complete your public instructor profile."
            : isOrganizerEntry
              ? "Add your account details, then you can contact instructors and track your inquiries."
              : "Choose the account workspace you need. You can contact support later if you need both."}
        </p>
        {error ? <p className={styles.error}>{error}</p> : null}
        <OnboardingForm
          email={session.user.email ?? ""}
          initialName={account?.full_name ?? session.user.user_metadata.full_name ?? ""}
          fixedRole={entryIntent ?? undefined}
          onComplete={async () => {
            if (entryReturnTo) {
              window.location.replace(entryReturnTo);
              return;
            }
            await refresh();
            window.history.replaceState({}, "", "/account/");
          }}
        />
      </section>
    );
  }

  const adminWorkspaceActive = isAdmin && workspaceMode === "admin";

  return (
    <section className={`${styles.shell} ${adminWorkspaceActive ? styles.adminShell : ""}`}>
      <div className={`${styles.topbar} ${adminWorkspaceActive ? styles.adminTopbar : ""}`}>
        <div>
          {!adminWorkspaceActive ? <p className={styles.eyebrow}>{workspaceMode === "organizer" || account?.role === "organizer" ? "Planner workspace" : "Instructor workspace"}</p> : null}
          <h1>{adminWorkspaceActive ? "Admin" : `Welcome, ${account?.full_name?.split(" ")[0] || "there"}`}</h1>
          <p className={styles.muted}>{account?.email}</p>
        </div>
        <button className={styles.secondaryButton} type="button" disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>

      {signOutError ? <p className={styles.error} role="alert">{signOutError}</p> : null}

      {!adminOnly && isAdmin ? (
        <div className={styles.tabs} role="tablist" aria-label="Workspace selection">
          <button className={`${styles.tab} ${workspaceMode === "admin" ? styles.activeTab : ""}`} type="button" onClick={() => setWorkspaceMode("admin")}>Admin</button>
          {account?.role === "instructor" ? <button className={`${styles.tab} ${workspaceMode === "account" ? styles.activeTab : ""}`} type="button" onClick={() => setWorkspaceMode("account")}>Instructor</button> : null}
          {account?.role === "organizer" ? <button className={`${styles.tab} ${workspaceMode === "account" ? styles.activeTab : ""}`} type="button" onClick={() => setWorkspaceMode("account")}>Organizer</button> : null}
          {account?.role !== "organizer" ? <button className={`${styles.tab} ${workspaceMode === "organizer" ? styles.activeTab : ""}`} type="button" onClick={() => setWorkspaceMode("organizer")}>Organizer</button> : null}
        </div>
      ) : null}

      {isAdmin && workspaceMode === "admin" ? <AdminDashboard isOwner={isOwner} /> : null}
      {workspaceMode === "account" && account?.role === "instructor" ? <InstructorDashboard account={account} /> : null}
      {workspaceMode === "account" && account?.role === "organizer" ? <OrganizerDashboard accountId={account.id} /> : null}
      {workspaceMode === "organizer" && isAdmin && account ? <OrganizerDashboard accountId={account.id} /> : null}
    </section>
  );
}

function OnboardingForm({
  email,
  initialName,
  fixedRole,
  invitationToken,
  onComplete
}: {
  email: string;
  initialName: string;
  fixedRole?: AccountIntent;
  invitationToken?: string;
  onComplete: () => void | Promise<void>;
}) {
  const [role, setRole] = useState<AccountRole>(fixedRole ?? "organizer");
  const [name, setName] = useState(initialName);
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client) return;

    setBusy(true);
    setError(null);
    try {
      const tokenHash = invitationToken
        ? await instructorInvitationTokenHash(invitationToken)
        : null;
      const { error: rpcError } = tokenHash
        ? await client.rpc("accept_instructor_invitation", {
            p_token_hash: tokenHash,
            p_full_name: name.trim(),
            p_company_name: company.trim() || null
          })
        : await client.rpc("complete_account_onboarding", {
            p_role: role,
            p_full_name: name.trim(),
            p_company_name: company.trim() || null,
            p_phone_e164: null,
            p_sms_opt_in: false
          });
      if (rpcError) throw rpcError;
      await onComplete();
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${styles.card} ${styles.stack}`} onSubmit={submit}>
      {!fixedRole ? (
        <div className={styles.roleGrid}>
          <label className={styles.roleOption}>
            <input type="radio" name="role" checked={role === "organizer"} onChange={() => setRole("organizer")} />
            <strong>I am planning an event</strong>
            <span>Contact instructors and keep your inquiries organized.</span>
          </label>
          <label className={styles.roleOption}>
            <input type="radio" name="role" checked={role === "instructor"} onChange={() => setRole("instructor")} />
            <strong>I teach line dancing</strong>
            <span>Build a profile, receive inquiries, and manage your availability.</span>
          </label>
        </div>
      ) : null}

      <label className={styles.field}>
        <span>Full name</span>
        <input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Email</span>
        <input value={email} disabled />
      </label>
      <label className={styles.field}>
        <span>{role === "organizer" ? "Company or organization (optional)" : "Business name (optional)"}</span>
        <input autoComplete="organization" value={company} onChange={(event) => setCompany(event.target.value)} />
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.button} disabled={busy} type="submit">
        {busy ? "Saving..." : invitationToken ? "Accept invitation" : role === "instructor" ? "Open instructor workspace" : "Open organizer workspace"}
      </button>
    </form>
  );
}

function InstructorDashboard({ account }: { account: MarketplaceAccount }) {
  const [tab, setTab] = useState<InstructorTab>("profile");
  const [focusInquiryId, setFocusInquiryId] = useState<string | null>(null);
  const [focusFollowup, setFocusFollowup] = useState<"booking" | "completion" | null>(null);
  const [profile, setProfile] = useState<InstructorProfile | null>(null);
  const [settings, setSettings] = useState<InstructorPrivateSettings | null>(null);
  const [billingRecovery, setBillingRecovery] = useState<InstructorBillingRecovery | null>(null);
  const [hasLifetimeAccess, setHasLifetimeAccess] = useState<boolean | null>(null);
  const [invitationOffer, setInvitationOffer] = useState<InstructorInvitationOfferStatus | null>(null);
  const [inquiries, setInquiries] = useState<MarketplaceInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutRecoveryError, setCheckoutRecoveryError] = useState<string | null>(null);
  const [checkoutRetryVersion, setCheckoutRetryVersion] = useState(0);
  const [paymentSetupPending, setPaymentSetupPending] = useState(false);
  const [paymentSetupRecoveryError, setPaymentSetupRecoveryError] = useState<string | null>(null);
  const [paymentSetupRetryVersion, setPaymentSetupRetryVersion] = useState(0);
  const [profileNotice, setProfileNotice] = useState<{ tone: "notice" | "success"; message: string } | null>(null);
  const [membershipNotice, setMembershipNotice] = useState<{ tone: "notice" | "success"; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(silent = false) {
    const client = getMarketplaceClient();
    if (!client) return;
    if (!silent) setLoading(true);
    setError(null);

    const { data: profileData, error: profileError } = await client
      .from("instructor_profiles")
      .select("*")
      .eq("account_id", account.id)
      .maybeSingle();
    if (profileError) {
      setError(profileError.message);
      setBillingRecovery(null);
      setHasLifetimeAccess(null);
      setLoading(false);
      return;
    }

    const loadedProfile = profileData as InstructorProfile | null;
    setProfile(loadedProfile);
    if (loadedProfile) {
      const [privateResult, inquiryResult, lifetimeAccessResult, invitationOfferResult, billingRecoveryResult] = await Promise.all([
        client.from("instructor_private_settings").select("*").eq("instructor_profile_id", loadedProfile.id).maybeSingle(),
        client.from("inquiries").select("*").eq("instructor_profile_id", loadedProfile.id).order("created_at", { ascending: false }),
        client.rpc("current_instructor_lifetime_access"),
        client.rpc("current_instructor_invitation_offer"),
        client.from("instructor_billing_recoveries")
          .select("id,instructor_profile_id,status,has_prior_successful_payment,first_failed_at,last_failed_at,grace_ends_at,access_paused_at,recovered_at")
          .eq("instructor_profile_id", loadedProfile.id)
          .in("status", ["grace_period", "access_paused"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ]);
      const loadError = privateResult.error ?? inquiryResult.error ?? lifetimeAccessResult.error ?? invitationOfferResult.error ?? billingRecoveryResult.error;
      if (loadError) setError(loadError.message);
      setSettings(privateResult.data as InstructorPrivateSettings | null);
      setInquiries((inquiryResult.data as MarketplaceInquiry[] | null) ?? []);
      setHasLifetimeAccess(lifetimeAccessResult.error ? null : Boolean(lifetimeAccessResult.data));
      setInvitationOffer(invitationOfferResult.error
        ? null
        : (invitationOfferResult.data as InstructorInvitationOfferStatus | null));
      setBillingRecovery(billingRecoveryResult.error
        ? null
        : (billingRecoveryResult.data as InstructorBillingRecovery | null));
    } else {
      setSettings(null);
      setInquiries([]);
      setHasLifetimeAccess(null);
      setInvitationOffer(null);
      setBillingRecovery(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [account.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success" || params.get("payment_setup") === "success") return;

    if (params.get("payment_setup") === "canceled") {
      setTab("profile");
      setPaymentSetupPending(false);
      setPaymentSetupRecoveryError(null);
      setProfileNotice({
        tone: "notice",
        message: "Payment setup was canceled. No payment method was saved, no subscription was started, and your profile remains a draft."
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("payment_setup");
      url.searchParams.delete("session_id");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      return;
    }

    if (params.get("checkout") === "canceled") {
      setTab("membership");
      setCheckoutPending(false);
      setCheckoutRecoveryError(null);
      setMembershipNotice({
        tone: "notice",
        message: "Checkout was canceled. No new membership was started, and you can try again when you are ready."
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("checkout");
      url.searchParams.delete("session_id");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      return;
    }

    if (params.get("billing") === "returned") {
      setTab("membership");
      setMembershipNotice({
        tone: "notice",
        message: "You returned from Stripe membership settings. Your latest billing status is shown below."
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("billing");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      return;
    }

    if (params.get("billing") === "recovery") {
      setTab("membership");
      setMembershipNotice({
        tone: "notice",
        message: "Update your payment method below. Stripe will then retry the overdue membership payment."
      });
      return;
    }

    if (params.get("billing") === "activation-failed") {
      setTab("profile");
      setProfileNotice({
        tone: "notice",
        message: "Your saved payment method could not start the membership, so your profile remains a draft. Save a new payment method and resubmit your profile."
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("billing");
      url.searchParams.set("tab", "profile");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      return;
    }

    const requestedTab = params.get("tab");
    const requestedInquiry = params.get("inquiry");
    const requestedFollowup = params.get("followup");
    const validInquiry = requestedInquiry && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(requestedInquiry)
      ? requestedInquiry
      : null;
    const validFollowup = requestedFollowup === "booking" || requestedFollowup === "completion"
      ? requestedFollowup
      : null;

    if (validInquiry) {
      setTab("inquiries");
      setFocusInquiryId(validInquiry);
      setFocusFollowup(validFollowup);
      return;
    }
    if (requestedTab === "media") {
      setTab("profile");
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "profile");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      return;
    }
    if (["profile", "inquiries", "membership"].includes(requestedTab ?? "")) {
      setTab(requestedTab as InstructorTab);
    }
  }, [account.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") !== "recovery-returned") return;

    setTab("membership");
    setMembershipNotice({
      tone: "notice",
      message: "Stripe saved your updated payment method. We are checking the overdue payment now."
    });
    let stopped = false;

    async function reconcileBillingRecovery() {
      const client = getMarketplaceClient();
      if (!client) return;
      const { data, error: reconciliationError } = await client.functions.invoke(
        "reconcile-instructor-billing-recovery",
        { body: {} }
      );
      if (stopped) return;

      if (reconciliationError) {
        setError(await edgeFunctionError(reconciliationError));
        setMembershipNotice(null);
      } else {
        setMembershipNotice({
          tone: data?.recovered ? "success" : "notice",
          message: typeof data?.message === "string"
            ? data.message
            : "Stripe is checking the overdue membership payment."
        });
      }
      await load(true);
      if (stopped) return;

      const url = new URL(window.location.href);
      url.searchParams.delete("billing");
      url.searchParams.set("tab", "membership");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    void reconcileBillingRecovery();
    return () => { stopped = true; };
  }, [account.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment_setup") !== "success") return;

    setTab("profile");
    setPaymentSetupPending(true);
    setPaymentSetupRecoveryError(null);
    setProfileNotice(null);
    let stopped = false;
    let attempts = 0;
    let timer: number | undefined;
    const sessionId = params.get("session_id");

    if (!sessionId || !/^cs_(?:live|test)_[A-Za-z0-9]+$/.test(sessionId)) {
      setPaymentSetupPending(false);
      setPaymentSetupRecoveryError("Stripe returned without a valid payment setup reference. Refresh this page, then contact support if your profile was not submitted.");
      return;
    }

    async function reconcilePaymentSetup() {
      const client = getMarketplaceClient();
      if (!client || stopped) return;
      attempts += 1;
      const { data, error: reconciliationError } = await client.functions.invoke("reconcile-instructor-payment-setup", {
        body: { sessionId }
      });
      if (stopped) return;

      await load(true);
      if (stopped) return;

      if (
        !reconciliationError
        && data?.reconciled === true
        && data?.paymentMethodSaved === true
        && ["pending_review", "approved", "published", "suspended"].includes(data?.profileStatus)
      ) {
        const reviewMessage = data.profileStatus === "pending_review"
          ? "Payment method saved. Your profile was submitted. We’ll review it ASAP."
          : data.profileStatus === "approved"
            ? "Payment method saved. Your profile is approved."
            : data.profileStatus === "published"
              ? "Payment method saved. Your profile is live."
              : "Payment method saved. Your profile is currently suspended.";
        const membershipTiming = data.profileStatus === "pending_review"
          ? "If approved, your membership will start automatically"
          : data.profileStatus === "approved"
            ? "Your membership is starting automatically"
            : data.profileStatus === "published"
              ? "Your membership is active"
              : null;
        const pricingMessage = !membershipTiming
          ? "This confirmation did not start a new membership. Contact support if you have questions about the suspension."
          : data.entitlementSource === "founding_first_100"
          ? `Your ${freePeriod} founding instructor offer is reserved. ${membershipTiming} with ${freePeriod} free. It will then renew at ${monthlyPriceWithCurrency} per month until canceled.`
          : data.entitlementSource === "private_invitation"
            ? `Your ${freePeriod} private instructor offer is reserved. ${membershipTiming} with ${freePeriod} free. It will then renew at ${monthlyPriceWithCurrency} per month until canceled.`
            : `${membershipTiming} at ${monthlyPriceWithCurrency} per month until canceled.`;
        setPaymentSetupPending(false);
        setPaymentSetupRecoveryError(null);
        setProfileNotice({
          tone: "success",
          message: `${reviewMessage} ${pricingMessage}`
        });
        const url = new URL(window.location.href);
        url.searchParams.delete("payment_setup");
        url.searchParams.delete("session_id");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        return;
      }

      if (attempts < 4) {
        const retryDelay = [750, 1500, 3000, 5000][attempts - 1] ?? 5000;
        timer = window.setTimeout(() => void reconcilePaymentSetup(), retryDelay);
        return;
      }

      const recoveryMessage = reconciliationError
        ? await edgeFunctionError(reconciliationError)
        : "Stripe is still confirming your saved payment method.";
      if (stopped) return;
      setPaymentSetupPending(false);
      setPaymentSetupRecoveryError(`${recoveryMessage} Use Check payment setup again below. If this continues, contact support and do not start another payment setup.`);
    }

    timer = window.setTimeout(() => void reconcilePaymentSetup(), 500);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [account.id, paymentSetupRetryVersion]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;

    setTab("membership");
    setCheckoutPending(true);
    setCheckoutRecoveryError(null);
    setMembershipNotice(null);
    let stopped = false;
    let attempts = 0;
    let timer: number | undefined;
    const sessionId = params.get("session_id");

    if (!sessionId || !/^cs_(?:live|test)_[A-Za-z0-9]+$/.test(sessionId)) {
      setCheckoutPending(false);
      setCheckoutRecoveryError("Stripe returned without a valid checkout reference. Refresh this page, then contact support if your membership is not active.");
      return;
    }

    async function reconcileMembership() {
      const client = getMarketplaceClient();
      if (!client || stopped) return;
      attempts += 1;
      const { data, error: reconciliationError } = await client.functions.invoke("reconcile-instructor-checkout", {
        body: { sessionId }
      });
      if (stopped) return;

      await load(true);
      if (stopped) return;

      if (
        !reconciliationError
        && data?.reconciled === true
        && ["active", "trialing"].includes(data.membershipStatus)
      ) {
        setCheckoutPending(false);
        setCheckoutRecoveryError(null);
        setMembershipNotice({
          tone: "success",
          message: "Your membership is confirmed. Your approved instructor profile is now ready for the directory."
        });
        const url = new URL(window.location.href);
        url.searchParams.delete("checkout");
        url.searchParams.delete("session_id");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        return;
      }

      if (attempts < 4) {
        const retryDelay = [750, 1500, 3000, 5000][attempts - 1] ?? 5000;
        timer = window.setTimeout(() => void reconcileMembership(), retryDelay);
        return;
      }

      const recoveryMessage = reconciliationError
        ? await edgeFunctionError(reconciliationError)
        : "Stripe is still confirming your membership.";
      if (stopped) return;
      setCheckoutPending(false);
      setCheckoutRecoveryError(`${recoveryMessage} Use Check membership again below. If this continues, contact support and do not start another checkout.`);
    }

    timer = window.setTimeout(() => void reconcileMembership(), 500);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [account.id, checkoutRetryVersion]);

  useEffect(() => {
    if (!checkoutPending) return;
    const membershipConfirmed = profile?.status === "published"
      || ["trialing", "active", "past_due", "unpaid", "paused"].includes(settings?.subscription_status ?? "");
    if (!membershipConfirmed) return;

    setCheckoutPending(false);
    setCheckoutRecoveryError(null);
    setMembershipNotice({
      tone: "success",
      message: "Your membership is confirmed. Your approved instructor profile is now ready for the directory."
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    url.searchParams.delete("session_id");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [checkoutPending, profile?.status, settings?.subscription_status]);

  function chooseTab(name: InstructorTab) {
    setTab(name);
    setFocusInquiryId(null);
    setFocusFollowup(null);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", name);
    url.searchParams.delete("inquiry");
    url.searchParams.delete("followup");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function clearInquiryFocus() {
    setFocusInquiryId(null);
    setFocusFollowup(null);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "inquiries");
    url.searchParams.delete("inquiry");
    url.searchParams.delete("followup");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <>
      {invitationOffer?.offerCode === commercialTerms.offer.outreachOfferCode ? (
        <div className={styles.card}>
          <p className={styles.eyebrow}>Private outreach offer</p>
          {invitationOffer.offerStatus === "redeemed" ? (
            <>
              <h2>{capitalizePolicyText(freePeriod)} free applied</h2>
              <p className={styles.success}>Your earned private offer was applied when your membership started automatically after approval, so your first {billingCycles} are free.</p>
              {invitationOffer.offerRedeemedAt ? <p className={styles.help}>Applied {new Date(invitationOffer.offerRedeemedAt).toLocaleString()}.</p> : null}
            </>
          ) : invitationOffer.offerStatus === "earned" || invitationOffer.offerEligible ? (
            <>
              <h2>{capitalizePolicyText(freePeriod)} free earned</h2>
              <p className={styles.success}>Your profile and payment setup were completed on time. If approved, your membership will start automatically with the first {billingCycles} free. Later review timing will not affect this earned offer.</p>
              <p className={styles.help}>Every new paid membership also includes the request-based {guaranteeCoverage} booking guarantee, subject to its terms.</p>
            </>
          ) : invitationOffer.status === "claim_expired" ? (
            <>
              <h2>Private offer window ended</h2>
              <p className={styles.notice}>You can still finish and submit your instructor profile, but the private {freePeriod} offer is no longer available.</p>
            </>
          ) : invitationOffer.profileSubmittedAt ? (
            <>
              <h2>Private offer not available</h2>
              <p className={styles.notice}>Your profile was submitted, but this account is not eligible for the new-instructor {freePeriod} offer.</p>
            </>
          ) : (
            <>
              <h2>Complete your profile and payment setup on time</h2>
              <p className={styles.notice}>
                Choose Continue to save your payment method and submit a complete profile{invitationOffer.profileSubmissionDeadlineAt ? ` by ${new Date(invitationOffer.profileSubmissionDeadlineAt).toLocaleString()}` : " within your invitation window"} to earn your first {billingCycles} free.
              </p>
              <p className={styles.help}>Required details include your public name, bio, location, at least one event type, a valid inquiry email, and a ready headshot.</p>
            </>
          )}
        </div>
      ) : null}

      <div className={styles.tabs} role="tablist" aria-label="Instructor account sections">
        {(["profile", "inquiries", "membership"] as const).map((name) => (
          <button
            key={name}
            className={`${styles.tab} ${tab === name ? styles.activeTab : ""}`}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => chooseTab(name)}
          >
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>

      {loading ? <div className={styles.loading}>Loading your instructor workspace...</div> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {!loading && tab === "profile" && profileNotice ? <p className={styles[profileNotice.tone]} role="status">{profileNotice.message}</p> : null}
      {!loading && tab === "profile" && paymentSetupPending ? <p className={styles.notice} role="status">Stripe received your payment setup. We are confirming your saved payment method and submitting your profile now.</p> : null}
      {!loading && tab === "profile" && paymentSetupRecoveryError ? (
        <div className={`${styles.card} ${styles.stack}`}>
          <p className={styles.error} role="alert">{paymentSetupRecoveryError}</p>
          <button className={styles.button} type="button" onClick={() => setPaymentSetupRetryVersion((current) => current + 1)}>Check payment setup again</button>
        </div>
      ) : null}
      {!loading && profile && tab === "profile" ? (
        <InstructorProfileForm profile={profile} settings={settings} hasLifetimeAccess={hasLifetimeAccess} onSaved={() => void load()} />
      ) : null}
      {!loading && tab === "inquiries" ? (
        <InquiryList
          inquiries={inquiries}
          perspective="instructor"
          focusInquiryId={focusInquiryId}
          focusFollowup={focusFollowup}
          onChange={() => void load()}
          onFeedbackSubmitted={clearInquiryFocus}
        />
      ) : null}
      {!loading && profile && tab === "membership" && hasLifetimeAccess !== null ? (
        <MembershipCard
          profile={profile}
          settings={settings}
          checkoutPending={checkoutPending}
          checkoutRecoveryError={checkoutRecoveryError}
          membershipNotice={membershipNotice}
          billingRecovery={billingRecovery}
          hasLifetimeAccess={hasLifetimeAccess}
          onRetryCheckout={() => setCheckoutRetryVersion((current) => current + 1)}
        />
      ) : null}
      {!loading && profile && tab === "membership" && hasLifetimeAccess === null ? (
        <div className={styles.card}>
          <p className={styles.eyebrow}>Instructor access</p>
          <h2>Access check unavailable</h2>
          <p className={styles.notice}>Membership controls are unavailable until we can verify your instructor access. Refresh the page to try again.</p>
        </div>
      ) : null}
    </>
  );
}

function InstructorProfileForm({
  profile,
  settings,
  hasLifetimeAccess,
  onSaved
}: {
  profile: InstructorProfile;
  settings: InstructorPrivateSettings | null;
  hasLifetimeAccess: boolean | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    display_name: profile.display_name,
    business_name: profile.business_name ?? "",
    headline: profile.headline ?? "",
    bio: profile.bio ?? "",
    city: profile.city ?? "",
    region: profile.region ?? "",
    postal_code: profile.postal_code ?? "",
    travel_radius_miles: profile.travel_radius_miles?.toString() ?? "",
    years_teaching: profile.years_teaching?.toString() ?? "",
    max_group_size: profile.max_group_size?.toString() ?? "",
    styles: profile.styles,
    event_types: profile.event_types,
    favorite_song_name: profile.favorite_song_name ?? "",
    favorite_song_spotify_url: profile.favorite_song_spotify_url ?? "",
    provides_speakers: profile.provides_speakers ?? false,
    provides_microphone: profile.provides_microphone ?? false,
    provides_music_playback: profile.provides_music_playback ?? false,
    liability_insurance_status: profile.liability_insurance_status,
    preferred_response_hours: profile.preferred_response_hours.toString(),
    inquiry_email: settings?.inquiry_email ?? "",
    minimum_rate: settings?.minimum_rate_cents ? (settings.minimum_rate_cents / 100).toString() : "",
    minimum_hours: settings?.minimum_hours?.toString() ?? ""
  });
  const [busy, setBusy] = useState<"save" | "continue" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paymentSetupRequestKey = useRef<string | null>(null);

  function setValue<Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleArray(key: "styles" | "event_types", value: string) {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value]
    }));
  }

  async function save(continueToSubmission: boolean) {
    const client = getMarketplaceClient();
    if (!client) return;
    if (continueToSubmission && (!form.display_name.trim() || !form.bio.trim() || !form.city.trim() || !form.region.trim() || !form.event_types.length)) {
      setError("Add your public name, bio, location, and at least one event type before continuing.");
      return;
    }
    if (continueToSubmission && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.inquiry_email.trim())) {
      setError("A valid inquiry email is required before continuing.");
      return;
    }

    setBusy(continueToSubmission ? "continue" : "save");
    setError(null);
    setMessage(null);

    if (continueToSubmission) {
      const { data: readyHeadshots, error: headshotError } = await client
        .from("profile_media")
        .select("id")
        .eq("instructor_profile_id", profile.id)
        .eq("media_type", "headshot")
        .eq("status", "ready")
        .limit(1);
      if (headshotError) {
        setError(headshotError.message);
        setBusy(null);
        return;
      }
      if (!readyHeadshots?.length) {
        setError("Upload a main headshot and wait for it to be ready before continuing.");
        setBusy(null);
        return;
      }
    }

    const profilePayload = {
      display_name: form.display_name.trim(),
      business_name: form.business_name.trim() || null,
      headline: form.headline.trim() || null,
      bio: form.bio.trim() || null,
      city: form.city.trim() || null,
      region: form.region.trim().toUpperCase() || null,
      postal_code: form.postal_code.trim() || null,
      travel_radius_miles: form.travel_radius_miles ? Number(form.travel_radius_miles) : null,
      years_teaching: form.years_teaching ? Number(form.years_teaching) : null,
      max_group_size: form.max_group_size ? Number(form.max_group_size) : null,
      styles: form.styles,
      event_types: form.event_types,
      favorite_song_name: form.favorite_song_name.trim() || null,
      favorite_song_spotify_url: form.favorite_song_spotify_url.trim() || null,
      provides_speakers: form.provides_speakers,
      provides_microphone: form.provides_microphone,
      provides_music_playback: form.provides_music_playback,
      liability_insurance_status: form.liability_insurance_status,
      preferred_response_hours: Number(form.preferred_response_hours),
      status: profile.status
    };

    const { error: settingsError } = await client.from("instructor_private_settings").upsert({
      instructor_profile_id: profile.id,
      inquiry_email: form.inquiry_email.trim(),
      inquiry_phone_e164: null,
      sms_notifications_enabled: false,
      minimum_rate_cents: form.minimum_rate ? Math.round(Number(form.minimum_rate) * 100) : null,
      minimum_hours: form.minimum_hours ? Number(form.minimum_hours) : null
    });
    if (settingsError) {
      setError(settingsError.message);
      setBusy(null);
      return;
    }

    const { error: profileError } = await client.from("instructor_profiles").update(profilePayload).eq("id", profile.id);
    if (profileError) {
      setError(profileError.message);
      setBusy(null);
      return;
    }

    if (!continueToSubmission) {
      setBusy(null);
      setMessage("Your profile changes are saved.");
      onSaved();
      return;
    }

    if (hasLifetimeAccess === null) {
      setBusy(null);
      setError("We could not verify your instructor access. Refresh the page before continuing.");
      return;
    }

    if (hasLifetimeAccess) {
      const { error: submissionError } = await client.rpc("submit_lifetime_instructor_profile_for_review");
      setBusy(null);
      if (submissionError) {
        setError(submissionError.message);
        return;
      }
      setMessage("Your profile was submitted. We’ll review it ASAP.");
      onSaved();
      return;
    }

    if (settings?.payment_setup_completed_at) {
      const { data: resubmissionData, error: resubmissionError } = await client.rpc("resubmit_instructor_profile_after_payment_setup");
      setBusy(null);
      if (resubmissionError) {
        setError(resubmissionError.message.includes("A verified payment setup is required before resubmitting")
          ? "We could not verify your saved payment method. Refresh the page and try again. If this continues, contact support. You will not be asked to enter your card again unless a replacement is required."
          : resubmissionError.message);
        return;
      }
      if (resubmissionData?.profileStatus !== "pending_review") {
        setError("Your updated profile could not be resubmitted for review. Refresh the page and try again.");
        return;
      }
      setMessage("Your saved payment method is confirmed. Your updated profile was resubmitted. We’ll review it ASAP.");
      onSaved();
      return;
    }

    paymentSetupRequestKey.current ??= crypto.randomUUID();
    const { data, error: setupError } = await client.functions.invoke("create-instructor-payment-setup", {
      body: { instructorProfileId: profile.id },
      headers: { "Idempotency-Key": paymentSetupRequestKey.current }
    });
    if (setupError) {
      setBusy(null);
      setError(await edgeFunctionError(setupError));
      return;
    }
    if (!data?.url || typeof data.url !== "string") {
      setBusy(null);
      setError("Stripe payment setup did not return a secure link.");
      return;
    }
    window.location.assign(data.url);
  }

  const canEdit = ["draft", "approved", "published"].includes(profile.status);
  const canContinue = profile.status === "draft";
  const selectedMarket = cities.find((market) => market.city === form.city && market.state === form.region);
  const allEventTypesSelected = eventTypes.every((item) => form.event_types.includes(item.slug));

  function selectMarket(slug: string) {
    const market = cities.find((item) => item.slug === slug);
    if (!market) return;
    setForm((current) => ({ ...current, city: market.city, region: market.state }));
  }

  function toggleAllEventTypes() {
    setForm((current) => ({
      ...current,
      event_types: allEventTypesSelected ? [] : eventTypes.map((item) => item.slug)
    }));
  }

  return (
    <div className={`${styles.card} ${styles.stack}`}>
      <div className={styles.buttonRow}>
        <span className={styles.status}>{profile.status.replace("_", " ")}</span>
        {profile.status === "pending_review" ? <span className={styles.muted}>Your profile is under review.</span> : null}
      </div>
      {!canEdit ? <p className={styles.notice}>Editing is paused while your profile is in review or suspended.</p> : null}

      <div className={`${styles.grid} ${styles.alignedGrid}`}>
        <label className={styles.field}>
          <span>Public name</span>
          <input disabled={!canEdit} required value={form.display_name} onChange={(e) => setValue("display_name", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Business name</span>
          <input disabled={!canEdit} value={form.business_name} onChange={(e) => setValue("business_name", e.target.value)} />
        </label>
      </div>
      <label className={styles.field}>
        <span>About you</span>
        <textarea disabled={!canEdit} maxLength={2000} value={form.bio} onChange={(e) => setValue("bio", e.target.value)} />
      </label>

      <ProfileMediaManager profile={profile} />

      <div className={`${styles.grid} ${styles.alignedGrid}`}>
        <label className={styles.field}>
          <span>City or metro area</span>
          <select disabled={!canEdit} required value={selectedMarket?.slug ?? ""} onChange={(e) => selectMarket(e.target.value)}>
            <option value="">Select one of our launch areas</option>
            {cities.map((market) => (
              <option key={market.slug} value={market.slug}>{market.city}, {market.state}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>ZIP code</span>
          <input disabled={!canEdit} value={form.postal_code} onChange={(e) => setValue("postal_code", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Travel radius in miles</span>
          <input disabled={!canEdit} type="number" min="0" max="1000" value={form.travel_radius_miles} onChange={(e) => setValue("travel_radius_miles", e.target.value)} />
        </label>
      </div>

      <fieldset className={styles.stack} disabled={!canEdit}>
        <legend className={styles.legend}>What do you teach?</legend>
        <div className={styles.checkGrid}>
          {danceStyles.map((item) => (
            <label className={styles.check} key={item}>
              <input type="checkbox" checked={form.styles.includes(item)} onChange={() => toggleArray("styles", item)} />
              <span>{item}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.stack} disabled={!canEdit}>
        <legend className={styles.legend}>Events you accept</legend>
        <div className={styles.checkGrid}>
          <label className={`${styles.check} ${styles.selectAllCheck}`}>
            <input type="checkbox" checked={allEventTypesSelected} onChange={toggleAllEventTypes} />
            <span>Select all event types</span>
          </label>
          {eventTypes.map((item) => (
            <label className={styles.check} key={item.slug}>
              <input type="checkbox" checked={form.event_types.includes(item.slug)} onChange={() => toggleArray("event_types", item.slug)} />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={`${styles.grid} ${styles.alignedGrid}`}>
        <label className={styles.field}>
          <span>Favorite line dance song</span>
          <input disabled={!canEdit} value={form.favorite_song_name} onChange={(e) => setValue("favorite_song_name", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Spotify track link</span>
          <input disabled={!canEdit} type="url" value={form.favorite_song_spotify_url} onChange={(e) => setValue("favorite_song_spotify_url", e.target.value)} placeholder="https://open.spotify.com/track/..." />
        </label>
      </div>

      <fieldset className={styles.stack} disabled={!canEdit}>
        <legend className={styles.legend}>Equipment you can provide</legend>
        <div className={styles.checkGrid}>
          <label className={styles.check}><input type="checkbox" checked={form.provides_speakers} onChange={(e) => setValue("provides_speakers", e.target.checked)} /><span>Speakers</span></label>
          <label className={styles.check}><input type="checkbox" checked={form.provides_microphone} onChange={(e) => setValue("provides_microphone", e.target.checked)} /><span>Microphone</span></label>
          <label className={styles.check}><input type="checkbox" checked={form.provides_music_playback} onChange={(e) => setValue("provides_music_playback", e.target.checked)} /><span>Music playback setup (iPhone, laptop, etc.)</span></label>
        </div>
      </fieldset>

      <div className={`${styles.grid} ${styles.alignedGrid}`}>
        <label className={styles.field}>
          <span>Liability insurance</span>
          <select disabled={!canEdit} value={form.liability_insurance_status} onChange={(e) => setValue("liability_insurance_status", e.target.value as typeof form.liability_insurance_status)}>
            <option value="not_provided">Not currently available</option>
            <option value="available">I can provide a certificate</option>
            <option value="required_per_event">I arrange it when required</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Typical response time</span>
          <select disabled={!canEdit} value={form.preferred_response_hours} onChange={(e) => setValue("preferred_response_hours", e.target.value)}>
            <option value="24">Within 24 hours</option>
            <option value="48">Within 48 hours</option>
            <option value="72">Within 72 hours</option>
          </select>
        </label>
      </div>

      <h3>Private inquiry and pricing settings</h3>
      <p className={styles.help}>These details are not displayed on your public profile.</p>
      <div className={`${styles.grid} ${styles.alignedGrid}`}>
        <label className={styles.field}>
          <span>Verified inquiry email</span>
          <input disabled type="email" value={form.inquiry_email} />
          <small>Inquiry alerts go to the email verified through your account sign-in.</small>
        </label>
        <label className={styles.field}>
          <span>Typical minimum rate in dollars</span>
          <input disabled={!canEdit} type="number" min="0" step="1" value={form.minimum_rate} onChange={(e) => setValue("minimum_rate", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Minimum booking hours</span>
          <input disabled={!canEdit} type="number" min="0.5" max="24" step="0.5" value={form.minimum_hours} onChange={(e) => setValue("minimum_hours", e.target.value)} />
        </label>
      </div>

      {message ? <p className={styles.success}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {canContinue && hasLifetimeAccess === false ? (
        <div className={styles.stack}>
          {settings?.payment_setup_completed_at ? (
            <p className={styles.help}>Your payment method is already saved securely. Choose Continue to resubmit your updated profile without entering your card again. No subscription will start and your card will not be charged while your profile is under review. If approved, your membership starts automatically.</p>
          ) : (
            <>
              <p className={styles.help}>Stripe will save your card securely. No subscription will start and your card will not be charged before your profile is approved. If approved, your membership starts automatically. The {foundingOfferLabel} who complete payment setup receive {freePeriod} free, then the membership renews at {monthlyPriceWithCurrency} per month until canceled. The {guaranteeCoverage} money-back guarantee begins when Stripe collects your first membership payment.</p>
              <p className={styles.muted}>By continuing, you agree to the <a href="/legal/terms/">Terms of Service</a>, acknowledge the <a href="/legal/privacy/">Privacy Policy</a> and <a href="/legal/refund-policy/">Refund Policy</a>, and authorize Hire Line Dancers to start your membership automatically only if your profile is approved.</p>
            </>
          )}
        </div>
      ) : null}
      {canContinue && hasLifetimeAccess ? <p className={styles.help}>Your complimentary lifetime access does not require a payment method. Continue to submit your completed profile for review.</p> : null}
      {canEdit ? (
        <div className={styles.buttonRow}>
          <button className={styles.secondaryButton} type="button" disabled={busy !== null} onClick={() => void save(false)}>
            {busy === "save" ? "Saving..." : profile.status === "draft" ? "Save draft" : "Save changes"}
          </button>
          {canContinue ? (
            <button className={styles.button} type="button" disabled={busy !== null || hasLifetimeAccess === null} onClick={() => void save(true)}>
              {busy === "continue" ? hasLifetimeAccess || settings?.payment_setup_completed_at ? "Submitting..." : "Opening secure payment setup..." : "Continue"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProfileMediaManager({ profile }: { profile: InstructorProfile }) {
  const [media, setMedia] = useState<ProfileMedia[]>([]);
  const [uploadType, setUploadType] = useState<ProfileMedia["media_type"]>("headshot");
  const [pendingCrop, setPendingCrop] = useState<{ file: File; mediaType: "headshot" | "image" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const client = getMarketplaceClient();
    if (!client) return;
    const { data, error: loadError } = await client
      .from("profile_media")
      .select("id,media_type,storage_path,external_url,caption,status,sort_order")
      .eq("instructor_profile_id", profile.id)
      .order("sort_order");
    if (loadError) setError(loadError.message);
    setMedia((data as ProfileMedia[] | null) ?? []);
  }

  useEffect(() => {
    void load();
  }, [profile.id]);

  async function uploadFile(file: File, mediaType: ProfileMedia["media_type"]) {
    const client = getMarketplaceClient();
    if (!client) return "Uploads are unavailable right now.";

    setBusy(true);
    setError(null);
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const path = `${profile.account_id}/${profile.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await client.storage.from("instructor-media").upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false
    });
    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return uploadError.message;
    }

    const { error: metadataError } = await client.from("profile_media").insert({
      instructor_profile_id: profile.id,
      media_type: mediaType,
      storage_path: path,
      mime_type: file.type,
      status: "ready",
      sort_order: media.length
    });
    if (metadataError) {
      await client.storage.from("instructor-media").remove([path]);
      setError(metadataError.message);
      setBusy(false);
      return metadataError.message;
    }
    setBusy(false);
    await load();
    return null;
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const isVideo = uploadType === "video" || uploadType === "welcome_video";
    const allowedTypes = isVideo ? ["video/mp4", "video/webm"] : ["image/jpeg", "image/png", "image/webp"];
    const maximumBytes = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maximumBytes) {
      setError(isVideo ? "Videos must be 50 MB or smaller." : "Images must be 10 MB or smaller.");
      event.target.value = "";
      return;
    }
    if (!allowedTypes.includes(file.type)) {
      setError(isVideo ? "Choose an MP4 or WebM video." : "Choose a JPG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }

    setError(null);
    if (!isVideo) {
      setPendingCrop({ file, mediaType: uploadType });
      return;
    }

    event.target.value = "";
    await uploadFile(file, uploadType);
  }

  function cancelCrop() {
    setPendingCrop(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    requestAnimationFrame(() => fileInputRef.current?.focus());
  }

  async function uploadCrop(file: File) {
    if (!pendingCrop) return;
    const uploadError = await uploadFile(file, pendingCrop.mediaType);
    if (uploadError) throw new Error(uploadError);
    setPendingCrop(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    requestAnimationFrame(() => fileInputRef.current?.focus());
  }

  async function remove(item: ProfileMedia) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy(true);
    setError(null);
    if (item.storage_path) {
      const { error: storageError } = await client.storage.from("instructor-media").remove([item.storage_path]);
      if (storageError) {
        setError(storageError.message);
        setBusy(false);
        return;
      }
    }
    const { error: metadataError } = await client.from("profile_media").delete().eq("id", item.id);
    if (metadataError) setError(metadataError.message);
    setBusy(false);
    await load();
  }

  function mediaUrl(item: ProfileMedia) {
    if (item.external_url) return item.external_url;
    const client = getMarketplaceClient();
    if (!client || !item.storage_path) return "";
    return client.storage.from("instructor-media").getPublicUrl(item.storage_path).data.publicUrl;
  }

  return (
    <section className={`${styles.profileMediaSection} ${styles.stack}`} aria-labelledby="profile-media-heading">
      <div>
        <h2 id="profile-media-heading">Profile photos and videos</h2>
        <p className={styles.muted}>Add one headshot, up to three teaching photos, one welcome video, and up to three additional videos.</p>
      </div>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Media type</span>
          <select value={uploadType} onChange={(event) => setUploadType(event.target.value as ProfileMedia["media_type"])}>
            <option value="headshot">Main headshot</option>
            <option value="image">Teaching photo</option>
            <option value="welcome_video">Welcome video</option>
            <option value="video">Dancing or teaching video</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>{busy ? "Uploading..." : "Choose a file"}</span>
          <input
            ref={fileInputRef}
            type="file"
            disabled={busy || !["draft", "approved", "published"].includes(profile.status)}
            accept={uploadType === "video" || uploadType === "welcome_video" ? "video/mp4,video/webm" : "image/jpeg,image/png,image/webp"}
            onChange={(event) => void chooseFile(event)}
          />
          <small>{uploadType === "headshot" ? "You will crop this to a square before uploading." : uploadType === "image" ? "You will crop this to a 4:3 frame before uploading." : "MP4 or WebM, up to 50 MB."}</small>
        </label>
      </div>
      {profile.status === "pending_review" ? <p className={styles.notice}>Media is locked while your profile is in review.</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.mediaGrid}>
        {media.map((item) => (
          <article className={styles.mediaItem} key={item.id}>
            {item.media_type === "video" || item.media_type === "welcome_video" ? (
              <video className={styles.mediaPreview} src={mediaUrl(item)} controls preload="metadata" />
            ) : (
              // Uploaded user content has a runtime URL that Next Image cannot optimize during static export.
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.mediaPreview} src={mediaUrl(item)} alt={item.caption || item.media_type} />
            )}
            <span className={styles.status}>{item.media_type.replace("_", " ")}</span>
            {["draft", "approved", "published"].includes(profile.status) ? (
              <button className={styles.dangerButton} type="button" disabled={busy} onClick={() => void remove(item)}>Remove</button>
            ) : null}
          </article>
        ))}
      </div>
      {pendingCrop ? (
        <ImageCropDialog
          file={pendingCrop.file}
          aspectRatio={pendingCrop.mediaType === "headshot" ? 1 : 4 / 3}
          title={pendingCrop.mediaType === "headshot" ? "Crop your headshot" : "Crop your teaching photo"}
          outputWidth={pendingCrop.mediaType === "headshot" ? 1200 : 1600}
          onCancel={cancelCrop}
          onConfirm={uploadCrop}
        />
      ) : null}
    </section>
  );
}

function MembershipCard({
  profile,
  settings,
  checkoutPending,
  checkoutRecoveryError,
  membershipNotice,
  billingRecovery,
  hasLifetimeAccess,
  onRetryCheckout,
}: {
  profile: InstructorProfile;
  settings: InstructorPrivateSettings | null;
  checkoutPending: boolean;
  checkoutRecoveryError: string | null;
  membershipNotice: { tone: "notice" | "success"; message: string } | null;
  billingRecovery: InstructorBillingRecovery | null;
  hasLifetimeAccess: boolean;
  onRetryCheckout: () => void;
}) {
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkoutRequestKey = useRef<string | null>(null);

  async function activateMembership() {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy("checkout");
    setError(null);
    checkoutRequestKey.current ??= crypto.randomUUID();
    const { data, error: checkoutError } = await client.functions.invoke("create-instructor-checkout", {
      body: { instructorProfileId: profile.id },
      headers: { "Idempotency-Key": checkoutRequestKey.current }
    });
    setBusy(null);
    if (checkoutError) {
      setError(await edgeFunctionError(checkoutError));
      return;
    }
    if (!data?.url || typeof data.url !== "string") {
      setError("Stripe checkout did not return a secure payment link.");
      return;
    }
    window.location.assign(data.url);
  }

  async function manageMembership() {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy("portal");
    setError(null);
    const { data, error: portalError } = await client.functions.invoke("create-billing-portal", {
      body: { billingRecovery: Boolean(billingRecovery) }
    });
    setBusy(null);
    if (portalError) {
      setError(await edgeFunctionError(portalError));
      return;
    }
    if (!data?.url || typeof data.url !== "string") {
      setError("Stripe did not return a secure billing link.");
      return;
    }
    window.location.assign(data.url);
  }

  const hasPriorSubscription = Boolean(settings?.stripe_subscription_id);
  const canManage = ["trialing", "active", "past_due", "unpaid", "paused"].includes(settings?.subscription_status ?? "");
  const membershipStatusLabel = profile.status === "pending_review"
    ? "payment method saved"
    : settings?.subscription_status ?? "inactive";

  if (hasLifetimeAccess) {
    return (
      <div className={styles.card}>
        <p className={styles.eyebrow}>Instructor access</p>
        <h2>Lifetime access</h2>
        <p>Your instructor account has complimentary lifetime access. You will not be asked to enter payment details or activate a Stripe membership for this profile.</p>
        <p><span className={styles.status}>Lifetime</span></p>
        {profile.status === "draft" ? <p className={styles.notice}>Complete your profile and choose Continue to submit it for review. Lifetime access will publish it automatically after approval.</p> : null}
        {profile.status === "pending_review" ? <p className={styles.notice}>Your profile is under review. It will go live automatically when approved.</p> : null}
        {profile.status === "approved" ? <p className={styles.notice}>Your profile is approved and is being prepared for the directory.</p> : null}
        {profile.status === "published" ? <p className={styles.success}>Your profile is live in the directory.</p> : null}
        {profile.status === "suspended" ? <p className={styles.notice}>Your profile is currently suspended. Contact support if you have questions.</p> : null}
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Instructor membership</p>
      <h2>{monthlyPriceWithCurrency} per month</h2>
      <p>New instructors save a payment method before profile review. Stripe does not start a subscription or charge the saved card before approval. If the profile is approved, membership begins automatically. The {foundingOfferLabel} who complete payment setup receive their first {freePeriod} free, then membership renews at {monthlyPriceWithCurrency} per month until canceled. Every new paid membership includes the {guaranteeCoverage} booking guarantee, which begins with the first membership payment.</p>
      <p><span className={styles.status}>{membershipStatusLabel}</span></p>
      {billingRecovery?.status === "grace_period" && billingRecovery.grace_ends_at ? (
        <p className={styles.notice} role="alert">
          We could not process your latest membership payment. Your profile remains live through {new Date(billingRecovery.grace_ends_at).toLocaleDateString("en-US", { dateStyle: "long" })}. Update your payment method before then to avoid removal from the directory.
        </p>
      ) : null}
      {billingRecovery?.status === "access_paused" ? (
        <p className={styles.error} role="alert">
          We could not process the overdue membership payment. Your profile is not currently public. Update your payment method and complete the payment to restore it automatically.
        </p>
      ) : null}
      {membershipNotice ? <p className={styles[membershipNotice.tone]} role="status">{membershipNotice.message}</p> : null}
      {checkoutRecoveryError ? (
        <div className={styles.stack}>
          <p className={styles.error} role="alert">{checkoutRecoveryError}</p>
          <button className={styles.button} type="button" disabled={busy !== null} onClick={onRetryCheckout}>Check membership again</button>
        </div>
      ) : null}
      {profile.status === "approved" && (!settings?.payment_setup_completed_at || hasPriorSubscription) ? (
        <>
          {checkoutPending ? (
            <p className={styles.notice}>Stripe received your checkout. We are confirming your membership now. This usually takes a few seconds.</p>
          ) : checkoutRecoveryError ? null : (
            <>
              <p>Your profile has been approved. {hasPriorSubscription ? "Restart your membership" : "Activate your membership"} to publish it in the directory.</p>
              <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void activateMembership()}>
                {busy === "checkout" ? "Opening secure checkout..." : hasPriorSubscription ? "Restart membership" : "Activate membership"}
              </button>
              <p className={styles.muted}>By selecting this button, you agree to the <a href="/legal/terms/">Terms of Use</a>, acknowledge the <a href="/legal/privacy/">Privacy Policy</a> and <a href="/legal/refund-policy/">Refund Policy</a>, and authorize a recurring {monthlyPriceWithCurrency} monthly charge after any free period shown in Checkout until you cancel.</p>
            </>
          )}
        </>
      ) : null}
      {profile.status === "approved" && settings?.payment_setup_completed_at && !hasPriorSubscription ? <p className={styles.notice}>Your profile is approved and your automatically started membership is still being confirmed. Do not begin another checkout. Refresh shortly, then contact support if this status does not update.</p> : null}
      {profile.status === "draft" ? <p className={styles.notice}>{settings?.payment_setup_completed_at ? "Complete your updates and choose Continue to resubmit with your saved payment method." : "Complete your profile and choose Continue to save your payment method securely before review."}</p> : null}
      {profile.status === "pending_review" ? <p className={styles.notice}>Your payment method is saved. No charge was made and no subscription has started while your profile is under review. If approved, your membership will begin automatically.</p> : null}
      {profile.status === "published" ? <p className={styles.success}>Your profile is live in the directory.</p> : null}
      {canManage ? (
        <button className={styles.secondaryButton} type="button" disabled={busy !== null} onClick={() => void manageMembership()}>
          {busy === "portal"
            ? "Opening secure billing..."
            : billingRecovery
            ? "Update payment method"
            : "Manage membership"}
        </button>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}

type AdminNotificationJob = {
  id: number;
  channel: "email" | "sms";
  notification_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
};

type AdminInstructorServiceNotificationJob = {
  id: number;
  instructor_profile_id: string;
  notification_type: "profile_approved" | "activation_payment_failed" | "billing_grace_started" | "billing_access_paused";
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

type AdminAccess = {
  account_id: string;
  email: string | null;
  full_name: string | null;
  is_owner: boolean;
  granted_at: string;
};

type AdminInstructorLifetimeAccess = {
  instructor_profile_id: string;
  account_id: string;
  display_name: string;
  account_email: string | null;
  profile_status: string;
  has_lifetime_access: boolean;
  access_source: "admin" | "invitation" | null;
  granted_at: string | null;
  granted_by_email: string | null;
};

type AdminInstructorPaymentSetup = {
  instructor_profile_id: string;
  inquiry_email: string;
  minimum_rate_cents: number | null;
  minimum_hours: number | null;
  payment_methods: string[];
  subscription_status: string;
  payment_setup_completed_at: string | null;
  stripe_customer_id: string | null;
  stripe_payment_setup_checkout_session_id: string | null;
  stripe_subscription_id: string | null;
};

type AdminInstructorOfferEntitlement = {
  instructor_profile_id: string | null;
  redeemed_at: string | null;
};

type AdminInstructorActivationMembership = {
  instructor_profile_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  latest_checkout_session_id: string | null;
  status: string;
};

type AdminInstructorInvitation = {
  invitation_id: string;
  email: string;
  grants_lifetime_access: boolean;
  invitation_status: "pending" | "sending" | "sent" | "delivery_failed" | "claimed" | "accepted" | "revoked" | "expired" | "claim_expired";
  offer_code: string | null;
  offer_status: "awaiting_claim" | "awaiting_account" | "awaiting_submission" | "earned" | "expired" | "ineligible" | "redeemed" | null;
  expires_at: string;
  claimed_at: string | null;
  profile_submission_deadline_at: string | null;
  account_created_at: string | null;
  profile_submitted_at: string | null;
  offer_eligible: boolean;
  offer_earned_at: string | null;
  offer_redeemed_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  accepted_profile_id: string | null;
  invited_by_email: string;
  created_at: string;
};

type AdminInstructorMembership = {
  instructor_profile_id: string;
  account_id: string;
  display_name: string;
  business_name: string | null;
  account_email: string | null;
  inquiry_email: string | null;
  city: string | null;
  region: string | null;
  profile_status: string;
  subscription_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_livemode: boolean | null;
  founding_member_number: number | null;
  founding_status: string;
  guarantee_status: string;
  guarantee_terms_version: string | null;
  guarantee_started_at: string | null;
  guarantee_ends_at: string | null;
  claim_deadline_at: string | null;
  guarantee_admin_note: string | null;
  qualifying_booking_count: number;
  eligible_paid_amount_cents: number | null;
  claim_id: string | null;
  claim_status: string | null;
  claim_received_at: string | null;
  claim_received_via: string | null;
  claimant_email: string | null;
  requested_amount_cents: number | null;
  approved_refund_amount_cents: number | null;
  profile_complete_confirmed: boolean | null;
  contact_details_current_confirmed: boolean | null;
  response_requirement_confirmed: boolean | null;
  claim_admin_note: string | null;
  decision_reason: string | null;
  verified_refund_cents: number;
  refund_count: number;
  refunded: boolean;
  latest_refunded_at: string | null;
};

type AdminFollowupResponse = {
  id: number;
  inquiry_id: string;
  stage: "booking" | "completion";
  response: string;
  confirmed_event_date: string | null;
  private_comment: string | null;
  submitted_at: string;
};

type AdminAnalytics = {
  summary: {
    inquiries: number;
    instructors: number;
    companies: number;
    booked: number;
    in_progress: number;
    not_booked: number;
    completed: number;
    did_not_happen: number;
    cohort_booked: number;
    cohort_completed: number;
  };
  instructors: Array<{
    instructor_key: string;
    instructor_name: string;
    inquiries: number;
    companies: number;
    booked: number;
    completed: number;
    latest_inquiry_at: string;
  }>;
  companies: Array<{
    company_key: string;
    company_name: string;
    contact_email: string | null;
    inquiries: number;
    instructors: number;
    booked: number;
    completed: number;
    latest_inquiry_at: string;
  }>;
  instructor_companies: Array<{
    instructor_key: string;
    instructor_name: string;
    company_key: string;
    company_name: string;
    contact_email: string | null;
    inquiries: number;
    booked: number;
    completed: number;
    latest_inquiry_at: string;
  }>;
  series: Array<{
    period_start: string;
    inquiries: number;
    booked: number;
    completed: number;
  }>;
};

type AdminRangePreset = "today" | "7d" | "30d" | "12m" | "all" | "custom";

const emptyAdminAnalytics: AdminAnalytics = {
  summary: {
    inquiries: 0,
    instructors: 0,
    companies: 0,
    booked: 0,
    in_progress: 0,
    not_booked: 0,
    completed: 0,
    did_not_happen: 0,
    cohort_booked: 0,
    cohort_completed: 0
  },
  instructors: [],
  companies: [],
  instructor_companies: [],
  series: []
};

function dateInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function adminRange(
  preset: AdminRangePreset,
  customStart: string,
  customEnd: string
): { start: string | null; end: string | null; bucket: "day" | "week" | "month" | "year" } {
  if (preset === "all") return { start: null, end: null, bucket: "month" };

  const now = new Date();
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (preset === "7d") start.setDate(start.getDate() - 6);
  if (preset === "30d") start.setDate(start.getDate() - 29);
  if (preset === "12m") start.setFullYear(start.getFullYear() - 1);
  if (preset === "custom") {
    const customStartDate = new Date(`${customStart}T00:00:00`);
    const customEndDate = new Date(`${customEnd}T00:00:00`);
    customEndDate.setDate(customEndDate.getDate() + 1);
    const days = Math.max(1, (customEndDate.getTime() - customStartDate.getTime()) / 86_400_000);
    return {
      start: customStartDate.toISOString(),
      end: customEndDate.toISOString(),
      bucket: days > 730 ? "year" : days > 120 ? "month" : days > 45 ? "week" : "day"
    };
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    bucket: preset === "12m" ? "month" : "day"
  };
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function statusLabel(value: string | null) {
  return (value || "not started").replaceAll("_", " ");
}

function profileFieldValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function profileListValue(values: string[], labels?: Map<string, string>) {
  if (!values.length) return null;
  return values.map((value) => labels?.get(value) ?? statusLabel(value)).join(", ");
}

function ProfileReviewField({ label, value }: { label: string; value: string | number | null | undefined }) {
  const displayValue = profileFieldValue(value);
  return (
    <div className={displayValue ? undefined : styles.emptyProfileField}>
      <dt>{label}</dt>
      <dd>{displayValue ?? "Not provided"}</dd>
    </div>
  );
}

function money(cents: number | null | undefined) {
  if (cents == null) return "Not entered";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function adminDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "Not set";
}

function dollarsToCents(value: string) {
  if (!value.trim()) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function stripeCustomerUrl(customerId: string, livemode: boolean | null) {
  const mode = livemode === true ? "" : "/test";
  return `https://dashboard.stripe.com${mode}/customers/${encodeURIComponent(customerId)}`;
}

async function edgeFunctionFailure(error: unknown): Promise<{ message: string; code: string | null }> {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { error?: unknown; code?: unknown } | null;
      if (typeof payload?.error === "string") {
        return {
          message: payload.error,
          code: typeof payload.code === "string" ? payload.code : null
        };
      }
    }
  }
  return { message: readableError(error), code: null };
}

async function edgeFunctionError(error: unknown) {
  return (await edgeFunctionFailure(error)).message;
}

function MembershipGuaranteeAdmin({ isOwner }: { isOwner: boolean }) {
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const [rows, setRows] = useState<AdminInstructorMembership[]>([]);
  const loadRequestId = useRef(0);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [foundingStatus, setFoundingStatus] = useState("unassigned");
  const [guaranteeStatus, setGuaranteeStatus] = useState("not_started");
  const [guaranteeNote, setGuaranteeNote] = useState("");
  const [claimSource, setClaimSource] = useState("email");
  const [claimantEmail, setClaimantEmail] = useState("");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [instructorMessage, setInstructorMessage] = useState("");
  const [claimNote, setClaimNote] = useState("");
  const [reviewStatus, setReviewStatus] = useState("in_review");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [profileConfirmed, setProfileConfirmed] = useState(false);
  const [contactConfirmed, setContactConfirmed] = useState(false);
  const [responseConfirmed, setResponseConfirmed] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [refundId, setRefundId] = useState("");
  const [refundIssuedConfirmed, setRefundIssuedConfirmed] = useState(false);

  const cityOptions = useMemo(() => Array.from(new Set(rows.map((row) => (
    [row.city, row.region].filter(Boolean).join(", ") || "Location not set"
  )))).sort((a, b) => {
    if (a === "Location not set") return 1;
    if (b === "Location not set") return -1;
    return a.localeCompare(b);
  }), [rows]);

  const visibleRows = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return rows
      .filter((row) => {
        const location = [row.city, row.region].filter(Boolean).join(", ") || "Location not set";
        const matchesCity = cityFilter === "all" || location === cityFilter;
        const searchText = [row.display_name, row.business_name, row.account_email, row.inquiry_email]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        return matchesCity && (!normalizedSearch || searchText.includes(normalizedSearch));
      })
      .sort((a, b) => {
        const aLocation = [a.city, a.region].filter(Boolean).join(", ") || "Location not set";
        const bLocation = [b.city, b.region].filter(Boolean).join(", ") || "Location not set";
        if (aLocation === "Location not set" && bLocation !== "Location not set") return 1;
        if (bLocation === "Location not set" && aLocation !== "Location not set") return -1;
        return aLocation.localeCompare(bLocation) || a.display_name.localeCompare(b.display_name);
      });
  }, [cityFilter, rows, search]);

  const membershipGroups = useMemo(() => visibleRows.reduce<Array<{ city: string; instructors: AdminInstructorMembership[] }>>((groups, row) => {
    const city = [row.city, row.region].filter(Boolean).join(", ") || "Location not set";
    const currentGroup = groups.at(-1);
    if (currentGroup?.city === city) currentGroup.instructors.push(row);
    else groups.push({ city, instructors: [row] });
    return groups;
  }, []), [visibleRows]);

  const selected = useMemo(
    () => rows.find((row) => row.instructor_profile_id === selectedProfileId) ?? null,
    [rows, selectedProfileId]
  );

  async function loadMemberships() {
    const client = getMarketplaceClient();
    if (!client) return;
    const requestId = loadRequestId.current + 1;
    loadRequestId.current = requestId;
    setLoading(true);
    setError(null);
    const pageSize = 200;
    const nextRows: AdminInstructorMembership[] = [];
    let offset = 0;

    while (true) {
      const { data, error: searchError } = await client.rpc("admin_search_instructors", {
        p_search: null,
        p_limit: pageSize,
        p_offset: offset
      });
      if (requestId !== loadRequestId.current) return;
      if (searchError) {
        setError(searchError.message);
        setLoading(false);
        return;
      }
      const page = (data as AdminInstructorMembership[] | null) ?? [];
      nextRows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    setRows(nextRows);
    setSelectedProfileId((current) => (
      current && nextRows.some((row) => row.instructor_profile_id === current)
        ? current
        : nextRows[0]?.instructor_profile_id ?? null
    ));
    setLoading(false);
  }

  useEffect(() => {
    void loadMemberships();
  }, []);

  useEffect(() => {
    setSelectedProfileId((current) => (
      current && visibleRows.some((row) => row.instructor_profile_id === current)
        ? current
        : visibleRows[0]?.instructor_profile_id ?? null
    ));
  }, [visibleRows]);

  useEffect(() => {
    if (!selected) return;
    setFoundingStatus(selected.founding_status || "unassigned");
    setGuaranteeStatus(selected.guarantee_status || "not_started");
    setGuaranteeNote(selected.guarantee_admin_note ?? "");
    setClaimSource(selected.claim_received_via ?? "email");
    setClaimantEmail(selected.claimant_email ?? selected.inquiry_email ?? selected.account_email ?? "");
    setRequestedAmount(selected.requested_amount_cents == null ? "" : (selected.requested_amount_cents / 100).toString());
    setClaimNote(selected.claim_admin_note ?? "");
    setReviewStatus(
      ["approved", "denied", "withdrawn", "refund_pending"].includes(selected.claim_status ?? "")
        ? selected.claim_status as string
        : "in_review"
    );
    setApprovedAmount(selected.approved_refund_amount_cents == null ? "" : (selected.approved_refund_amount_cents / 100).toString());
    setProfileConfirmed(Boolean(selected.profile_complete_confirmed));
    setContactConfirmed(Boolean(selected.contact_details_current_confirmed));
    setResponseConfirmed(Boolean(selected.response_requirement_confirmed));
    setReviewNote(selected.claim_admin_note ?? "");
    setDecisionReason(selected.decision_reason ?? "");
    setInstructorMessage("");
    setRefundId("");
    setRefundIssuedConfirmed(false);
  }, [selected]);

  async function saveGuarantee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !selected || !isOwner) return;
    setBusy("guarantee");
    setError(null);
    setMessage(null);
    const { error: updateError } = await client.rpc("admin_update_instructor_guarantee", {
      p_instructor_profile_id: selected.instructor_profile_id,
      p_founding_status: foundingStatus,
      p_guarantee_status: guaranteeStatus,
      p_admin_note: guaranteeNote.trim() || null
    });
    setBusy(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage("Legacy founding and guarantee status saved.");
    await loadMemberships();
  }

  async function logClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !selected || !isOwner) return;
    const requestedCents = dollarsToCents(requestedAmount);
    if (requestedAmount.trim() && requestedCents == null) {
      setError("Enter a valid requested refund amount.");
      return;
    }
    setBusy("claim");
    setError(null);
    setMessage(null);
    const { error: claimError } = await client.rpc("admin_log_guarantee_claim", {
      p_instructor_profile_id: selected.instructor_profile_id,
      p_received_via: claimSource,
      p_claimant_email: claimantEmail.trim() || null,
      p_requested_amount_cents: requestedCents,
      p_instructor_message: instructorMessage.trim() || null,
      p_admin_note: claimNote.trim() || null
    });
    setBusy(null);
    if (claimError) {
      setError(claimError.message);
      return;
    }
    setMessage("Refund claim logged for review.");
    await loadMemberships();
  }

  async function reviewClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !selected?.claim_id || !isOwner) return;
    const approvedCents = dollarsToCents(approvedAmount);
    if (["approved", "refund_pending"].includes(reviewStatus) && approvedCents == null) {
      setError("Enter the approved refund amount before approving this claim.");
      return;
    }
    setBusy("review");
    setError(null);
    setMessage(null);
    const { error: reviewError } = await client.rpc("admin_review_guarantee_claim", {
      p_claim_id: selected.claim_id,
      p_status: reviewStatus,
      p_profile_complete_confirmed: profileConfirmed,
      p_contact_details_current_confirmed: contactConfirmed,
      p_response_requirement_confirmed: responseConfirmed,
      p_approved_refund_amount_cents: approvedCents,
      p_admin_note: reviewNote.trim() || null,
      p_decision_reason: decisionReason.trim() || null
    });
    setBusy(null);
    if (reviewError) {
      setError(reviewError.message);
      return;
    }
    setMessage("Claim review saved. No money was moved.");
    await loadMemberships();
  }

  async function verifyRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !selected?.claim_id || !isOwner) return;
    if (!refundIssuedConfirmed) {
      setError("Confirm that you already issued the refund in Stripe.");
      return;
    }
    if (!/^re_[A-Za-z0-9]+$/.test(refundId.trim())) {
      setError("Enter the Stripe refund ID beginning with re_.");
      return;
    }
    setBusy("refund");
    setError(null);
    setMessage(null);
    const { data, error: verifyError } = await client.functions.invoke("verify-instructor-refund", {
      body: { claimId: selected.claim_id, refundId: refundId.trim() }
    });
    setBusy(null);
    if (verifyError) {
      setError(await edgeFunctionError(verifyError));
      return;
    }
    if (data?.error) {
      setError(String(data.error));
      return;
    }
    setMessage(`Stripe verified ${money(Number(data?.amountCents ?? 0))}. Claim status: ${statusLabel(String(data?.claimStatus ?? "updated"))}.`);
    setRefundId("");
    setRefundIssuedConfirmed(false);
    await loadMemberships();
  }

  return (
    <div className={styles.membershipAdminLayout}>
      <section className={`${styles.card} ${styles.compactAdminCard}`}>
        <div className={styles.compactSectionHeader}>
          <div>
            <h2>Memberships and guarantees</h2>
            <p className={styles.muted}>Select an instructor to review membership, guarantee, claim, and refund details.</p>
          </div>
          <span className={styles.recordCount} aria-live="polite">{loading && !rows.length ? "Loading" : `${visibleRows.length} of ${rows.length}`}</span>
        </div>
        <div className={styles.membershipToolbar}>
          <label className={styles.field}>
            <span>Search by name</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, business, or email" />
          </label>
          <label className={styles.field}>
            <span>City</span>
            <select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}>
              <option value="all">All cities</option>
              {cityOptions.map((city) => <option value={city} key={city}>{city}</option>)}
            </select>
          </label>
          <button className={`${styles.secondaryButton} ${styles.compactButton}`} disabled={loading} type="button" onClick={() => void loadMemberships()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.success}>{message}</p> : null}
        {loading && !rows.length ? <p className={styles.notice} role="status">Loading instructors...</p> : null}
        {!loading && !visibleRows.length ? (
          <div className={styles.emptyFilterState}>
            <span role="status">{rows.length ? "No instructors match these filters." : "No instructor memberships yet."}</span>
            {rows.length ? <button className={`${styles.secondaryButton} ${styles.compactButton}`} type="button" onClick={() => { setSearch(""); setCityFilter("all"); }}>Clear filters</button> : null}
          </div>
        ) : null}
        {visibleRows.length ? <div className={`${styles.tableWrap} ${styles.membershipTableWrap}`} role="region" aria-label="Instructor memberships and guarantees" tabIndex={0}>
          <table className={`${styles.dataTable} ${styles.membershipTable}`}>
            <caption className={styles.srOnly}>Instructor memberships and guarantees grouped by city</caption>
            <thead>
              <tr><th scope="col">Instructor</th><th scope="col">Profile</th><th scope="col">Membership</th><th scope="col">Legacy founding</th><th scope="col">Guarantee</th><th scope="col">Bookings</th><th scope="col">Claim</th><th scope="col">Refunds</th></tr>
            </thead>
            {membershipGroups.map((group) => (
              <tbody key={group.city}>
                <tr className={styles.cityGroupRow}><th colSpan={8} scope="rowgroup">{group.city}<span>{group.instructors.length} {group.instructors.length === 1 ? "instructor" : "instructors"}</span></th></tr>
                {group.instructors.map((row) => (
                  <tr className={selectedProfileId === row.instructor_profile_id ? styles.selectedTableRow : ""} key={row.instructor_profile_id}>
                    <td>
                      <button
                        className={styles.tableSelectButton}
                        type="button"
                        aria-current={selectedProfileId === row.instructor_profile_id ? "true" : undefined}
                        aria-label={`View membership details for ${row.display_name}`}
                        onClick={() => setSelectedProfileId(row.instructor_profile_id)}
                      >{row.display_name}</button>
                      {row.business_name ? <small>{row.business_name}</small> : null}
                      <small>{row.account_email || row.inquiry_email || "No email"}</small>
                    </td>
                    <td><span className={styles.status}>{statusLabel(row.profile_status)}</span></td>
                    <td><span className={styles.status}>{statusLabel(row.subscription_status)}</span></td>
                    <td>{row.founding_member_number ? `#${row.founding_member_number} ` : ""}{statusLabel(row.founding_status)}</td>
                    <td>{statusLabel(row.guarantee_status)}<small>{row.guarantee_terms_version === currentGuaranteeTermsVersion ? `Current ${guaranteeCoverage} terms` : row.guarantee_terms_version ? "Legacy terms" : "Not started"}</small></td>
                    <td>{row.qualifying_booking_count}</td>
                    <td>{row.claim_status ? statusLabel(row.claim_status) : "None"}</td>
                    <td>{row.refunded ? <span className={styles.verifiedBadge}>Verified</span> : money(row.verified_refund_cents)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div> : null}
      </section>

      {selected ? (
        <div className={styles.membershipDetail}>
          <div className={`${styles.card} ${styles.compactAdminCard}`}>
            <div className={styles.membershipHeader}>
              <div>
                <h2>{selected.display_name}</h2>
                <p className={styles.muted}>{[selected.business_name, selected.city, selected.region].filter(Boolean).join(" · ")}</p>
              </div>
              {isOwner && selected.stripe_customer_id ? (
                <a className={`${styles.secondaryButton} ${styles.compactButton}`} href={stripeCustomerUrl(selected.stripe_customer_id, selected.stripe_livemode)} target="_blank" rel="noreferrer">Open Stripe customer</a>
              ) : isOwner ? <span className={styles.muted}>No Stripe customer</span> : null}
            </div>
            <div className={styles.membershipSummary}>
              <div><span>Profile</span><strong>{statusLabel(selected.profile_status)}</strong></div>
              <div><span>Membership</span><strong>{statusLabel(selected.subscription_status)}</strong></div>
              <div><span>Legacy founding</span><strong>{selected.founding_member_number ? `#${selected.founding_member_number}, ${statusLabel(selected.founding_status)}` : statusLabel(selected.founding_status)}</strong></div>
              <div><span>Guarantee</span><strong>{statusLabel(selected.guarantee_status)}</strong></div>
              <div><span>Terms</span><strong>{selected.guarantee_terms_version === currentGuaranteeTermsVersion ? `Current ${guaranteeCoverage}` : selected.guarantee_terms_version ? "Legacy" : "Not started"}</strong></div>
              <div><span>Bookings</span><strong>{selected.qualifying_booking_count}</strong></div>
              <div><span>Verified refunds</span><strong>{money(selected.verified_refund_cents)}</strong></div>
            </div>
            <dl className={styles.membershipFacts}>
              <div><dt>Account email</dt><dd>{selected.account_email || "Not set"}</dd></div>
              <div><dt>Inquiry email</dt><dd>{selected.inquiry_email || "Not set"}</dd></div>
              <div><dt>Guarantee period</dt><dd>{adminDate(selected.guarantee_started_at)} to {adminDate(selected.guarantee_ends_at)}</dd></div>
              <div><dt>Claim deadline</dt><dd>{adminDate(selected.claim_deadline_at)}</dd></div>
              <div><dt>Maximum eligible refund</dt><dd>{selected.guarantee_terms_version === currentGuaranteeTermsVersion ? money(selected.eligible_paid_amount_cents ?? 0) : "Legacy terms apply"}</dd></div>
            </dl>
            {selected.refunded ? (
              <p className={styles.verifiedRefund} role="status">
                <span aria-hidden="true">✓</span>
                <span><strong>Refund verified against Stripe</strong><small>{money(selected.verified_refund_cents)} verified on {adminDate(selected.latest_refunded_at)}</small></span>
              </p>
            ) : selected.verified_refund_cents > 0 ? (
              <p className={styles.notice}>Stripe has verified {money(selected.verified_refund_cents)} in partial refunds. Claim status: {statusLabel(selected.claim_status)}.</p>
            ) : null}
            {!isOwner ? <p className={styles.notice}>Finance records are read-only for delegated administrators. Only the marketplace owner can change guarantees or verify refunds.</p> : null}
          </div>

          {isOwner ? (
            <>
              <form className={`${styles.card} ${styles.stack} ${styles.compactAdminCard}`} onSubmit={saveGuarantee}>
                <div><h3>Legacy founding and guarantee status</h3><p className={styles.muted}>Previously granted founding numbers stay attached to the original instructor record. No new founding positions are assigned.</p></div>
                <div className={styles.grid}>
                  <label className={styles.field}>
                    <span>Legacy founding status</span>
                    <select disabled={selected.refunded || selected.verified_refund_cents > 0} value={foundingStatus} onChange={(event) => setFoundingStatus(event.target.value)}>
                      <option value="unassigned">Unassigned</option>
                      <option value="reserved">Reserved</option>
                      <option value="active">Active</option>
                      <option value="ended">Ended</option>
                      <option value="not_available">Not available</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Guarantee status</span>
                    <select disabled={selected.refunded || selected.verified_refund_cents > 0} value={guaranteeStatus} onChange={(event) => setGuaranteeStatus(event.target.value)}>
                      {[
                        "not_started", "covered", "claim_eligible", "fulfilled", "ineligible", "claim_received",
                        "under_review", "approved", "denied", "expired"
                      ].map((value) => <option value={value} key={value}>{statusLabel(value)}</option>)}
                      <option disabled value="refunded">refunded (Stripe verified)</option>
                    </select>
                  </label>
                </div>
                <label className={styles.field}><span>Internal guarantee note</span><textarea disabled={selected.refunded || selected.verified_refund_cents > 0} maxLength={4000} value={guaranteeNote} onChange={(event) => setGuaranteeNote(event.target.value)} /></label>
                <button className={styles.secondaryButton} disabled={busy !== null || selected.refunded || selected.verified_refund_cents > 0} type="submit">{busy === "guarantee" ? "Saving..." : "Save guarantee status"}</button>
              </form>

              <form className={`${styles.card} ${styles.stack} ${styles.compactAdminCard}`} onSubmit={logClaim}>
                <div><h3>Log a refund claim</h3><p className={styles.muted}>Use this after an instructor contacts you. This creates the review record and does not issue a refund.</p></div>
                <div className={styles.grid}>
                  <label className={styles.field}>
                    <span>Received through</span>
                    <select value={claimSource} onChange={(event) => setClaimSource(event.target.value)}>
                      <option value="email">Email</option><option value="phone">Phone</option><option value="admin">Admin entry</option><option value="other">Other</option>
                    </select>
                  </label>
                  <label className={styles.field}><span>Claimant email</span><input type="email" value={claimantEmail} onChange={(event) => setClaimantEmail(event.target.value)} /></label>
                  <label className={styles.field}><span>Requested refund, dollars</span><input type="number" min="0.01" step="0.01" value={requestedAmount} onChange={(event) => setRequestedAmount(event.target.value)} /></label>
                </div>
                <label className={styles.field}><span>Instructor message</span><textarea maxLength={4000} value={instructorMessage} onChange={(event) => setInstructorMessage(event.target.value)} /></label>
                <label className={styles.field}><span>Internal claim note</span><textarea maxLength={4000} value={claimNote} onChange={(event) => setClaimNote(event.target.value)} /></label>
                <button className={styles.secondaryButton} disabled={busy !== null || selected.refunded || selected.verified_refund_cents > 0} type="submit">{busy === "claim" ? "Logging..." : selected.claim_id ? "Update claim intake" : "Log claim"}</button>
              </form>

              {selected.claim_id ? (
                <form className={`${styles.card} ${styles.stack} ${styles.compactAdminCard}`} onSubmit={reviewClaim}>
                  <div className={styles.membershipHeader}>
                    <div><h3>Review guarantee claim</h3><p className={styles.muted}>Claim received {adminDate(selected.claim_received_at)}. Current status: {statusLabel(selected.claim_status)}.</p></div>
                    <span className={styles.status}>{statusLabel(selected.claim_status)}</span>
                  </div>
                  <div className={styles.grid}>
                    <label className={styles.field}>
                      <span>Review decision</span>
                      <select disabled={selected.refunded || selected.verified_refund_cents > 0} value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}>
                        <option value="in_review">In review</option><option value="approved">Approved</option><option value="refund_pending">Refund pending</option><option value="denied">Denied</option><option value="withdrawn">Withdrawn</option>
                      </select>
                    </label>
                    <label className={styles.field}><span>Approved refund, dollars</span><input disabled={selected.refunded || selected.verified_refund_cents > 0} type="number" min="0.01" step="0.01" value={approvedAmount} onChange={(event) => setApprovedAmount(event.target.value)} /></label>
                  </div>
                  <div className={styles.requirementChecklist}>
                    <label className={styles.check}><input disabled={selected.refunded || selected.verified_refund_cents > 0} type="checkbox" checked={profileConfirmed} onChange={(event) => setProfileConfirmed(event.target.checked)} /><span>Profile completeness requirement confirmed</span></label>
                    <label className={styles.check}><input disabled={selected.refunded || selected.verified_refund_cents > 0} type="checkbox" checked={contactConfirmed} onChange={(event) => setContactConfirmed(event.target.checked)} /><span>Contact details were current during the guarantee period</span></label>
                    <label className={styles.check}><input disabled={selected.refunded || selected.verified_refund_cents > 0} type="checkbox" checked={responseConfirmed} onChange={(event) => setResponseConfirmed(event.target.checked)} /><span>Instructor response requirement confirmed</span></label>
                  </div>
                  <label className={styles.field}><span>Internal review note</span><textarea disabled={selected.refunded || selected.verified_refund_cents > 0} maxLength={4000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label>
                  <label className={styles.field}><span>Decision reason</span><textarea disabled={selected.refunded || selected.verified_refund_cents > 0} maxLength={2000} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} /></label>
                  <button className={styles.secondaryButton} disabled={busy !== null || selected.refunded || selected.verified_refund_cents > 0} type="submit">{busy === "review" ? "Saving..." : "Save claim review"}</button>
                </form>
              ) : null}

              {selected.claim_id && ["approved", "refund_pending", "partially_refunded", "refunded"].includes(selected.claim_status ?? "") ? (
                <form className={`${styles.card} ${styles.stack} ${styles.compactAdminCard} ${styles.refundVerificationCard}`} onSubmit={verifyRefund}>
                  <div><p className={styles.eyebrow}>Final verification</p><h3>Record a refund issued in Stripe</h3></div>
                  <p>This action never sends money or cancels a subscription. First issue the refund from the Stripe Dashboard, cancel the subscription there if the instructor wants to stop future charges, then paste the Stripe refund ID here. The server checks the customer, membership invoice, price, amount, and refund status before recording it.</p>
                  {selected.stripe_customer_id ? <a className={styles.secondaryButton} href={stripeCustomerUrl(selected.stripe_customer_id, selected.stripe_livemode)} target="_blank" rel="noreferrer">Open customer in Stripe</a> : null}
                  <label className={styles.check}><input disabled={selected.refunded} type="checkbox" checked={refundIssuedConfirmed} onChange={(event) => setRefundIssuedConfirmed(event.target.checked)} /><span>I already issued this refund in Stripe.</span></label>
                  <label className={styles.field}><span>Stripe refund ID</span><input disabled={selected.refunded} required placeholder="re_..." value={refundId} onChange={(event) => setRefundId(event.target.value)} /></label>
                  <button className={styles.button} disabled={busy !== null || selected.refunded || !refundIssuedConfirmed} type="submit">{busy === "refund" ? "Verifying with Stripe..." : "Verify and record refund"}</button>
                </form>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AdminDashboard({ isOwner }: { isOwner: boolean }) {
  const [tab, setTab] = useState<"overview" | "profiles" | "memberships" | "invitations" | "delivery" | "access">("overview");
  const [focusedProfileId, setFocusedProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<InstructorProfile[]>([]);
  const [inquiries, setInquiries] = useState<MarketplaceInquiry[]>([]);
  const [jobs, setJobs] = useState<AdminNotificationJob[]>([]);
  const [serviceJobs, setServiceJobs] = useState<AdminInstructorServiceNotificationJob[]>([]);
  const [media, setMedia] = useState<ProfileMedia[]>([]);
  const [admins, setAdmins] = useState<AdminAccess[]>([]);
  const [lifetimeAccess, setLifetimeAccess] = useState<AdminInstructorLifetimeAccess[]>([]);
  const [paymentSetups, setPaymentSetups] = useState<AdminInstructorPaymentSetup[]>([]);
  const [offerEntitlements, setOfferEntitlements] = useState<AdminInstructorOfferEntitlement[]>([]);
  const [activationMemberships, setActivationMemberships] = useState<AdminInstructorActivationMembership[]>([]);
  const [invitations, setInvitations] = useState<AdminInstructorInvitation[]>([]);
  const [followupResponses, setFollowupResponses] = useState<AdminFollowupResponse[]>([]);
  const [analytics, setAnalytics] = useState<AdminAnalytics>(emptyAdminAnalytics);
  const [slugs, setSlugs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [profileApprovalStates, setProfileApprovalStates] = useState<Record<string, ProfileApprovalViewState>>({});
  const [profileApprovalReadiness, setProfileApprovalReadiness] = useState<Record<string, ApprovalReadinessViewState>>({});
  const [rangePreset, setRangePreset] = useState<AdminRangePreset>("30d");
  const [customStart, setCustomStart] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 29);
    return dateInputValue(date);
  });
  const [customEnd, setCustomEnd] = useState(() => dateInputValue(new Date()));
  const [grantEmail, setGrantEmail] = useState("");
  const [invitationEmail, setInvitationEmail] = useState("");
  const [invitationGrantsLifetime, setInvitationGrantsLifetime] = useState(false);
  const invitationRequestKey = useRef<string | null>(null);
  const invitationDeliveryToken = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function suggestedSlug(profile: InstructorProfile) {
    return [profile.display_name, profile.city, profile.region]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async function loadApprovalReadiness(profileIds: string[]) {
    const client = getMarketplaceClient();
    if (!client || !profileIds.length) return;
    setProfileApprovalReadiness((current) => ({
      ...current,
      ...Object.fromEntries(profileIds.map((profileId) => [profileId, { phase: "checking" } as const]))
    }));
    await Promise.all(profileIds.map(async (profileId) => {
      try {
        const { data, error: readinessError } = await client.functions.invoke("review-instructor-profile", {
          body: { action: "readiness", instructorProfileId: profileId }
        });
        if (readinessError) {
          const failure = await edgeFunctionFailure(readinessError);
          throw new Error(failure.message);
        }
        const receipt = parseInstructorApprovalReadiness(data);
        if (receipt.instructorProfileId !== profileId) {
          throw new Error("Approval readiness was returned for a different instructor.");
        }
        setProfileApprovalReadiness((current) => ({
          ...current,
          [profileId]: receipt.ready
            ? { phase: "ready", receipt }
            : { phase: "blocked", receipt }
        }));
      } catch (readinessError) {
        setProfileApprovalReadiness((current) => ({
          ...current,
          [profileId]: {
            phase: "error",
            message: `Approval systems could not be verified. ${readableError(readinessError)}`
          }
        }));
      }
    }));
  }

  async function loadOperations(silent = false) {
    const client = getMarketplaceClient();
    if (!client) return;
    if (!silent) setLoading(true);
    setError(null);
    const [profileResult, inquiryResult, jobResult, serviceJobResult, mediaResult, adminResult, feedbackResult, lifetimeResult, paymentSetupResult, entitlementResult, membershipResult, invitationResult] = await Promise.all([
      client.from("instructor_profiles").select("*").order("updated_at", { ascending: false }),
      client.from("inquiries").select("*").order("created_at", { ascending: false }).limit(100),
      client.from("inquiry_notification_jobs").select("id,channel,notification_type,status,attempts,last_error,created_at").order("created_at", { ascending: false }).limit(100),
      client.from("instructor_service_notification_jobs").select("id,instructor_profile_id,notification_type,status,attempts,last_error,created_at,sent_at").order("created_at", { ascending: false }).limit(100),
      client.from("profile_media").select("*").order("sort_order"),
      client.rpc("list_marketplace_admins"),
      client.from("inquiry_followup_responses").select("id,inquiry_id,stage,response,confirmed_event_date,private_comment,submitted_at").order("submitted_at", { ascending: false }).limit(100),
      client.rpc("admin_list_instructor_lifetime_access"),
      client.from("instructor_private_settings").select("instructor_profile_id,inquiry_email,minimum_rate_cents,minimum_hours,payment_methods,subscription_status,payment_setup_completed_at,stripe_customer_id,stripe_payment_setup_checkout_session_id,stripe_subscription_id"),
      client.from("instructor_offer_entitlements").select("instructor_profile_id,redeemed_at"),
      client.from("instructor_memberships").select("instructor_profile_id,stripe_customer_id,stripe_subscription_id,latest_checkout_session_id,status"),
      client.rpc("admin_list_instructor_invitations")
    ]);
    const loadError = profileResult.error ?? inquiryResult.error ?? jobResult.error ?? serviceJobResult.error ?? mediaResult.error ?? adminResult.error ?? feedbackResult.error ?? lifetimeResult.error ?? paymentSetupResult.error ?? entitlementResult.error ?? membershipResult.error ?? invitationResult.error;
    if (loadError) setError(loadError.message);
    const loadedProfiles = (profileResult.data as InstructorProfile[] | null) ?? [];
    setProfiles(loadedProfiles);
    setInquiries((inquiryResult.data as MarketplaceInquiry[] | null) ?? []);
    setJobs((jobResult.data as AdminNotificationJob[] | null) ?? []);
    setServiceJobs((serviceJobResult.data as AdminInstructorServiceNotificationJob[] | null) ?? []);
    setMedia((mediaResult.data as ProfileMedia[] | null) ?? []);
    setAdmins((adminResult.data as AdminAccess[] | null) ?? []);
    setFollowupResponses((feedbackResult.data as AdminFollowupResponse[] | null) ?? []);
    setLifetimeAccess((lifetimeResult.data as AdminInstructorLifetimeAccess[] | null) ?? []);
    setPaymentSetups((paymentSetupResult.data as AdminInstructorPaymentSetup[] | null) ?? []);
    setOfferEntitlements((entitlementResult.data as AdminInstructorOfferEntitlement[] | null) ?? []);
    setActivationMemberships((membershipResult.data as AdminInstructorActivationMembership[] | null) ?? []);
    setInvitations((invitationResult.data as AdminInstructorInvitation[] | null) ?? []);
    setSlugs((current) => Object.fromEntries(loadedProfiles.map((profile) => [profile.id, current[profile.id] ?? profile.slug ?? suggestedSlug(profile)])));
    void loadApprovalReadiness(loadedProfiles.filter((profile) => profile.status === "pending_review").map((profile) => profile.id));
    if (!silent) setLoading(false);
  }

  async function loadAnalytics() {
    const client = getMarketplaceClient();
    if (!client) return;
    setAnalyticsLoading(true);
    setError(null);
    const range = adminRange(rangePreset, customStart, customEnd);
    const { data, error: analyticsError } = await client.rpc("get_marketplace_admin_analytics", {
      p_start: range.start,
      p_end: range.end,
      p_bucket: range.bucket,
      p_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
    });
    if (analyticsError) setError(analyticsError.message);
    else setAnalytics((data as AdminAnalytics | null) ?? emptyAdminAnalytics);
    setAnalyticsLoading(false);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    if (["overview", "profiles", "memberships", "invitations", "delivery", "access"].includes(requestedTab ?? "")) {
      setTab(requestedTab as typeof tab);
    }
    setFocusedProfileId(params.get("profile"));
    void loadOperations();
  }, []);

  useEffect(() => {
    if (loading || tab !== "profiles" || !focusedProfileId) return;
    window.requestAnimationFrame(() => {
      document.getElementById(`profile-review-${focusedProfileId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  }, [focusedProfileId, loading, tab]);

  useEffect(() => {
    if (rangePreset === "custom" && (!customStart || !customEnd || customStart > customEnd)) return;
    void loadAnalytics();
  }, [rangePreset, customStart, customEnd]);

  async function review(profileId: string, decision: "approve" | "return_to_draft" | "suspend") {
    const client = getMarketplaceClient();
    if (!client) return;
    const targetProfile = profiles.find((profile) => profile.id === profileId);
    const targetHasLifetimeAccess = lifetimeAccess.some((access) =>
      access.instructor_profile_id === profileId && access.has_lifetime_access
    );
    const targetPaymentSetup = paymentSetups.find((setup) => setup.instructor_profile_id === profileId);
    const targetUnredeemedEntitlement = offerEntitlements.some((entitlement) =>
      entitlement.instructor_profile_id === profileId && !entitlement.redeemed_at
    );
    const targetActivationIsSynced = activationMemberships.some((membership) =>
      membership.instructor_profile_id === profileId
      && membership.stripe_customer_id === targetPaymentSetup?.stripe_customer_id
      && membership.stripe_subscription_id === targetPaymentSetup?.stripe_subscription_id
      && membership.latest_checkout_session_id === targetPaymentSetup?.stripe_payment_setup_checkout_session_id
    );
    const retriesMembershipActivation = decision === "approve"
      && ["approved", "published"].includes(targetProfile?.status ?? "")
      && Boolean(targetPaymentSetup?.payment_setup_completed_at)
      && (!targetActivationIsSynced || targetUnredeemedEntitlement)
      && !targetHasLifetimeAccess;
    const usesVerifiedApproval = decision === "approve"
      && (targetProfile?.status === "pending_review" || retriesMembershipActivation);
    if (usesVerifiedApproval && targetProfile?.status === "pending_review" && profileApprovalReadiness[profileId]?.phase !== "ready") {
      setProfileApprovalStates((current) => ({
        ...current,
        [profileId]: {
          phase: "error",
          message: "Approval systems must be verified before this instructor can be approved. Check the readiness status below."
        }
      }));
      return;
    }
    setBusyId(profileId);
    setError(null);
    setMessage(null);
    if (usesVerifiedApproval) {
      setProfileApprovalStates((current) => ({
        ...current,
        [profileId]: { phase: "approving" }
      }));
    }
    let reviewError: string | null = null;
    let approvalData: unknown = null;
    try {
      if (usesVerifiedApproval) {
        const { data, error: approvalError } = await client.functions.invoke("review-instructor-profile", {
          body: {
            instructorProfileId: profileId,
            decision,
            slug: slugs[profileId] || null,
            note: notes[profileId] || null
          }
        });
        approvalData = data;
        if (approvalError) {
          const failure = await edgeFunctionFailure(approvalError);
          reviewError = approvalFailureCopy(failure.message, failure.code);
        }
      } else {
        const { error: decisionError } = await client.rpc("review_instructor_profile", {
          p_instructor_profile_id: profileId,
          p_decision: decision,
          p_slug: slugs[profileId] || null,
          p_note: notes[profileId] || null
        });
        if (decisionError) reviewError = decisionError.message;
      }
    } catch (unexpectedError) {
      reviewError = readableError(unexpectedError);
    } finally {
      setBusyId(null);
    }
    if (reviewError) {
      if (usesVerifiedApproval) {
        setProfileApprovalStates((current) => ({
          ...current,
          [profileId]: { phase: "error", message: reviewError }
        }));
      } else {
        setError(reviewError);
      }
      await loadOperations(true);
      return;
    }

    if (usesVerifiedApproval) {
      try {
        const receipt = parseInstructorApprovalReceipt(approvalData, slugs[profileId] || "");
        setProfileApprovalStates((current) => ({
          ...current,
          [profileId]: { phase: "approved", receipt }
        }));
      } catch (receiptError) {
        setProfileApprovalStates((current) => ({
          ...current,
          [profileId]: { phase: "error", message: readableError(receiptError) }
        }));
      }
      await loadOperations(true);
      return;
    }

    setMessage(decision === "approve"
      ? "Instructor reactivated. An active membership or lifetime access publishes the profile automatically."
      : "Instructor profile updated.");
    await loadOperations();
  }

  async function grantAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client) return;
    setBusyId("grant-admin");
    setError(null);
    setMessage(null);
    const { error: grantError } = await client.rpc("grant_marketplace_admin", { p_email: grantEmail.trim() });
    setBusyId(null);
    if (grantError) setError(grantError.message);
    else {
      setGrantEmail("");
      setMessage("Admin access granted.");
      await loadOperations();
    }
  }

  async function revokeAdmin(accountId: string) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusyId(accountId);
    setError(null);
    setMessage(null);
    const { error: revokeError } = await client.rpc("revoke_marketplace_admin", { p_account_id: accountId });
    setBusyId(null);
    if (revokeError) setError(revokeError.message);
    else {
      setMessage("Admin access revoked.");
      await loadOperations();
    }
  }

  async function sendInstructorInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client) return;
    setBusyId("send-instructor-invitation");
    setError(null);
    setMessage(null);
    invitationRequestKey.current ??= crypto.randomUUID();
    invitationDeliveryToken.current ??= Array.from(
      crypto.getRandomValues(new Uint8Array(32)),
      (byte) => byte.toString(16).padStart(2, "0")
    ).join("");
    const { data, error: invitationError } = await client.functions.invoke("send-instructor-invitation", {
      body: {
        email: invitationEmail.trim(),
        grantsLifetimeAccess: invitationGrantsLifetime,
        requestKey: invitationRequestKey.current,
        invitationToken: invitationDeliveryToken.current
      },
      headers: { "Idempotency-Key": invitationRequestKey.current }
    });
    setBusyId(null);
    if (invitationError) {
      setError(await edgeFunctionError(invitationError));
      return;
    }
    if (!data?.invitationId) {
      setError("The invitation service did not confirm delivery.");
      return;
    }
    if (data.deliveryPending) {
      setMessage(`The invitation to ${data.email} is already being sent.`);
      await loadOperations();
      return;
    }
    setInvitationEmail("");
    setInvitationGrantsLifetime(false);
    invitationRequestKey.current = null;
    invitationDeliveryToken.current = null;
    setMessage(`Instructor invitation sent to ${data.email}.`);
    await loadOperations();
  }

  async function grantLifetimeAccess(profileId: string) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusyId(`lifetime:${profileId}`);
    setError(null);
    setMessage(null);
    const { error: grantError } = await client.rpc("admin_grant_instructor_lifetime_access", {
      p_instructor_profile_id: profileId,
      p_note: "Granted from the admin dashboard"
    });
    setBusyId(null);
    if (grantError) {
      setError(grantError.message);
      return;
    }
    setMessage("Lifetime instructor access granted.");
    await loadOperations();
  }

  function mediaUrl(item: ProfileMedia) {
    if (item.external_url) return item.external_url;
    const client = getMarketplaceClient();
    if (!client || !item.storage_path) return "";
    return client.storage.from("instructor-media").getPublicUrl(item.storage_path).data.publicUrl;
  }

  const pending = profiles.filter((profile) => profile.status === "pending_review");
  const reviewProfiles = profiles.filter((profile) =>
    profile.status === "pending_review" || Boolean(profileApprovalStates[profile.id])
  );
  const failedDeliveryCount = jobs.filter((job) => job.status === "failed").length
    + serviceJobs.filter((job) => job.status === "failed").length;

  function latestApprovalEmailJob(profileId: string) {
    return serviceJobs.find((job) =>
      job.instructor_profile_id === profileId && job.notification_type === "profile_approved"
    );
  }

  const summary = analytics.summary;

  function selectAdminTab(nextTab: typeof tab) {
    setTab(nextTab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    if (nextTab !== "profiles") url.searchParams.delete("profile");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label="Admin dashboard sections">
        {(isOwner
          ? (["overview", "profiles", "memberships", "invitations", "delivery", "access"] as const)
          : (["overview", "profiles", "memberships", "invitations", "delivery"] as const)
        ).map((name) => (
          <button key={name} className={`${styles.tab} ${tab === name ? styles.activeTab : ""}`} type="button" onClick={() => selectAdminTab(name)}>
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}
      {loading ? <div className={styles.loading}>Loading marketplace operations...</div> : null}

      {!loading && tab === "overview" ? (
        <div className={styles.compactAdminStack}>
          <div className={`${styles.card} ${styles.compactAdminCard} ${styles.filterBar} ${styles.adminOverviewHeader}`}>
            <div>
              <h2>Marketplace performance</h2>
              <p className={styles.muted}>Every submitted contact form counts as one inquiry. Booking activity uses the date it was reported, and completed gigs use the confirmed event date.</p>
            </div>
            <label className={styles.field}>
              <span>Time frame</span>
              <select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as AdminRangePreset)}>
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="12m">Last 12 months</option>
                <option value="all">All time</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {rangePreset === "custom" ? (
              <>
                <label className={styles.field}><span>Start</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
                <label className={styles.field}><span>End</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
              </>
            ) : null}
          </div>

          {analyticsLoading ? <div className={styles.loading}>Calculating marketplace results...</div> : (
            <>
              <div className={`${styles.metricGrid} ${styles.adminMetricGrid}`}>
                <article className={`${styles.metricCard} ${styles.adminMetricCard}`}><span>Inquiries</span><strong>{summary.inquiries}</strong></article>
                <article className={`${styles.metricCard} ${styles.adminMetricCard}`}><span>Instructors contacted</span><strong>{summary.instructors}</strong></article>
                <article className={`${styles.metricCard} ${styles.adminMetricCard}`}><span>Companies</span><strong>{summary.companies}</strong></article>
                <article className={`${styles.metricCard} ${styles.adminMetricCard}`}><span>Bookings reported</span><strong>{summary.booked}</strong><small>{percent(summary.cohort_booked, summary.inquiries)} conversion</small></article>
                <article className={`${styles.metricCard} ${styles.adminMetricCard}`}><span>Completed gigs</span><strong>{summary.completed}</strong><small>{percent(summary.cohort_completed, summary.cohort_booked)} completion</small></article>
                <article className={`${styles.metricCard} ${styles.adminMetricCard}`}><span>In progress</span><strong>{summary.in_progress}</strong></article>
              </div>

              <div className={`${styles.card} ${styles.compactAdminCard}`}>
                <h2>Activity over time</h2>
                {!analytics.series.length ? <p className={styles.notice}>No inquiry activity in this time frame.</p> : (
                  <div className={`${styles.tableWrap} ${styles.compactTableWrap}`}>
                    <table className={`${styles.dataTable} ${styles.compactDataTable}`}>
                      <thead><tr><th>Period</th><th>Inquiries</th><th>Booked</th><th>Completed</th></tr></thead>
                      <tbody>{analytics.series.map((row) => (
                        <tr key={row.period_start}><td>{new Date(`${row.period_start}T12:00:00`).toLocaleDateString()}</td><td>{row.inquiries}</td><td>{row.booked}</td><td>{row.completed}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className={`${styles.card} ${styles.compactAdminCard}`}>
                <h2>Performance by instructor</h2>
                <p className={styles.muted}>Booking and completion columns show the current results for inquiries submitted during this time frame.</p>
                <div className={`${styles.tableWrap} ${styles.compactTableWrap}`}>
                  <table className={`${styles.dataTable} ${styles.compactDataTable}`}>
                    <thead><tr><th>Instructor</th><th>Inquiries</th><th>Companies</th><th>Booked</th><th>Completed</th><th>Booking rate</th></tr></thead>
                    <tbody>{analytics.instructors.map((row) => (
                      <tr key={row.instructor_key}><td>{row.instructor_name}</td><td>{row.inquiries}</td><td>{row.companies}</td><td>{row.booked}</td><td>{row.completed}</td><td>{percent(row.booked, row.inquiries)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>

              <div className={`${styles.card} ${styles.compactAdminCard}`}>
                <h2>Inquiries by instructor and company</h2>
                <p className={styles.muted}>Use this view to see how many times each company or organizer contacted a specific instructor.</p>
                <div className={`${styles.tableWrap} ${styles.compactTableWrap}`}>
                  <table className={`${styles.dataTable} ${styles.compactDataTable}`}>
                    <thead><tr><th>Instructor</th><th>Company</th><th>Inquiries</th><th>Booked</th><th>Completed</th><th>Latest inquiry</th></tr></thead>
                    <tbody>{analytics.instructor_companies.map((row) => (
                      <tr key={`${row.instructor_key}:${row.company_key}`}>
                        <td>{row.instructor_name}</td>
                        <td>{row.company_name}{row.contact_email ? <small>{row.contact_email}</small> : null}</td>
                        <td>{row.inquiries}</td><td>{row.booked}</td><td>{row.completed}</td>
                        <td>{new Date(row.latest_inquiry_at).toLocaleDateString()}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>

              <div className={`${styles.card} ${styles.compactAdminCard}`}>
                <h2>Performance by company or organizer</h2>
                <div className={`${styles.tableWrap} ${styles.compactTableWrap}`}>
                  <table className={`${styles.dataTable} ${styles.compactDataTable}`}>
                    <thead><tr><th>Company</th><th>Inquiries</th><th>Instructors</th><th>Booked</th><th>Completed</th><th>Latest inquiry</th></tr></thead>
                    <tbody>{analytics.companies.map((row) => (
                      <tr key={row.company_key}><td>{row.company_name}{row.contact_email ? <small>{row.contact_email}</small> : null}</td><td>{row.inquiries}</td><td>{row.instructors}</td><td>{row.booked}</td><td>{row.completed}</td><td>{new Date(row.latest_inquiry_at).toLocaleDateString()}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <div className={`${styles.card} ${styles.compactAdminCard}`}>
            <h2>Recent inquiries</h2>
            <div className={`${styles.tableWrap} ${styles.compactTableWrap}`}>
              <table className={`${styles.dataTable} ${styles.compactDataTable}`}>
                <thead><tr><th>Submitted</th><th>Company</th><th>Instructor</th><th>Event</th><th>Booking</th><th>Completion</th></tr></thead>
                <tbody>{inquiries.slice(0, 30).map((inquiry) => (
                  <tr key={inquiry.id}>
                    <td>{new Date(inquiry.created_at).toLocaleDateString()}</td>
                    <td>{inquiry.company_name || inquiry.contact_name || "Individual organizer"}</td>
                    <td>{inquiry.instructor_name || "Instructor"}</td>
                    <td>{[inquiry.event_type, inquiry.event_date].filter(Boolean).join(" · ")}</td>
                    <td><span className={styles.status}>{inquiry.booking_outcome.replaceAll("_", " ")}</span></td>
                    <td><span className={styles.status}>{inquiry.completion_status.replaceAll("_", " ")}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          <div className={`${styles.card} ${styles.compactAdminCard}`}>
            <h2>Recent instructor feedback</h2>
            {!followupResponses.length ? <p className={styles.notice}>No instructor follow-up responses yet.</p> : (
              <div className={styles.list}>{followupResponses.slice(0, 20).map((response) => {
                const inquiry = inquiries.find((item) => item.id === response.inquiry_id);
                return (
                  <article className={styles.listItem} key={response.id}>
                    <div className={styles.buttonRow}><strong>{inquiry?.instructor_name || "Instructor"}</strong><span className={styles.status}>{response.stage}: {response.response.replaceAll("_", " ")}</span></div>
                    <p>{[inquiry?.company_name || inquiry?.contact_name, response.confirmed_event_date].filter(Boolean).join(" · ")}</p>
                    {response.private_comment ? <p>{response.private_comment}</p> : <p>No additional comment.</p>}
                  </article>
                );
              })}</div>
            )}
          </div>
        </div>
      ) : null}

      {!loading && tab === "profiles" ? (
        <div className={styles.compactAdminStack}>
          <section className={`${styles.card} ${styles.compactAdminCard} ${styles.profileReviewIntro}`}>
            <div className={styles.compactSectionHeader}>
              <div>
                <h2>Profiles awaiting review</h2>
                <p className={styles.muted}>Review the public preview, every submitted field, and all media before making a decision.</p>
              </div>
              <span className={styles.recordCount}>{pending.length} waiting</span>
            </div>
            {!pending.length ? <p className={styles.notice}>No profiles are waiting for review.</p> : null}
          </section>

          <div className={styles.profileReviewList}>
              {reviewProfiles.map((profile) => {
                const profileMedia = media.filter((item) => item.instructor_profile_id === profile.id);
                const readyMedia = profileMedia.filter((item) => item.status === "ready");
                const headshot = readyMedia.find((item) => item.media_type === "headshot");
                const galleryMedia = readyMedia.filter((item) => item.media_type !== "headshot");
                const privateSettings = paymentSetups.find((item) => item.instructor_profile_id === profile.id);
                const approvalState = profileApprovalStates[profile.id];
                const readinessState = profileApprovalReadiness[profile.id];
                const readinessReceipt = readinessState?.phase === "ready" || readinessState?.phase === "blocked"
                  ? readinessState.receipt
                  : null;
                const approvalJob = latestApprovalEmailJob(profile.id);
                const approvalEmailStatus = approvalState?.phase === "approved"
                  ? normalizeApprovalEmailStatus(approvalJob?.status ?? approvalState.receipt.emailStatus)
                  : null;
                const firstName = profile.display_name.trim().split(/\s+/)[0] || profile.display_name;
                const location = [profile.city, profile.region].filter(Boolean).join(", ") || "Location not provided";
                const eventLabels = profile.event_types.map((value) => eventTypes.find((item) => item.slug === value)?.label ?? statusLabel(value));
                return (
                  <article
                    className={`${styles.card} ${styles.compactAdminCard} ${styles.profileReviewCard} ${focusedProfileId === profile.id ? styles.focusedItem : ""}`}
                    id={`profile-review-${profile.id}`}
                    key={profile.id}
                  >
                    <header className={styles.profileReviewHeader}>
                      <div>
                        <div className={styles.buttonRow}><h3>{profile.display_name}</h3><span className={styles.status}>{statusLabel(profile.status)}</span></div>
                        <p className={styles.muted}>{[profile.business_name, location].filter(Boolean).join(" · ")}</p>
                      </div>
                      {approvalState?.phase === "approved" ? (
                        <span className={styles.approvedBadge}><CheckCircle2 size={15} aria-hidden="true" />Approved and live</span>
                      ) : <span className={styles.recordCount}>Submitted profile</span>}
                    </header>

                    <section className={styles.productionPreview} aria-label={`Public profile preview for ${profile.display_name}`}>
                      <div className={styles.productionPreviewHero}>
                        <div className={styles.reviewHeadshot}>
                          {headshot ? (
                            // Uploaded user content has a runtime URL that Next Image cannot optimize during static export.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={mediaUrl(headshot)} alt={headshot.alt_text || `${profile.display_name}, line dance instructor`} />
                          ) : <span>No headshot</span>}
                        </div>
                        <div>
                          <p className={styles.previewLabel}>Public profile preview</p>
                          <h4>{profile.display_name}</h4>
                          <p className={profile.headline ? styles.previewHeadline : styles.missingPreviewCopy}>{profile.headline || "No headline provided"}</p>
                          <div className={styles.previewFacts}>
                            <span>{location}</span>
                            <span>{profile.max_group_size ? `Groups up to ${profile.max_group_size}` : "Group size not provided"}</span>
                            <span>{profile.years_teaching !== null ? `${profile.years_teaching} years teaching` : "Teaching experience not provided"}</span>
                          </div>
                          <span className={styles.previewContactButton}>Contact {firstName}</span>
                        </div>
                      </div>

                      <div className={styles.productionPreviewBody}>
                        <section>
                          <p className={styles.previewLabel}>About the instructor</p>
                          <h4>Meet {profile.display_name}</h4>
                          <p className={profile.bio ? undefined : styles.missingPreviewCopy}>{profile.bio || "No bio provided"}</p>
                        </section>
                        <section>
                          <p className={styles.previewLabel}>Services and fit</p>
                          <h4>What {profile.display_name} offers</h4>
                          <div className={styles.previewServiceGrid}>
                            <div><strong>Events and programs</strong><p>{eventLabels.length ? eventLabels.join(", ") : "None selected"}</p></div>
                            <div><strong>Dance styles</strong><p>{profile.styles.length ? profile.styles.join(", ") : "None selected"}</p></div>
                            <div><strong>Age groups</strong><p>{profile.age_groups.length ? profile.age_groups.map(statusLabel).join(", ") : "None selected"}</p></div>
                            <div><strong>Languages</strong><p>{profile.languages.length ? profile.languages.join(", ") : "None selected"}</p></div>
                          </div>
                        </section>
                        <aside className={styles.previewBookingPanel}>
                          <p className={styles.previewLabel}>Booking details</p>
                          <h4>Plan your line dance experience</h4>
                          <p>Preferred response window: about {profile.preferred_response_hours} hours</p>
                          <p>Speakers: {profile.provides_speakers ? "Instructor can provide" : "Confirm with instructor"}</p>
                          <p>Microphone: {profile.provides_microphone ? "Instructor can provide" : "Confirm with instructor"}</p>
                          <p>Music playback: {profile.provides_music_playback ? "Instructor can provide" : "Confirm with instructor"}</p>
                        </aside>
                      </div>

                      {galleryMedia.length ? (
                        <div className={styles.reviewMediaGrid}>{galleryMedia.map((item) => (
                          <figure className={styles.reviewMediaItem} key={item.id}>
                            {item.media_type === "video" || item.media_type === "welcome_video" ? (
                              <video className={styles.mediaPreview} src={mediaUrl(item)} controls preload="metadata" />
                            ) : (
                              // Uploaded user content has a runtime URL that Next Image cannot optimize during static export.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className={styles.mediaPreview} src={mediaUrl(item)} alt={item.alt_text || item.caption || `${profile.display_name} teaching line dancing`} />
                            )}
                            <figcaption>{item.caption || statusLabel(item.media_type)}</figcaption>
                          </figure>
                        ))}</div>
                      ) : null}
                    </section>

                    <section className={styles.submittedFields} aria-labelledby={`submitted-fields-${profile.id}`}>
                      <div className={styles.compactSectionHeader}>
                        <div><h4 id={`submitted-fields-${profile.id}`}>Every submitted field</h4><p className={styles.muted}>Missing values are called out instead of being hidden.</p></div>
                      </div>
                      <dl className={styles.profileFieldGrid}>
                        <ProfileReviewField label="Public name" value={profile.display_name} />
                        <ProfileReviewField label="Business name" value={profile.business_name} />
                        <ProfileReviewField label="Headline" value={profile.headline} />
                        <ProfileReviewField label="Bio" value={profile.bio} />
                        <ProfileReviewField label="City or metro" value={profile.city} />
                        <ProfileReviewField label="State or region" value={profile.region} />
                        <ProfileReviewField label="ZIP code (private)" value={profile.postal_code} />
                        <ProfileReviewField label="Travel radius" value={profile.travel_radius_miles === null ? null : `${profile.travel_radius_miles} miles`} />
                        <ProfileReviewField label="Years teaching" value={profile.years_teaching} />
                        <ProfileReviewField label="Maximum group size" value={profile.max_group_size} />
                        <ProfileReviewField label="Dance styles" value={profileListValue(profile.styles)} />
                        <ProfileReviewField label="Events accepted" value={eventLabels.join(", ") || null} />
                        <ProfileReviewField label="Age groups" value={profileListValue(profile.age_groups)} />
                        <ProfileReviewField label="Languages" value={profileListValue(profile.languages)} />
                        <ProfileReviewField label="Favorite song" value={profile.favorite_song_name} />
                        <ProfileReviewField label="Spotify track" value={profile.favorite_song_spotify_url} />
                        <ProfileReviewField label="Provides speakers" value={profile.provides_speakers === null ? null : profile.provides_speakers ? "Yes" : "No"} />
                        <ProfileReviewField label="Provides microphone" value={profile.provides_microphone === null ? null : profile.provides_microphone ? "Yes" : "No"} />
                        <ProfileReviewField label="Provides music playback" value={profile.provides_music_playback === null ? null : profile.provides_music_playback ? "Yes" : "No"} />
                        <ProfileReviewField label="Liability insurance" value={statusLabel(profile.liability_insurance_status)} />
                        <ProfileReviewField label="Typical response time" value={`${profile.preferred_response_hours} hours`} />
                        <ProfileReviewField label="Inquiry email (private)" value={privateSettings?.inquiry_email} />
                        <ProfileReviewField label="Typical minimum rate (private)" value={privateSettings?.minimum_rate_cents == null ? null : money(privateSettings.minimum_rate_cents)} />
                        <ProfileReviewField label="Minimum booking (private)" value={privateSettings?.minimum_hours == null ? null : `${privateSettings.minimum_hours} hours`} />
                        <ProfileReviewField label="Payment setup" value={privateSettings?.payment_setup_completed_at ? "Complete" : "Not complete"} />
                        <ProfileReviewField label="Uploaded media" value={profileMedia.length ? `${profileMedia.length} file${profileMedia.length === 1 ? "" : "s"}` : null} />
                      </dl>
                    </section>

                    {approvalState?.phase === "approved" && approvalEmailStatus ? (
                      <div className={styles.approvalResult} role="status" aria-live="polite">
                        <CheckCircle2 className={styles.approvalResultIcon} size={26} aria-hidden="true" />
                        <div>
                          <strong>Approved and live</strong>
                          <p>{approvalState.receipt.lifetimeAccess ? "Lifetime access confirmed." : "Membership active."}</p>
                          <p className={approvalEmailNeedsAttention(approvalEmailStatus) ? styles.approvalEmailAttention : styles.approvalEmailStatus}>
                            {approvalEmailNeedsAttention(approvalEmailStatus)
                              ? <AlertCircle size={16} aria-hidden="true" />
                              : approvalEmailStatus === "sent" || approvalEmailStatus === "delivered"
                                ? <MailCheck size={16} aria-hidden="true" />
                                : <Mail size={16} aria-hidden="true" />}
                            {approvalEmailStatusCopy(approvalEmailStatus)}
                          </p>
                          <Link className={styles.approvalProfileLink} href={`/profile/?${new URLSearchParams({ instructor: approvalState.receipt.slug }).toString()}`}>View live profile</Link>
                        </div>
                      </div>
                    ) : (
                      <>
                        {!readinessState || readinessState.phase === "checking" ? (
                          <div className={styles.approvalReadiness} role="status" aria-live="polite">
                            <LoaderCircle className={styles.spinner} size={20} aria-hidden="true" />
                            <div><strong>Checking approval systems</strong><p>Verifying Stripe billing, the applicable offer, and approval email configuration.</p></div>
                          </div>
                        ) : readinessState.phase === "ready" ? (
                          <div className={styles.approvalReadiness} role="status" aria-live="polite">
                            <CheckCircle2 size={20} aria-hidden="true" />
                            <div>
                              <strong>Approval systems ready</strong>
                              <p>{readinessReceipt?.lifetimeAccess ? "Lifetime access" : `${(readinessReceipt!.terms.monthlyPriceCents / 100).toFixed(2)} ${readinessReceipt!.terms.currency.toUpperCase()} per month${readinessReceipt?.hasOffer ? `, ${readinessReceipt.terms.freeBillingCycles} free billing cycles` : ""}`}, {readinessReceipt?.terms.guaranteeCoverageDays}-day guarantee, approval email configured.</p>
                              <ul className={styles.approvalReadinessChecks}>{readinessReceipt?.checks.map((check) => <li key={check.key}><span>{check.label}</span>{check.detail}</li>)}</ul>
                            </div>
                          </div>
                        ) : readinessState.phase === "blocked" ? (
                          <div className={`${styles.approvalReadiness} ${styles.approvalReadinessBlocked}`} role="alert">
                            <AlertCircle size={20} aria-hidden="true" />
                            <div>
                              <strong>Approval is paused</strong>
                              <p>Nothing will change until every required system is ready.</p>
                              <ul className={styles.approvalReadinessChecks}>{readinessReceipt?.checks.map((check) => <li key={check.key}><span>{check.label}</span>{check.detail}</li>)}</ul>
                              <button className={`${styles.secondaryButton} ${styles.compactButton}`} disabled={busyId === profile.id} type="button" onClick={() => void loadApprovalReadiness([profile.id])}>Check again</button>
                            </div>
                          </div>
                        ) : (
                          <div className={`${styles.approvalReadiness} ${styles.approvalReadinessBlocked}`} role="alert">
                            <AlertCircle size={20} aria-hidden="true" />
                            <div><strong>Approval readiness could not be checked</strong><p>{readinessState.message}</p><button className={`${styles.secondaryButton} ${styles.compactButton}`} disabled={busyId === profile.id} type="button" onClick={() => void loadApprovalReadiness([profile.id])}>Check again</button></div>
                          </div>
                        )}
                        {!headshot ? <p className={styles.error}>A ready headshot is required before approval.</p> : null}
                        <div className={`${styles.grid} ${styles.reviewControls}`}>
                          <label className={styles.field}><span>Public profile slug</span><input value={slugs[profile.id] ?? ""} onChange={(event) => setSlugs((current) => ({ ...current, [profile.id]: event.target.value }))} /></label>
                          <label className={styles.field}><span>Review note</span><input value={notes[profile.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [profile.id]: event.target.value }))} /></label>
                        </div>
                        <div className={`${styles.buttonRow} ${styles.reviewActionBar}`}>
                          <button className={`${styles.button} ${styles.compactButton}`} disabled={busyId === profile.id || !headshot || readinessState?.phase !== "ready"} type="button" onClick={() => void review(profile.id, "approve")}>
                            {approvalState?.phase === "approving" ? (
                              <><LoaderCircle className={styles.spinner} size={17} aria-hidden="true" />Approving and starting membership...</>
                            ) : approvalState?.phase === "error" ? (
                              <><RotateCcw size={16} aria-hidden="true" />Try approval again</>
                            ) : (
                              <><CheckCircle2 size={16} aria-hidden="true" />Approve profile</>
                            )}
                          </button>
                          <button className={`${styles.dangerButton} ${styles.compactButton}`} disabled={busyId === profile.id} type="button" onClick={() => void review(profile.id, "return_to_draft")}>Request changes</button>
                        </div>
                        {approvalState?.phase === "approving" ? (
                          <div className={styles.approvalProgress} role="status" aria-live="polite">
                            <LoaderCircle className={styles.spinner} size={22} aria-hidden="true" />
                            <div><strong>Approving this instructor</strong><p>Verifying Stripe, starting membership, publishing the profile, and queuing the approval email.</p></div>
                          </div>
                        ) : null}
                        {approvalState?.phase === "error" ? (
                          <div className={styles.approvalFailure} role="alert">
                            <AlertCircle size={22} aria-hidden="true" />
                            <div><strong>Approval didn’t complete</strong><p>{approvalState.message}</p></div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </article>
                );
              })}
          </div>

          <section className={`${styles.card} ${styles.compactAdminCard}`}>
            <div className={styles.compactSectionHeader}><h2>All instructor profiles</h2><span className={styles.recordCount}>{profiles.length} total</span></div>
            <div className={`${styles.tableWrap} ${styles.compactTableWrap}`}>
              <table className={`${styles.dataTable} ${styles.compactDataTable}`}>
                <thead><tr><th>Instructor</th><th>Location</th><th>Status</th><th>Approval email</th><th>Action</th></tr></thead>
                <tbody>{profiles.map((profile) => {
                  const paymentSetup = paymentSetups.find((setup) => setup.instructor_profile_id === profile.id);
                  const approvalJob = latestApprovalEmailJob(profile.id);
                  const activationIsSynced = activationMemberships.some((membership) =>
                    membership.instructor_profile_id === profile.id
                    && membership.stripe_customer_id === paymentSetup?.stripe_customer_id
                    && membership.stripe_subscription_id === paymentSetup?.stripe_subscription_id
                    && membership.latest_checkout_session_id === paymentSetup?.stripe_payment_setup_checkout_session_id
                  );
                  const hasUnredeemedEntitlement = offerEntitlements.some((entitlement) =>
                    entitlement.instructor_profile_id === profile.id && !entitlement.redeemed_at
                  );
                  const activationNeedsRetry = ["approved", "published"].includes(profile.status)
                    && Boolean(paymentSetup?.payment_setup_completed_at)
                    && (!activationIsSynced || hasUnredeemedEntitlement)
                    && !lifetimeAccess.some((access) => access.instructor_profile_id === profile.id && access.has_lifetime_access);
                  return (
                    <tr key={profile.id}>
                      <td>{profile.display_name}</td><td>{[profile.city, profile.region].filter(Boolean).join(", ")}</td><td><span className={styles.status}>{profile.status.replaceAll("_", " ")}</span></td>
                      <td>{approvalJob
                        ? <><span className={styles.status}>{approvalJob.status.replaceAll("_", " ")}</span>{approvalJob.sent_at ? <small>{new Date(approvalJob.sent_at).toLocaleString()}</small> : null}</>
                        : <span className={styles.muted}>Not queued</span>}</td>
                      <td>
                        {activationNeedsRetry ? <button className={styles.button} disabled={busyId === profile.id} type="button" onClick={() => void review(profile.id, "approve")}>{busyId === profile.id ? "Finishing..." : "Finish membership activation"}</button> : null}
                        {!activationNeedsRetry && ["approved", "published"].includes(profile.status) ? <button className={styles.dangerButton} disabled={busyId === profile.id} type="button" onClick={() => void review(profile.id, "suspend")}>Suspend</button> : null}
                        {profile.status === "suspended" ? <button className={styles.secondaryButton} disabled={busyId === profile.id} type="button" onClick={() => void review(profile.id, "approve")}>Reactivate</button> : null}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {!loading && tab === "memberships" ? <MembershipGuaranteeAdmin isOwner={isOwner} /> : null}

      {!loading && tab === "invitations" ? (
        <div className={styles.compactAdminStack}>
          <section className={`${styles.card} ${styles.compactAdminCard}`}>
            <div className={styles.compactSectionHeader}>
              <div><h2>Invite instructor</h2><p className={styles.muted}>Standard invitations give eligible new instructors their first {billingCycles} free. Choose lifetime access instead only when that separate benefit is intended.</p></div>
            </div>
            <form className={styles.invitationForm} onSubmit={sendInstructorInvitation}>
              <label className={styles.field}>
                <span>Instructor email</span>
                <input type="email" required autoComplete="off" value={invitationEmail} onChange={(event) => {
                  setInvitationEmail(event.target.value);
                  invitationRequestKey.current = null;
                  invitationDeliveryToken.current = null;
                }} placeholder="instructor@example.com" />
              </label>
              <label className={styles.check}>
                <input type="checkbox" checked={invitationGrantsLifetime} onChange={(event) => {
                  setInvitationGrantsLifetime(event.target.checked);
                  invitationRequestKey.current = null;
                  invitationDeliveryToken.current = null;
                }} />
                <span>Complimentary lifetime access</span>
              </label>
              <button className={`${styles.button} ${styles.compactButton}`} disabled={busyId === "send-instructor-invitation"} type="submit">
                {busyId === "send-instructor-invitation" ? "Sending..." : "Send invitation"}
              </button>
            </form>
          </section>

          <section className={`${styles.card} ${styles.compactAdminCard}`}>
            <h2>Lifetime instructor access</h2>
            {!lifetimeAccess.length ? <p className={styles.notice}>No instructor profiles yet.</p> : <div className={`${styles.tableWrap} ${styles.compactTableWrap}`} role="region" aria-label="Lifetime instructor access" tabIndex={0}>
              <table className={`${styles.dataTable} ${styles.compactDataTable}`}>
                <caption className={styles.srOnly}>Lifetime access status for instructors</caption>
                <thead><tr><th scope="col">Instructor</th><th scope="col">Profile</th><th scope="col">Access</th><th scope="col">Action</th></tr></thead>
                <tbody>{lifetimeAccess.map((row) => (
                  <tr key={row.instructor_profile_id}>
                    <td>{row.display_name}{row.account_email ? <small>{row.account_email}</small> : null}</td>
                    <td><span className={styles.status}>{row.profile_status.replaceAll("_", " ")}</span></td>
                    <td>
                      {row.has_lifetime_access ? (
                        <><span className={styles.status}>Lifetime</span>{row.granted_at ? <small>{row.access_source} · {new Date(row.granted_at).toLocaleDateString()}</small> : null}</>
                      ) : <span className={styles.muted}>Standard membership</span>}
                    </td>
                    <td>{row.has_lifetime_access ? (
                      <span className={styles.status}>Granted</span>
                    ) : (
                      <button className={`${styles.button} ${styles.compactButton}`} disabled={busyId === `lifetime:${row.instructor_profile_id}`} type="button" onClick={() => void grantLifetimeAccess(row.instructor_profile_id)}>
                        {busyId === `lifetime:${row.instructor_profile_id}` ? "Granting..." : "Grant lifetime access"}
                      </button>
                    )}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>}
          </section>

          <section className={`${styles.card} ${styles.compactAdminCard}`}>
            <h2>Recent invitations</h2>
            {!invitations.length ? <p className={styles.notice}>No instructor invitations have been sent yet.</p> : (
              <div className={`${styles.tableWrap} ${styles.compactTableWrap}`} role="region" aria-label="Recent instructor invitations" tabIndex={0}>
                <table className={`${styles.dataTable} ${styles.compactDataTable}`}>
                  <caption className={styles.srOnly}>Recently sent instructor invitations</caption>
                  <thead><tr><th scope="col">Email</th><th scope="col">Access</th><th scope="col">Status</th><th scope="col">Claim</th><th scope="col">Profile</th><th scope="col">Offer</th></tr></thead>
                  <tbody>{invitations.map((invitation) => (
                    <tr key={invitation.invitation_id}>
                      <td>
                        {invitation.email}
                        <small>{invitation.sent_at ? `Sent ${new Date(invitation.sent_at).toLocaleDateString()}` : "Not sent"}</small>
                      </td>
                      <td>{invitation.grants_lifetime_access
                        ? <span className={styles.status}>Lifetime</span>
                        : invitation.offer_code === commercialTerms.offer.outreachOfferCode
                          ? <span className={styles.status}>2 billing cycles</span>
                          : "Standard"}</td>
                      <td><span className={styles.status}>{invitation.invitation_status.replaceAll("_", " ")}</span></td>
                      <td>{invitation.claimed_at
                        ? <><span className={styles.status}>Claimed</span><small>{new Date(invitation.claimed_at).toLocaleString()}</small></>
                        : <><span className={styles.muted}>Due</span><small>{new Date(invitation.expires_at).toLocaleString()}</small></>}</td>
                      <td>{invitation.profile_submitted_at
                        ? <><span className={styles.status}>Submitted</span><small>{new Date(invitation.profile_submitted_at).toLocaleString()}</small></>
                        : invitation.profile_submission_deadline_at
                          ? <><span className={styles.muted}>Due</span><small>{new Date(invitation.profile_submission_deadline_at).toLocaleString()}</small></>
                          : <span className={styles.muted}>Not started</span>}</td>
                      <td>{invitation.grants_lifetime_access
                        ? <span className={styles.status}>Lifetime</span>
                        : invitation.offer_status
                          ? <><span className={styles.status}>{invitation.offer_status.replaceAll("_", " ")}</span>{invitation.offer_redeemed_at ? <small>{new Date(invitation.offer_redeemed_at).toLocaleString()}</small> : invitation.offer_earned_at ? <small>{new Date(invitation.offer_earned_at).toLocaleString()}</small> : null}</>
                          : <span className={styles.muted}>None</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {!loading && tab === "delivery" ? (
        <div className={styles.card}>
          <div className={styles.buttonRow}><h2>Notification delivery</h2><span className={styles.status}>{failedDeliveryCount} failed</span></div>
          <div className={styles.list}>
            {serviceJobs.slice(0, 100).map((job) => (
              <article className={styles.listItem} key={`service-${job.id}`}>
                <div className={styles.buttonRow}><strong>EMAIL · {job.notification_type.replaceAll("_", " ")}</strong><span className={styles.status}>{job.status}</span></div>
                <p>{new Date(job.created_at).toLocaleString()} · {job.attempts} attempt{job.attempts === 1 ? "" : "s"}</p>
                {job.last_error ? <p className={styles.error}>{job.last_error}</p> : null}
              </article>
            ))}
            {jobs.slice(0, 100).map((job) => (
              <article className={styles.listItem} key={job.id}>
                <div className={styles.buttonRow}><strong>{job.channel.toUpperCase()} · {job.notification_type.replaceAll("_", " ")}</strong><span className={styles.status}>{job.status}</span></div>
                <p>{new Date(job.created_at).toLocaleString()} · {job.attempts} attempt{job.attempts === 1 ? "" : "s"}</p>
                {job.last_error ? <p className={styles.error}>{job.last_error}</p> : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && tab === "access" && isOwner ? (
        <div className={styles.card}>
          <h2>Admin access</h2>
          <p className={styles.muted}>Only people listed here can open the admin dashboard or query marketplace reports. A new admin must sign in once before you grant access.</p>
          <form className={styles.filterBar} onSubmit={grantAdmin}>
            <label className={styles.field}><span>Account email</span><input type="email" required value={grantEmail} onChange={(event) => setGrantEmail(event.target.value)} placeholder="person@example.com" /></label>
            <button className={styles.button} disabled={busyId === "grant-admin"} type="submit">{busyId === "grant-admin" ? "Granting..." : "Grant admin access"}</button>
          </form>
          <div className={styles.list}>{admins.map((admin) => (
            <article className={styles.listItem} key={admin.account_id}>
              <div><h3>{admin.full_name || admin.email || "Administrator"}</h3><p>{admin.email}</p></div>
              <div className={styles.buttonRow}>
                <span className={styles.status}>{admin.is_owner ? "Owner" : "Admin"}</span>
                {!admin.is_owner ? <button className={styles.dangerButton} disabled={busyId === admin.account_id} type="button" onClick={() => void revokeAdmin(admin.account_id)}>Revoke access</button> : null}
              </div>
            </article>
          ))}</div>
        </div>
      ) : null}
    </>
  );
}

function OrganizerDashboard({ accountId }: { accountId: string }) {
  const [inquiries, setInquiries] = useState<MarketplaceInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const client = getMarketplaceClient();
    if (!client) return;
    const { data, error: loadError } = await client
      .from("inquiries")
      .select("*")
      .eq("organizer_account_id", accountId)
      .order("created_at", { ascending: false });
    setInquiries((data as MarketplaceInquiry[] | null) ?? []);
    setError(loadError?.message ?? null);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [accountId]);

  return (
    <>
      <div className={styles.card}>
        <h2>Your instructor inquiries</h2>
        <p>Instructors reply to your account email so contracts, availability, rates, and payments can stay in your usual inbox.</p>
        <Link className={styles.button} href="/#find">Find an instructor</Link>
      </div>
      {loading ? <div className={styles.loading}>Loading inquiries...</div> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {!loading ? <InquiryList inquiries={inquiries} perspective="organizer" onChange={() => void load()} /> : null}
    </>
  );
}

function InquiryList({
  inquiries,
  perspective,
  onChange,
  focusInquiryId = null,
  focusFollowup = null,
  onFeedbackSubmitted
}: {
  inquiries: MarketplaceInquiry[];
  perspective: "organizer" | "instructor";
  onChange: () => void;
  focusInquiryId?: string | null;
  focusFollowup?: "booking" | "completion" | null;
  onFeedbackSubmitted?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [eventDates, setEventDates] = useState<Record<string, string>>(() => Object.fromEntries(
    inquiries.map((inquiry) => [inquiry.id, inquiry.booking_event_date || inquiry.event_date || ""])
  ));

  useEffect(() => {
    if (!focusInquiryId || !inquiries.some((inquiry) => inquiry.id === focusInquiryId)) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`inquiry-${focusInquiryId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [focusInquiryId, inquiries]);

  async function setStatus(id: string, status: string) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusyId(id);
    setError(null);
    const { error: actionError } = await client.rpc("set_inquiry_status", {
      p_inquiry_id: id,
      p_status: status,
      p_note: null
    });
    setBusyId(null);
    if (actionError) setError(actionError.message);
    else onChange();
  }

  async function reportOutcome(id: string, outcome: string) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusyId(id);
    setError(null);
    const { error: actionError } = await client.rpc("report_booking_outcome", {
      p_inquiry_id: id,
      p_outcome: outcome,
      p_booking_value_cents: null,
      p_note: null
    });
    setBusyId(null);
    if (actionError) setError(actionError.message);
    else onChange();
  }

  async function submitInstructorFeedback(
    inquiry: MarketplaceInquiry,
    stage: "booking" | "completion",
    response: string
  ) {
    const client = getMarketplaceClient();
    if (!client) return;
    const requestId = `${inquiry.id}:${stage}`;
    setBusyId(requestId);
    setError(null);
    const { error: actionError } = await client.rpc("submit_instructor_inquiry_feedback", {
      p_inquiry_id: inquiry.id,
      p_stage: stage,
      p_response: response,
      p_private_comment: comments[requestId]?.trim() || null,
      p_confirmed_event_date: stage === "booking" && response === "booked"
        ? eventDates[inquiry.id] || inquiry.event_date
        : null
    });
    setBusyId(null);
    if (actionError) setError(actionError.message);
    else {
      onChange();
      onFeedbackSubmitted?.();
    }
  }

  if (!inquiries.length) {
    return <p className={styles.notice}>{perspective === "instructor" ? "No inquiries yet. New inquiries will appear here and arrive by email." : "You have not contacted an instructor yet."}</p>;
  }

  return (
    <div className={styles.list}>
      {error ? <p className={styles.error}>{error}</p> : null}
      {focusInquiryId && !inquiries.some((inquiry) => inquiry.id === focusInquiryId) ? (
        <p className={styles.error}>That inquiry is not available in this instructor account.</p>
      ) : null}
      {inquiries.map((inquiry) => (
        <article
          className={`${styles.listItem} ${focusInquiryId === inquiry.id ? styles.focusedItem : ""}`}
          id={`inquiry-${inquiry.id}`}
          key={inquiry.id}
        >
          <div className={styles.buttonRow}>
            <span className={styles.status}>{inquiry.status.replace("_", " ")}</span>
            <span className={styles.muted}>{new Date(inquiry.created_at).toLocaleDateString()}</span>
          </div>
          <h3>{perspective === "instructor" ? inquiry.contact_name : inquiry.instructor_name}</h3>
          <p>{[inquiry.event_type, inquiry.event_date, inquiry.event_city, inquiry.event_region].filter(Boolean).join(" · ")}</p>
          {inquiry.guest_count ? <p>{inquiry.guest_count} expected attendees</p> : null}
          {inquiry.message ? <p>{inquiry.message}</p> : null}
          {perspective === "instructor" && inquiry.contact_email ? (
            <p><a href={`mailto:${inquiry.contact_email}?subject=${encodeURIComponent(`Your line dance inquiry for ${inquiry.event_date ?? "your event"}`)}`}>Reply by email</a></p>
          ) : null}
          <div className={styles.buttonRow}>
            {perspective === "instructor" && !["responded", "declined", "booked", "not_booked", "closed"].includes(inquiry.status) ? (
              <button className={styles.secondaryButton} disabled={busyId === inquiry.id} type="button" onClick={() => void setStatus(inquiry.id, "responded")}>Mark responded</button>
            ) : null}
            {perspective === "organizer" && !["withdrawn", "booked", "not_booked", "closed"].includes(inquiry.status) ? (
              <button className={styles.dangerButton} disabled={busyId === inquiry.id} type="button" onClick={() => void setStatus(inquiry.id, "withdrawn")}>Withdraw inquiry</button>
            ) : null}
            {perspective === "organizer" && (inquiry.booking_outcome === "unknown" || inquiry.booking_outcome === "still_deciding") ? (
              <>
                <button className={styles.button} disabled={busyId === inquiry.id} type="button" onClick={() => void reportOutcome(inquiry.id, "booked")}>Booked</button>
                <button className={styles.dangerButton} disabled={busyId === inquiry.id} type="button" onClick={() => void reportOutcome(inquiry.id, "not_booked")}>Not booked</button>
              </>
            ) : null}
          </div>

          {perspective === "instructor" ? (
            <div className={`${styles.feedbackPanel} ${focusInquiryId === inquiry.id && focusFollowup === "booking" ? styles.focusedFeedback : ""}`}>
              <div>
                <strong>Did this inquiry turn into a booking?</strong>
                <p>Current result: {inquiry.booking_outcome.replaceAll("_", " ")}</p>
              </div>
              <label className={styles.field}>
                <span>Confirmed event date</span>
                <input disabled={inquiry.completion_status !== "unknown"} type="date" value={eventDates[inquiry.id] ?? inquiry.event_date ?? ""} onChange={(event) => setEventDates((current) => ({ ...current, [inquiry.id]: event.target.value }))} />
              </label>
              <label className={styles.field}>
                <span>Private comments (optional)</span>
                <textarea
                  disabled={inquiry.completion_status !== "unknown"}
                  maxLength={2000}
                  placeholder="Your feedback helps us improve Hire Line Dancers."
                  value={comments[`${inquiry.id}:booking`] ?? ""}
                  onChange={(event) => setComments((current) => ({ ...current, [`${inquiry.id}:booking`]: event.target.value }))}
                />
              </label>
              <p className={styles.help}>Comments are visible only to you and Hire Line Dancers administrators.</p>
              {inquiry.completion_status !== "unknown" ? <p className={styles.notice}>The booking result is locked because event completion has already been recorded.</p> : null}
              <div className={styles.buttonRow}>
                <button className={styles.button} disabled={inquiry.completion_status !== "unknown" || busyId === `${inquiry.id}:booking`} type="button" onClick={() => void submitInstructorFeedback(inquiry, "booking", "booked")}>Yes, booked</button>
                <button className={styles.dangerButton} disabled={inquiry.completion_status !== "unknown" || busyId === `${inquiry.id}:booking`} type="button" onClick={() => void submitInstructorFeedback(inquiry, "booking", "not_booked")}>No</button>
                <button className={styles.secondaryButton} disabled={inquiry.completion_status !== "unknown" || busyId === `${inquiry.id}:booking`} type="button" onClick={() => void submitInstructorFeedback(inquiry, "booking", "still_deciding")}>In progress</button>
              </div>
            </div>
          ) : null}

          {perspective === "instructor" && inquiry.booking_outcome === "booked" ? (() => {
            const bookingDate = inquiry.booking_event_date || inquiry.event_date;
            const eventHasArrived = !bookingDate || bookingDate <= dateInputValue(new Date());
            return (
              <div className={`${styles.feedbackPanel} ${focusInquiryId === inquiry.id && focusFollowup === "completion" ? styles.focusedFeedback : ""}`}>
                <div>
                  <strong>Did the booked event happen?</strong>
                  <p>Current result: {inquiry.completion_status.replaceAll("_", " ")}</p>
                </div>
                {!eventHasArrived ? <p className={styles.notice}>This question opens after the event date, {new Date(`${bookingDate}T00:00:00`).toLocaleDateString()}.</p> : null}
                <label className={styles.field}>
                  <span>Private comments (optional)</span>
                  <textarea
                    maxLength={2000}
                    placeholder="Tell us what went well or what could be better."
                    value={comments[`${inquiry.id}:completion`] ?? ""}
                    onChange={(event) => setComments((current) => ({ ...current, [`${inquiry.id}:completion`]: event.target.value }))}
                  />
                </label>
                <p className={styles.help}>Comments are visible only to you and Hire Line Dancers administrators.</p>
                <div className={styles.buttonRow}>
                  <button className={styles.button} disabled={!eventHasArrived || busyId === `${inquiry.id}:completion`} type="button" onClick={() => void submitInstructorFeedback(inquiry, "completion", "completed")}>Yes, it happened</button>
                  <button className={styles.dangerButton} disabled={!eventHasArrived || busyId === `${inquiry.id}:completion`} type="button" onClick={() => void submitInstructorFeedback(inquiry, "completion", "did_not_happen")}>No</button>
                </div>
              </div>
            );
          })() : null}
        </article>
      ))}
    </div>
  );
}
