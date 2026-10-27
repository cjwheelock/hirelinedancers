"use client";
import { useEffect, useState } from "react";
import { getMarketplaceClient } from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

type AttentionItem = { thread_id: string; reason: string; created_at: string };
const reasons: Record<string, string> = { no_matches: "No suitable alternatives", urgent_event: "Event within two days", delivery_failed: "Notification delivery failed", static_listing: "Instructor connection needed" };
export function InquiryAttention({ onOpen }: { onOpen: (threadId: string) => void }) {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const client = getMarketplaceClient();
      if (!client) return;
      const { data, error: loadError } = await client.from("inquiry_attention_items").select("thread_id,reason,created_at").is("resolved_at", null).order("created_at").limit(50);
      if (!active) return;
      if (loadError) setError("Unable to load inquiries needing attention.");
      else { setItems(data || []); setError(null); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  async function resolve(item: AttentionItem) {
    const client = getMarketplaceClient();
    if (!client) return;
    const { error: saveError } = await client.from("inquiry_attention_items").update({ resolved_at: new Date().toISOString() }).eq("thread_id", item.thread_id).eq("reason", item.reason);
    if (saveError) setError("Unable to resolve this item.");
    else setItems((current) => current.filter((row) => row.thread_id !== item.thread_id || row.reason !== item.reason));
  }
  if (!items.length && !error) return null;
  return <aside className={styles.recommendations} aria-label="Inquiries needing attention">
    <h3>Inquiries needing attention</h3>
    {error ? <p className={styles.error}>{error}</p> : null}
    <div className={styles.list}>{items.map((item) => <div className={styles.listItem} key={`${item.thread_id}:${item.reason}`}>
      <strong>{reasons[item.reason] || "Inquiry needs attention"}</strong>
      <div className={styles.buttonRow}><button className={styles.secondaryButton} type="button" onClick={() => onOpen(item.thread_id)}>Open inquiry</button><button className={styles.secondaryButton} type="button" onClick={() => void resolve(item)}>Mark resolved</button></div>
    </div>)}</div>
  </aside>;
}
