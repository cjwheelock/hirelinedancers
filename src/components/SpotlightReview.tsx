"use client";

import { useEffect, useState } from "react";
import { getMarketplaceClient, type InstructorProfile } from "@/lib/marketplace";
import { spotlightHeading, type Spotlight } from "@/lib/spotlight";
import { SpotlightBody } from "./SpotlightBody";
import styles from "./Marketplace.module.css";
import articleStyles from "./Spotlight.module.css";

const stateLabel = { draft: "Awaiting instructor review", approved: "Approved by instructor", declined: "Kept private", released: "Released for publication" };
type Action = "approve" | "decline" | "release";

export function SpotlightReview({ profile, profiles }: { profile?: InstructorProfile; profiles?: InstructorProfile[] }) {
  const [rows, setRows] = useState<Spotlight[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const client = getMarketplaceClient();
    if (!client) return;
    let active = true;
    let query = client.from("instructor_spotlights").select("profile_id,slug,revision,content,status,released_at");
    if (profile) query = query.eq("profile_id", profile.id);
    void query.order("slug").range(page * 20, page * 20 + 20).then(result => {
      if (!active) return;
      if (result.error) setError("The spotlight could not be loaded.");
      else {
        setRows((result.data || []).slice(0, 20) as Spotlight[]);
        setMore((result.data || []).length > 20);
      }
      setLoaded(true);
      setBusy(false);
    });
    return () => { active = false; };
  }, [profile, profiles, reload, page]);

  async function review(row: Spotlight, action: Action) {
    const client = getMarketplaceClient();
    if (!client || busy) return;
    setBusy(true);
    setError("");
    const result = await client.rpc("review_instructor_spotlight", { p_id: row.profile_id, p_revision: row.revision, p_action: action });
    if (result.error) setError(result.error.message);
    setReload(v => v + 1);
  }
  if ((!loaded || !rows.length) && !error && (profile || !loaded)) return null;
  return <section className={styles.card}>
    <h2>{profile ? "Your instructor spotlight" : "Instructor spotlights"}</h2>
    {error && <p role="alert" className={styles.error}>{error} <button type="button" onClick={() => { setError(""); setReload(v => v + 1); }}>Refresh</button></p>}
    {!error && !rows.length && <p>No spotlight drafts yet.</p>}
    {rows.map(row => {
      const { title, description } = spotlightHeading(row.content);
      const liveProfile = (profile || profiles?.find(p => p.id === row.profile_id))?.status === "published";
      return <details key={row.profile_id} className={articleStyles.review}>
        <summary>{profile ? "Review your article" : title} · {stateLabel[row.status]}</summary>
        <article>
          <p className={styles.eyebrow}>Instructor spotlight</p>
          <h3>{title}</h3>
          <p>{description}</p>
          <SpotlightBody content={row.content} profileId={row.profile_id} preview />
        </article>
        <p className={styles.help}>{row.status === "released"
          ? "The article will appear on the blog after the next site update."
          : row.status === "declined" ? "You chose to keep this article private. A previously published article comes off the blog after the next site update."
          : profile ? "Your article stays private until you approve it and an administrator publishes it."
          : "Publishing requires the instructor’s approval and a live instructor profile."}</p>
        <div className={styles.buttonRow}>
          {profile && ["draft","declined"].includes(row.status) && <button type="button" className={styles.button} disabled={busy} onClick={() => void review(row,"approve")}>Approve article</button>}
          {profile && row.status !== "declined" && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void review(row,"decline")}>Keep private</button>}
          {!profile && row.status === "approved" && <button type="button" className={styles.button} disabled={busy || !liveProfile} onClick={() => void review(row,"release")}>Publish article</button>}
        </div>
      </details>;
    })}
    {!profile && (page > 0 || more) && <div className={styles.buttonRow}>
      <button type="button" disabled={busy || page === 0} onClick={() => { setBusy(true); setPage(page - 1); }}>Previous</button>
      <button type="button" disabled={busy || !more} onClick={() => { setBusy(true); setPage(page + 1); }}>Next</button>
    </div>}
  </section>;
}
