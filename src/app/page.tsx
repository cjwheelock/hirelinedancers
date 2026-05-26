import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeDollarSign, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import { InstructorCard } from "@/components/InstructorCard";
import { SearchPanel } from "@/components/SearchPanel";
import { cities, eventTypes, instructors, site } from "@/data/site";

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Hire line dance instructors for events",
    provider: { "@type": "Organization", name: site.name, url: site.url },
    areaServed: "United States",
    serviceType: "Line dance instructor directory"
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="hero">
        <Image src="/images/line-dance-event-hero.png" alt="Line dance instructor leading event guests on a dance floor" fill priority />
        <div className="hero-overlay" />
        <div className="hero-content">
          <p className="eyebrow">Line dance instructors for events</p>
          <h1>Hire a line dance instructor who gets the whole room moving.</h1>
          <p>Find local instructors for weddings, corporate events, bachelorette parties, private parties, venues, schools, and community events.</p>
          <div className="hero-actions">
            <Link className="button primary" href="#search">Search instructors <ArrowRight size={18} /></Link>
            <Link className="button secondary" href="/apply/">List your services</Link>
          </div>
        </div>
      </section>

      <section className="proof-strip">
        <span><Sparkles size={18} /> Beginner-friendly group entertainment</span>
        <span><MapPin size={18} /> 25 launch city targets</span>
        <span><ShieldCheck size={18} /> Manual instructor review</span>
        <span><BadgeDollarSign size={18} /> $99 founding offer</span>
      </section>

      <SearchPanel />

      <section className="section">
        <div className="section-heading">
          <p className="eyebrow">Featured instructors</p>
          <h2>Seed profiles built for discovery and conversion.</h2>
        </div>
        <div className="card-grid">
          {instructors.slice(0, 3).map((instructor) => (
            <InstructorCard key={instructor.slug} instructor={instructor} />
          ))}
        </div>
      </section>

      <section className="band">
        <div className="section-heading">
          <p className="eyebrow">Event use cases</p>
          <h2>One instructor. Dozens or hundreds of guests. Instant participation.</h2>
        </div>
        <div className="link-grid">
          {eventTypes.map((event) => (
            <Link key={event.slug} href={`/events/${event.slug}/`}>
              <strong>{event.title}</strong>
              <span>{event.intro}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <p className="eyebrow">Launch cities</p>
          <h2>Built for local SEO from day one.</h2>
        </div>
        <div className="city-cloud">
          {cities.map((city) => (
            <Link key={city.slug} href={`/cities/${city.slug}/`}>{city.city}, {city.state}</Link>
          ))}
        </div>
      </section>
    </>
  );
}
