"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, Download, Mail, MessageSquare, UserPlus } from "lucide-react";
import QRCode from "qrcode";
import { commercialTerms } from "@/lib/commercialTerms";
import { getMarketplaceClient, readableError } from "@/lib/marketplace";
import { normalizeReferralCode, referralShareLink } from "@/lib/referrals";
import styles from "./ReferralsCard.module.css";

const referralTerms = commercialTerms.referrals;
const sharePercent = `${referralTerms.shareBps / 100}%`;
const durationLabel = `${referralTerms.durationMonths} months`;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

// Worked example from the booking contract: on a $400 booking the platform
// keeps the client fee plus the instructor fee, and the referrer gets their share.
const examplePriceCents = 40000;
const examplePlatformCents = Math.round(examplePriceCents * commercialTerms.bookings.clientFeeBps / 10000)
  + Math.round(examplePriceCents * commercialTerms.bookings.instructorFeeBps / 10000);
const exampleShareCents = Math.floor(examplePlatformCents * referralTerms.shareBps / 10000);

function money(cents: number | null | undefined) {
  return usd.format((cents ?? 0) / 100);
}

function date(value: string | null | undefined) {
  return value ? shortDate.format(new Date(value)) : "";
}

const statusLabels: Record<string, string> = {
  published: "Live",
  approved: "Approved",
  pending_review: "In review",
  suspended: "Paused",
  draft: "Setting up"
};

type ReferredRow = {
  name: string;
  joined_at: string;
  earning_ends_at: string;
  profile_status: string;
  bookings: number;
  earned_cents: number;
  pending_cents: number;
};

type ReferralProgram = {
  code: string | null;
  link_visits: number;
  payouts_ready: boolean;
  share_bps: number;
  referrals: ReferredRow[];
  referred_by: { name: string; code: string } | null;
  can_add_referral: boolean;
};

