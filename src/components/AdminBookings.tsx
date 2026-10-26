"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { bookingStatusLabels, displayDate, displayDateTime, money, type BookingStatus } from "@/lib/booking";
import { getMarketplaceClient } from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

type AdminBookingRow = {
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
};

function attentionReason(row: AdminBookingRow): string | null {
  if (row.problem_reported_at && !row.problem_resolved_at) return "Problem reported";
  if (row.disputed_at) return "Payment disputed";
  if (row.refund_status === "failed") return "Refund failed";
  if (row.payout_error && !row.paid_out_at) return "Payout error";
  if (["completed"].includes(row.status) && !row.paid_out_at && new Date(row.payout_due_at).getTime() < Date.now() - 3 * 3_600_000) return "Payout overdue";
  return null;
}

export function AdminBookings() {
  const [rows, setRows] = useState<AdminBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"attention" | "all">("attention");

  async function load() {
    const client = getMarketplaceClient();
    if (!client) return;
    setLoading(true);
    const { data, error: loadError } = await client
      .from("bookings")
      .select("id,thread_id,status,event_date,total_cents,price_cents,payout_due_at,paid_at,paid_out_at,problem_reported_at,problem_resolved_at,disputed_at,payout_error,refund_status,refund_cents,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (loadError) setError(loadError.message);
    else {
      setRows((data ?? []) as AdminBookingRow[]);
      setError(null);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => filter === "all" ? rows : rows.filter((row) => attentionReason(row)), [filter, rows]);
  const paid = rows.filter((row) => row.paid_at);
  const grossCents = paid.reduce((sum, row) => sum + row.total_cents, 0);

  return (
    <div className={`${styles.card} ${styles.compactAdminCard}`}>
      <div className={styles.compactSectionHeader}>
        <div>
          <h2>Bookings</h2>
          <p className={styles.muted}>{paid.length} paid bookings, {money(grossCents)} collected in the latest {rows.length} records.</p>
        </div>
        <div className={styles.buttonRow}>
          <select aria-label="Filter bookings" value={filter} onChange={(event) => setFilter(event.target.value as "attention" | "all")}>
            <option value="attention">Needs attention</option>
            <option value="all">All recent bookings</option>
          </select>
          <button className={styles.iconButton} type="button" aria-label="Refresh bookings" onClick={() => void load()}><RefreshCw aria-hidden="true" size={18} /></button>
        </div>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.muted}>Loading bookings...</p> : null}
      {!loading && !visible.length ? <p className={styles.muted}>{filter === "attention" ? "Nothing needs attention." : "No bookings yet."}</p> : null}
      {visible.length ? (
        <div className={styles.compactTableWrap}>
          <table className={styles.compactDataTable}>
            <thead>
              <tr><th>Event</th><th>Status</th><th>Total</th><th>Attention</th><th>Payout</th><th /></tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>{displayDate(row.event_date)}</td>
                  <td>{bookingStatusLabels[row.status]}</td>
                  <td>{money(row.total_cents)}</td>
                  <td>{attentionReason(row) ?? ""}{row.payout_error ? <><br /><small>{row.payout_error}</small></> : null}</td>
                  <td>{row.paid_out_at ? `Sent ${displayDateTime(row.paid_out_at)}` : row.paid_at ? `Due ${displayDateTime(row.payout_due_at)}` : ""}</td>
                  <td><Link href={`/admin/?tab=messages&thread=${encodeURIComponent(row.thread_id)}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
