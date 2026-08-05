import { site } from "@/data/site";

export const metadata = { title: "Founding Instructor Refund Policy" };

export default function RefundPolicyPage() {
  return (
    <section className="page-shell article-page">
      <h1>Founding Instructor Refund Policy</h1>
      <p>Last updated: August 5, 2026.</p>
      <p>This policy is offered by {site.legalName}, which operates Hire Line Dancers.</p>
      <p>The founding guarantee applies to the first 100 approved instructors who activate and maintain an active $14.99 USD monthly membership. If Hire Line Dancers does not help an eligible instructor get booked for a paid event within the first 12 months after membership activation, the instructor may request a refund of the membership payments made during that first year.</p>
      <ul className="check-list">
        <li>The instructor must maintain a complete approved profile.</li>
        <li>Contact information, service area, and availability must remain current.</li>
        <li>The instructor should respond to buyer inquiries within 48 hours when reasonably possible.</li>
        <li>A booking means a paid event generated from a Hire Line Dancers inquiry.</li>
        <li>Refund requests must be submitted within 30 days after the 12-month guarantee period ends.</li>
      </ul>
      <p>To request a guarantee refund, email <a href="mailto:hello@hirelinedancers.com">hello@hirelinedancers.com</a> from the address associated with your instructor account and include your profile name. Refunds are limited to membership payments actually collected during the first 12 months after activation and do not cover discounts, zero-dollar invoices, external costs, travel, or lost revenue.</p>
      <p>Payments outside this published guarantee are nonrefundable except where required by law or expressly stated. A verified guarantee refund closes the founding guarantee and its related founding benefits. It does not automatically cancel the paid membership. Instructors who want to stop future charges must cancel through the account billing portal or visit the <a href="/support/">support page</a> for help.</p>
    </section>
  );
}
