import Link from "next/link";
import { Award, ShieldCheck } from "lucide-react";
import {
  bookingExample,
  foundingInstructorDeadline,
  instructorFeePercent
} from "@/lib/commercialTerms";
import styles from "./Marketplace.module.css";

const example = bookingExample(40000);

export function InstructorOnboardingPricing() {
  return (
    <section className={styles.onboardingPricing} aria-labelledby="instructor-join-fee-heading">
      <div className={styles.onboardingPricingDetails}>
        <span className="founding-badge"><Award size={15} aria-hidden="true" /> Founding instructor</span>
        <div className={styles.onboardingListingPrice}>
          <s aria-label="Regular listing fee: 49 dollars">$49</s>
          <h2 id="instructor-join-fee-heading">$0 <span className={styles.onboardingListingPriceLabel}>permanent listing</span></h2>
        </div>
        <p>Listing fee waived through {foundingInstructorDeadline}. Includes a Founding Instructor badge.</p>
        <ul className="check-list">
          <li>No monthly fee, ever.</li>
          <li>We keep a {instructorFeePercent} platform fee from each booking. On a {example.price} booking, you receive {example.payout}.</li>
          <li>You set your rate, minimum and cancellation policy on every quote.</li>
        </ul>
        <p className={styles.onboardingPricingFootnote}>Payout timing and insurance are covered when you set up payouts. See the <Link href="/legal/terms/">Terms of Service</Link> and <Link href="/legal/refund-policy/">refund policy</Link>.</p>
      </div>
      <p className={styles.onboardingPricingNote}><ShieldCheck size={16} aria-hidden="true" /> Book and get paid through Hire Line Dancers to keep payment protection and support if something goes wrong.</p>
    </section>
  );
}
