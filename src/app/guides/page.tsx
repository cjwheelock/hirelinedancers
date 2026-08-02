import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/data/site";

export const metadata: Metadata = {
  title: "Line Dancing Guides",
  description: "Practical guides for hiring line dance instructors, planning events, and growing line dancing communities.",
  alternates: { canonical: "/guides/" },
  openGraph: {
    title: "Line Dancing Guides",
    description: "Practical guides for hiring instructors and growing line dancing communities.",
    url: `${site.url}/guides/`,
    images: ["/images/line-dance-event-hero.png"]
  }
};

export default function GuidesPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Line Dancing Guides",
    description: "Practical guides for hiring line dance instructors, planning events, and growing line dancing communities.",
    url: `${site.url}/guides/`
  };

  return (
    <section className="page-shell guides-index">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span>Guides</span>
      </nav>
      <p className="eyebrow">Practical resources</p>
      <h1>Help more people start dancing.</h1>
      <p className="lede">Straightforward resources for planning a great event, finding the right instructor, and creating a line dancing community of your own.</p>

      <div className="guide-card-grid">
        <Link className="guide-card" href="/guides/cost-to-hire-line-dance-instructor/">
          <span className="pill">Event organizer guide</span>
          <h2>How much does it cost to hire a line dance instructor?</h2>
          <p>Understand typical starting prices, travel, equipment, group size, and the details that affect a quote.</p>
          <strong>Read the cost guide <span aria-hidden="true">→</span></strong>
        </Link>
        <Link className="guide-card featured" href="/guides/start-a-line-dance-club-on-campus/">
          <span className="pill">Campus starter kit</span>
          <h2>Start a line dance club on your campus</h2>
          <p>Use an eight-week plan, first-meeting agenda, and copyable templates to turn student interest into a welcoming community.</p>
          <strong>Build your campus club <span aria-hidden="true">→</span></strong>
        </Link>
      </div>
    </section>
  );
}
