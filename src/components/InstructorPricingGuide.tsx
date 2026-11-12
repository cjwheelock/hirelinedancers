import { instructorFeeLabel, money, previewAmounts } from "@/lib/booking";
import styles from "./InstructorPricingGuide.module.css";

const exampleRateCents = 10000;
const examplePayoutCents = previewAmounts(exampleRateCents).instructorPayoutCents;

export function InstructorPricingGuide() {
  return (
    <aside className={styles.guide} aria-label="A quick guide to pricing">
      <h4>A quick guide to pricing</h4>
      <div className={styles.recommendation}>
        <p>Published event prices vary widely by location and what&rsquo;s included.</p>
        <p className={styles.recommendedRate}>We recommend charging $125–$250 per hour with a two-hour minimum, including travel.</p>
        <p>Use it as a starting point when setting your rates.</p>
        <p className={styles.corporate}>Larger corporate events may justify a higher rate.</p>
      </div>
      <div className={styles.fee}>
        <h5>Take the platform fee into account</h5>
        <p>Hire Line Dancers takes a {instructorFeeLabel} fee from your instructor price.</p>
        <div className={styles.example}>
          <div>
            <p className={styles.label}>Example hourly rate</p>
            <p className={styles.amount}>{money(exampleRateCents).replace(/\.00$/, "")} / hour</p>
          </div>
          <span className={styles.arrow} aria-hidden="true">→</span>
          <div className={styles.payout}>
            <p className={styles.label}>After our {instructorFeeLabel} fee</p>
            <p className={styles.amount}>{money(examplePayoutCents).replace(/\.00$/, "")} / hour</p>
            <p className={styles.help}>Before any other deductions.</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
