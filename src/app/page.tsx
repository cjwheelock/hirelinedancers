import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Footprints,
  Heart,
  MapPin,
  Music4,
  PartyPopper,
  Smile,
  Sparkles,
  Star,
  Users
} from "lucide-react";
import { eventTypes, site } from "@/data/site";
import styles from "./home.module.css";

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

const eventAccents = [styles.accentClay, styles.accentGold, styles.accentTeal];

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Hire a line dance instructor for events",
    provider: { "@type": "Organization", name: site.name, url: site.url },
    areaServed: "United States",
    serviceType: "Line dance instructor for weddings, corporate events, and private parties"
  };

  return (
    <div className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

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
        <div className={styles.heroArt}>
          <div className={styles.arch}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/home/sunset-dance-floor.webp"
              alt="Illustrated guests line dancing under string lights with desert mesas and a setting sun behind them"
              width={1122}
              height={1402}
              fetchPriority="high"
            />
          </div>
        </div>
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
          <div className={styles.connectionArt} aria-hidden="true">
            <div className={styles.connectionHeading}>A simple way to connect</div>
            <div className={styles.connectionCard}>
              <span className={styles.connectionEventIcon}><MapPin size={28} strokeWidth={1.6} /></span>
              <div className={styles.connectionCopy}>
                <strong>Your event</strong>
                <span>City <span className={styles.connectionBullet}>•</span> Event type</span>
              </div>
            </div>
            <div className={styles.connectionDots}><i /><i /><i /></div>
            <div className={`${styles.connectionCard} ${styles.connectionPeople}`}>
              <svg className={styles.connectionAvatar} viewBox="0 0 64 64" focusable="false">
                <circle cx="32" cy="32" r="32" fill="#f6d69e" />
                <circle cx="32" cy="28" r="11" fill="#c88d5c" />
                <path d="M21 25c0-12 22-12 22 0Z" fill="#2a1e17" />
                <path d="M12 49c0-19 40-19 40 0Z" fill="#1f6f6b" />
              </svg>
              <div className={styles.connectionCopy}>
                <strong>Local instructors</strong>
                <span>Browse profiles</span>
                <span className={styles.connectionFit}>Find your fit</span>
              </div>
            </div>
            <div className={`${styles.connectionDots} ${styles.connectionDotsBack}`}><i /><i /><i /></div>
            <div className={`${styles.connectionCard} ${styles.connectionInquiry}`}>
              <span className={styles.connectionInquiryIcon}>
                <svg width="28" height="28" viewBox="0 0 28 28" focusable="false">
                  <path d="M7 4h14a5 5 0 0 1 5 5v9a5 5 0 0 1-5 5h-9l-6 4v-5a5 5 0 0 1-4-5V9a5 5 0 0 1 5-5Z" fill="currentColor" />
                  <circle cx="8" cy="13.5" r="1.3" fill="#fff" />
                  <circle cx="14" cy="13.5" r="1.3" fill="#fff" />
                  <circle cx="20" cy="13.5" r="1.3" fill="#fff" />
                </svg>
              </span>
              <div className={styles.connectionCopy}>
                <strong>Your inquiry</strong>
                <span>Connect in your inbox</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* EVENT TYPES */}
      <section className={styles.eventsWrap} id="events">
        <div className={styles.section}>
          <h2 className={styles.h2}>Perfect for every kind of celebration</h2>
          <div className={styles.linkGrid}>
            {eventTypes.map((event, i) => (
              <Link
                key={event.slug}
                href={`/events/${event.slug}/`}
                className={`${styles.linkCard} ${eventAccents[i % eventAccents.length]}`}
              >
                <strong>{event.label}</strong>
                <span>{event.intro}</span>
                <ArrowRight size={18} className={styles.linkArrow} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* MISSION */}
      <section className={styles.quoteTeal}>
        <div className={styles.quoteInner}>
          <p>Our mission is simple: get more people dancing.</p>
          <p>That means more people moving to music, trying something new, and having fun together. It also means more great local instructors making a living doing what they love.</p>
          <span>{site.name}</span>
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
    </div>
  );
}
