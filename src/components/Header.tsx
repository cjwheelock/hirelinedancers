import Link from "next/link";
import { Search } from "lucide-react";
import { Logo } from "@/components/Logo";

export function Header() {
  return (
    <header className="site-header">
      <Link href="/" aria-label="Hire Line Dancers home">
        <Logo />
      </Link>
      <nav aria-label="Main navigation">
        <Link className="navlink" href="/#how-it-works">How it works</Link>
        <Link className="navlink" href="/events/weddings/">Events</Link>
        <Link className="navlink" href="/#cities">Cities</Link>
        <Link className="navlink" href="/about/">About</Link>
        <Link className="navlink" href="/blog/">Blog</Link>
        <span className="nav-divider" aria-hidden="true" />
        <Link className="navlink nav-ghost" href="/instructors/join/">For instructors</Link>
        <Link className="button primary small navlink is-cta" href="/#find">
          <Search size={16} aria-hidden="true" />
          Find an instructor
        </Link>
      </nav>
    </header>
  );
}
