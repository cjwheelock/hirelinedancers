import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, Clock, MapPin, Users } from "lucide-react";
import { InquiryForm } from "@/components/Forms";
import { SpotifyTrack } from "@/components/SpotifyTrack";
import { instructors, site } from "@/data/site";
import { profileJsonLd } from "@/lib/search";

export function generateStaticParams() {
  return instructors.map((instructor) => ({ slug: instructor.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const instructor = instructors.find((item) => item.slug === slug);
  if (!instructor) return {};
  return {
    title: `${instructor.business} - ${instructor.city}, ${instructor.state} Line Dance Instructor`,
    description: instructor.bio,
    alternates: { canonical: `/instructors/${instructor.slug}/` },
    openGraph: {
      title: `${instructor.business} in ${instructor.city}, ${instructor.state}`,
      description: instructor.bio,
      url: `${site.url}/instructors/${instructor.slug}/`,
      images: ["/images/line-dance-event-hero.png"]
    }
  };
}

export default async function InstructorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const instructor = instructors.find((item) => item.slug === slug);
  if (!instructor) notFound();
  const jsonLd = profileJsonLd(instructor.slug);

  return (
    <section className="page-shell profile-page">
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
      <div className="profile-hero">
        <div className="avatar large" aria-hidden="true">{instructor.name.split(" ").map((word) => word[0]).join("")}</div>
        <div>
          <p className="eyebrow">Instructor profile</p>
          <h1>{instructor.business}</h1>
          <p className="lede">{instructor.bio}</p>
          <div className="tag-row">
            {instructor.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </div>
      </div>
      <div className="profile-grid">
        <div>
          <div className="stat-grid">
            <span><MapPin size={18} /> {instructor.city}, {instructor.state}</span>
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
            <p>{instructor.name} serves events within about {instructor.travelRadius} miles of {instructor.city}. Confirm availability, exact rates, travel fees, and insurance directly before booking.</p>
            {instructor.founding && <p className="pill inline"><BadgeCheck size={14} /> Founding instructor</p>}
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
          <h2>Request availability</h2>
          <InquiryForm instructorName={instructor.name} instructorSlug={instructor.slug} />
        </aside>
      </div>
    </section>
  );
}
