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
      <h2>Manage or cancel a membership</h2>
      <p>Sign in to your instructor account and select <strong>Manage membership</strong> to open the secure Stripe billing portal. Cancellation takes effect at the end of the current billing period unless applicable law requires otherwise.</p>
      <h2>Refund questions</h2>
      <p>Review the <Link href="/legal/refund-policy/">Founding Instructor Refund Policy</Link> before submitting a request. Eligible requests can be sent to <a href={`mailto:${site.email}`}>{site.email}</a>.</p>
      <h2>Event inquiries</h2>
      <p>Hire Line Dancers is a directory and lead-generation service. Event organizers and instructors agree on event pricing, deposits, cancellations, and payments directly with each other.</p>
    </section>
  );
}
