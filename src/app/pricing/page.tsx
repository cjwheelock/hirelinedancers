import Link from "next/link";
import { BadgeCheck, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Instructor Pricing and Founding Guarantee",
  description: "Join HireALineDancer.com as a founding instructor for $99 for the first year, then $299/year."
};

export default function PricingPage() {
  return (
    <section className="page-shell">
      <p className="eyebrow">Instructor pricing</p>
      <h1>First 100 approved instructors: $99 for the first year.</h1>
      <p className="lede">Founding members get a public profile, city and category placement, lead form, media showcase, founding badge, and booking refund guarantee.</p>
      <div className="pricing-grid">
        <article className="price-card featured">
          <BadgeCheck size={28} />
          <h2>Founding Instructor</h2>
          <p className="price">$99 <span>first year</span></p>
          <p>Renews at $299/year after the first membership year.</p>
          <Link className="button primary" href="/apply/">Apply for founding spot</Link>
        </article>
        <article className="price-card">
          <ShieldCheck size={28} />
          <h2>Standard Instructor</h2>
          <p className="price">$299 <span>per year</span></p>
          <p>Public profile, local search visibility, lead form, media showcase, and city/category placement.</p>
          <Link className="button secondary" href="/apply/">Start application</Link>
        </article>
      </div>
      <div className="policy-box">
        <h2>Founding guarantee</h2>
        <p>Join as one of our first 100 instructors for $99 for your first year. If HireALineDancer.com does not help you get booked for a paid event in your first year, we will refund your membership fee.</p>
        <p>Guarantee terms require a complete approved profile, current contact and service area details, reasonable inquiry response, and a refund request within 30 days after the first membership year ends.</p>
      </div>
    </section>
  );
}
