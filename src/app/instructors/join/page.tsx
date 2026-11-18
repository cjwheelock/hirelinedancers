import Link from "next/link";
import { Check, Mail, MoveRight, Search } from "lucide-react";
import { signInUrl } from "@/lib/marketplace";
import { foundingInstructorDeadline } from "@/lib/commercialTerms";
import { profilePath, profilePhoto, publishedProfiles } from "@/lib/publishedProfiles";
import styles from "./join.module.css";

export const metadata = {
  title: "List Your Services as a Line Dance Instructor",
  description: "Join Hire Line Dancers and become a founding instructor. Get discovered by people planning weddings, corporate events, and private parties, send quotes, and get paid through the platform."
};

const applyHref = signInUrl("/account/", "instructor");

function bioExcerpt(bio: string | null) {
  const paragraph = (bio ?? "").split(/\n\s*\n/).map(part => part.trim()).find(Boolean) ?? "";
  const sentences = paragraph.match(/[^.!?]+[.!?]+(\s|$)/g);
  return (sentences ? sentences.slice(0, 2).join("") : paragraph).trim();
}

function sampleProfile() {
  const all = publishedProfiles();
  return all.find(({ profile }) => /^tara\b/i.test(profile.display_name ?? "")) ?? all[0];
}

export default function JoinPage() {
  const sample = sampleProfile();
  const samplePhoto = sample ? profilePhoto(sample.media) : undefined;
  const sampleBio = sample ? bioExcerpt(sample.profile.bio) : "";
  const sampleFirst = sample ? (sample.profile.display_name ?? "").split(" ")[0] : "";

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <h1>Get booked by people planning events in your city.</h1>
          <p className="lede">Weddings, corporate parties, bachelorettes and more. We bring you the clients, you bring the dance floor to life.</p>
          <ul className={styles.badges}>
            <li><Check size={18} aria-hidden="true" />Free to join</li>
            <li><Check size={18} aria-hidden="true" />You set your rate</li>
            <li><Check size={18} aria-hidden="true" />We only earn when you&apos;re booked</li>
          </ul>
          <div>
            <Link className={`button primary ${styles.heroCta}`} href={applyHref}>Apply to get listed</Link>
          </div>
        </div>
        <div className={styles.heroArt}>
          <img src="/images/home/sunset-dance-floor.webp" alt="Illustration of guests line dancing at sunset" />
        </div>
      </section>

      <section className={styles.band}>
        <div className={styles.inner}>
          <div className={styles.heading}>
            <h2>Where the gigs come from</h2>
            <p>We get line dancing on the radar of the people who plan events in your city, and make it easy for them to reach out to you.</p>
          </div>
          <div className={styles.cards}>
            <article className={styles.card}>
              <Mail size={30} aria-hidden="true" />
              <h3>Planners and venues</h3>
              <p>We reach out to wedding planners, venues, DJs and event organizers in your city and point them to your profile.</p>
            </article>
            <article className={styles.card}>
              <Search size={30} aria-hidden="true" />
              <h3>People searching</h3>
              <p>Couples and companies find you through search and our guides to line dancing at weddings and events.</p>
            </article>
            <article className={styles.card}>
              <MoveRight size={30} aria-hidden="true" />
              <h3>They reach out to you</h3>
              <p>When someone picks you, their request comes with the date, guest count and details. Can&apos;t make it? One tap, and we help them find someone else.</p>
            </article>
          </div>
          <p className={styles.events}><strong>Events you&apos;ll get booked for:</strong> weddings, corporate events, bachelorette parties, bar and bat mitzvahs, private parties, camps, schools and more, in any US city.</p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.inner}>
          <div className={styles.heading}>
            <h2>How it works</h2>
          </div>
          <div className={styles.steps}>
            <article className={styles.step} data-tone="sunset">
              <span className={styles.stepNum}>1</span>
              <h3>Build your profile</h3>
              <p>Add your headshot, teaching photos, bio, specialties and the area you cover. We personally review every profile before it goes live.</p>
            </article>
            <article className={styles.step} data-tone="pine">
              <span className={styles.stepNum}>2</span>
              <h3>Get requests and send a quote</h3>
              <p>Reply in the conversation and send a booking agreement with your own rate, minimum and cancellation policy.</p>
            </article>
            <article className={styles.step} data-tone="gold">
              <span className={styles.stepNum}>3</span>
              <h3>Teach, then get paid</h3>
              <p>The client signs and pays in full up front. After the event, your payout goes straight to your bank through Stripe.</p>
            </article>
          </div>
        </div>
      </section>

      <section className={styles.paySection} id="pricing">
        <div className={styles.pay}>
          <div className={styles.payText}>
            <h2>Free to join. We only make money when you get booked.</h2>
            <p>No signup fee, no monthly fee, and nothing to create a profile or answer inquiries. When a client books you through Hire Line Dancers, we keep a percentage of the booking, and the rest goes to your bank account after the event.</p>
            <p className={styles.payRate}>You set your own rate.</p>
          </div>
          <div className={styles.payAside}>
            <dl className={styles.payList}>
              <div><dt>Create a profile</dt><dd>Free</dd></div>
              <div><dt>Get and answer requests</dt><dd>Free</dd></div>
              <div><dt>Monthly fee</dt><dd>None</dd></div>
              <div><dt>When you&apos;re booked</dt><dd>A percentage of the booking</dd></div>
            </dl>
            <Link className={`button primary ${styles.wide}`} href={applyHref}>Apply to get listed</Link>
            <p className={styles.note}>We personally review every profile.</p>
          </div>
        </div>
      </section>

      <section className={styles.band}>
        <div className={`${styles.inner} ${styles.profileRow}`}>
          <div className={styles.profileText}>
            <h2>Your profile</h2>
            <p>Planners anywhere in the US can search your city and see your photos, specialties and service area, then send a request with one click.</p>
            {sample ? <a href={profilePath(sample.profile)}>See a live instructor profile</a> : null}
          </div>
          {sample ? (
            <a className={styles.profileCard} href={profilePath(sample.profile)}>
              <div className={styles.profileCover} />
              <div className={styles.profileBody}>
                {samplePhoto ? <img className={styles.profilePhoto} src={samplePhoto} alt={sample.profile.display_name ?? ""} /> : null}
                <div>
                  <span className={styles.profileName}>{sample.profile.display_name}</span>
                  <span className={styles.profileCity}>{[sample.profile.city, sample.profile.region].filter(Boolean).join(", ")}</span>
                </div>
                {sampleBio ? <p>{sampleBio}</p> : null}
                <span className={`button primary ${styles.wide}`}>See {sampleFirst}&apos;s profile</span>
              </div>
            </a>
          ) : null}
        </div>
      </section>

      <section className={styles.ctaSection}>
        <div className={styles.cta}>
          <div className={styles.ctaText}>
            <span className={styles.ctaBadge}>Founding Instructor</span>
            <h2>Join by {foundingInstructorDeadline} and get the Founding Instructor badge.</h2>
            <p>It shows on your profile, so planners know you were one of the first instructors on Hire Line Dancers.</p>
          </div>
          <Link className={`button ${styles.ctaButton}`} href={applyHref}>Apply to get listed</Link>
        </div>
      </section>
    </div>
  );
}
