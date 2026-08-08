import Link from "next/link";
import { ArrowRight, BadgeCheck, ClipboardCheck, CreditCard, ShieldCheck, Sparkles, Users } from "lucide-react";
import { signInUrl } from "@/lib/marketplace";

export const metadata = {
  title: "List Your Services as a Line Dance Instructor",
  description: "Get discovered by people planning weddings, corporate events, and private parties in your area. Apply to join Hire Line Dancers."
};

export default function JoinPage() {
  return (
    <section className="page-shell">
      <h1>Get booked by people planning events in your city.</h1>
      <p className="lede">Hire Line Dancers helps event planners, couples, and companies find instructors who can get their guests dancing. Build a profile, appear in relevant local searches, and receive event inquiries by email.</p>

      <p className="founding-offer">
        <strong>Founding instructor offer:</strong> The first 100 instructors who complete payment setup get their first two months free (a $30 value), in addition to our ongoing <Link href="/legal/refund-policy/">90-day money-back guarantee</Link>.
      </p>

      <div className="hero-actions" style={{ marginTop: 28 }}>
        <Link className="button primary" href={signInUrl("/account/", "instructor")}>Apply to get listed <ArrowRight size={18} /></Link>
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

      {/* HOW JOINING WORKS: profile, payment setup, then review */}
      <div className="faq-block">
        <h2>How joining works</h2>
        <div className="step-grid">
          <article className="step">
            <div className="step-num"><ClipboardCheck size={20} /></div>
            <h3>1. Build your profile</h3>
            <p>Add your background, service area, and a headshot, plus photos or videos of you teaching or dancing.</p>
          </article>
          <article className="step">
            <div className="step-num"><CreditCard size={20} /></div>
            <h3>2. Save your payment method</h3>
            <p>Continue to Stripe to save a card securely. We do not start a subscription or charge your card before your profile is approved.</p>
          </article>
          <article className="step">
            <div className="step-num"><ShieldCheck size={20} /></div>
            <h3>3. Get reviewed and go live</h3>
            <p>We personally review every profile. If approved, your membership starts automatically and we publish your profile. The first 100 instructors who complete payment setup receive their first two months free.</p>
          </article>
        </div>
      </div>

      {/* PRICING: only shown here, gated from buyers */}
      <div className="faq-block">
        <h2>Instructor membership</h2>
        <p className="lede">Pricing is shared here for instructors only. It never appears on the pages event planners browse.</p>
        <div className="pricing-grid">
          <article className="price-card featured">
            <BadgeCheck size={28} />
            <h2>Two months free</h2>
            <p className="price">$14.99 USD <span>per month after offer</span></p>
            <p>The first 100 instructors who complete payment setup receive their first two months free (a $30 value). Stripe saves your card when you submit your profile, but no subscription starts and no charge is made before approval. If approved, your membership starts automatically. After the two free months, it renews at $14.99 USD per month until canceled.</p>
            <p>The founding instructor offer is in addition to our ongoing 90-day money-back guarantee. Your 90-day guarantee begins when Stripe collects your first membership payment after the free period.</p>
            <Link className="button primary" href={signInUrl("/account/", "instructor")}>Apply for a profile</Link>
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
        <p>Our mission is simple: get more people dancing. We want more rooms full of people moving to music, trying something new, and having fun together. We also want more working instructors making a real living doing it. Our first goal for every instructor is the same: help you earn at least one booking, so the membership pays for itself and we grow from there together.</p>
      </div>

      <div className="policy-box">
        <h2>Our 90-day money-back guarantee</h2>
        <p>Every new paid membership includes our ongoing 90-day money-back guarantee. The guarantee begins when Stripe collects your first membership payment. For instructors who receive the founding offer, that happens after the two free months. If Hire Line Dancers does not help you get booked for a qualifying paid event during those 90 days, you may request a review for a refund of eligible membership fees paid during the guarantee period.</p>
        <p>The honest ask is time. We are building local awareness, improving search visibility, and introducing event professionals to line dancing as a participatory option. We would rather earn your trust through useful work than promise a specific number of inquiries or bookings.</p>
        <p>You may request a guarantee review only after the 90-day period ends and within the next 30 days. Requests are reviewed manually. Approval and refunds are not automatic. Terms require a complete approved profile, current contact and service-area details, and reasonable inquiry response. See the <Link href="/legal/refund-policy/">full refund policy</Link>.</p>
      </div>
    </section>
  );
}
