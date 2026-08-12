import { site } from "@/data/site";
import {
  foundingOfferLabel,
  freeBillingCycles,
  freePeriod,
  guaranteeClaimWindow,
  guaranteeCoverage,
  guaranteeCoverageDays,
  monthlyPriceWithCurrency
} from "@/lib/commercialTerms";

export const metadata = { title: "Instructor Membership Refund Policy" };

export default function RefundPolicyPage() {
  return (
    <section className="page-shell article-page">
      <h1>Instructor Membership Refund Policy</h1>
      <p>Last updated: August 8, 2026.</p>
      <p>This policy is offered by {site.legalName}, which operates Hire Line Dancers.</p>
      <h2>Founding instructor offer timing</h2>
      <p>The {foundingOfferLabel} who complete payment setup are eligible for {freeBillingCycles} if their profiles are approved. Stripe saves a valid payment method during profile submission, but no subscription begins and no charge is made before approval. If approved, the membership starts automatically. After the free period, it renews at {monthlyPriceWithCurrency} per month until canceled.</p>
      <h2>{guaranteeCoverage} booking guarantee</h2>
      <p>Every membership first activated on or after August 7, 2026 includes the {guaranteeCoverage} booking guarantee. The guarantee begins on the date Stripe records the first invoice that collects a positive membership payment. For a membership with {freePeriod} free, that invoice comes after the free period. For a membership without a free period, it is the first positive paid invoice after activation.</p>
      <p>If Hire Line Dancers does not help an eligible instructor get booked for a qualifying paid event during those {guaranteeCoverageDays}, the instructor may request a refund review for eligible membership payments collected during the guarantee period. The request must be submitted after the {guaranteeCoverage} guarantee period ends and within the next {guaranteeClaimWindow}.</p>
      <ul className="check-list">
        <li>The instructor must maintain a complete approved profile.</li>
        <li>Contact information, service area, and availability must remain current.</li>
        <li>The instructor should respond to buyer inquiries within 48 hours when reasonably possible.</li>
        <li>A booking means a paid event generated from a Hire Line Dancers inquiry.</li>
      </ul>
      <h2>How to request a review</h2>
      <p>After the guarantee period ends and before the {guaranteeClaimWindow} request window closes, email <a href="mailto:hello@hirelinedancers.com">hello@hirelinedancers.com</a> from the address associated with your instructor account and include your profile name. A request does not create an automatic refund. Hire Line Dancers manually reviews the profile, inquiry response history, booking records, payments, and other eligibility details before approving or denying the request.</p>
      <p>If a request is approved, Hire Line Dancers issues the refund manually through Stripe and then verifies the completed refund in its records. Refunds are limited to eligible membership payments actually collected during the {guaranteeCoverage} guarantee period. They do not cover the free period, discounts, zero-dollar invoices, external costs, travel, lost revenue, or payments between an instructor and an event organizer.</p>
      <p>Payments outside this published guarantee are nonrefundable except where required by law or expressly stated. A guarantee refund does not automatically cancel the paid membership. Instructors who want to stop future charges must cancel through the account billing portal or visit the <a href="/support/">support page</a> for help.</p>
      <h2>Legacy founding guarantees</h2>
      <p>An instructor who already qualified for a prior 12-month founding guarantee retains the terms granted at that time. This policy does not shorten, replace, or cancel an existing legacy guarantee.</p>
    </section>
  );
}
