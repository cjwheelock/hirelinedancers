import { cities, eventTypes, instructors } from "@/data/site";

export function cityLabel(slug: string) {
  const match = cities.find((city) => city.slug === slug);
  return match ? `${match.city}, ${match.state}` : "Your city";
}

export function eventLabel(slug: string) {
  return eventTypes.find((event) => event.slug === slug)?.label ?? "Events";
}

export function findInstructors(citySlug?: string, eventSlug?: string) {
  const city = cities.find((item) => item.slug === citySlug);
  return instructors
    .filter((instructor) => {
      const cityMatch = !city || instructor.state === city.state || instructor.city === city.city;
      const eventMatch = !eventSlug || instructor.events.includes(eventSlug);
      return cityMatch && eventMatch;
    })
    .sort((a, b) => Number(b.featured) - Number(a.featured) || b.rating - a.rating);
}

export function profileJsonLd(slug: string) {
  const instructor = instructors.find((item) => item.slug === slug);
  if (!instructor) return null;
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: instructor.business,
    description: instructor.bio,
    address: {
      "@type": "PostalAddress",
      addressLocality: instructor.city,
      addressRegion: instructor.state,
      postalCode: instructor.zip,
      addressCountry: "US"
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: instructor.rating,
      reviewCount: instructor.reviews
    },
    priceRange: `$${instructor.startingRate}+`,
    areaServed: `${instructor.travelRadius} miles from ${instructor.city}, ${instructor.state}`,
    url: `https://hirelinedancers.com/instructors/${instructor.slug}/`
  };
}
