import { site } from "@/data/site";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <section className="page-shell article-page">
      <h1>Terms of Service</h1>
      <p>Last updated: August 5, 2026.</p>
      <p>These Terms are between you and {site.legalName}, which operates the Hire Line Dancers service.</p>
      <h2>Marketplace role</h2>
      <p>Hire Line Dancers is a directory and lead-generation service. Instructors are independent providers, not employees or agents of Hire Line Dancers.</p>
      <p>Event organizers and instructors communicate and contract directly. They are responsible for confirming rates, availability, insurance, travel fees, safety requirements, contracts, deposits, refunds, payment terms, and event details. Hire Line Dancers does not process or guarantee payments between organizers and instructors.</p>
      <h2>Accounts and inquiries</h2>
      <p>You must provide accurate information, protect access to your account, and use the service only for legitimate event or teaching needs. Organizers may browse without an account but must sign in before sending an inquiry. An inquiry is not a booking and does not require an instructor to accept an event.</p>
      <p>Instructors should make reasonable efforts to respond to inquiries within the response window shown on their profile, including when they are unavailable. Hire Line Dancers does not guarantee a particular number of inquiries or bookings.</p>
      <h2>Instructor membership</h2>
      <p>Approved instructors may activate a membership for $14.99 USD per month. A valid payment method is required. Unless canceled, the membership renews automatically each month. Billing is processed by Stripe, and any applicable taxes may be added. The amount and any valid promotional adjustment shown at checkout control the initial charge.</p>
      <p>You may cancel through your account. Cancellation takes effect at the end of the current billing period unless the law requires otherwise.</p>
      <p>The first-year booking guarantee is governed by the separate <a href="/legal/refund-policy/">refund policy</a>. Other payments are nonrefundable except where required by law or expressly stated.</p>
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
