import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/data/site";

export const metadata: Metadata = {
  title: "Support",
  description: "Get account, billing, cancellation, and refund support for Hire Line Dancers."
};

export default function SupportPage() {
  return (
    <section className="page-shell article-page">
      <h1>Support</h1>
      <p>Hire Line Dancers is operated by {site.legalName}.</p>
      <p>For account, billing, cancellation, refund, or general service questions, email <a href={`mailto:${site.email}`}>{site.email}</a>.</p>
      <p>Include the email address associated with your account and a short description of the issue. Do not email card numbers, bank information, passwords, or identity documents.</p>
      <h2>Bookings and payments</h2>
      <p>Instructors send quotes from the conversation, and organizers sign and pay through Hire Line Dancers. Every step, including payment, cancellation, refunds, and payouts, is recorded in the conversation. To cancel a booking or report a problem, open the conversation and use the booking panel at the top.</p>
      <h2>Refund questions</h2>
      <p>Review the <Link href="/legal/refund-policy/">Cancellation and Refund Policy</Link>. If something is not resolved in the conversation, email <a href={`mailto:${site.email}`}>{site.email}</a> with the booking date and the other party&rsquo;s name.</p>
      <h2>Instructor payouts</h2>
      <p>Sign in to your instructor account and open <strong>Payouts</strong> to finish Stripe setup or view your payouts and bank details.</p>
      <h2>Legacy memberships</h2>
      <p>Instructors with a membership started before October 26, 2026 can sign in and select <strong>Manage membership</strong> to open the secure Stripe billing portal. Cancellation takes effect at the end of the current billing period unless applicable law requires otherwise.</p>
    </section>
  );
}