export function ReferralsCard({ onOpenPayouts }: { onOpenPayouts: () => void }) {
  const [program, setProgram] = useState<ReferralProgram | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [addCode, setAddCode] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const client = getMarketplaceClient();
    if (!client) return;
    const { data, error: loadError } = await client.rpc("get_my_referral_program");
    if (loadError) setError(readableError(loadError));
    else setProgram(data as ReferralProgram);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createCode() {
    const client = getMarketplaceClient();
    if (!client) return;
    setCreating(true);
    setError(null);
    const { error: createError } = await client.rpc("create_my_referral_code");
    if (createError) setError(readableError(createError));
    await load();
    setCreating(false);
  }

  async function addReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    const code = normalizeReferralCode(addCode);
    if (!client) return;
    if (!code) {
      setAddError("Enter the code exactly as you received it.");
      return;
    }
    setAdding(true);
    setAddError(null);
    const { error: attachError } = await client.rpc("attach_referral_code", { p_code: code, p_source: "typed" });
    if (attachError) setAddError(readableError(attachError));
    else await load();
    setAdding(false);
  }

  const link = program?.code ? referralShareLink(program.code) : "";
  const shareText = link ? `Join me on Hire Line Dancers: ${link}` : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Copy did not work in this browser. Select the link and copy it instead.");
    }
  }

  async function downloadQr() {
    if (!program?.code) return;
    try {
      const dataUrl = await QRCode.toDataURL(link, { width: 720, margin: 2, color: { dark: "#2a1e17", light: "#ffffff" } });
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = `hire-line-dancers-${program.code.toLowerCase()}.png`;
      anchor.click();
    } catch (qrError) {
      setError(readableError(qrError));
    }
  }

  if (loading) return <div className={styles.card}>Loading referrals...</div>;

  const rows = program?.referrals ?? [];
  const joined = rows.length;
  const live = rows.filter((row) => row.profile_status === "published").length;
  const bookings = rows.reduce((sum, row) => sum + Number(row.bookings || 0), 0);
  const earned = rows.reduce((sum, row) => sum + Number(row.earned_cents || 0), 0);
  const pending = rows.reduce((sum, row) => sum + Number(row.pending_cents || 0), 0);

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2>Referrals</h2>
        <p>Invite line dance instructors you know. For {durationLabel} after each one joins, you earn {sharePercent} of what Hire Line Dancers earns from their bookings.</p>
      </header>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {!program?.code ? (
        <section className={styles.card}>
          <div className={styles.createRow}>
            <div>
              <h3>Get your referral link</h3>
              <p className={styles.muted}>Your code is tied to your account. Anyone who joins through it is credited to you automatically.</p>
            </div>
            <button className={styles.primary} type="button" disabled={creating} onClick={() => void createCode()}>
              {creating ? "Creating..." : "Create my referral code"}
            </button>
          </div>
        </section>
      ) : (
        <section className={styles.linkCard}>
          <div className={styles.linkMain}>
            <span className={styles.eyebrow}>Your referral link</span>
            <div className={styles.linkRow}>
              <span className={styles.linkText}>{link.replace(/^https?:\/\//, "")}</span>
              <button className={styles.light} type="button" onClick={() => void copyLink()}>
                {copied ? <CheckCircle2 size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <div className={styles.shareRow}>
              <span>Code <b>{program.code}</b></span>
              <a href={`sms:?&body=${encodeURIComponent(shareText)}`}><MessageSquare size={15} aria-hidden="true" /> Text it</a>
              <a href={`mailto:?subject=${encodeURIComponent("Join Hire Line Dancers")}&body=${encodeURIComponent(shareText)}`}><Mail size={15} aria-hidden="true" /> Email it</a>
              <button type="button" className={styles.textButton} onClick={() => void downloadQr()}><Download size={15} aria-hidden="true" /> Download QR code</button>
            </div>
          </div>
          <div className={styles.example}>
            <span>Example</span>
            <p>A referred instructor books a {money(examplePriceCents)} event. We earn {money(examplePlatformCents)}. You earn <b>{money(exampleShareCents)}</b>.</p>
          </div>
        </section>
      )}

      {program?.code && !program.payouts_ready ? (
        <p className={styles.notice}>
          Set up payouts to receive referral earnings. Earnings wait for you until you do.{" "}
          <button type="button" className={styles.inlineLink} onClick={onOpenPayouts}>Set up payouts</button>
        </p>
      ) : null}

      <section className={styles.stats} aria-label="Referral summary">
        <div className={styles.stat}><span>Instructors joined</span><strong>{joined}</strong><small>{live} {live === 1 ? "profile" : "profiles"} live</small></div>
        <div className={styles.stat}><span>Their bookings</span><strong>{bookings}</strong><small>Within each {referralTerms.durationMonths}-month window</small></div>
        <div className={styles.stat}><span>Pending</span><strong>{money(pending)}</strong><small>Pays when they get paid</small></div>
        <div className={`${styles.stat} ${styles.statDark}`}><span>Paid to you</span><strong>{money(earned)}</strong><small>To your Stripe payout account</small></div>
      </section>

      <section className={styles.tableCard}>
        <div className={styles.tableHead}>
          <h3>Instructors you referred</h3>
          <span className={styles.muted}>Earnings run for {durationLabel} from each join date</span>
        </div>
        {rows.length ? (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr><th scope="col">Instructor</th><th scope="col">Joined</th><th scope="col">Status</th><th scope="col">Bookings</th><th scope="col">You earned</th><th scope="col">Earning until</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.name}-${row.joined_at}`}>
                    <td><b>{row.name}</b></td>
                    <td>{date(row.joined_at)}</td>
                    <td><span className={`${styles.pill} ${row.profile_status === "published" ? styles.pillLive : row.profile_status === "pending_review" ? styles.pillReview : ""}`}>{statusLabels[row.profile_status] ?? "Setting up"}</span></td>
                    <td>{row.bookings}</td>
                    <td><b>{money(row.earned_cents)}</b>{row.pending_cents > 0 ? <small className={styles.muted}> + {money(row.pending_cents)} pending</small> : null}</td>
                    <td>{date(row.earning_ends_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>No referred instructors yet. Share your link to get started.</p>
        )}
      </section>

      <section className={styles.steps}>
        <div><span>1</span><b>Share your link</b><p>Send it to instructors you know, or post it in your dance groups.</p></div>
        <div><span>2</span><b>They join and get booked</b><p>Their code is saved to their account when they sign up. The $49 listing fee is waived for them too.</p></div>
        <div><span>3</span><b>You get paid automatically</b><p>Your {sharePercent} goes to your Stripe payout account when they get paid for each event.</p></div>
      </section>

      {program?.referred_by ? (
        <p className={styles.muted}>You joined through {program.referred_by.name}&rsquo;s referral link.</p>
      ) : program?.can_add_referral ? (
        <form className={styles.addForm} onSubmit={addReferral}>
          <label>
            <span><UserPlus size={15} aria-hidden="true" /> Referred by a friend? Their code</span>
            <input value={addCode} onChange={(event) => setAddCode(event.target.value.toUpperCase())} autoComplete="off" />
          </label>
          <button className={styles.secondary} type="submit" disabled={adding}>{adding ? "Saving..." : "Save code"}</button>
          {addError ? <p className={styles.error} role="alert">{addError}</p> : null}
        </form>
      ) : null}
    </div>
  );
}

type AdminReferrer = {
  account_id: string;
  name: string;
  email: string;
  code: string;
  disabled: boolean;
  link_visits: number;
  joined: number;
  live: number;
  bookings: number;
  platform_revenue_cents: number;
  paid_cents: number;
  due_cents: number;
  payouts_ready: boolean;
};

type AdminSignup = {
  referred_account_id: string;
  name: string;
  email: string;
  referrer_name: string;
  code: string;
  source: "link" | "typed" | "admin";
  attached_at: string;
  earning_ends_at: string;
  profile_status: string;
};

type AdminProgram = {
  referrers: AdminReferrer[];
  signups: AdminSignup[];
  totals: { active_codes: number; referred: number; platform_revenue_cents: number; paid_cents: number; due_cents: number };
};

const sourceLabels = { link: "Link", typed: "Typed code", admin: "Set by admin" };

export function AdminReferrals() {
  const [program, setProgram] = useState<AdminProgram | null>(null);
  const [view, setView] = useState<"referrers" | "signups">("referrers");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editCode, setEditCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const client = getMarketplaceClient();
    if (!client) return;
    const { data, error: loadError } = await client.rpc("admin_list_referral_program");
    if (loadError) setError(readableError(loadError));
    else setProgram(data as AdminProgram);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveReferral(referredAccountId: string) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy(true);
    setError(null);
    const { error: saveError } = await client.rpc("admin_set_instructor_referral", {
      p_referred_account_id: referredAccountId,
      p_code: editCode.trim() || null
    });
    if (saveError) setError(readableError(saveError));
    else {
      setEditing(null);
      await load();
    }
    setBusy(false);
  }

  async function toggleCode(row: AdminReferrer) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy(true);
    const { error: toggleError } = await client.rpc("admin_set_referral_code_disabled", {
      p_account_id: row.account_id,
      p_disabled: !row.disabled
    });
    if (toggleError) setError(readableError(toggleError));
    await load();
    setBusy(false);
  }

  function exportCsv() {
    if (!program) return;
    const header = view === "referrers"
      ? ["Referrer", "Email", "Code", "Link visits", "Joined", "Live", "Bookings", "Our revenue", "Paid to referrer", "Due"]
      : ["New instructor", "Email", "Referred by", "Code", "How", "Joined", "Status", "Earning until"];
    const body = view === "referrers"
      ? program.referrers.map((row) => [row.name, row.email, row.code, row.link_visits, row.joined, row.live, row.bookings, money(row.platform_revenue_cents), money(row.paid_cents), money(row.due_cents)])
      : program.signups.map((row) => [row.name, row.email, row.referrer_name, row.code, sourceLabels[row.source], date(row.attached_at), statusLabels[row.profile_status] ?? row.profile_status, date(row.earning_ends_at)]);
    const csv = [header, ...body].map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    anchor.download = `referrals-${view}.csv`;
    anchor.click();
  }

  if (!program) return error ? <p className={styles.error} role="alert">{error}</p> : <div className={styles.card}>Loading referrals...</div>;

  return (
    <div className={styles.wrap}>
      <div className={styles.adminTop}>
        <div className={styles.segment} role="group" aria-label="Referral view">
          <button type="button" aria-pressed={view === "referrers"} onClick={() => setView("referrers")}>Referrers</button>
          <button type="button" aria-pressed={view === "signups"} onClick={() => setView("signups")}>New signups</button>
        </div>
        <button className={styles.secondary} type="button" onClick={exportCsv}>Export CSV</button>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <section className={styles.stats} aria-label="Referral totals">
        <div className={styles.stat}><span>Active codes</span><strong>{program.totals.active_codes}</strong></div>
        <div className={styles.stat}><span>Instructors referred</span><strong>{program.totals.referred}</strong></div>
        <div className={styles.stat}><span>Our revenue from them</span><strong>{money(program.totals.platform_revenue_cents)}</strong></div>
        <div className={`${styles.stat} ${styles.statDark}`}><span>Referral payouts</span><strong>{money(program.totals.paid_cents)}</strong><small>{money(program.totals.due_cents)} waiting</small></div>
      </section>

      <section className={styles.tableCard}>
        <div className={styles.scroll}>
          {view === "referrers" ? (
            <table className={styles.table}>
              <thead>
                <tr><th scope="col">Referrer</th><th scope="col">Code</th><th scope="col">Link visits</th><th scope="col">Joined</th><th scope="col">Live</th><th scope="col">Bookings</th><th scope="col">Our revenue</th><th scope="col">Paid to referrer</th><th scope="col"><span className={styles.srOnly}>Actions</span></th></tr>
              </thead>
              <tbody>
                {program.referrers.map((row) => (
                  <tr key={row.account_id}>
                    <td><b>{row.name}</b><small className={styles.block}>{row.email}</small></td>
                    <td><span className={`${styles.code} ${row.disabled ? styles.codeOff : ""}`}>{row.code}</span></td>
                    <td>{row.link_visits}</td>
                    <td>{row.joined}</td>
                    <td>{row.live}</td>
                    <td>{row.bookings}</td>
                    <td>{money(row.platform_revenue_cents)}</td>
                    <td><b className={styles.teal}>{money(row.paid_cents)}</b>{row.due_cents > 0 ? <small className={styles.block}>{money(row.due_cents)} waiting{row.payouts_ready ? "" : " for payout setup"}</small> : null}</td>
                    <td><button className={styles.textButton} type="button" disabled={busy} onClick={() => void toggleCode(row)}>{row.disabled ? "Turn code on" : "Turn code off"}</button></td>
                  </tr>
                ))}
                {!program.referrers.length ? <tr><td colSpan={9} className={styles.empty}>No referral codes yet.</td></tr> : null}
              </tbody>
            </table>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr><th scope="col">New instructor</th><th scope="col">Referred by</th><th scope="col">How</th><th scope="col">Joined</th><th scope="col">Status</th><th scope="col">Earning until</th><th scope="col"><span className={styles.srOnly}>Actions</span></th></tr>
              </thead>
              <tbody>
                {program.signups.map((row) => (
                  <tr key={row.referred_account_id}>
                    <td><b>{row.name}</b><small className={styles.block}>{row.email}</small></td>
                    <td>
                      {editing === row.referred_account_id ? (
                        <span className={styles.editRow}>
                          <label className={styles.srOnly} htmlFor={`ref-${row.referred_account_id}`}>Referral code</label>
                          <input id={`ref-${row.referred_account_id}`} value={editCode} onChange={(event) => setEditCode(event.target.value.toUpperCase())} placeholder="Code, or blank to remove" />
                          <button className={styles.secondary} type="button" disabled={busy} onClick={() => void saveReferral(row.referred_account_id)}>Save</button>
                          <button className={styles.textButton} type="button" onClick={() => setEditing(null)}>Cancel</button>
                        </span>
                      ) : (
                        <>{row.referrer_name} <span className={styles.code}>{row.code}</span></>
                      )}
                    </td>
                    <td>{sourceLabels[row.source]}</td>
                    <td>{date(row.attached_at)}</td>
                    <td><span className={`${styles.pill} ${row.profile_status === "published" ? styles.pillLive : row.profile_status === "pending_review" ? styles.pillReview : ""}`}>{statusLabels[row.profile_status] ?? "Setting up"}</span></td>
                    <td>{date(row.earning_ends_at)}</td>
                    <td>{editing === row.referred_account_id ? null : <button className={styles.textButton} type="button" onClick={() => { setEditing(row.referred_account_id); setEditCode(row.code); }}>Change</button>}</td>
                  </tr>
                ))}
                {!program.signups.length ? <tr><td colSpan={7} className={styles.empty}>No referred signups yet.</td></tr> : null}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
