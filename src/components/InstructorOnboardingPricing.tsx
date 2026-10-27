import Link from "next/link";
import { Award, ShieldCheck } from "lucide-react";
import {
  bookingExample,
  foundingInstructorDeadline,
  instructorFeePercent,
  payoutDelayLabel,
  problemReportWindowLabel
} from "@/lib/commercialTerms";
import styles from "./Marketplace.module.css";

const example = bookingExample(40000);

export function InstructorOnboardingPricing() {
  return (
    <section className={styles.onboardingPricing} aria-labelledby="instructor-join-fee-heading">
      <div className={styles.onboardingPricingDetails}>
        <span className="founding-badge"><Award size={15} aria-hidden="true" /> Founding instructor</span>
        <h2 id="instructor-join-fee-heading">Free to join</h2>
        <ul className="check-list">
          <li>No monthly fee. You pay nothing until you get paid.</li>
          <li>Hire Line Dancers keeps a {instructorFeePercent} platform fee from each booking paid through the platform.</li>
          <li>Example: on a {example.price} booking, you receive {example.payout}.</li>
          <li>You set your rate, minimum hours, and cancellation policy on every quote.</li>
          <li>Your payout is sent {payoutDelayLabel} after the event unless the client reports a problem within {problemReportWindowLabel}.</li>
          <li>If you need insurance, you can attach your own certificate or note that you handle insurance outside the agreement.</li>
          <li>Join by {foundingInstructorDeadline} to become a founding instructor and keep a Founding Instructor badge on your profile.</li>
        </ul>
        <p>See the <Link href="/legal/terms/">Terms of Service</Link> and <Link href="/legal/refund-policy/">booking cancellation and refund policy</Link>.</p>
      </div>
      <p className={styles.onboardingPricingNote}><ShieldCheck size={16} aria-hidden="true" /> Book and get paid through Hire Line Dancers to keep payment protection, guaranteed payouts, and support if something goes wrong.</p>
    </section>
  );
}
