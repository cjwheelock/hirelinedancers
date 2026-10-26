import Link from "next/link";
import { ArrowRight, Award, Banknote, ClipboardCheck, FileSignature, ShieldCheck, Sparkles, Users } from "lucide-react";
import {
  bookingExample,
  foundingInstructorDeadline,
  instructorFeePercent,
  payoutDelayLabel,
  problemReportWindowLabel
} from "@/lib/commercialTerms";
import { signInUrl } from "@/lib/marketplace";

export const metadata = {
  title: "List Your Services as a Line Dance Instructor",
  description: "Join Hire Line Dancers free and become a founding instructor. Get discovered by people planning weddings, corporate events, and private parties, send quotes, and get paid through the platform."
};

const example = bookingExample(40000);

export default function JoinPage() {
  return (
    <section className="page-shell">
      <h1>Get booked by people planning events in your city.</h1>
      <p className="lede">Hire Line Dancers helps event planners, couples, and companies find instructors who can get their guests dancing. Joining is free. Build a profile, reply to inquiries, send a quote, and get paid after the event.</p>

      <div className="hero-actions" style={{ marginTop: 28 }}>
        <Link className="button primary" href={signInUrl("/account/", "instructor")}>Apply to get listed free <ArrowRight size={18} /></Link>
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
            <p>Planners anywhere in the US can search for instructors in their city and find you.</p>
          </article>
          <article className="benefit-card">
            <div className="benefit-icon"><FileSignature size={24} /></div>
            <h3>Quotes clients can sign and pay</h3>
            <p>Send a booking agreement with your own rate, minimum, and cancellation policy. The client signs and pays in full in one step.</p>
          </article>
          <article className="benefit-card">
            <div className="benefit-icon"><Banknote size={24} /></div>
            <h3>Guaranteed payment</h3>
            <p>Clients pay before the event. We hold the money and send your share to your bank account {payoutDelayLabel} after the event.</p>
          </article>
        </div>
      </div>

      <div className="faq-block">
        <h2>How it works</h2>
        <div className="step-grid">
          <article className="step">
            <div className="step-num"><ClipboardCheck size={20} /></div>
            <h3>1. Build your profile</h3>
            <p>Add your background, service area, and a headshot, plus photos or videos of you teaching or dancing. We personally review every profile.</p>
          </article>
          <article className="step">
            <div className="step-num"><Banknote size={20} /></div>
            <h3>2. Set up payouts</h3>
            <p>Connect your bank account through Stripe in about 5 minutes. Stripe verifies your identity and handles tax forms. We never see your bank details.</p>
          </article>
          <article className="step">
            <div className="step-num"><FileSignature size={20} /></div>
            <h3>3. Quote, get paid, get dancing</h3>
            <p>Reply to inquiries, send a signed quote, and the client signs and pays. Every step shows up in your conversation so you always know what happens next.</p>
          </article>
        </div>
      </div>

      <div className="faq-block">
        <h2>Pricing</h2>
        <div className="pricing-grid">
          <article className="price-card featured">
            <span className="founding-badge"><Award size={15} aria-hidden="true" /> Founding instructor</span>
            <h2>Free to join</h2>
            <ul className="check-list">
              <li>No monthly fee. You pay nothing until you get paid.</li>
              <li>Hire Line Dancers keeps a {instructorFeePercent} platform fee from each booking paid through the platform.</li>
              <li>Example: on a {example.price} booking, you receive {example.payout}.</li>
              <li>You set your rate, minimum hours, and cancellation policy on every quote.</li>
              <li>Your payout is sent {payoutDelayLabel} after the event unless the client reports a problem within {problemReportWindowLabel}.</li>
              <li>If you need insurance, you can attach your own certificate or note that you handle insurance outside the agreement.</li>
              <li>Join by {foundingInstructorDeadline} to become a founding instructor and keep a Founding Instructor badge on your profile.</li>
            </ul>
            <p>See the <Link href="/legal/terms/">Terms of Service</Link> and <Link href="/legal/refund-policy/">booking cancellation and refund policy</Link>.</p>
            <Link className="button primary" href={signInUrl("/account/", "instructor")}>Apply for a profile</Link>
          </article>
        </div>
        <p style={{ marginTop: 16 }}><ShieldCheck size={16} aria-hidden="true" /> Book and get paid through Hire Line Dancers to keep payment protection, guaranteed payouts, and support if something goes wrong.</p>
      </div>
    </section>
  );
}
