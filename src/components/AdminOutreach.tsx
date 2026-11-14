"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getMarketplaceClient } from "@/lib/marketplace";
import styles from "./Marketplace.module.css";
import local from "./AdminOutreach.module.css";

type Config = { enabled: boolean; daily_limit: number; sender_email: string; research_enabled: boolean };
type Status = { gmailConfigured: boolean; serperConfigured: boolean; config: Config | null };
type Market = {
  service_market_slug: string;
  featured_instructor_name: string | null;
  featured_instructor_years: number | null;
  featured_instructor_pronoun: "she" | "he" | "they" | null;
  featured_profile_url: string | null;
  research_status: string;
  sending_approved: boolean;
};
type Lead = {
  id: number;
  service_market_slug: string;
  business: string;
  first_name: string | null;
  greeting: string;
  email: string | null;
  contact_method: string;
  contact_form_url: string | null;
  website: string | null;
  name_evidence: string | null;
  status: string;
};
type Send = { id: number; to_email: string; subject: string; kind: string; status: string; sent_at: string | null; created_at: string };
type FormAnswer = { id: number; question_key: string; example_labels: string[]; answer: string; notes: string | null; times_used: number };
type Template = { key: string; kind: string; subject_template: string; body_template: string; active: boolean };
type Section = "cities" | "leads" | "sent" | "forms" | "answers" | "templates";

const LEAD_STATUSES = ["new", "approved", "sent", "followed_up", "replied", "bounced", "form_pending", "form_submitted", "excluded", "send_failed", "uncertain", "unsubscribed"];
const SECTION_LABELS: Record<Section, string> = {
  cities: "Cities",
  leads: "Leads",
  sent: "Sent",
  forms: "Contact forms",
  answers: "Form answers",
  templates: "Templates",
};

function label(value: string): string {
  return value.replace(/_/g, " ");
}

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

