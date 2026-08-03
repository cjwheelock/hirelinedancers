import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, MapPin, Users } from "lucide-react";
import { SpotifyTrack } from "@/components/SpotifyTrack";
import { eventTypes, instructors, site } from "@/data/site";
import { profileJsonLd } from "@/lib/search";

export function generateStaticParams() {
  return instructors.map((instructor) => ({ slug: instructor.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const instructor = instructors.find((item) => item.slug === slug);
  if (!instructor) return {};
  const title = instructor.demoEverywhere
    ? `${instructor.name} | Fictional Demo Instructor Profile`
    : `${instructor.business} - ${instructor.city}, ${instructor.state} Line Dance Instructor`;
  return {
    title,
    description: instructor.bio,
    alternates: { canonical: `/instructors/${instructor.slug}/` },
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description: instructor.bio,
      url: `${site.url}/instructors/${instructor.slug}/`,
      images: [instructor.photo || "/images/line-dance-event-hero.png"]
    }
  };
}

export default async function InstructorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const instructor = instructors.find((item) => item.slug === slug);
  if (!instructor) notFound();
  const jsonLd = profileJsonLd(instructor.slug);
  const profileEvents = eventTypes.filter((event) => instructor.events.includes(event.slug));

  return (
    <section className="page-shell profile-page">
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
      <div className="profile-hero">
        <div className="avatar large" aria-hidden={instructor.photo ? undefined : "true"}>
          {instructor.photo ? (
            // Static preview media is exported with the site and does not need image optimization.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={instructor.photo} alt={`${instructor.name}, fictional demo line dance instructor`} />
          ) : (
            instructor.name.split(" ").map((word) => word[0]).join("")
          )}
        </div>
        <div>
          <p className="eyebrow">{instructor.demoEverywhere ? "Fictional demo profile" : "Illustrative profile preview"}</p>
          <h1>{instructor.name}</h1>
          <p className="card-sub">{instructor.business}</p>
          <p className="lede">{instructor.bio}</p>
          <div className="tag-row">
            {instructor.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </div>
      </div>
      <div className="profile-grid">
        <div>
          <div className="stat-grid">
            <span><MapPin size={18} /> {instructor.demoEverywhere ? "Shown in every launch market" : `${instructor.city}, ${instructor.state}`}</span>
            <span><Users size={18} /> Up to {instructor.groupSize} guests</span>
            <span><Clock size={18} /> {instructor.years} years teaching</span>
          </div>
          <div className="policy-box">
            <h2>Sample event format</h2>
            <ul className="check-list">
              {instructor.sampleFormat.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div className="policy-box">
            <h2>Services</h2>
            <div className="tag-row">
              {instructor.styles.map((style) => <span key={style}>{style}</span>)}
            </div>
            <h3>Available for</h3>
            <div className="tag-row">
              {profileEvents.map((event) => <span key={event.slug}>{event.label}</span>)}
            </div>
            <p>
              {instructor.demoEverywhere
                ? "Tessa is a fictional example. Her five sample event types demonstrate how real instructors can describe the work they want."
                : `${instructor.name} serves events within about ${instructor.travelRadius} miles of ${instructor.city}. Confirm availability, exact rates, travel fees, and insurance directly before booking.`}
            </p>
          </div>
          {instructor.favoriteSong && (
            <SpotifyTrack
              instructorName={instructor.name}
              song={instructor.favoriteSong.name}
              spotifyUrl={instructor.favoriteSong.spotifyUrl}
            />
          )}
        </div>
        <aside className="sticky-panel">
          <p className="eyebrow">{instructor.demoEverywhere ? "Demo only" : "Example profile"}</p>
          <h2>This is a preview of how instructor listings can look.</h2>
          <p>This is not a verified or bookable instructor listing. It cannot receive inquiries. Published profiles from approved instructors will appear in the live directory.</p>
          <Link className="button primary" href="/instructors/">Browse published instructors</Link>
          <Link className="button secondary" href="/instructors/join/">Create an instructor profile</Link>
        </aside>
      </div>
    </section>
  );
}
