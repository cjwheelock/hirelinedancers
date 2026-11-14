import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { matchingRequestHref, placeFromQuery } from "./matchingPlace";
import styles from "./MatchingRequestCard.module.css";

export function MatchingRequestCard({ query, eventSlug, hasResults = false }: { query: string; eventSlug?: string; hasResults?: boolean }) {
  const place = placeFromQuery(query);
  if (!place) return null;
  if (hasResults) {
    return (
      <aside className={styles.more}>
        <div>
          <h3 className={styles.moreTitle}>Don&apos;t see the right fit?</h3>
          <p className={styles.copy}>Tell us about your event and we&apos;ll find someone in {place.short} for you.</p>
        </div>
        <Link className={`button secondary small ${styles.cta}`} href={matchingRequestHref(query, eventSlug)}>
          Get matched <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </aside>
    );
  }
  return (
    <>
      <article className={styles.card}>
        <div className={styles.body}>
          <div className={styles.top}>
            <span className={styles.mark} aria-hidden="true"><MapPin size={26} /></span>
            <span className={styles.pill}>Free to request</span>
          </div>
          <div>
            <h3 className={styles.title}>We&apos;ll find you an instructor in {place.short}</h3>
            <p className={styles.sub}>Personal matching by Hire Line Dancers · {place.full}</p>
          </div>
          <p className={styles.copy}>No one in {place.short} has published a profile with us yet, so we&apos;ll do the legwork. Tell us about your event and we&apos;ll reach out to line dance instructors in your area, then introduce you to the ones who are available and a good fit.</p>
          <Link className={`button primary ${styles.cta}`} href={matchingRequestHref(query, eventSlug)}>
            Get matched in {place.short} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <ol className={styles.steps}>
          <li>Share your event</li>
          <li>We reach out to instructors near you</li>
          <li>You choose who to book</li>
        </ol>
      </article>
      <p className={styles.join}>
        <strong>Teach line dancing in {place.short}?</strong> Be the first instructor listed here. <Link href="/instructors/join/">Apply to join</Link>
      </p>
    </>
  );
}
