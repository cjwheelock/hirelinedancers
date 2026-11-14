"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isAppPath, isAuthPath } from "@/components/Header";
import { Logo } from "@/components/Logo";
import styles from "./Header.module.css";
import { cities, eventTypes, site } from "@/data/site";
import { marketplaceConfigured } from "@/lib/marketplace";

export function Footer() {
  const pathname = usePathname();
  if (isAuthPath(pathname)) return null;
  if (isAppPath(pathname)) {
    return (
      <footer className={styles.appFooter}>
        <span>© {new Date().getFullYear()} {site.legalName} Operating as {site.name}.</span>
        <nav aria-label="Help and legal">
          <Link href="/support/">Support</Link>
          <Link href="/legal/terms/">Terms</Link>
          <Link href="/legal/privacy/">Privacy</Link>
        </nav>
      </footer>
    );
  }

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <Link href="/" aria-label="Hire Line Dancers home"><Logo size={40} /></Link>
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
            <li><Link href="/instructors/">Browse instructors</Link></li>
            {marketplaceConfigured ? <li><Link href="/sign-in/">Sign in</Link></li> : null}
            <li><Link href="/instructors/join/">For instructors</Link></li>
            <li><Link href="/guides/">Guides</Link></li>
            <li><Link href="/guides/start-a-line-dance-club-on-campus/">Start a campus club</Link></li>
            <li><Link href="/blog/">Blog</Link></li>
            <li><Link href="/support/">Support</Link></li>
            <li><Link href="/legal/terms/">Terms</Link></li>
            <li><Link href="/legal/privacy/">Privacy</Link></li>
            <li><Link href="/legal/refund-policy/">Refund policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} {site.legalName} Operating as {site.name}. Instructors are independent providers.</span>
        <span><a href={`mailto:${site.email}`}>{site.email}</a> · {site.url.replace("https://", "")}</span>
      </div>
    </footer>
  );
}
