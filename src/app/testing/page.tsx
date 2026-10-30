import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Footprints,
  Heart,
  MapPin,
  Music4,
  PartyPopper,
  Search,
  Smile,
  Sparkles,
  Star,
  Users
} from "lucide-react";
import { eventTypes, site, topCities } from "@/data/site";
import { LogoMark } from "@/components/Logo";
import { HeroArt } from "./HeroArt";
import styles from "./desert.module.css";

export const metadata: Metadata = {
  title: "Homepage preview",
  description: site.description,
  robots: { index: false, follow: false }
};

const benefits = [
  {
    icon: <Users size={24} />,
    tone: styles.toneClay,
    title: "A shared activity",
    body: "An instructor gives guests a clear, welcoming way to join in together, whether they dance often or are trying it for the first time."
  },
  {
    icon: <Smile size={24} />,
    tone: styles.toneTeal,
    title: "Built for beginners",
    body: "Step-by-step teaching helps first-time dancers follow along without needing a partner or any previous dance experience."
  },
  {
    icon: <Sparkles size={24} />,
    tone: styles.toneGold,
    title: "A memorable moment",
    body: "Learning and moving together creates a natural moment for connection, laughter, photos, and stories guests can share afterward."
  },
  {
    icon: <PartyPopper size={24} />,
    tone: styles.toneSaddle,
    title: "Flexible for your event",
    body: "Work directly with your instructor on timing, music, group size, sound requirements, and a lesson format that fits the room."
  }
];

const steps = [
  {
    title: "Tell us about your event",
    body: "Share your city and event type so we can show you relevant profiles."
  },
  {
    title: "Browse instructors near you",
    body: "See instructor profiles with photos, services, and the kinds of events they specialize in."
  },
  {
    title: "Send an event inquiry",
    body: "Share the date and key details, then read and reply in your Hire Line Dancers inbox. No reply within 48 hours? We will follow up and help you connect with other instructors. Your event details stay saved, so reaching out again is easy."
  }
];

function Mark({ size = 48 }: { size?: number }) {
  return (
    <span aria-hidden="true" style={{ display: "inline-flex" }}>
      <LogoMark size={size} />
    </span>
  );
}

