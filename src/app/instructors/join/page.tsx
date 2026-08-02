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
        <div className="benefit-grid instructor-benefit-grid">
          <article className="benefit-card">
            <div className="benefit-icon"><Sparkles size={24} /></div>
            <h3>A polished public profile</h3>
            <p>Your headshot, teaching photos, bio, service area, and the events you specialize in, all presented to convert.</p>
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

      {/* HOW JOINING WORKS: approve-then-pay flow */}
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

      {/* PRICING: only shown here, gated from buyers */}
      <div className="faq-block">
        <h2>Founding membership</h2>
        <p className="lede">Pricing is shared here for instructors only. It never appears on the pages event planners browse.</p>
        <div className="pricing-grid">
          <article className="price-card featured">
            <BadgeCheck size={28} />
            <h2>Founding Instructor</h2>
            <p className="price">$99 <span>for your first year</span></p>
            <p>For our first 100 approved instructors only. Founding members get a <strong>Founding Instructor badge</strong> on their profile and a <strong>permanent ranking boost</strong>. We push founding profiles to the top of city and event searches. And it&rsquo;s no-risk: if you don&rsquo;t get a booking in your first 12 months, we refund every penny.</p>
            <Link className="button primary" href="/apply/">Claim a founding spot</Link>
          </article>
        </div>
        <p style={{ marginTop: 16 }}>Here&rsquo;s the math: instructors on our platform bill $200&ndash;$215 an hour with a two-hour minimum. Just one booking more than covers your $99. Fold it into your first gig and everything after that is upside.</p>
      </div>

      <div className="faq-block">
        <h2>Your profile, your rules</h2>
        <p>Your profile isn&rsquo;t just for line dancing. Teach country swing, two step, or West Coast swing? List it. Offer choreography, private lessons, or DJ services? Add them. You can edit and update your profile whenever you want: your rates, your services, your photos, your words. We don&rsquo;t limit what you offer; our job is to send planners your way.</p>
      </div>

      <div className="faq-block">
        <h2>Why we&rsquo;re building this</h2>
        <p>Our mission is simple: get more people dancing. We want more rooms full of people moving to music, trying something new, and having fun together. We also want more working instructors making a real living doing it. Founding members aren&rsquo;t just customers; you&rsquo;re helping get this off the ground, and our first goal for every founding instructor is the same: get you at least one booking, so the membership pays for itself and we grow from there together.</p>
      </div>

      <div className="policy-box">
        <h2>Our guarantee and an honest ask</h2>
        <p>If Hire Line Dancers doesn&rsquo;t help you get booked for a paid event in your first 12 months, we&rsquo;ll refund your $99. Full stop.</p>
        <p>The honest ask: give us time. We&rsquo;re building this alongside you by running Google ads, growing our search presence, and reaching out directly to event planners, wedding planners, and entertainment companies in your city so they know hiring a line dance instructor is even an option. Your founding membership funds that push. We have your best interests at heart, and we&rsquo;d rather earn your trust over months than overpromise on day one.</p>
        <p>Guarantee terms require a complete approved profile, current contact and service-area details, and reasonable inquiry response. See the <Link href="/legal/refund-policy/">full refund policy</Link>.</p>
      </div>
    </section>
  );
}
