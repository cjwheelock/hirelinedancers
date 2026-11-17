import { site } from "@/data/site";
import {
  clientFeePercent,
  payoutDelayLabel,
  problemReportWindowLabel,
  standardCancellationSummary
} from "@/lib/commercialTerms";

export const metadata = { title: "Cancellation and Refund Policy" };

export default function RefundPolicyPage() {
  return (
    <section className="page-shell article-page">
      <h1>Cancellation and Refund Policy</h1>
      <p>Last updated: November 16, 2026.</p>
      <p>This policy is offered by {site.legalName}, which operates Hire Line Dancers. It covers bookings paid through Hire Line Dancers.</p>
      <h2>Booking cancellations</h2>
      <p>Organizers pay in full when they sign a booking agreement. Hire Line Dancers holds the payment until {payoutDelayLabel} after the scheduled end of the event, so refunds come from money we still hold.</p>
      <ul className="check-list">
        <li>Each booking agreement shows its cancellation policy before anyone signs. The Standard policy is: {standardCancellationSummary}.</li>
        <li>An instructor may set a custom policy on a quote. The custom terms appear in the agreement the organizer signs.</li>
        <li>When an organizer cancels, the {clientFeePercent} service fee is not refunded.</li>
        <li>When an instructor cancels, the organizer receives a full refund, including the service fee.</li>
        <li>To cancel, open the conversation for the booking and choose Cancel booking. The refund amount is shown before you confirm.</li>
        <li>If both parties agree in the conversation to move the event because of weather, a venue closure, or an emergency, the payment carries over to the new date.</li>
      </ul>
      <h2>Problems at the event</h2>
      <p>If the instructor does not show up or there is a material problem, the organizer can choose Report a problem in the conversation within {problemReportWindowLabel} after the scheduled end of the event. The instructor payout pauses while Hire Line Dancers reviews the conversation and information from both parties. We aim to decide within 10 business days. We may release the payout, refund part of the instructor price, or refund the full amount including the service fee.</p>
      <h2>How refunds are issued</h2>
      <p>Refunds go back to the original payment method through Stripe. Card refunds usually appear within 5 to 10 business days. Bank refunds can take a few days longer. Every refund is recorded in the booking conversation.</p>
    </section>
  );
}
