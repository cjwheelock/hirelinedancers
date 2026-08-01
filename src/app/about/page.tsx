import type { Metadata } from "next";
import { CalendarHeart, UsersRound } from "lucide-react";
import { site } from "@/data/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "Hire Line Dancers is building a national home for line dance instructors and the people planning events that could use a fuller, happier dance floor.",
  alternates: { canonical: "/about/" },
  openGraph: {
    title: "More people dancing. That’s the whole idea.",
    description:
      "Meet the idea behind Hire Line Dancers and our mission to create more movement, more shared memories, and more full dance floors.",
    url: `${site.url}/about/`,
    images: ["/images/line-dance-event-hero.png"]
  }
};

export default function AboutPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: "About Hire Line Dancers",
    url: `${site.url}/about/`,
    description: metadata.description,
    mainEntity: {
      "@type": "Organization",
      name: site.name,
      url: site.url,
      slogan: "More people dancing."
    }
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <article className="about-page">
        <header className="about-hero">
          <div className="about-hero-inner">
            <p className="eyebrow">Why we exist</p>
            <h1>
              <span>Get more people dancing.</span>
              <span>That&rsquo;s the whole idea.</span>
            </h1>
            <div className="about-purpose">
              <p>
                I want to help line dancing grow however I possibly can. That starts with making it
                easy for any venue or event organizer, including wedding, party, and corporate event
                planners, to see how a line dance instructor can make an event more fun.
              </p>
              <p>
                Line dancing gives attendees a memorable experience and gets everyone doing
                something together. It is a phenomenal group activity because it&rsquo;s accessible
                to everyone (all ages and all skill levels) and turns a room full of people into
                participants.
              </p>
              <p>
                I also want to support fellow dancers and create more opportunities for instructors.
                This project is something I feel like I have to build.
              </p>
            </div>
          </div>
        </header>

        <section className="about-intro section" aria-labelledby="shared-experience-title">
          <div className="about-intro-grid">
            <div>
              <p className="eyebrow">A shared experience</p>
              <h2 id="shared-experience-title">Hi, I&rsquo;m CJ.</h2>
            </div>
            <div className="about-prose">
              <p>
                I&rsquo;ve been dancing West Coast Swing for more than 16 years, and I&rsquo;ve
                become a regular at San Francisco line dance venues (shout out to Jaxson and
                Westwood). Over the years, I&rsquo;ve gotten to know the instructors, met too many
                people to count, brought some of them into the West Coast Swing community, and found
                line dancing really growing on me.
              </p>
              <p>
                West Coast Swing will always have my heart but line dancing is unbelievably
                accessible. It can get a room full of people moving to music, including people who
                may be dancing for the first time. Dancing can feel intimidating when you have never
                done it. Nobody likes feeling awkward in public. Trying something for the first time
                takes courage, and great instruction makes that first step so much more comfortable.
              </p>
              <p>
                My goal with this project is to expose more people to line dancing and help them get
                moving to music. I want people to try something new, have a great time, tell their
                friends, and help the community grow (and hopefully get into West Coast Swing too).
              </p>
              <p>
                I would love for there to be thriving line dancing communities all across the US. I
                say that as a regular who is not a huge line dancer myself. I simply see the value,
                see how much people love it, and think there should be more of it. That is what
                I&rsquo;m working to build here.
              </p>
              <p>
                If you have feedback or want to chat, please email me at{" "}
                <a href="mailto:cj@cjwheelock.com">cj@cjwheelock.com</a>. Thank you so much.
              </p>
            </div>
          </div>
        </section>

        <section className="about-marketplace section" aria-labelledby="marketplace-title">
          <div className="section-inner">
            <div className="section-heading about-marketplace-heading">
              <p className="eyebrow">What we&rsquo;re building</p>
              <h2 id="marketplace-title">A two-sided marketplace for better events.</h2>
            </div>

            <div className="marketplace-map">
              <article className="marketplace-side marketplace-supply">
                <span className="marketplace-side-icon">
                  <UsersRound size={28} aria-hidden="true" />
                </span>
                <p className="marketplace-label">The supply</p>
                <h3>Great instructors, easier to discover.</h3>
                <p>
                  We want to bring amazing line dance instructors into one place, help established
                  teachers reach more events, and foster the next generation of instructors.
                </p>
              </article>

              <article className="marketplace-side marketplace-demand">
                <span className="marketplace-side-icon">
                  <CalendarHeart size={28} aria-hidden="true" />
                </span>
                <p className="marketplace-label">The demand</p>
                <h3>Memorable activities, easier to find.</h3>
                <p>
                  We want to show event planners how a skilled instructor can turn weddings,
                  company gatherings, birthdays, and community events into more memorable,
                  participatory experiences for attendees.
                </p>
              </article>
            </div>

            <p className="marketplace-outcome">
              <span>More instructors hired.</span>
              <span>Memorable experiences for attendees.</span>
              <span>More people dancing.</span>
            </p>
          </div>
        </section>
      </article>
    </>
  );
}
