"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { eventTypes } from "@/data/site";
import { bookingStatusLabels, displayDate, displayDateTime, money, type BookingStatus } from "@/lib/booking";
import { getMarketplaceClient } from "@/lib/marketplace";
import admin from "./AdminShell.module.css";

export type AdminBookingRow = {
  id: string;
  thread_id: string;
  status: BookingStatus;
  event_date: string;
  total_cents: number;
  price_cents: number;
  payout_due_at: string;
  paid_at: string | null;
  paid_out_at: string | null;
  problem_reported_at: string | null;
  problem_resolved_at: string | null;
  disputed_at: string | null;
  payout_error: string | null;
  refund_status: string | null;
  refund_cents: number | null;
  created_at: string;
  instructor: { display_name: string | null } | null;
  inquiry: {
    contact_name: string | null;
    company_name: string | null;
    event_type: string | null;
    event_city: string | null;
    event_region: string | null;
  } | null;
};

type AttentionItem = { thread_id: string; reason: string; created_at: string };

const bookingColumns = "id,thread_id,status,event_date,total_cents,price_cents,payout_due_at,paid_at,paid_out_at,problem_reported_at,problem_resolved_at,disputed_at,payout_error,refund_status,refund_cents,created_at,instructor:instructor_profiles(display_name),inquiry:inquiries(contact_name,company_name,event_type,event_city,event_region)";

const attentionReasons: Record<string, string> = {
  no_matches: "No suitable alternatives",
  urgent_event: "Event within two days",
  delivery_failed: "Notification delivery failed",
  static_listing: "Instructor connection needed"
};

function attentionReason(row: AdminBookingRow): string | null {
  if (row.problem_reported_at && !row.problem_resolved_at) return "Problem reported";
  if (row.disputed_at) return "Payment disputed";
  if (row.refund_status === "failed") return "Refund failed";
  if (row.payout_error && !row.paid_out_at) return "Payout error";
  if (["completed"].includes(row.status) && !row.paid_out_at && new Date(row.payout_due_at).getTime() < Date.now() - 3 * 3_600_000) return "Payout overdue";
  return null;
}

function hasOpenProblem(row: AdminBookingRow) {
  return Boolean(row.problem_reported_at && !row.problem_resolved_at);
}

function statusChipClass(row: AdminBookingRow) {
  if (attentionReason(row) || ["cancelled", "declined", "payment_failed"].includes(row.status)) return admin.chipAlert;
  if (["quote_sent", "awaiting_payment", "payment_processing"].includes(row.status)) return admin.chipAmber;
  if (["confirmed", "completed", "paid_out"].includes(row.status)) return admin.chipPine;
  return "";
}

function eventLabel(row: AdminBookingRow) {
  const value = row.inquiry?.event_type;
  const type = value ? eventTypes.find((item) => item.slug === value)?.label ?? value.replaceAll("-", " ").replaceAll("_", " ") : null;
  return [type, displayDate(row.event_date)].filter(Boolean).join(" · ");
}

function eventPlace(row: AdminBookingRow) {
  return [row.inquiry?.event_city, row.inquiry?.event_region].filter(Boolean).join(", ");
}

function organizerName(row: AdminBookingRow) {
  return row.inquiry?.contact_name || row.inquiry?.company_name || "";
}

function threadHref(row: AdminBookingRow) {
  return `/admin/?tab=messages&thread=${encodeURIComponent(row.thread_id)}`;
}

/** Sum of paid booking totals whose payment landed inside the selected time frame. */
export function collectedCents(rows: AdminBookingRow[], start: string | null, end: string | null) {
  const from = start ? new Date(start).getTime() : -Infinity;
  const to = end ? new Date(end).getTime() : Infinity;
  return rows.reduce((sum, row) => {
    if (!row.paid_at) return sum;
    const paid = new Date(row.paid_at).getTime();
    return paid >= from && paid < to ? sum + row.total_cents : sum;
  }, 0);
}

