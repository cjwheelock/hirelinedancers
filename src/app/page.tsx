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
import { cities, eventTypes, instructors, site } from "@/data/site";

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
      title: "Everyone joins in",
      body: "One instructor turns a room of bystanders into a packed dance floor in minutes — guests of every age, all at once."
    },
    {
      icon: <Smile size={26} />,
      title: "No rhythm required",
      body: "No experience needed and no awkwardness. Steps are taught slowly and simply, so even the shyest guest is laughing and moving."
    },
    {
      icon: <Sparkles size={26} />,
      title: "The peak of the night",
      body: "It’s the part everyone talks about afterward — and the moment your photographer can’t stop shooting."
    },
    {
      icon: <PartyPopper size={26} />,
      title: "Completely turnkey",
      body: "Your instructor brings the know-how, the energy, and the song picks. You just tell them the vibe and show up."
    }
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* HERO */}
      <section className="hero">
        <Image src="/images/line-dance-event-hero.png" alt="A line dance instructor leading a happy crowd of guests on the dance floor" fill priority />
        <div className="hero-overlay" />
        <div className="hero-content">
          <p className="eyebrow">Live entertainment that gets the whole room moving</p>
          <h1>Get every guest on their feet.</h1>
          <p className="lede">Hire a line dance instructor for your wedding, party, or company event &mdash; the easiest, most joyful way to get everyone dancing together. No experience, no rhythm, any shoes.</p>
          <div className="hero-actions">
            <Link className="button primary" href="#find">Find an instructor near you <ArrowRight size={18} /></Link>
            <Link className="button ghost-light" href="#how-it-works">See how it works</Link>
          </div>
          <div className="hero-badges">
            <span><CheckCircle2 size={17} /> No experience needed</span>
            <span><Footprints size={17} /> Any shoes, any outfit</span>
            <span><Heart size={17} /> All ages welcome</span>
          </div>
        </div>
      </section>

      {/* TRUST BAR */}
      <section className="band trust-bar">
        <div className="band-inner">
          <span><CheckCircle2 size={18} /> Vetted local instructors</span>
          <span><Music4 size={18} /> They bring the music &amp; the energy</span>
          <span><Users size={18} /> Great for 10 to 500+ guests</span>
          <span><Star size={18} /> From backyard parties to galas</span>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="section">
        <div className="section-heading">
          <p className="eyebrow">Why planners book a line dance instructor</p>
          <h2>The surest way to a packed, happy dance floor.</h2>
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
          <p className="eyebrow">How it works</p>
          <h2>Booked in three easy steps.</h2>
        </div>
        <div className="step-grid">
          <article className="step">
            <div className="step-num">1</div>
            <h3>Tell us about your event</h3>
            <p>Your city, the type of event, and roughly how many guests. Takes about ten seconds.</p>
          </article>
          <article className="step">
            <div className="step-num">2</div>
            <h3>Browse instructors near you</h3>
            <p>See vetted local instructors with reviews, photos, and the events they specialize in.</p>
          </article>
          <article className="step">
            <div className="step-num">3</div>
            <h3>Reach out and book</h3>
            <p>Message your favorite directly to check availability and lock in the date. That&rsquo;s it.</p>
          </article>
        </div>
      </section>

      {/* SEARCH / MATCH */}
      <SearchPanel />

      {/* FEATURED INSTRUCTORS */}
      <section className="section">
        <div className="section-heading">
          <p className="eyebrow">Meet a few instructors</p>
          <h2>Friendly pros who know how to read a room.</h2>
        </div>
        <div className="card-grid">
          {featured.map((instructor) => (
            <InstructorCard key={instructor.slug} instructor={instructor} />
          ))}
        </div>
      </section>

      {/* EVENT TYPES */}
      <section className="section steps">
        <div className="section-heading">
          <p className="eyebrow">Perfect for every kind of celebration</p>
          <h2>One instructor. A whole room moving together.</h2>
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

      {/* TESTIMONIAL */}
      <section className="band quote-band">
        <div className="band-inner">
          <blockquote className="quote">
            <span className="quote-mark" aria-hidden="true">&ldquo;</span>
            <p>Within five minutes our entire reception was on the floor &mdash; grandparents, kids, everyone. It was the moment our guests kept talking about.</p>
            <cite>&mdash; Event planner, 180-guest wedding</cite>
          </blockquote>
        </div>
      </section>

      {/* CITIES */}
      <section className="section">
        <div className="section-heading">
          <p className="eyebrow">Find instructors near you</p>
          <h2>Available in cities across the country.</h2>
        </div>
        <div className="city-cloud">
          {cities.map((city) => (
            <Link key={city.slug} href={`/cities/${city.slug}/`}>{city.city}, {city.state}</Link>
          ))}
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
          <p>Find a vetted line dance instructor near you and turn your next event into the one people remember.</p>
          <div className="hero-actions">
            <Link className="button secondary" href="#find"><MapPin size={18} /> Find an instructor near you</Link>
          </div>
        </div>
      </section>
    </>
  );
}
