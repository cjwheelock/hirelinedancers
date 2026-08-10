import { site } from "@/data/site";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <section className="page-shell article-page">
      <h1>Terms of Service</h1>
      <p>Last updated: August 10, 2026.</p>
      <p>These Terms are between you and {site.legalName}, which operates the Hire Line Dancers service.</p>
      <h2>Marketplace role</h2>
      <p>Hire Line Dancers is a directory and lead-generation service. Instructors are independent providers, not employees or agents of Hire Line Dancers.</p>
      <p>Event organizers and instructors communicate and contract directly. They are responsible for confirming rates, availability, insurance, travel fees, safety requirements, contracts, deposits, refunds, payment terms, and event details. Hire Line Dancers does not process or guarantee payments between organizers and instructors.</p>
      <h2>Accounts and inquiries</h2>
      <p>You must provide accurate information, protect access to your account, and use the service only for legitimate event or teaching needs. Organizers may browse without an account but must sign in before sending an inquiry. An inquiry is not a booking and does not require an instructor to accept an event.</p>
      <p>Instructors should make reasonable efforts to respond to inquiries within the response window shown on their profile, including when they are unavailable. Hire Line Dancers does not guarantee a particular number of inquiries or bookings.</p>
      <h2>Instructor membership</h2>
      <p>Instructors submit a complete profile and save a valid payment method through Stripe before administrative review. Saving a payment method does not start a subscription or authorize a charge before approval. If the profile is approved, the instructor membership starts automatically. Unless canceled, the membership renews at $14.99 USD per month after any applicable free period. Billing is processed by Stripe, and any applicable taxes may be added.</p>
      <p>The first 100 instructors who complete payment setup are eligible for the founding instructor offer. If an eligible profile is approved, its first two monthly billing cycles are free. The membership then renews at $14.99 USD per month until canceled. Hire Line Dancers displays the payment terms before redirecting to Stripe and records offer eligibility before activation.</p>
      <p>If a profile is not approved, no membership begins and Hire Line Dancers does not charge the saved payment method. Hire Line Dancers may ask the instructor to revise and resubmit the profile.</p>
      <p>If a membership has not completed any positive payment and a charge fails, the profile is not published or is removed immediately, and no grace period applies. After an instructor has completed at least one successful positive membership payment, a later failed recurring payment receives a 14-day grace period beginning when the payment first fails. The profile may remain public during that grace period. If the overdue payment is not resolved before the deadline, the profile is removed from the public directory until payment succeeds. Hire Line Dancers may send transactional emails with a secure link for updating the payment method.</p>
      <p>You may cancel through your account. Cancellation takes effect at the end of the current billing period unless the law requires otherwise.</p>
      <p>Every membership first activated on or after August 7, 2026 includes a request-based 90-day booking guarantee. The guarantee begins when Stripe records the first invoice that collects a positive membership payment. For a membership with two free months, that invoice comes after the free period. For a membership without a free period, it is the first positive paid invoice after activation. A guarantee request may be submitted only after the 90-day period ends and within the next 30 days. Requests are reviewed manually, and any approved refund is issued manually before Hire Line Dancers verifies it in its records. The separate <a href="/legal/refund-policy/">refund policy</a> governs eligibility and refund scope. Other payments are nonrefundable except where required by law or expressly stated.</p>
      <p>An instructor who already qualified for a prior 12-month founding guarantee retains the terms granted at that time. The current offer does not shorten, replace, or cancel an existing legacy guarantee.</p>
      <h2>Profile content</h2>
      <p>Instructor-submitted content may be displayed on profiles, city pages, event pages, and marketing surfaces for the purpose of operating and promoting the directory.</p>
      <p>You represent that you have permission to upload and publish your profile information, photos, videos, music links, and other content. You grant Hire Line Dancers a nonexclusive license to host, display, format, and promote that content in connection with the service. You may request removal of your profile content, subject to reasonable backup and record-retention periods.</p>
      <h2>Acceptable use</h2>
      <p>Do not submit spam, false inquiries, illegal content, malicious files, impersonation, harassment, or material that infringes another person&rsquo;s rights. We may restrict or remove accounts, profiles, or content that create safety, legal, fraud, or trust concerns.</p>
      <h2>Support</h2>
      <p>For account, billing, cancellation, or other support, visit the <a href="/support/">support page</a> or email <a href="mailto:hello@hirelinedancers.com">hello@hirelinedancers.com</a>. Report content, review, spam, abuse, or DMCA concerns to the same address.</p>
    </section>
  );
}
