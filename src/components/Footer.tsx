import Link from "next/link";
import { cities, eventTypes, site } from "@/data/site";

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <h2 className="brand-name">{site.name}</h2>
          <p>A simple way to find a line dance instructor for your event and help more guests get moving together. No experience needed.</p>
        </div>
        <div>
          <h3>Top cities</h3>
          <ul>
            {cities.map((city) => (
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
            <li><Link href="/about/">About</Link></li>
            <li><Link href="/#find">Find an instructor</Link></li>
            <li><Link href="/instructors/join/">For instructors</Link></li>
            <li><Link href="/guides/cost-to-hire-line-dance-instructor/">Cost guide</Link></li>
            <li><Link href="/blog/">Blog</Link></li>
            <li><Link href="/legal/terms/">Terms</Link></li>
            <li><Link href="/legal/privacy/">Privacy</Link></li>
            <li><Link href="/legal/refund-policy/">Refund policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} {site.name}. Instructors are independent providers.</span>
        <span>{site.url.replace("https://", "")}</span>
      </div>
    </footer>
  );
}
