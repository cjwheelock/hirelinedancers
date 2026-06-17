import Link from "next/link";
import { ArrowRight, BadgeCheck, ClipboardCheck, CreditCard, ShieldCheck, Sparkles, Users } from "lucide-react";

export const metadata = {
  title: "List Your Services as a Line Dance Instructor",
  description: "Get discovered by people planning weddings, corporate events, and private parties in your area. Apply to join Hire Line Dancers."
};

export default function JoinPage() {
  return (
    <section className="page-shell">
      <p className="eyebrow">For instructors</p>
      <h1>Get booked by people planning events in your city.</h1>
      <p className="lede">Hire Line Dancers connects you with event planners, couples, and companies actively looking to hire someone to get their guests dancing. Build a profile, show up in local searches, and receive inquiries directly.</p>

      <div className="hero-actions" style={{ marginTop: 28 }}>
        <Link className="button primary" href="/apply/">Apply to get listed <ArrowRight size={18} /></Link>
      </div>

      <div className="faq-block">
        <h2>What you get</h2>
        <div className="benefit-grid">
          <article className="benefit-card">
            <div className="benefit-icon"><Sparkles size={24} /></div>
            <h3>A polished public profile</h3>
            <p>Your headshot, teaching photos, bio, service area, and the events you specialize in &mdash; built to convert.</p>
          </article>
          <article className="benefit-card">
            <div className="benefit-icon"><Users size={24} /></div>
            <h3>Local search placement</h3>
            <p>Appear on your city and event pages so planners nearby find you first.</p>
          </article>
          <article className="benefit-card">
            <div className="benefit-icon"><BadgeCheck size={24} /></div>
            <h3>Direct inquiries</h3>
            <p>Event leads come straight to you. You set your rates and book on your terms.</p>
          </article>
        </div>
      </div>

      {/* HOW JOINING WORKS — approve-then-pay flow */}
      <div className="faq-block">
        <h2>How joining works</h2>
        <div className="step-grid">
          <article className="step">
            <div className="step-num"><ClipboardCheck size={20} /></div>
            <h3>1. Apply</h3>
            <p>Submit your background and upload a headshot plus a few photos of you teaching or dancing.</p>
          </article>
          <article className="step">
            <div className="step-num"><ShieldCheck size={20} /></div>
            <h3>2. Get reviewed</h3>
            <p>We personally review every application to keep quality high for planners. You&rsquo;ll hear back by email.</p>
          </article>
          <article className="step">
            <div className="step-num"><CreditCard size={20} /></div>
            <h3>3. Activate &amp; go live</h3>
            <p>Once approved, you&rsquo;ll get a secure payment link to activate your membership. Your profile publishes right away.</p>
          </article>
        </div>
      </div>

      {/* PRICING — only shown here, gated from buyers */}
      <div className="faq-block">
        <h2>Membership</h2>
        <p className="lede">Pricing is shared here for instructors only &mdash; it never appears on the pages event planners browse.</p>
        <div className="pricing-grid">
          <article className="price-card featured">
            <BadgeCheck size={28} />
            <h2>Founding Instructor</h2>
            <p className="price">$99 <span>first year</span></p>
            <p>For our first 100 approved instructors. Renews at $299/year after your first year. Includes the founding badge and booking guarantee.</p>
            <Link className="button primary" href="/apply/">Apply for a founding spot</Link>
          </article>
          <article className="price-card">
            <ShieldCheck size={28} />
            <h2>Standard Instructor</h2>
            <p className="price">$299 <span>per year</span></p>
            <p>Public profile, local search visibility, direct inquiries, media showcase, and city/category placement.</p>
            <Link className="button secondary" href="/apply/">Start your application</Link>
          </article>
        </div>
      </div>

      <div className="policy-box">
        <h2>Founding guarantee</h2>
        <p>Join as one of our first 100 instructors for $99 for your first year. If Hire Line Dancers does not help you get booked for a paid event in your first year, we will refund your membership fee.</p>
        <p>Guarantee terms require a complete approved profile, current contact and service-area details, reasonable inquiry response, and a refund request within 30 days after the first membership year ends.</p>
      </div>
    </section>
  );
}
