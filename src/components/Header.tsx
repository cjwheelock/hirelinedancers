"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useMarketplaceSession } from "@/hooks/useMarketplaceSession";
import styles from "./Header.module.css";

export function Header() {
  const { session, loading } = useMarketplaceSession();

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" aria-label="Hire Line Dancers home">
          <Logo />
        </Link>
        <nav className={styles.nav} aria-label="Main navigation">
          <Link className="navlink" href="/#how-it-works">How it works</Link>
          <Link className="navlink" href="/#events">Events</Link>
          <Link className="navlink" href="/#cities">Cities</Link>
          <Link className="navlink" href="/about/">About</Link>
          <Link className="navlink" href="/blog/">Blog</Link>
          {!loading && !session ? (
            <>
              <span className="nav-divider" aria-hidden="true" />
              <Link className="navlink nav-ghost nav-role" href="/instructors/join/">For instructors</Link>
              <Link className="navlink nav-ghost nav-role" href="/login/?next=%2Faccount%2F&role=organizer">For organizers</Link>
            </>
          ) : null}
          {!loading ? (
            <Link className="navlink is-account" href={session ? "/account/?tab=profile" : "/account/"}>
              {session ? "Profile" : "Sign in"}
            </Link>
          ) : null}
          <Link className="button primary small navlink is-cta" href="/instructors/">
            <Search size={16} aria-hidden="true" />
            <span className="nav-cta-long">Find an instructor</span>
            <span className="nav-cta-short">Find</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
