import Link from "next/link";
import { ArrowRight, BadgeCheck, ClipboardCheck, CreditCard, ShieldCheck, Sparkles, Users } from "lucide-react";
import {
  capitalizePolicyText,
  foundingOfferLabel,
  freePeriod,
  guaranteeCoverage,
  monthlyPriceWithCurrency,
  offerValue
} from "@/lib/commercialTerms";
import { signInUrl } from "@/lib/marketplace";

export const metadata = {
  title: "List Your Services as a Line Dance Instructor",
  description: "Get discovered by people planning weddings, corporate events, and private parties in your area. Apply to join Hire Line Dancers."
};

export default function JoinPage() {
  return (
    <section className="page-shell">
      <h1>Get booked by people planning events in your city.</h1>
      <p className="lede">Hire Line Dancers helps event planners, couples, and companies find instructors who can get their guests dancing. Build a profile, appear in relevant local searches, and receive and reply to event inquiries through your account.</p>

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
            <p>We personally review every profile. If approved, your membership starts automatically and we publish your profile.</p>
          </article>
        </div>
      </div>

      {/* PRICING: only shown here, gated from buyers */}
      <div className="faq-block">
        <h2>Instructor membership</h2>
        <div className="pricing-grid">
          <article className="price-card featured">
            <BadgeCheck size={28} />
            <h2>{capitalizePolicyText(freePeriod)} free</h2>
            <p className="price">{monthlyPriceWithCurrency} <span>per month after offer</span></p>
            <ul className="check-list">
              <li>The {foundingOfferLabel} who complete payment setup receive their first {freePeriod} free (a {offerValue} value).</li>
              <li>Stripe saves your card when you submit your profile, but no subscription starts and no charge is made before approval.</li>
              <li>If approved, your membership starts automatically.</li>
              <li>After the free period, it renews at {monthlyPriceWithCurrency} per month until canceled.</li>
              <li>The founding instructor offer is in addition to our ongoing {guaranteeCoverage} money-back guarantee.</li>
              <li>Your {guaranteeCoverage} guarantee begins when Stripe collects your first membership payment after the free period.</li>
            </ul>
            <p>See the <Link href="/legal/refund-policy/">full refund policy</Link>.</p>
            <Link className="button primary" href={signInUrl("/account/", "instructor")}>Apply for a profile</Link>
          </article>
        </div>
        <p style={{ marginTop: 16 }}>You set your rates and payment terms directly with each client. Hire Line Dancers does not take a commission or handle payment for your events.</p>
      </div>
    </section>
  );
}
