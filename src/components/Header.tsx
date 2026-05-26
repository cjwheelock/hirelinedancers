import Link from "next/link";
import { Search, UserPlus } from "lucide-react";

export function Header() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="HireALineDancer.com home">
        <span className="brand-mark">HLD</span>
        <span>HireALineDancer.com</span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/pricing/">Pricing</Link>
        <Link href="/events/weddings/">Events</Link>
        <Link href="/cities/nashville-tn/">Cities</Link>
        <Link className="nav-action" href="/apply/">
          <UserPlus size={16} aria-hidden="true" />
          Apply
        </Link>
        <Link className="nav-action primary" href="/#search">
          <Search size={16} aria-hidden="true" />
          Search
        </Link>
      </nav>
    </header>
  );
}
