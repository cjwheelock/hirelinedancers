"use client";

import { FormEvent, useEffect, useState } from "react";
import { getMarketplaceClient, readableError, type MarketplaceInquiry } from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

type AdminInquiry = MarketplaceInquiry & {
  name?: string | null;
  email?: string | null;
  location?: string | null;
  time_zone?: string | null;
  reply_by_date?: string | null;
};

const PAGE_SIZE = 50;
const searchFields = ["contact_name", "contact_email", "company_name", "instructor_name", "event_city", "event_region", "name", "email", "location"];

// Quote PostgREST filter values, escaping its grammar and LIKE wildcards.
export function inquirySearchFilter(value: string) {
  const literal = value.trim().replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "\\%").replaceAll("_", "\\_");
  return searchFields.map((field) => `${field}.ilike."%${literal}%"`).join(",");
}

export function AdminInquiries({ onOpenThread, focusInquiryId = null }: { onOpenThread: (threadId: string) => void; focusInquiryId?: string | null }) {
  const [selectedInquiryId, setSelectedInquiryId] = useState(focusInquiryId);
  const [rows, setRows] = useState<AdminInquiry[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [threadNotice, setThreadNotice] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setRows([]);
    async function load() {
      try {
        const client = getMarketplaceClient();
        if (!client) throw new Error("Marketplace connection unavailable.");
        // Existing admin-only SELECT policy governs access. No time/status/thread filter:
        // historical inquiries without message threads remain visible here.
        let query = client.from("inquiries").select("*", { count: "exact" })
          .order("created_at", { ascending: false }).order("id", { ascending: false });
        if (selectedInquiryId) query = query.eq("id", selectedInquiryId);
        if (search) query = query.or(inquirySearchFilter(search));
        const result = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1).abortSignal(controller.signal);
        if (!active) return;
        if (result.error) throw result.error;
        const total = result.count ?? 0;
        setCount(total);
        if (page > 0 && page * PAGE_SIZE >= total) {
          setPage(Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
          return;
        }
        setRows((result.data ?? []) as AdminInquiry[]);
      } catch (failure) {
        if (active) setError(readableError(failure));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [page, search, refresh, selectedInquiryId]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(0);
    setSelectedInquiryId(null);
    setSearch(draftSearch.trim());
    setRefresh((value) => value + 1);
  }

  async function openThread(inquiryId: string) {
    const client = getMarketplaceClient();
    if (!client) return;
    setOpeningId(inquiryId);
    setThreadNotice(null);
    try {
      const result = await client.rpc("get_inquiry_primary_thread", { p_inquiry_id: inquiryId });
      if (result.error) throw result.error;
      if (result.data) onOpenThread(result.data as string);
      else setThreadNotice("This inquiry has no message thread. Its submitted details are shown below.");
    } catch (failure) {
      setThreadNotice(readableError(failure));
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <section className={styles.card} aria-label="All inquiries">
      <div className={styles.compactSectionHeader}>
        <h2>All inquiries</h2>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
      </div>
      {selectedInquiryId ? <button type="button" className={styles.secondaryButton} onClick={() => { setSelectedInquiryId(null); setPage(0); }}>View all inquiries</button> : null}
      <form className={styles.buttonRow} onSubmit={submitSearch}>
        <label className={styles.field} style={{ flex: "1 1 240px" }}>
          <span>Search name, email, company, instructor or city</span>
          <input type="search" value={draftSearch} maxLength={200} onChange={(event) => setDraftSearch(event.target.value)} />
        </label>
        <button className={styles.secondaryButton} type="submit">Search</button>
      </form>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {threadNotice ? <p className={styles.notice} role="status">{threadNotice}</p> : null}
      {loading ? <p role="status">Loading inquiries...</p> : !error ? <>
        <p role="status">{count} {count === 1 ? "inquiry" : "inquiries"}{count ? ` · ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, count)}` : ""}</p>
        <div className={styles.list}>
          {rows.map((inquiry) => <details className={styles.listItem} key={inquiry.id} open={selectedInquiryId === inquiry.id || undefined}>
            <summary style={{ cursor: "pointer" }}>
              <strong>{inquiry.contact_name || inquiry.name || inquiry.company_name || "Individual organizer"}</strong>
              {` · ${inquiry.instructor_name || "Instructor"} · ${[inquiry.event_type, inquiry.event_city, inquiry.event_date].filter(Boolean).join(" · ")}`}
              <br /><small>Submitted {new Date(inquiry.created_at).toLocaleString()} · {(inquiry.status || "unknown").replaceAll("_", " ")}</small>
            </summary>
            <dl style={{ overflowWrap: "anywhere" }}>
              {[
                ["Contact", inquiry.contact_name || inquiry.name], ["Email", inquiry.contact_email || inquiry.email], ["Phone", inquiry.contact_phone_e164],
                ["Company", inquiry.company_name], ["Instructor", inquiry.instructor_name], ["Event type", inquiry.event_type],
                ["Event date", inquiry.event_date], ["Start time", inquiry.event_start_time], ["Venue", inquiry.venue_name],
                ["City / region", [inquiry.event_city, inquiry.event_region].filter(Boolean).join(", ")], ["Postal code", inquiry.event_postal_code],
                ["Location", inquiry.location], ["Time zone", inquiry.time_zone], ["Reply by", inquiry.reply_by_date],
                ["Guest count", inquiry.guest_count], ["Budget", inquiry.budget_range], ["Music requests", inquiry.music_requests],
                ["Venue speakers", inquiry.venue_has_speakers == null ? null : inquiry.venue_has_speakers ? "Yes" : "No"],
                ["Venue microphone", inquiry.venue_has_microphone == null ? null : inquiry.venue_has_microphone ? "Yes" : "No"],
                ["Message", inquiry.message], ["Booking outcome", inquiry.booking_outcome?.replaceAll("_", " ")],
                ["Booking event date", inquiry.booking_event_date], ["Outcome note", inquiry.outcome_note],
                ["Completion", inquiry.completion_status?.replaceAll("_", " ")],
                ["First response", inquiry.first_responded_at ? new Date(inquiry.first_responded_at).toLocaleString() : null],
                ["Inquiry ID", inquiry.id]
              ].map(([label, value]) => value != null && value !== "" ? <div key={label} style={{ marginTop: 12 }}><dt><strong>{label}</strong></dt><dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{value}</dd></div> : null)}
            </dl>
            <button type="button" className={styles.secondaryButton} disabled={openingId !== null} onClick={() => void openThread(inquiry.id)}>{openingId === inquiry.id ? "Loading..." : "View conversation"}</button>
          </details>)}
        </div>
        <div className={styles.buttonRow} aria-label="Inquiry pages">
          <button type="button" className={styles.secondaryButton} disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button>
          <span>Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE_SIZE))}</span>
          <button type="button" className={styles.secondaryButton} disabled={(page + 1) * PAGE_SIZE >= count} onClick={() => setPage((value) => value + 1)}>Next</button>
        </div>
      </> : null}
    </section>
  );
}
