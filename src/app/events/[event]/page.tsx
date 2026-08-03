import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicInstructorResults } from "@/components/SearchPanel";
import { cities, eventTypes, site } from "@/data/site";

export function generateStaticParams() {
  return eventTypes.map((event) => ({ event: event.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ event: string }> }): Promise<Metadata> {
  const { event: eventSlug } = await params;
  const event = eventTypes.find((item) => item.slug === eventSlug);
  if (!event) return {};
  return {
    title: event.title,
    description: event.intro,
    alternates: { canonical: `/events/${event.slug}/` },
    openGraph: {
      title: event.title,
      description: event.intro,
      url: `${site.url}/events/${event.slug}/`,
      images: ["/images/line-dance-event-hero.png"]
    }
  };
}

export default async function EventPage({ params }: { params: Promise<{ event: string }> }) {
  const { event: eventSlug } = await params;
  const event = eventTypes.find((item) => item.slug === eventSlug);
  if (!event) notFound();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: event.title,
    provider: { "@type": "Organization", name: site.name, url: site.url },
    areaServed: "United States",
    description: event.intro
  };

  return (
    <section className="page-shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="eyebrow">Event service page</p>
      <h1>{event.title}</h1>
      <p className="lede">{event.intro}</p>
      <div className="faq-block">
        <h2>What to expect</h2>
        <ul className="check-list">
          <li>Simple dances taught step by step for beginners.</li>
          <li>Flexible formats for cocktail hour, reception resets, team activities, or public venue programming.</li>
          <li>Instructor profiles with service area, group size experience, media, and event inquiry forms.</li>
        </ul>
      </div>
      <div className="card-grid">
        <PublicInstructorResults
          eventSlug={event.slug}
          emptyTitle={`No published ${event.label.toLowerCase()} profiles yet`}
          emptyBody="Try another event type, or check back as new instructors are approved."
        />
      </div>
      <div className="faq-block">
        <h2>Our 11 launch markets</h2>
        <div className="city-cloud">
          {cities.map((city) => (
            <Link key={city.slug} href={`/cities/${city.slug}/`}>{city.city}, {city.state}</Link>
          ))}
        </div>
      </div>
    </section>
  );
}
