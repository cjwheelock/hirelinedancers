import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Music4,
  PartyPopper,
  Smile,
  Sparkles,
  Star,
  Users,
  Footprints,
  Heart,
  MapPin
} from "lucide-react";
import { InstructorCard } from "@/components/InstructorCard";
import { SearchPanel } from "@/components/SearchPanel";
import { eventTypes, instructors, site, topCities } from "@/data/site";

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Hire a line dance instructor for events",
    provider: { "@type": "Organization", name: site.name, url: site.url },
    areaServed: "United States",
    serviceType: "Line dance instructor for weddings, corporate events, and private parties"
  };

  const featured = instructors.filter((i) => i.featured).slice(0, 3);

  const benefits = [
    {
      icon: <Users size={26} />,
      title: "A shared activity",
      body: "An instructor gives guests a clear, welcoming way to join in together, whether they dance often or are trying it for the first time."
    },
    {
      icon: <Smile size={26} />,
      title: "Built for beginners",
      body: "Step-by-step teaching helps first-time dancers follow along without needing a partner or any previous dance experience."
    },
    {
      icon: <Sparkles size={26} />,
      title: "A memorable moment",
      body: "Learning and moving together creates a natural moment for connection, laughter, photos, and stories guests can share afterward."
    },
    {
      icon: <PartyPopper size={26} />,
      title: "Flexible for your event",
      body: "Work directly with your instructor on timing, music, group size, sound requirements, and a lesson format that fits the room."
    }
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* HERO */}
      <section className="hero">
        <div className="hero-media">
          <Image
            className="hero-image"
            src="/images/line-dance-event-hero.png"
            alt="A line dance instructor leading a happy crowd of guests on the dance floor"
            fill
            priority
            sizes="100vw"
          />
        </div>
        <div className="hero-content">
          <h1>Live entertainment that gets the whole room moving.</h1>
          <p className="lede">Hire a line dance instructor for your wedding, party, or company event. Give guests a beginner-friendly way to learn, move, and have fun together.</p>
          <div className="hero-actions">
            <Link className="button primary" href="#find">Find an instructor near you <ArrowRight size={18} /></Link>
            <Link className="button ghost-light" href="#how-it-works">See how it works</Link>
          </div>
          <div className="hero-badges">
            <span><CheckCircle2 size={17} /> No experience needed</span>
            <span><Footprints size={17} /> No partner required</span>
            <span><Heart size={17} /> All ages welcome</span>
          </div>
        </div>
      </section>

      {/* TRUST BAR */}
      <section className="band trust-bar">
        <div className="band-inner">
          <span><CheckCircle2 size={18} /> Beginner-friendly instruction</span>
          <span><Music4 size={18} /> Music selected for your crowd</span>
          <span><Users size={18} /> Adaptable to different group sizes</span>
          <span><Star size={18} /> From private parties to company events</span>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="section">
        <div className="section-heading">
          <h2>Why planners book a line dance instructor</h2>
        </div>
        <div className="benefit-grid">
          {benefits.map((b) => (
            <article key={b.title} className="benefit-card">
              <div className="benefit-icon">{b.icon}</div>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="section steps" id="how-it-works">
        <div className="section-heading">
          <h2>How it works</h2>
        </div>
        <div className="step-grid">
          <article className="step">
            <div className="step-num">1</div>
            <h3>Tell us about your event</h3>
            <p>Share your city, event type, and approximate group size so we can show you relevant profiles.</p>
          </article>
          <article className="step">
            <div className="step-num">2</div>
            <h3>Browse instructors near you</h3>
            <p>See instructor profiles with photos, services, and the kinds of events they specialize in.</p>
          </article>
          <article className="step">
            <div className="step-num">3</div>
            <h3>Send an event inquiry</h3>
            <p>Share the date and key details. The instructor can reply by email with availability, rates, and next steps.</p>
          </article>
        </div>
      </section>

      {/* SEARCH / MATCH */}
      <SearchPanel />

      {/* FEATURED INSTRUCTORS */}
      <section className="section">
        <div className="section-heading">
          <h2>Profile previews</h2>
        </div>
        <div className="card-grid">
          {featured.map((instructor) => (
            <InstructorCard key={instructor.slug} instructor={instructor} />
          ))}
        </div>
      </section>

      {/* EVENT TYPES */}
      <section className="section steps" id="events">
        <div className="section-heading">
          <h2>Perfect for every kind of celebration</h2>
        </div>
        <div className="link-grid">
          {eventTypes.map((event) => (
            <Link key={event.slug} href={`/events/${event.slug}/`}>
              <strong>{event.label}</strong>
              <span>{event.intro}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* SHARED EXPERIENCE */}
      <section className="band quote-band">
        <div className="band-inner">
          <div className="quote">
            <p>A guided lesson gives the room something joyful to do together, one approachable step at a time.</p>
            <span className="mission-attribution">Simple steps. Shared momentum.</span>
          </div>
        </div>
      </section>

      {/* LAUNCH CITIES */}
      <section className="section steps" id="cities">
        <div className="section-heading">
          <h2>Find line dance instructors and local planning guides.</h2>
        </div>
        <div className="link-grid">
          {topCities.map((top) => {
            return (
              <Link key={top.slug} href={`/cities/${top.slug}/`}>
                <strong>{top.city}, {top.state}</strong>
                <span>{top.blurb}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* MISSION */}
      <section className="band quote-band mission-band">
        <div className="band-inner">
          <div className="quote">
            <p>Our mission is simple: get more people dancing. That means more people moving to music, trying something new, and having fun together. It also means more great local instructors making a living doing what they love.</p>
            <span className="mission-attribution">Hire Line Dancers</span>
          </div>
        </div>
      </section>

      {/* INSTRUCTOR CTA STRIP */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="instructor-strip">
          <div>
            <strong>Are you a line dance instructor?</strong>
            <p>Get discovered by people planning events in your area.</p>
          </div>
          <Link className="button secondary" href="/instructors/join/">
            Apply to get listed <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="band cta-band">
        <div className="cta-inner">
          <h2>Ready to get everyone dancing?</h2>
          <p>Find a line dance instructor near you and create a welcoming shared activity your guests can remember.</p>
          <div className="hero-actions">
            <Link className="button secondary" href="#find"><MapPin size={18} /> Find an instructor near you</Link>
          </div>
        </div>
      </section>
    </>
  );
}
