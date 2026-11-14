"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useMarketplaceSession } from "@/hooks/useMarketplaceSession";
import { getMarketplaceClient } from "@/lib/marketplace";
import styles from "./Header.module.css";

/** Sign-in pages carry their own full-screen layout with no site chrome. */
export function isAuthPath(pathname: string | null) {
  return Boolean(pathname && /^\/(sign-in|login)(\/|$)/.test(pathname));
}

/** Logged-in workspace pages use the slim app header and footer. */
export function isAppPath(pathname: string | null) {
  return Boolean(pathname && /^\/(account|admin)(\/|$)/.test(pathname));
}

function initials(name: string | null | undefined, email: string | null | undefined) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email ?? "").slice(0, 1).toUpperCase();
}

export function Header() {
  const pathname = usePathname();
  const { session, account, isAdmin, loading } = useMarketplaceSession();

  if (isAuthPath(pathname)) return null;
  if (isAppPath(pathname)) {
    return <AppHeader loading={loading} signedIn={Boolean(session)} account={account} email={session?.user.email ?? null} isAdmin={isAdmin} onAdminPage={Boolean(pathname?.startsWith("/admin"))} />;
  }

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
            <Link className="navlink is-account" href={session ? (account?.role === "instructor" ? "/account/?tab=profile" : "/account/") : "/sign-in/"}>
              {session ? (account?.role === "instructor" ? "Profile" : "Messages") : "Sign in"}
            </Link>
          ) : null}
          <Link className="button primary small navlink is-cta" href="/instructors/">
            <Search size={16} aria-hidden="true" />
            <span className="nav-cta-long">Find an instructor</span>
            <span className="nav-cta-short">Find</span>
          </Link>
          {!loading && !session ? (
            <Link className="navlink is-join" href="/instructors/join/">
              <span className="nav-join-long">Join as an instructor</span>
              <span className="nav-join-short">Join</span>
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}

function AppHeader({
  loading,
  signedIn,
  account,
  email,
  isAdmin,
  onAdminPage
}: {
  loading: boolean;
  signedIn: boolean;
  account: { full_name: string | null; first_name?: string | null; last_name?: string | null; email: string | null; role: string | null } | null;
  email: string | null;
  isAdmin: boolean;
  onAdminPage: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const role = account?.role ?? null;

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    async function loadUnread() {
      const client = getMarketplaceClient();
      if (!client) return;
      const { data, error } = await client.rpc("list_inquiry_threads", {
        p_search: null,
        p_filter: "unread",
        p_sort: "recent",
        p_limit: 50,
        p_cursor_at: null,
        p_cursor_id: null,
        p_admin: false
      });
      if (!active || error || !Array.isArray(data)) return;
      setUnread(data.reduce((sum: number, row: { unread_count?: number }) => sum + (Number(row.unread_count) || 0), 0));
    }
    void loadUnread();
    const refresh = () => void loadUnread();
    window.addEventListener("focus", refresh);
    window.addEventListener("hld:inbox-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("hld:inbox-changed", refresh);
    };
  }, [signedIn]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  async function signOut() {
    const client = getMarketplaceClient();
    if (!client) return;
    setSigningOut(true);
    setSignOutError(null);
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) {
      setSignOutError(error.message);
      setSigningOut(false);
      return;
    }
    window.location.replace("/");
  }

  const displayName = account?.full_name?.trim() || [account?.first_name, account?.last_name].filter(Boolean).join(" ") || null;
  const messagesHref = onAdminPage ? "/admin/?tab=messages" : role === "instructor" ? "/account/?tab=inquiries" : "/account/";

  return (
    <header className={styles.appHeader}>
      <div className={styles.appHeaderInner}>
        <Link className={styles.appBrand} href="/" aria-label="Hire Line Dancers home">
          <Logo size={40} />
        </Link>
        {!loading && signedIn ? (
          <nav className={styles.appNav} aria-label="App navigation">
            <a className={styles.appLink} href={messagesHref}>
              Messages
              {unread > 0 ? <span className={styles.badge} aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</span> : null}
            </a>
            <Link className={`${styles.appLink} ${styles.findLink}`} href="/instructors/">Find an instructor</Link>
            <div className={styles.menuWrap} ref={menu}>
              <button
                className={styles.avatarButton}
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Account menu${displayName ? ` for ${displayName}` : ""}`}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <span className={styles.avatar} aria-hidden="true">{initials(displayName, email)}</span>
                <ChevronDown aria-hidden="true" size={15} />
              </button>
              {menuOpen ? (
                <div className={styles.menu} role="menu">
                  {email ? <p className={styles.menuEmail}>{email}</p> : null}
                  <Link className={`${styles.menuItem} ${styles.menuFind}`} role="menuitem" href="/instructors/">Find an instructor</Link>
                  {role === "instructor" ? <a className={styles.menuItem} role="menuitem" href="/account/?tab=profile">Profile</a> : null}
                  {role === "instructor" ? <a className={styles.menuItem} role="menuitem" href="/account/?tab=payouts">Payouts</a> : null}
                  {isAdmin ? <a className={styles.menuItem} role="menuitem" href="/admin/">Admin</a> : null}
                  <button className={styles.menuItem} role="menuitem" type="button" disabled={signingOut} onClick={() => void signOut()}>
                    {signingOut ? "Signing out..." : "Sign out"}
                  </button>
                  {signOutError ? <p className={styles.menuError} role="alert">{signOutError}</p> : null}
                </div>
              ) : null}
            </div>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
