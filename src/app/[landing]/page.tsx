import type { Metadata } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { profilePath, profilePhoto, publishedProfiles } from "@/lib/publishedProfiles";
import styles from "./landing.module.css";

// Email-only pages for planner outreach (e.g. /tara-bianco-austin-weddings/).
// Not linked from the site or listed in the sitemap, and kept out of search.

type LandingRow = { instructor_profile_id: string; city: string; pronoun: "she" | "he" | "they" | null; slug: string };

export const dynamicParams = false;

function landingRows(): LandingRow[] {
  const file = join(process.cwd(), "tmp", "landing-pages.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
}

function landingFor(slug: string) {
  const row = landingRows().find(item => item.slug === slug);
  if (!row) return null;
  const snapshot = publishedProfiles().find(({ profile }) => profile.id === row.instructor_profile_id);
  return snapshot ? { row, ...snapshot } : null;
}

export function generateStaticParams() {
  const rows = landingRows().filter(row => landingFor(row.slug));
  // A static export needs at least one path; this one is never generated as a page.
  return rows.length ? rows.map(row => ({ landing: row.slug })) : [{ landing: "_none" }];
}

export async function generateMetadata({ params }: { params: Promise<{ landing: string }> }): Promise<Metadata> {
  const { landing } = await params;
  const data = landingFor(landing);
  if (!data) return { robots: { index: false, follow: false } };
  const first = data.profile.display_name.split(" ")[0];
  return {
    title: `Meet ${first} + Why Wedding Planners Love Line Dancing`,
    description: "A line dance lesson fills the floor after dinner, gets three generations dancing together, and costs a fraction of the DJ.",
    robots: { index: false, follow: false }
  };
}

const reasons = [
  { title: "It solves the empty-floor problem on cue.", body: "An instructor invites the whole room by name, and a group lesson feels safe in a way freestyle dancing doesn't." },
  { title: "It's the bridge between dinner and the party.", body: "A lesson right after dinner or toasts gives guests a reason to get up, and once they're up, the DJ keeps them there." },
  { title: "Grandma and the groomsmen dance together.", body: "Line dancing is one of the rare activities that puts three generations on one floor." },
  { title: "It's a timeline you control.", body: "Each lesson runs about 20 minutes. Most couples book one or two, and the instructor works with the DJ on music and cues." },
  { title: "The photos and video are incredible.", body: "A packed floor of guests moving in sync is the shot photographers and videographers dream about." },
  { title: "It's easy to say yes to.", body: "One vendor, one short slot, light setup, and a price that barely moves the total." }
];

const objectPronoun = { she: "her", he: "him", they: "them" } as const;

function bioExcerpt(bio: string | null) {
  const paragraph = (bio ?? "").split(/\n\s*\n/).map(part => part.trim()).find(Boolean) ?? "";
  const sentences = paragraph.match(/[^.!?]+[.!?]+(\s|$)/g);
  return (sentences ? sentences.slice(0, 2).join("") : paragraph).trim();
}

export default async function OutreachLanding({ params }: { params: Promise<{ landing: string }> }) {
  const { landing } = await params;
  const data = landingFor(landing);
  if (!data) notFound();
  const { row, profile, media } = data;
  const first = profile.display_name.split(" ")[0];
  const photo = profilePhoto(media);
  const facts = [
    profile.years_teaching ? `${profile.years_teaching} years teaching` : null,
    profile.max_group_size ? `Groups up to ${profile.max_group_size.toLocaleString("en-US")}` : null,
    profile.provides_speakers && profile.provides_microphone ? "Brings speakers and a mic" : profile.provides_speakers ? "Brings speakers" : profile.provides_microphone ? "Brings a mic" : null,
    profile.travel_radius_miles ? `Travels up to ${profile.travel_radius_miles} miles` : null
  ].filter(Boolean) as string[];
  const excerpt = bioExcerpt(profile.bio);
  const highlights = (profile.highlights ?? []).filter(item => item.title).slice(0, 4);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1>Meet {first} + Why Wedding Planners Love Line Dancing</h1>
      </section>

      <section className={styles.instructor}>
        <div className={styles.instructorInner}>
          {photo ? <img src={photo} alt={profile.display_name} className={styles.photo} /> : null}
          <div className={styles.instructorBody}>
            <p className={styles.eyebrow}>Your {row.city} instructor</p>
            <h2>{profile.display_name}</h2>
            {profile.headline ? <p className={styles.headline}>{profile.headline}</p> : null}
            {facts.length ? <ul className={styles.facts}>{facts.map(fact => <li key={fact}>{fact}</li>)}</ul> : null}
            {excerpt ? <p className={styles.bio}>{excerpt}</p> : null}
            {highlights.length ? (
              <ul className={styles.highlights}>
                {highlights.map(item => <li key={item.title}><strong>{item.title}</strong>{item.detail ? <span>{item.detail}</span> : null}</li>)}
              </ul>
            ) : null}
            <a className={styles.profileButton} href={profilePath(profile)}>See {first}&apos;s profile and contact {objectPronoun[row.pronoun ?? "they"]}</a>
          </div>
        </div>
      </section>

      <section className={styles.reasons}>
        <div className={styles.inner}>
          <h2>6 reasons planners love a line dance lesson</h2>
          <ol className={styles.reasonGrid}>
            {reasons.map((reason, index) => (
              <li key={reason.title}>
                <div className={styles.reasonHead}>
                  <span className={styles.badge} aria-hidden="true">{index + 1}</span>
                  <strong>{reason.title}</strong>
                </div>
                <p>{reason.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={`${styles.inner} ${styles.twoUp}`}>
        <div>
          <h2>The budget math</h2>
          <p>A line dance lesson costs a fraction of what couples already spend on music, and it&apos;s what makes that music spend pay off.</p>
          <dl className={styles.costs}>
            <div><dt>Live band</dt><dd>$4,500 average</dd></div>
            <div><dt>DJ</dt><dd>$1,800 average</dd></div>
            <div className={styles.costHighlight}><dt>Line dance lesson</dt><dd>A few hundred dollars</dd></div>
          </dl>
          <p className={styles.source}>Band and DJ averages according to <a href="https://www.theknot.com/content/average-cost-wedding-band-dj" target="_blank" rel="noreferrer">The Knot</a>.</p>
        </div>
        <div>
          <h2>Where it fits in the night</h2>
          <p>The sweet spot is right after dinner and toasts, as the first thing that opens the dance floor. Other slots that work well:</p>
          <ul className={styles.slots}>
            <li><strong>After the first dance and parent dances</strong>, to pull everyone else in immediately.</li>
            <li><strong>Mid-reception</strong>, to re-energize the room after a lull or cake cutting.</li>
            <li><strong>During cocktail hour</strong>, as a quick teaser lesson so guests know the steps when the song comes on later.</li>
            <li><strong>At the rehearsal dinner or welcome party</strong>, so the two families meet on the dance floor before the big day.</li>
          </ul>
        </div>
      </section>

      <section className={styles.closing}>
        <h2>Your couples get a full dance floor.<br />You get the credit.</h2>
      </section>
    </div>
  );
}
