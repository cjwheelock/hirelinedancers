import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock, MapPin, Users } from "lucide-react";
import { InstructorContactLink } from "@/components/InstructorContactLink";
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
    ? `${instructor.name} | ${instructor.city}, ${instructor.state} Line Dance Instructor`
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
  const firstName = instructor.name.trim().split(/\s+/)[0] || instructor.name;

  return (
    <section className="page-shell profile-page">
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
      <div className="profile-hero">
        <div className="avatar large" aria-hidden={instructor.photo ? undefined : "true"}>
          {instructor.photo ? (
            // Static preview media is exported with the site and does not need image optimization.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={instructor.photo} alt={`${instructor.name}, line dance instructor`} />
          ) : (
            instructor.name.split(" ").map((word) => word[0]).join("")
          )}
        </div>
        <div className="profile-hero-copy">
          <h1>{instructor.name}</h1>
          <p className="lede">{instructor.headline || instructor.bio}</p>
          <div className="tag-row">
            {instructor.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </div>
      </div>
      <div className="profile-grid">
        <div>
          <InstructorContactLink
            instructorIdentifier={instructor.slug}
            className="button primary profile-top-contact"
          >
            Contact {firstName}
          </InstructorContactLink>

          <div className="stat-grid">
            <span><MapPin size={18} /> {instructor.city}, {instructor.state}{instructor.demoEverywhere ? " · National travel available" : ""}</span>
            <span><Users size={18} /> Up to {instructor.groupSize} guests</span>
            <span><Clock size={18} /> {instructor.years} years teaching</span>
          </div>

          <div className="policy-box">
            <h2>About {firstName}</h2>
            <p>{instructor.bio}</p>
          </div>

          {instructor.profileDetails ? (
            <div className="policy-box">
              <h2>Teaching approach</h2>
              <p>{instructor.profileDetails.teachingApproach}</p>
            </div>
          ) : null}

          <div className="policy-box">
            <h2>{instructor.demoEverywhere ? "Sample 60-minute session" : "Sample event format"}</h2>
            <ul className="check-list">
              {instructor.sampleFormat.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>

          <div className="policy-box">
            <h2>Events and programs</h2>
            <div className="profile-specialty-grid">
              {profileEvents.map((event) => (
                <article key={event.slug}>
                  <h3>{event.label}</h3>
                  <p>{instructor.eventDescriptions?.[event.slug] || event.bookingHint}</p>
                </article>
              ))}
            </div>

            <h2>Dance styles and services</h2>
            <div className="tag-row">
              {instructor.styles.map((style) => <span key={style}>{style}</span>)}
            </div>
            <p>
              {instructor.profileDetails
                ? instructor.profileDetails.travelNote
                : `${instructor.name} serves events within about ${instructor.travelRadius} miles of ${instructor.city}. Confirm availability, exact rates, travel fees, and insurance directly before booking.`}
            </p>
          </div>

          {instructor.profileDetails ? (
            <>
              <div className="policy-box">
                <h2>Equipment and venue setup</h2>
                <div className="profile-detail-grid">
                  <div>
                    <h3>Equipment available</h3>
                    <ul className="check-list">
                      {instructor.profileDetails.equipment.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                  <div>
                    <h3>Venue needs</h3>
                    <ul className="check-list">
                      {instructor.profileDetails.venueNeeds.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="policy-box">
                <h2>Who I teach</h2>
                <div className="tag-row">
                  {instructor.profileDetails.ageGroups.map((group) => <span key={group}>{group}</span>)}
                  {instructor.profileDetails.languages.map((language) => <span key={language}>Language: {language}</span>)}
                </div>
                <h3>Insurance</h3>
                <p>{instructor.profileDetails.insurance}</p>
              </div>
            </>
          ) : null}

          {instructor.favoriteSong && (
            <SpotifyTrack
              instructorName={instructor.name}
              song={instructor.favoriteSong.name}
              spotifyUrl={instructor.favoriteSong.spotifyUrl}
              note={instructor.favoriteSong.note}
            />
          )}
        </div>
        <aside className="sticky-panel profile-booking-panel" aria-labelledby="profile-booking-title">
          <p className="eyebrow">Booking details</p>
          <h2 id="profile-booking-title">Plan your line dance experience</h2>
          <p>{instructor.profileDetails?.responseTime || "Event details and availability are confirmed directly with the instructor."}</p>
          <ul className="check-list profile-booking-list">
            <li>Rates quoted after reviewing the date, location, group size, and format</li>
            <li>{instructor.minHours}-hour minimum booking</li>
            <li>Song requests and accessibility needs discussed before the event</li>
            <li>Travel, venue access, sound, and insurance confirmed in advance</li>
          </ul>
        </aside>
      </div>

      <section className="profile-bottom-cta" aria-labelledby="profile-bottom-cta-title">
        <div>
          <p className="eyebrow">Start planning</p>
          <h2 id="profile-bottom-cta-title">Bring {firstName} to your event.</h2>
          <p>Share your date, location, group size, and event details to check availability.</p>
        </div>
        <InstructorContactLink instructorIdentifier={instructor.slug} className="button primary">
          Contact {firstName}
        </InstructorContactLink>
      </section>
    </section>
  );
}