export function useAdminBookings() {
  const [rows, setRows] = useState<AdminBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const client = getMarketplaceClient();
    if (!client) return;
    setLoading(true);
    const { data, error: loadError } = await client
      .from("bookings")
      .select(bookingColumns)
      .order("created_at", { ascending: false })
      .limit(200);
    if (loadError) setError(loadError.message);
    else {
      setRows((data ?? []) as unknown as AdminBookingRow[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return { rows, loading, error, reload };
}

function BookingStatusChip({ row }: { row: AdminBookingRow }) {
  return <span className={`${admin.chip} ${statusChipClass(row)}`}>{attentionReason(row) ?? bookingStatusLabels[row.status]}</span>;
}

export function AdminBookings() {
  const { rows, loading, error, reload } = useAdminBookings();
  const [filter, setFilter] = useState<"attention" | "all">("attention");

  const visible = useMemo(() => filter === "all" ? rows : rows.filter((row) => attentionReason(row)), [filter, rows]);
  const paid = rows.filter((row) => row.paid_at);
  const grossCents = paid.reduce((sum, row) => sum + row.total_cents, 0);

  return (
    <div className={admin.card}>
      <div className={admin.cardHeader}>
        <div>
          <h2>Bookings</h2>
          <p className={admin.cardNote}>{paid.length} paid bookings, {money(grossCents)} collected in the latest {rows.length} records.</p>
        </div>
        <div className={admin.pageHeaderControls}>
          <select className={admin.select} aria-label="Filter bookings" value={filter} onChange={(event) => setFilter(event.target.value as "attention" | "all")}>
            <option value="attention">Needs attention</option>
            <option value="all">All recent bookings</option>
          </select>
          <button className={admin.iconButton} type="button" aria-label="Refresh bookings" onClick={() => void reload()}><RefreshCw aria-hidden="true" size={18} /></button>
        </div>
      </div>
      {error ? <p className={admin.error} role="alert">{error}</p> : null}
      {loading && !rows.length ? <p className={admin.empty} role="status">Loading bookings...</p> : null}
      {!loading && !visible.length ? <p className={admin.empty}>{filter === "attention" ? "Nothing needs attention." : "No bookings yet."}</p> : null}
      {visible.length ? (
        <div className={admin.tableWrap} tabIndex={0} role="region" aria-label="Bookings">
          <table className={admin.table}>
            <thead>
              <tr><th scope="col">Event</th><th scope="col">Instructor</th><th scope="col">Organizer</th><th scope="col">Status</th><th scope="col">Payout</th><th scope="col" className={admin.numeric}>Total</th></tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td><Link className={admin.tableLink} href={threadHref(row)}>{eventLabel(row)}</Link>{eventPlace(row) ? <small>{eventPlace(row)}</small> : null}</td>
                  <td>{row.instructor?.display_name ?? ""}</td>
                  <td>{organizerName(row)}</td>
                  <td><BookingStatusChip row={row} />{row.payout_error ? <small>{row.payout_error}</small> : null}</td>
                  <td>{row.paid_out_at ? `Sent ${displayDateTime(row.paid_out_at)}` : row.paid_at ? `Due ${displayDateTime(row.payout_due_at)}` : ""}</td>
                  <td className={admin.numeric}>{money(row.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function AdminRecentBookings({ rows, loading, error, onViewAll }: { rows: AdminBookingRow[]; loading: boolean; error: string | null; onViewAll: () => void }) {
  const recent = rows.slice(0, 5);
  return (
    <section className={admin.card} aria-label="Recent bookings">
      <div className={admin.cardHeader}>
        <h2>Recent bookings</h2>
        <button className={admin.linkButton} type="button" onClick={onViewAll}>View all</button>
      </div>
      {error ? <p className={admin.error} role="alert">{error}</p> : null}
      {loading && !rows.length ? <p className={admin.empty} role="status">Loading bookings...</p> : null}
      {!loading && !error && !recent.length ? <p className={admin.empty}>No bookings yet.</p> : null}
      {recent.length ? (
        <div className={admin.tableWrap} tabIndex={0} role="region" aria-label="Recent bookings">
          <table className={admin.table}>
            <thead>
              <tr><th scope="col">Event</th><th scope="col">Instructor</th><th scope="col">Organizer</th><th scope="col">Status</th><th scope="col" className={admin.numeric}>Total</th></tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id}>
                  <td><Link className={admin.tableLink} href={threadHref(row)}>{eventLabel(row)}</Link>{eventPlace(row) ? <small>{eventPlace(row)}</small> : null}</td>
                  <td>{row.instructor?.display_name ?? ""}</td>
                  <td>{organizerName(row)}</td>
                  <td><BookingStatusChip row={row} /></td>
                  <td className={admin.numeric}>{money(row.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Rows of the overview's "Needs attention" card that come from inquiries and
 * bookings. The instructor review row is rendered by the dashboard itself.
 */
export function AdminAttentionRows({ hasPending, bookings, bookingsLoading, onOpenThread, onOpenBookings }: {
  hasPending: boolean;
  bookings: AdminBookingRow[];
  bookingsLoading: boolean;
  onOpenThread: (threadId: string) => void;
  onOpenBookings: () => void;
}) {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const client = getMarketplaceClient();
      if (!client) return;
      const { data, error: loadError } = await client.from("inquiry_attention_items").select("thread_id,reason,created_at").is("resolved_at", null).order("created_at").limit(50);
      if (!active) return;
      if (loadError) setError("Unable to load inquiries needing attention.");
      else { setItems((data ?? []) as AttentionItem[]); setError(null); }
      setItemsLoaded(true);
    }
    void load();
    return () => { active = false; };
  }, []);

  const problems = bookings.filter(hasOpenProblem);
  const settled = itemsLoaded && !bookingsLoading;

  return (
    <>
      {error ? <p className={admin.error} role="alert">{error}</p> : null}
      {items.map((item) => (
        <div className={admin.attentionRow} key={`${item.thread_id}:${item.reason}`}>
          <span>{attentionReasons[item.reason] || "Inquiry needs attention"}</span>
          <button className={admin.linkButton} type="button" onClick={() => onOpenThread(item.thread_id)}>Open conversation</button>
        </div>
      ))}
      {problems.length ? (
        <div className={admin.attentionRow}>
          <span><strong>{problems.length} {problems.length === 1 ? "booking" : "bookings"}</strong> with a reported problem</span>
          <button className={admin.linkButton} type="button" onClick={() => problems.length === 1 ? onOpenThread(problems[0].thread_id) : onOpenBookings()}>Resolve problem</button>
        </div>
      ) : null}
      {settled && !error && !hasPending && !items.length && !problems.length ? <p className={admin.empty}>Nothing needs attention.</p> : null}
    </>
  );
}
