import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicInstructorResults } from "@/components/SearchPanel";
import { formatPostDate, publishedPostsForCity } from "@/data/blog";
import { cities, eventTypes, site } from "@/data/site";

export function generateStaticParams() {
  return cities.map((city) => ({ city: city.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: citySlug } = await params;
  const city = cities.find((item) => item.slug === citySlug);
  if (!city) return {};
  const description = `${city.localIntro} Browse instructors, local planning guidance, and line dancing articles for ${city.city}, ${city.state}.`;
  return {
    title: `Hire a Line Dance Instructor in ${city.city}, ${city.state}`,
    description,
    alternates: { canonical: `/cities/${city.slug}/` },
    openGraph: {
      title: `Hire a Line Dance Instructor in ${city.city}, ${city.state}`,
      description,
      url: `${site.url}/cities/${city.slug}/`,
      images: ["/images/line-dance-event-hero.png"]
    }
  };
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: citySlug } = await params;
  const city = cities.find((item) => item.slug === citySlug);
  if (!city) notFound();
  const localPosts = publishedPostsForCity(city.slug, 5);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${site.url}/cities/${city.slug}/#page`,
        url: `${site.url}/cities/${city.slug}/`,
        name: `Hire a line dance instructor in ${city.city}, ${city.state}`,
        description: city.localIntro,
        about: {
          "@type": "Service",
          name: "Line dance instruction for events",
          areaServed: { "@type": "AdministrativeArea", name: `${city.city}, ${city.state}` }
        }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: site.url },
          { "@type": "ListItem", position: 2, name: `${city.city}, ${city.state}`, item: `${site.url}/cities/${city.slug}/` }
        ]
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: `What should I share when contacting a line dance instructor in ${city.city}?`,
            acceptedAnswer: { "@type": "Answer", text: `Share your date, venue location, guest count, available floor space and sound, preferred music, and event goals. ${city.planningNote}` }
          },
          {
            "@type": "Question",
            name: "What events can a line dance instructor support?",
            acceptedAnswer: { "@type": "Answer", text: "Common fits include weddings, company gatherings, conferences, bachelorette parties, private celebrations, venue programs, schools, and community events." }
          }
        ]
      }
    ]
  };

  return (
    <section className="page-shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="eyebrow">City directory</p>
      <h1>Hire a line dance instructor in {city.city}, {city.state}.</h1>
      <p className="lede">{city.localIntro}</p>
      <div className="policy-box">
        <h2>Plan for the local details</h2>
        <p>{city.planningNote}</p>
      </div>
      <div className="card-grid">
        <PublicInstructorResults
          citySlug={city.slug}
          emptyTitle={`No published ${city.city} profiles yet`}
          emptyBody={`We are reviewing instructors for ${city.city}. Instructors can apply now to be considered for the directory.`}
        />
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
      <div className="faq-block">
        <h2>Planning questions</h2>
        <div className="policy-box">
          <h3>What should I share with an instructor?</h3>
          <p>Share your date, venue location, guest count, available floor space and sound, preferred music, and event goals. {city.planningNote}</p>
          <h3>What events can an instructor support?</h3>
          <p>Line dancing can work for weddings, company gatherings, conferences, bachelorette parties, private celebrations, venue programs, schools, and community events.</p>
        </div>
      </div>
      {localPosts.length > 0 && (
        <div className="faq-block" aria-labelledby="city-articles-title">
          <p className="eyebrow">Local line dancing resources</p>
          <h2 id="city-articles-title">Read more about line dancing in {city.city}</h2>
          <div className="blog-grid">
            {localPosts.map((post) => (
              <Link key={post.slug} className="blog-card" href={`/blog/${post.slug}/`}>
                <span className="pill">{post.category}</span>
                <h3>{post.title}</h3>
                <p>{post.description}</p>
                <time dateTime={post.publishDate}>{formatPostDate(post.publishDate)}</time>
              </Link>
            ))}
          </div>
        </div>
      )}
      <p className="form-note">Directory disclaimer: instructors are independent providers. Confirm rates, insurance, availability, travel fees, and event details directly before booking.</p>
    </section>
  );
}
