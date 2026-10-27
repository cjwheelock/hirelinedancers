import Link from "next/link";
import { ArrowRight, Banknote, ClipboardCheck, FileSignature, Sparkles, Users } from "lucide-react";
import { signInUrl } from "@/lib/marketplace";

export const metadata = {
  title: "List Your Services as a Line Dance Instructor",
  description: "Join Hire Line Dancers and become a founding instructor. Get discovered by people planning weddings, corporate events, and private parties, send quotes, and get paid through the platform."
};

export default function JoinPage() {
  return (
    <section className="page-shell">
      <h1>Get booked by people planning events in your city.</h1>
      <p className="lede">Hire Line Dancers helps event planners, couples, and companies find instructors who can get their guests dancing. Build a profile, reply to inquiries, send a quote, and get paid after the event.</p>

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
            <p>Planners anywhere in the US can search for instructors in their city and find you.</p>
          </article>
          <article className="benefit-card">
            <div className="benefit-icon"><FileSignature size={24} /></div>
            <h3>Quotes clients can sign and pay</h3>
            <p>Send a booking agreement with your own rate, minimum, and cancellation policy. The client signs and pays in full in one step.</p>
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

      <div className="hero-actions">
        <Link className="button primary" href={signInUrl("/account/", "instructor")}>Apply for a profile</Link>
      </div>

    </section>
  );
}