export default function TestingHome() {
  return (
    <div className={styles.page} data-desert-preview="">
      <link
        rel="stylesheet"
        precedence="default"
        href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Serif+Display:ital@0;1&display=swap"
      />

      {/* HEADER */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/testing/" className={styles.brand}>
            <Mark />
            <span>{site.name}</span>
          </Link>
          <nav className={styles.nav} aria-label="Main navigation">
            <Link href="#how-it-works">How it works</Link>
            <Link href="#events">Events</Link>
            <Link href="#cities">Cities</Link>
            <Link href="/about/">About</Link>
            <Link href="/blog/">Blog</Link>
            <Link href="/instructors/join/">For instructors</Link>
            <Link href="/sign-in/">Sign in</Link>
            <Link className={styles.navCta} href="/instructors/">
              <Search size={16} aria-hidden="true" /> Find an instructor
            </Link>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1>
            Live entertainment that gets the whole room <em>moving.</em>
          </h1>
          <p className={styles.lede}>
            Book a local instructor who teaches your guests a line dance on the spot. No experience or partner needed, and nobody stuck on the sidelines.
          </p>
          <div className={styles.actions}>
            <Link className={styles.btnPrimary} href="/instructors/">
              Find an instructor near you <ArrowRight size={18} />
            </Link>
            <Link className={styles.btnGhost} href="#how-it-works">See how it works</Link>
          </div>
          <div className={styles.badges}>
            <span><CheckCircle2 size={17} /> No experience needed</span>
            <span><Footprints size={17} /> No partner required</span>
            <span><Heart size={17} /> All ages welcome</span>
          </div>
        </div>
        <HeroArt />
      </section>

      {/* TRUST BAR */}
      <section className={styles.trust}>
        <div className={styles.trustInner}>
          <span><CheckCircle2 size={18} /> Beginner-friendly instruction</span>
          <span><Music4 size={18} /> Music selected for your crowd</span>
          <span><Users size={18} /> Adaptable to different group sizes</span>
          <span><Star size={18} /> From private parties to company events</span>
        </div>
      </section>

      {/* BENEFITS */}
      <section className={styles.section}>
        <h2 className={styles.h2}>Why planners book a line dance instructor</h2>
        <div className={styles.benefitGrid}>
          {benefits.map((b) => (
            <article key={b.title} className={styles.benefit}>
              <span className={`${styles.iconTile} ${b.tone}`}>{b.icon}</span>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className={styles.howWrap} id="how-it-works">
        <div className={styles.how}>
          <div className={styles.howCopy}>
            <h2 className={styles.h2}>How it works</h2>
            <ol className={styles.steps}>
              {steps.map((s, i) => (
                <li key={s.title}>
                  <span className={styles.stepNum}>{i + 1}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className={styles.inboxArt} aria-hidden="true">
            <div className={styles.inboxTop}><span /><span /><span /></div>
            <div className={styles.inboxBody}>
              <div className={styles.bubbleThem}><i style={{ width: "88%" }} /><i style={{ width: "60%" }} /></div>
              <div className={styles.bubbleMe}><i style={{ width: "92%" }} /><i style={{ width: "70%" }} /></div>
              <div className={styles.bubbleThem}><i style={{ width: "74%" }} /></div>
              <div className={styles.inboxCheck}><CheckCircle2 size={18} /></div>
            </div>
          </div>
        </div>
      </section>

      {/* EVENT TYPES */}
      <section className={styles.section} id="events">
        <h2 className={styles.h2}>Perfect for every kind of celebration</h2>
        <div className={styles.linkGrid}>
          {eventTypes.map((event) => (
            <Link key={event.slug} href={`/events/${event.slug}/`} className={styles.linkCard}>
              <strong>{event.label}</strong>
              <span>{event.intro}</span>
              <ArrowRight size={18} className={styles.linkArrow} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      {/* SHARED EXPERIENCE */}
      <section className={styles.quoteClay}>
        <div className={styles.quoteInner}>
          <p>A guided lesson gives the room something joyful to do together, one approachable step at a time.</p>
          <span>Simple steps. Shared momentum.</span>
        </div>
      </section>

      {/* CITIES */}
      <section className={styles.section} id="cities">
        <h2 className={styles.h2}>Find line dance instructors and local planning guides.</h2>
        <div className={styles.cityGrid}>
          {topCities.map((top) => (
            <Link key={top.slug} href={`/cities/${top.slug}/`} className={styles.cityCard}>
              <strong><MapPin size={17} aria-hidden="true" /> {top.city}, {top.state}</strong>
              <span>{top.blurb}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* MISSION */}
      <section className={styles.quoteTeal}>
        <div className={styles.quoteInner}>
          <p>Our mission is simple: get more people dancing. That means more people moving to music, trying something new, and having fun together. It also means more great local instructors making a living doing what they love.</p>
          <span>{site.name}</span>
        </div>
      </section>

      {/* INSTRUCTOR STRIP */}
      <section className={styles.section}>
        <div className={styles.instructorStrip}>
          <div>
            <strong>Are you a line dance instructor?</strong>
            <p>Get discovered by people planning events in your area.</p>
          </div>
          <Link className={styles.btnDark} href="/instructors/join/">
            Apply to get listed <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className={styles.finalCta}>
        <div className={styles.finalInner}>
          <h2>Ready to get everyone dancing?</h2>
          <p>Find a line dance instructor near you and create a welcoming shared activity your guests can remember.</p>
          <Link className={styles.btnPrimary} href="/instructors/">
            <MapPin size={18} /> Find an instructor near you
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <span className={styles.brand}><Mark size={38} /><span>{site.name}</span></span>
            <p>A simple way to find a line dance instructor for your event and help more guests get moving together. No experience needed.</p>
          </div>
          <div>
            <h3>Top cities</h3>
            <ul>
              {topCities.map((city) => (
                <li key={city.slug}><Link href={`/cities/${city.slug}/`}>{city.city}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Event types</h3>
            <ul>
              {eventTypes.map((event) => (
                <li key={event.slug}><Link href={`/events/${event.slug}/`}>{event.label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Company</h3>
            <ul>
              <li><Link href="/about/">About</Link></li>
              <li><Link href="/instructors/">Browse instructors</Link></li>
              <li><Link href="/sign-in/">Sign in</Link></li>
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
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} {site.legalName} Operating as {site.name}. Instructors are independent providers.</span>
          <span><a href={`mailto:${site.email}`}>{site.email}</a> · {site.url.replace("https://", "")}</span>
        </div>
      </footer>
    </div>
  );
}
