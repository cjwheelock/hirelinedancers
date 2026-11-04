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
          <Link className="navlink" href="/about/">About</Link>
          <Link className="navlink" href="/blog/">Blog</Link>
          {!loading ? (
            <Link className="navlink is-account" href={session ? "/account/?tab=profile" : "/sign-in/"}>
              {session ? "Profile" : "Sign in"}
            </Link>
          ) : null}
          {!loading && !session ? (
            <Link className="navlink is-join" href="/instructors/join/">
              <span className="nav-join-long">Join as an instructor</span>
              <span className="nav-join-short">Join</span>
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
