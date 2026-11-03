import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Footprints, Heart, Music4, Users } from "lucide-react";
import { InstructorDemo } from "@/components/homepage-demo/InstructorDemo";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Homepage testing",
  description: "Hire Line Dancers homepage testing. An illustrative instructor search and event inquiry demo.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/homepage-testing/" }
};

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
    body: "Share the date and key details, then read and reply in your Hire Line Dancers inbox."
  }
];

export default function HomepageTesting() {
  return (
    <div className={styles.page}>
      <div className={styles.previewBar}>
        <span>Homepage testing</span>
        <Link href="/">View current homepage <ArrowRight size={14} aria-hidden="true" /></Link>
      </div>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1>Live entertainment that gets the whole room <em>moving.</em></h1>
          <p className={styles.lede}>
            Book a local instructor who teaches your guests a line dance on the spot. No experience or partner needed, and nobody stuck on the sidelines.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/instructors/">
              Find an instructor near you <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <a className={styles.textLink} href="#how-it-works">See how it works</a>
          </div>
          <div className={styles.badges}>
            <span><Footprints size={16} aria-hidden="true" /> No partner required</span>
            <span><Heart size={16} aria-hidden="true" /> All ages welcome</span>
          </div>
        </div>
        <InstructorDemo />
      </section>

      <div className={styles.trust}>
        <span><CheckCircle2 size={19} aria-hidden="true" /> Beginner-friendly instruction</span>
        <span><Music4 size={19} aria-hidden="true" /> Music selected for your crowd</span>
        <span><Users size={19} aria-hidden="true" /> Adaptable to different group sizes</span>
      </div>

      <section id="how-it-works" className={styles.how}>
        <div className={styles.howIntro}>
          <h2>How it works</h2>
          <div className={styles.art}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/home/sunset-dance-floor.webp"
              alt="Illustrated guests line dancing under string lights with desert mesas and a setting sun behind them"
              width={1122}
              height={1402}
              loading="lazy"
            />
          </div>
        </div>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li key={step.title}>
              <span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span>
              <div><h3>{step.title}</h3><p>{step.body}</p></div>
            </li>
          ))}
          <li className={styles.stepAction}>
            <Link className={styles.primary} href="/instructors/">Find an instructor <ArrowRight size={18} aria-hidden="true" /></Link>
          </li>
        </ol>
      </section>
    </div>
  );
}
