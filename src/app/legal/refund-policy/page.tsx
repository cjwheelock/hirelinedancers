import { site } from "@/data/site";

export const metadata = { title: "Instructor Membership Refund Policy" };

export default function RefundPolicyPage() {
  return (
    <section className="page-shell article-page">
      <h1>Instructor Membership Refund Policy</h1>
      <p>Last updated: August 7, 2026.</p>
      <p>This policy is offered by {site.legalName}, which operates Hire Line Dancers.</p>
      <h2>Private offer timing</h2>
      <p>The invitation-only free period applies to an eligible instructor who deliberately claims a personal private offer within 14 days after it is issued, then creates an account and submits a complete instructor profile within the following 7 days. Hire Line Dancers may complete its review after that submission deadline without affecting an offer that was claimed and submitted on time.</p>
      <p>After approval, the eligible instructor may activate a recurring $14.99 USD monthly membership with the first two monthly billing cycles free. A valid payment method is required at activation. Stripe displays the free period, first charge date, and recurring price before the instructor confirms the membership.</p>
      <h2>90-day booking guarantee</h2>
      <p>Every membership first activated on or after August 7, 2026 includes the 90-day booking guarantee. The guarantee begins on the date Stripe records the first invoice that collects a positive membership payment. For an eligible private-offer membership, that invoice comes after the first two monthly billing cycles. For a regular membership, it is the first invoice that collects a positive membership payment after activation.</p>
      <p>If Hire Line Dancers does not help an eligible instructor get booked for a qualifying paid event during those 90 days, the instructor may request a refund review for eligible membership payments collected during the guarantee period. The request must be submitted after the 90-day guarantee period ends and within the next 30 days.</p>
      <ul className="check-list">
        <li>The instructor must maintain a complete approved profile.</li>
        <li>Contact information, service area, and availability must remain current.</li>
        <li>The instructor should respond to buyer inquiries within 48 hours when reasonably possible.</li>
        <li>A booking means a paid event generated from a Hire Line Dancers inquiry.</li>
      </ul>
      <h2>How to request a review</h2>
      <p>After the guarantee period ends and before the 30-day request window closes, email <a href="mailto:hello@hirelinedancers.com">hello@hirelinedancers.com</a> from the address associated with your instructor account and include your profile name. A request does not create an automatic refund. Hire Line Dancers manually reviews the profile, inquiry response history, booking records, payments, and other eligibility details before approving or denying the request.</p>
      <p>If a request is approved, Hire Line Dancers issues the refund manually through Stripe and then verifies the completed refund in its records. Refunds are limited to eligible membership payments actually collected during the 90-day guarantee period. They do not cover the free period, discounts, zero-dollar invoices, external costs, travel, lost revenue, or payments between an instructor and an event organizer.</p>
      <p>Payments outside this published guarantee are nonrefundable except where required by law or expressly stated. A guarantee refund does not automatically cancel the paid membership. Instructors who want to stop future charges must cancel through the account billing portal or visit the <a href="/support/">support page</a> for help.</p>
      <h2>Legacy founding guarantees</h2>
      <p>An instructor who already qualified for a prior 12-month founding guarantee retains the terms granted at that time. This policy does not shorten, replace, or cancel an existing legacy guarantee.</p>
    </section>
  );
}
