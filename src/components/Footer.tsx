import Link from "next/link";
import { cities, eventTypes, site } from "@/data/site";

export function Footer() {
  return (
    <footer className="footer">
      <div>
        <h2>{site.name}</h2>
        <p>{site.description}</p>
      </div>
      <div>
        <h3>Top cities</h3>
        <ul>
          {cities.slice(0, 8).map((city) => (
            <li key={city.slug}>
              <Link href={`/cities/${city.slug}/`}>{city.city}</Link>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3>Event types</h3>
        <ul>
          {eventTypes.map((event) => (
            <li key={event.slug}>
              <Link href={`/events/${event.slug}/`}>{event.label}</Link>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3>Company</h3>
        <ul>
          <li><Link href="/apply/">Instructor application</Link></li>
          <li><Link href="/pricing/">Pricing and guarantee</Link></li>
          <li><Link href="/guides/cost-to-hire-line-dance-instructor/">Cost guide</Link></li>
          <li><Link href="/legal/terms/">Terms</Link></li>
          <li><Link href="/legal/privacy/">Privacy</Link></li>
          <li><Link href="/legal/refund-policy/">Refund policy</Link></li>
        </ul>
      </div>
    </footer>
  );
}