export function AdminOutreach() {
  const [section, setSection] = useState<Section>("leads");
  const [status, setStatus] = useState<Status | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketNames, setMarketNames] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sends, setSends] = useState<Send[]>([]);
  const [sentToday, setSentToday] = useState(0);
  const [answers, setAnswers] = useState<FormAnswer[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [cityFilter, setCityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("new");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ leadId: number; to: string | null; subject: string; body: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newAnswer, setNewAnswer] = useState({ question_key: "", example_labels: "", answer: "", notes: "" });

  async function callAdmin(body: Record<string, unknown>) {
    const client = getMarketplaceClient();
    if (!client) throw new Error("Marketplace is not configured");
    const { data, error: invokeError } = await client.functions.invoke("outreach/admin", { body });
    if (invokeError) {
      let detail = invokeError.message;
      try {
        const context = (invokeError as { context?: Response }).context;
        const parsed = context ? await context.json() as { error?: string } : null;
        if (parsed?.error) detail = parsed.error;
      } catch {
        // keep the generic message
      }
      throw new Error(detail);
    }
    return data as Record<string, unknown>;
  }

  async function load() {
    const client = getMarketplaceClient();
    if (!client) return;
    setLoading(true);
    setError(null);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [statusResult, marketsResult, namesResult, leadRows, sendsResult, todayResult, answersResult, templatesResult, userResult] = await Promise.all([
      callAdmin({ action: "status" }).catch((e: Error) => ({ error: e.message })),
      client.from("outreach_markets").select("service_market_slug,featured_instructor_name,featured_instructor_years,featured_instructor_pronoun,featured_profile_url,research_status,sending_approved").order("service_market_slug"),
      client.from("service_markets").select("slug,name"),
      client.from("outreach_leads").select("id,service_market_slug,business,first_name,greeting,email,contact_method,contact_form_url,website,name_evidence,status").order("id").limit(2000),
      client.from("outreach_sends").select("id,to_email,subject,kind,status,sent_at,created_at").order("created_at", { ascending: false }).limit(50),
      client.from("outreach_sends").select("id", { count: "exact", head: true }).neq("kind", "test").gte("created_at", today.toISOString()),
      client.from("outreach_form_answers").select("id,question_key,example_labels,answer,notes,times_used").order("question_key"),
      client.from("outreach_templates").select("key,kind,subject_template,body_template,active").order("key"),
      client.auth.getUser(),
    ]);
    if ("error" in statusResult && typeof statusResult.error === "string") setError(`Outreach status: ${statusResult.error}`);
    else setStatus(statusResult as unknown as Status);
    const firstError = [marketsResult, namesResult, leadRows, sendsResult, answersResult, templatesResult].find((r) => r.error)?.error;
    if (firstError) setError(firstError.message);
    setMarkets((marketsResult.data ?? []) as Market[]);
    setMarketNames(Object.fromEntries(((namesResult.data ?? []) as { slug: string; name: string }[]).map((m) => [m.slug, m.name])));
    const allLeads = (leadRows.data ?? []) as Lead[];
    setLeads(allLeads);
    const tally: Record<string, Record<string, number>> = {};
    for (const lead of allLeads) {
      tally[lead.service_market_slug] ??= {};
      tally[lead.service_market_slug][lead.status] = (tally[lead.service_market_slug][lead.status] ?? 0) + 1;
    }
    setCounts(tally);
    setSends((sendsResult.data ?? []) as Send[]);
    setSentToday(todayResult.count ?? 0);
    setAnswers((answersResult.data ?? []) as FormAnswer[]);
    setTemplates((templatesResult.data ?? []) as Template[]);
    setAdminEmail(userResult.data.user?.email ?? null);
    setSelected(new Set());
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  async function setSending(enabled: boolean) {
    await run(async () => {
      const client = getMarketplaceClient();
      const { error: rpcError } = await client!.rpc("outreach_set_config", { p_enabled: enabled });
      if (rpcError) throw rpcError;
      setStatus((s) => s && s.config ? { ...s, config: { ...s.config, enabled } } : s);
    }, enabled ? "Sending is on." : "Sending is off.");
  }

  async function updateMarket(slug: string, patch: Partial<Market>) {
    await run(async () => {
      const { error: updateError } = await getMarketplaceClient()!.from("outreach_markets").update(patch).eq("service_market_slug", slug);
      if (updateError) throw updateError;
      setMarkets((list) => list.map((m) => m.service_market_slug === slug ? { ...m, ...patch } : m));
    }, "Saved.");
  }

  async function updateLead(id: number, patch: Partial<Lead>) {
    await run(async () => {
      const { error: updateError } = await getMarketplaceClient()!.from("outreach_leads").update(patch).eq("id", id);
      if (updateError) throw updateError;
      setLeads((list) => list.map((l) => l.id === id ? { ...l, ...patch } : l));
    }, "Saved.");
  }

  async function bulkStatus(next: "approved" | "excluded") {
    const ids = [...selected];
    if (!ids.length) return;
    await run(async () => {
      const patch = next === "approved" ? { status: "approved", approved_at: new Date().toISOString() } : { status: "excluded" };
      const { error: updateError } = await getMarketplaceClient()!.from("outreach_leads").update(patch).in("id", ids);
      if (updateError) throw updateError;
      await load();
    }, `${ids.length} ${ids.length === 1 ? "lead" : "leads"} ${next}.`);
  }

  async function openPreview(leadId: number) {
    await run(async () => {
      const data = await callAdmin({ action: "preview", lead_id: leadId });
      setPreview({ leadId, to: (data.to as string) ?? null, subject: String(data.subject), body: String(data.body) });
    });
  }

  async function sendTest(leadId: number) {
    if (!adminEmail) {
      setError("Your account email is not available.");
      return;
    }
    await run(async () => {
      await callAdmin({ action: "send_test", lead_id: leadId, to: adminEmail });
    }, `Test sent to ${adminEmail}.`);
  }

  async function saveAnswer(answer: FormAnswer) {
    await run(async () => {
      const { error: updateError } = await getMarketplaceClient()!.from("outreach_form_answers")
        .update({ answer: answer.answer, notes: answer.notes, example_labels: answer.example_labels }).eq("id", answer.id);
      if (updateError) throw updateError;
    }, "Saved.");
  }

  async function addAnswer() {
    const key = newAnswer.question_key.trim().toLowerCase();
    if (!key || !newAnswer.answer.trim()) {
      setError("Question and answer are both required.");
      return;
    }
    await run(async () => {
      const { error: insertError } = await getMarketplaceClient()!.from("outreach_form_answers").insert({
        question_key: key,
        example_labels: newAnswer.example_labels.split(",").map((s) => s.trim()).filter(Boolean),
        answer: newAnswer.answer.trim(),
        notes: newAnswer.notes.trim() || null,
      });
      if (insertError) throw insertError;
      setNewAnswer({ question_key: "", example_labels: "", answer: "", notes: "" });
      await load();
    }, "Answer added.");
  }

  async function deleteAnswer(id: number) {
    await run(async () => {
      const { error: deleteError } = await getMarketplaceClient()!.from("outreach_form_answers").delete().eq("id", id);
      if (deleteError) throw deleteError;
      setAnswers((list) => list.filter((a) => a.id !== id));
    }, "Answer removed.");
  }

  const visibleLeads = useMemo(() => leads.filter((l) =>
    (cityFilter === "all" || l.service_market_slug === cityFilter) && (statusFilter === "all" || l.status === statusFilter)
  ), [leads, cityFilter, statusFilter]);
  const formLeads = useMemo(() => leads.filter((l) => l.status === "form_pending"), [leads]);
  const replied = leads.filter((l) => l.status === "replied").length;
  const bounced = leads.filter((l) => l.status === "bounced").length;
  const cityName = (slug: string) => marketNames[slug] ?? slug;
  const cfg = status?.config ?? null;

  return (
    <div className={`${styles.card} ${styles.compactAdminCard}`}>
      <div className={styles.compactSectionHeader}>
        <div>
          <h2>Outreach</h2>
          <p className={styles.muted}>Planner emails sent from {cfg?.sender_email ?? "the outreach inbox"}.</p>
        </div>
        <button className={styles.iconButton} type="button" aria-label="Refresh outreach" onClick={() => void load()}><RefreshCw aria-hidden="true" size={18} /></button>
      </div>

      <div className={local.statusBar}>
        <span className={`${local.chip} ${status?.gmailConfigured ? local.ok : local.bad}`}>Gmail {status?.gmailConfigured ? "connected" : "not connected"}</span>
        <span className={`${local.chip} ${status?.serperConfigured ? local.ok : local.bad}`}>Research {status?.serperConfigured ? "connected" : "not connected"}</span>
        <span className={local.chip}>Sent today: {sentToday} of {cfg?.daily_limit ?? 0}</span>
        {cfg ? (
          <label className={local.chip}>
            <input type="checkbox" checked={cfg.enabled} disabled={busy} onChange={(e) => void setSending(e.target.checked)} />
            Sending {cfg.enabled ? "on" : "off"}
          </label>
        ) : null}
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}

      <div className={styles.tabs} role="tablist" aria-label="Outreach sections">
        {(Object.keys(SECTION_LABELS) as Section[]).map((name) => (
          <button key={name} className={`${styles.tab} ${section === name ? styles.activeTab : ""}`} type="button" onClick={() => setSection(name)}>
            {name === "forms" && formLeads.length ? `${SECTION_LABELS[name]} (${formLeads.length})` : SECTION_LABELS[name]}
          </button>
        ))}
      </div>

      {loading ? <p className={styles.muted}>Loading outreach...</p> : null}

      {!loading && section === "cities" ? (
        <div className={local.cards}>
          {markets.length === 0 ? <p className={styles.muted}>No cities yet.</p> : null}
          {markets.map((m) => {
            const c = counts[m.service_market_slug] ?? {};
            const missing = !m.featured_instructor_name || !m.featured_instructor_years || !m.featured_instructor_pronoun || !m.featured_profile_url;
            return (
              <div key={m.service_market_slug} className={local.leadCard}>
                <div className={local.leadHeader}>
                  <strong>{cityName(m.service_market_slug)}</strong>
                  <span className={local.chip}>Research {label(m.research_status)}</span>
                </div>
                <p className={local.small}>{Object.entries(c).map(([s, n]) => `${label(s)}: ${n}`).join(" · ") || "No leads yet"}</p>
                <div className={local.inline}>
                  <input aria-label="Featured instructor name" placeholder="Instructor name" defaultValue={m.featured_instructor_name ?? ""}
                    onBlur={(e) => e.target.value !== (m.featured_instructor_name ?? "") && void updateMarket(m.service_market_slug, { featured_instructor_name: e.target.value || null })} />
                  <input aria-label="Years teaching" type="number" min={0} placeholder="Years teaching" defaultValue={m.featured_instructor_years ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value ? Number(e.target.value) : null;
                      if (v !== m.featured_instructor_years) void updateMarket(m.service_market_slug, { featured_instructor_years: v });
                    }} />
                  <select aria-label="Pronoun" value={m.featured_instructor_pronoun ?? ""}
                    onChange={(e) => void updateMarket(m.service_market_slug, { featured_instructor_pronoun: (e.target.value || null) as Market["featured_instructor_pronoun"] })}>
                    <option value="">Pronoun</option>
                    <option value="she">she / her</option>
                    <option value="he">he / him</option>
                    <option value="they">they / them</option>
                  </select>
                  <input aria-label="Profile URL" placeholder="Profile URL" defaultValue={m.featured_profile_url ?? ""}
                    onBlur={(e) => e.target.value !== (m.featured_profile_url ?? "") && void updateMarket(m.service_market_slug, { featured_profile_url: e.target.value || null })} />
                </div>
                {missing ? <p className={local.warn}>Emails for this city cannot send until the instructor name, years, pronoun and profile URL are filled in.</p> : null}
                <label className={local.small}>
                  <input type="checkbox" checked={m.sending_approved} disabled={busy}
                    onChange={(e) => void updateMarket(m.service_market_slug, { sending_approved: e.target.checked })} /> Sending approved for this city
                </label>
              </div>
            );
          })}
        </div>
      ) : null}

      {!loading && section === "leads" ? (
        <div className={local.section}>
          <div className={styles.buttonRow}>
            <select aria-label="Filter by city" value={cityFilter} onChange={(e) => { setCityFilter(e.target.value); setSelected(new Set()); }}>
              <option value="all">All cities</option>
              {markets.map((m) => <option key={m.service_market_slug} value={m.service_market_slug}>{cityName(m.service_market_slug)}</option>)}
            </select>
            <select aria-label="Filter by status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setSelected(new Set()); }}>
              <option value="all">All statuses</option>
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
          <div className={styles.buttonRow}>
            <button className={styles.secondaryButton} type="button" onClick={() => setSelected(selected.size === visibleLeads.length ? new Set() : new Set(visibleLeads.map((l) => l.id)))}>
              {selected.size === visibleLeads.length && visibleLeads.length ? "Clear selection" : `Select all (${visibleLeads.length})`}
            </button>
            <button className={styles.button} type="button" disabled={busy || !selected.size} onClick={() => void bulkStatus("approved")}>Approve ({selected.size})</button>
            <button className={styles.secondaryButton} type="button" disabled={busy || !selected.size} onClick={() => void bulkStatus("excluded")}>Exclude ({selected.size})</button>
          </div>
          <div className={local.cards}>
            {visibleLeads.length === 0 ? <p className={styles.muted}>No leads match these filters.</p> : null}
            {visibleLeads.map((lead) => (
              <div key={lead.id} className={local.leadCard}>
                <div className={local.leadHeader}>
                  <label className={local.leadTitle}>
                    <input type="checkbox" checked={selected.has(lead.id)} onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(lead.id);
                      else next.delete(lead.id);
                      setSelected(next);
                    }} />
                    {lead.business}
                  </label>
                  <span className={local.chip}>{label(lead.status)}</span>
                </div>
                <p className={local.small}>
                  {cityName(lead.service_market_slug)} · {label(lead.contact_method)}
                  {lead.email ? ` · ${lead.email}` : ""}
                  {lead.website ? <> · <a href={lead.website} target="_blank" rel="noreferrer">website</a></> : null}
                </p>
                <div className={local.inline}>
                  <input aria-label="First name" placeholder="First name" defaultValue={lead.first_name ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (lead.first_name ?? "")) void updateLead(lead.id, { first_name: v || null, ...(v ? { greeting: `Hi ${v},` } : {}) });
                    }} />
                  <input key={lead.greeting} aria-label="Greeting" defaultValue={lead.greeting}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== lead.greeting && void updateLead(lead.id, { greeting: e.target.value.trim() })} />
                </div>
                {lead.name_evidence ? <p className={local.small} title={lead.name_evidence}>Name found: &ldquo;{lead.name_evidence}&rdquo;</p> : null}
                {lead.email ? (
                  <div className={styles.buttonRow}>
                    <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void openPreview(lead.id)}>Preview</button>
                    <button className={styles.secondaryButton} type="button" disabled={busy || !status?.gmailConfigured} onClick={() => void sendTest(lead.id)}>Send test to me</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && section === "sent" ? (
        <div className={local.section}>
          <div className={local.statusBar}>
            <span className={local.chip}>Replied: {replied}</span>
            <span className={local.chip}>Bounced: {bounced}</span>
          </div>
          {sends.length === 0 ? <p className={styles.muted}>Nothing sent yet.</p> : (
            <div className={styles.compactTableWrap}>
              <table className={styles.compactDataTable}>
                <thead><tr><th>To</th><th>Subject</th><th>Type</th><th>Status</th><th>Sent</th></tr></thead>
                <tbody>
                  {sends.map((s) => (
                    <tr key={s.id}><td>{s.to_email}</td><td>{s.subject}</td><td>{label(s.kind)}</td><td>{s.status}</td><td>{when(s.sent_at ?? s.created_at)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {!loading && section === "forms" ? (
        <div className={local.cards}>
          {formLeads.length === 0 ? <p className={styles.muted}>No contact forms waiting.</p> : null}
          {formLeads.map((lead) => (
            <div key={lead.id} className={local.leadCard}>
              <strong>{lead.business}</strong>
              <p className={local.small}>
                {cityName(lead.service_market_slug)}{lead.first_name ? ` · ${lead.first_name}` : ""}
                {lead.contact_form_url ? <> · <a href={lead.contact_form_url} target="_blank" rel="noreferrer">contact form</a></> : null}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && section === "answers" ? (
        <div className={local.section}>
          <p className={styles.muted}>Saved answers are reused when filling planner contact forms.</p>
          <div className={`${local.leadCard} ${local.formGrid}`}>
            <strong>Add an answer</strong>
            <input aria-label="Question" placeholder="Question (for example: how did you hear about us)" value={newAnswer.question_key}
              onChange={(e) => setNewAnswer({ ...newAnswer, question_key: e.target.value })} />
            <input aria-label="Other labels" placeholder="Other labels for this field, comma separated" value={newAnswer.example_labels}
              onChange={(e) => setNewAnswer({ ...newAnswer, example_labels: e.target.value })} />
            <textarea aria-label="Answer" placeholder="Answer" rows={3} value={newAnswer.answer}
              onChange={(e) => setNewAnswer({ ...newAnswer, answer: e.target.value })} />
            <input aria-label="Notes" placeholder="Notes (optional)" value={newAnswer.notes}
              onChange={(e) => setNewAnswer({ ...newAnswer, notes: e.target.value })} />
            <div className={styles.buttonRow}>
              <button className={styles.button} type="button" disabled={busy} onClick={() => void addAnswer()}>Add answer</button>
            </div>
          </div>
          {answers.length === 0 ? <p className={styles.muted}>No saved answers yet.</p> : null}
          {answers.map((a) => (
            <div key={a.id} className={`${local.leadCard} ${local.formGrid}`}>
              <div className={local.leadHeader}>
                <strong>{a.question_key}</strong>
                <span className={local.small}>Used {a.times_used}×</span>
              </div>
              <input aria-label="Other labels" placeholder="Other labels, comma separated" defaultValue={a.example_labels.join(", ")}
                onBlur={(e) => { a.example_labels = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); }} />
              <textarea aria-label="Answer" rows={3} defaultValue={a.answer} onBlur={(e) => { a.answer = e.target.value; }} />
              <input aria-label="Notes" placeholder="Notes" defaultValue={a.notes ?? ""} onBlur={(e) => { a.notes = e.target.value || null; }} />
              <div className={styles.buttonRow}>
                <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void saveAnswer(a)}>Save</button>
                <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void deleteAnswer(a.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && section === "templates" ? (
        <div className={local.cards}>
          <p className={styles.muted}>Email copy is set by CJ. Changes to templates go through CJ before they are used.</p>
          {templates.map((t) => (
            <div key={t.key} className={local.leadCard}>
              <div className={local.leadHeader}>
                <strong>{label(t.kind)}</strong>
                <span className={`${local.chip} ${t.active ? local.ok : ""}`}>{t.active ? "Active" : "Inactive"}</span>
              </div>
              <p><strong>Subject:</strong> {t.subject_template}</p>
              <pre className={local.emailBody}>{t.body_template}</pre>
            </div>
          ))}
        </div>
      ) : null}

      {preview ? (
        <div className={local.overlay} role="dialog" aria-modal="true" aria-label="Email preview" onClick={() => setPreview(null)}>
          <div className={local.modal} onClick={(e) => e.stopPropagation()}>
            <p className={local.small}>To: {preview.to ?? "no email"}</p>
            <p><strong>{preview.subject}</strong></p>
            <pre className={local.emailBody}>{preview.body}</pre>
            <div className={styles.buttonRow}>
              <button className={styles.secondaryButton} type="button" disabled={busy || !status?.gmailConfigured} onClick={() => void sendTest(preview.leadId)}>Send test to me</button>
              <button className={styles.button} type="button" onClick={() => setPreview(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
