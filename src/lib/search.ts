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
      const cityMatch = !city || instructor.demoEverywhere || city.serviceCities.includes(instructor.city);
      const eventMatch = !eventSlug || instructor.events.includes(eventSlug);
      return cityMatch && eventMatch;
    })
    .sort((a, b) => Number(b.featured) - Number(a.featured) || b.years - a.years);
}

export function profileJsonLd(slug: string) {
  const instructor = instructors.find((item) => item.slug === slug);
  if (!instructor || instructor.demoEverywhere) return null;
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: {
      "@type": "Person",
      name: instructor.name,
      worksFor: { "@type": "Organization", name: instructor.business },
      description: instructor.bio,
      address: {
        "@type": "PostalAddress",
        addressLocality: instructor.city,
        addressRegion: instructor.state,
        addressCountry: "US"
      },
      knowsAbout: instructor.styles
    },
    url: `https://hirelinedancers.com/instructors/${instructor.slug}/`
  };
}
