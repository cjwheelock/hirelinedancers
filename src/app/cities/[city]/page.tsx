import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InstructorCard } from "@/components/InstructorCard";
import { cities, eventTypes, site } from "@/data/site";
import { findInstructors } from "@/lib/search";

export function generateStaticParams() {
  return cities.map((city) => ({ city: city.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: citySlug } = await params;
  const city = cities.find((item) => item.slug === citySlug);
  if (!city) return {};
  return {
    title: `Hire a Line Dance Instructor in ${city.city}, ${city.state}`,
    description: `Find line dance instructors for weddings, corporate events, private parties, venues, schools, and community events in ${city.city}, ${city.state}.`
  };
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: citySlug } = await params;
  const city = cities.find((item) => item.slug === citySlug);
  if (!city) notFound();
  const results = findInstructors(city.slug);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `Can I hire a line dance instructor in ${city.city}?`,
        acceptedAnswer: { "@type": "Answer", text: `Yes. Hire Line Dancers lists instructors serving ${city.city}, ${city.state} and nearby areas.` }
      },
      {
        "@type": "Question",
        name: "What events are line dance instructors good for?",
        acceptedAnswer: { "@type": "Answer", text: "Common fits include weddings, corporate events, bachelorette parties, venue nights, schools, and private parties." }
      }
    ]
  };

  return (
    <section className="page-shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="eyebrow">City directory</p>
      <h1>Hire a line dance instructor in {city.city}, {city.state}.</h1>
      <p className="lede">Find local instructors who can teach beginner-friendly group dances for event guests, coworkers, wedding parties, venue crowds, schools, and community groups.</p>
      <div className="card-grid">
        {results.length ? results.map((instructor) => (
          <InstructorCard key={instructor.slug} instructor={instructor} />
        )) : (
          <div className="policy-box">
            <h2>Instructor seeding in progress</h2>
            <p>We are reviewing instructors for {city.city}. Apply to be listed or submit an inquiry for manual routing.</p>
          </div>
        )}
      </div>
      <div className="faq-block">
        <h2>Popular event searches in {city.city}</h2>
        <div className="link-grid">
          {eventTypes.map((event) => (
            <Link key={event.slug} href={`/events/${event.slug}/`}>
              <strong>{event.title}</strong>
              <span>{event.searches.join(" · ")}</span>
            </Link>
          ))}
        </div>
      </div>
      <p className="form-note">Directory disclaimer: instructors are independent providers. Confirm rates, insurance, availability, travel fees, and event details directly before booking.</p>
    </section>
  );
}
