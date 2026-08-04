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
      <p className="lede">Hire Line Dancers helps event planners, couples, and companies find instructors who can get their guests dancing. Build a profile, appear in relevant local searches, and receive event inquiries by email.</p>

      <div className="hero-actions" style={{ marginTop: 28 }}>
        <Link className="button primary" href="/apply/">Apply to get listed <ArrowRight size={18} /></Link>
      </div>

      <div className="faq-block">
        <h2>What you get</h2>
        <div className="benefit-grid instructor-benefit-grid">
          <article className="benefit-card">
            <div className="benefit-icon"><Sparkles size={24} /></div>
            <h3>A polished public profile</h3>
            <p>Your headshot, teaching photos, bio, service area, favorite song, and the events you specialize in, all in one place.</p>
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
            <p>Once approved, start your free month and add a payment method through Stripe. We publish your approved profile right away and send planner inquiries to you. Your first charge is 30 days later.</p>
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
            <p className="price">$0 <span>for your first 30 days</span></p>
            <p><strong>Then $14.99 per month.</strong> Add a payment method when you activate, and Stripe will not charge it until your free month ends. Cancel before your first charge if it is not right for you.</p>
            <p>For our first 100 approved instructors. Founding members receive a <strong>Founding Instructor badge</strong>, a complete public profile, and early placement while we build each local directory. Your first year is protected by our money-back guarantee.</p>
            <Link className="button primary" href="/apply/">Claim a founding spot</Link>
          </article>
        </div>
        <p style={{ marginTop: 16 }}>You set your rates and payment terms directly with each client. Hire Line Dancers does not take a commission or handle payment for your events.</p>
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
        <p>If Hire Line Dancers does not help you get booked for a paid event in your first 12 months, we will refund the membership fees you paid during that first year, subject to the published guarantee terms.</p>
        <p>The honest ask is time. We are building local awareness, improving search visibility, and introducing event professionals to line dancing as a participatory option. We would rather earn your trust through useful work than promise a specific number of inquiries or bookings.</p>
        <p>Guarantee terms require a complete approved profile, current contact and service-area details, and reasonable inquiry response. See the <Link href="/legal/refund-policy/">full refund policy</Link>.</p>
      </div>
    </section>
  );
}
