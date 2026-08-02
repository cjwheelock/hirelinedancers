import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/data/site";

const launchSteps = [
  { name: "Learn the campus process", text: "Find the current rules for student organizations, rooms, funding, events, vendors, and risk management." },
  { name: "Build a founding team", text: "Find a few dependable students who can share registration, promotion, programming, and operations." },
  { name: "Register the club", text: "Prepare the mission, officers, constitution, adviser, and training your school requires." },
  { name: "Plan for beginners", text: "Create a first experience where students know what to expect and feel comfortable joining at their own pace." },
  { name: "Launch consistently", text: "Promote a clear first meeting, announce the next date, and build a repeatable early schedule." },
  { name: "Develop new leaders", text: "Share responsibility early so the community can continue after its founders graduate." }
];

const launchWeeks = [
  ["Week 1", "Define the idea", "Write the club promise, find the registration process, check for similar groups, and open an interest form."],
  ["Week 2", "Build the founding team", "Recruit the required members, identify possible officers, choose a likely meeting rhythm, and begin the adviser search if needed."],
  ["Week 3", "Prepare the application", "Draft the organization description and constitution, confirm responsibilities, complete training, and submit the registration materials."],
  ["Week 4", "Plan the first meeting", "Request a room, choose the teaching model, contact instructors if needed, and confirm sound, accessibility, and event requirements."],
  ["Week 5", "Create the launch identity", "Choose a clear name, prepare the interest announcement and flyer, and make registration simple if capacity is limited."],
  ["Week 6", "Promote the kickoff", "Use approved campus channels, ask partner groups to share, invite people personally, and confirm every operational detail."],
  ["Week 7", "Host the first meeting", "Arrive early, test the room, welcome students individually, teach for complete beginners, and announce the next gathering."],
  ["Week 8", "Follow up and improve", "Thank attendees, send the next date, collect brief feedback, review the plan with your team, and adjust what comes next."]
];

const frequentlyAsked = [
  {
    question: "Do I need to be an advanced dancer to start the club?",
    answer: "No. A founder can organize the community while another student or professional leads instruction. Be honest about your experience and bring in qualified help when you need it."
  },
  {
    question: "Does the music have to be country?",
    answer: "No. Line dances exist across several music styles. Choose music that suits your community, and confirm what a prospective instructor is comfortable teaching."
  },
  {
    question: "Do we need a professional instructor at every meeting?",
    answer: "Not necessarily. Some clubs use student instruction, some hire professionals, and some combine a professional launch workshop with student-led practice between workshops."
  },
  {
    question: "Can we meet before the organization is officially approved?",
    answer: "Ask your student activities office. Colleges differ in what an unregistered group may call itself, reserve, promote, or collect money for."
  },
  {
    question: "What if we cannot afford an instructor yet?",
    answer: "Explore campus recreation partnerships, department co-sponsorships, student government funding, or one funded launch workshop followed by student-led practice. Confirm the approved payment process before making a commitment."
  }
];

export const metadata: Metadata = {
  title: "How to Start a Line Dance Club on Your College Campus",
  description: "An eight-week guide with practical checklists and copyable templates for starting a welcoming line dancing club or student organization at your college.",
  alternates: { canonical: "/guides/start-a-line-dance-club-on-campus/" },
  openGraph: {
    title: "Start a Line Dance Club on Your College Campus",
    description: "A practical eight-week launch guide with first-meeting plans, promotion ideas, and copyable campus club templates.",
    url: `${site.url}/guides/start-a-line-dance-club-on-campus/`,
    images: ["/images/line-dance-event-hero.png"]
  }
};

export default function CampusLineDanceGuidePage() {
  const pageUrl = `${site.url}/guides/start-a-line-dance-club-on-campus/`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "HowTo",
        "@id": `${pageUrl}#howto`,
        name: "How to start a line dance club on your college campus",
        description: "A practical path from first interest to a repeatable campus line dancing community.",
        totalTime: "P8W",
        step: launchSteps.map((step, index) => ({
          "@type": "HowToStep",
          position: index + 1,
          name: step.name,
          text: step.text,
          url: `${pageUrl}#step-${index + 1}`
        }))
      },
      {
        "@type": "FAQPage",
        mainEntity: frequentlyAsked.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer }
        }))
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: site.url },
          { "@type": "ListItem", position: 2, name: "Guides", item: `${site.url}/guides/` },
          { "@type": "ListItem", position: 3, name: "Start a line dance club on campus", item: pageUrl }
        ]
      }
    ]
  };

  return (
    <article className="campus-guide">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <header className="campus-guide-hero">
        <div className="campus-guide-hero-inner">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span aria-hidden="true">/</span>
            <Link href="/guides/">Guides</Link>
          </nav>
          <p className="eyebrow">Campus starter kit</p>
          <h1>Start a line dance club on your campus.</h1>
          <p className="lede">You do not need to be the best dancer at your college. You need a clear purpose, a few interested people, and a welcoming first experience. This guide gives you a practical path from “someone should start this” to a community that meets again.</p>
          <div className="campus-guide-actions">
            <a className="button primary" href="#launch-plan">See the eight-week plan</a>
            <a className="button secondary" href="#templates">Copy the templates</a>
          </div>
          <p className="campus-guide-note">Built for student-led clubs and organizations. Campus rules vary, so confirm every registration, funding, venue, vendor, and safety requirement with your school.</p>
        </div>
      </header>

      <section className="campus-quick-start" aria-labelledby="quick-start-heading">
        <div className="campus-wide-shell">
          <div className="section-heading left">
            <p className="eyebrow">The path</p>
            <h2 id="quick-start-heading">Six phases from idea to community.</h2>
          </div>
          <ol className="campus-step-grid">
            {launchSteps.map((step, index) => (
              <li id={`step-${index + 1}`} key={step.name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.name}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="campus-guide-layout">
        <aside className="campus-guide-toc" aria-label="On this page">
          <p>On this page</p>
          <a href="#purpose">Start with the purpose</a>
          <a href="#campus-process">Learn the campus process</a>
          <a href="#founding-team">Build the founding team</a>
          <a href="#beginner-first">Design for beginners</a>
          <a href="#instruction">Choose instruction</a>
          <a href="#launch-plan">Eight-week launch plan</a>
          <a href="#first-meeting">First meeting</a>
          <a href="#budget">Budget and funding</a>
          <a href="#promotion">Promote the club</a>
          <a href="#retention">Keep it growing</a>
          <a href="#templates">Copyable templates</a>
          <a href="#faq">Common questions</a>
        </aside>

        <div className="campus-guide-content post-body">
          <section id="purpose">
            <p className="eyebrow">Begin here</p>
            <h2>Start with a simple promise</h2>
            <p>Starting a college line dancing club is partly about dancing and partly about building community. Your job as the founder is not necessarily to teach every step. Your job is to bring the right people, place, instruction, and support together so more students have a comfortable way to try.</p>
            <div className="article-action-box">
              <p className="article-action-label">A useful starting promise</p>
              <p>We are building a welcoming campus community where students can learn line dancing, meet people, and enjoy moving to music. No partner or previous dance experience is required, and beginners are always welcome.</p>
            </div>
            <p>Keep the first version simple. One reliable beginner gathering every week or every other week is enough to prove that the community should exist.</p>
          </section>

          <section id="campus-process">
            <p className="eyebrow">Step one</p>
            <h2>Learn your campus process</h2>
            <p>Search your college website for “student organization registration,” “new club application,” or “student activities.” If the path is unclear, email the office that supports student organizations and ask for the current process.</p>
            <p>Find out:</p>
            <ul>
              <li>When new organizations may apply</li>
              <li>How many founding members and officers are required</li>
              <li>Whether a faculty or staff adviser is required</li>
              <li>Whether you need a constitution or officer training</li>
              <li>How room reservations and event registration work</li>
              <li>Whether dance is treated as a student club, recreation program, or club sport</li>
              <li>What waivers, insurance, or risk-management steps apply</li>
              <li>How outside instructors become approved vendors</li>
              <li>How the organization may receive and spend money</li>
              <li>Which accessibility and nondiscrimination language is required</li>
            </ul>
            <p>Ask whether you may hold an informal interest meeting while the application is under review. Do not assume another college’s process applies to yours.</p>
          </section>

          <section id="founding-team">
            <p className="eyebrow">Step two</p>
            <h2>Find a small, dependable founding team</h2>
            <p>You do not need a crowd before you apply. You need enough reliable people to meet your school’s requirements and share the work. Look among friends, residence halls, campus dance and fitness groups, music programs, recreation classes, cultural organizations, student affinity groups, and people who already attend local dance events.</p>
            <p>Ask two separate questions: “Would you attend?” and “Would you help launch this?” Interest and responsibility are not the same commitment.</p>
            <h3>A simple interest form</h3>
            <ul>
              <li>Name and school email</li>
              <li>Graduation year</li>
              <li>Dance experience, including “none”</li>
              <li>Preferred meeting days and times</li>
              <li>Interest in organizing, teaching, or assisting</li>
              <li>Accessibility needs the organizers should consider</li>
              <li>Permission to receive club updates</li>
            </ul>
            <p>Collect only what you need and use a university-approved form when required.</p>
          </section>

          <section id="beginner-first">
            <p className="eyebrow">Step three</p>
            <h2>Make beginner-friendly a real operating choice</h2>
            <p>A student entering the room may be excited, nervous, or both. Make the experience understandable before the music starts.</p>
            <ul>
              <li>Explain the session before teaching begins.</li>
              <li>Teach unfamiliar movements from the beginning.</li>
              <li>Do not require partners or physical contact.</li>
              <li>Make participation, rest, and observation acceptable choices.</li>
              <li>Avoid calling out reluctant or struggling participants.</li>
              <li>Share the music volume, activity level, venue access, and session length in advance.</li>
              <li>Ask before filming or photographing participants.</li>
              <li>Provide a clear photo opt-out process.</li>
              <li>Offer a private way to request accommodations.</li>
              <li>Ask instructors what adaptations they can confidently provide.</li>
            </ul>
            <p>The goal is not to promise that one event will work identically for everyone. The goal is to remove unnecessary barriers and respond respectfully when students tell you what would help them participate.</p>
          </section>

          <section id="instruction">
            <p className="eyebrow">Step four</p>
            <h2>Choose who will teach</h2>
            <div className="campus-option-grid">
              <div>
                <h3>Student-led</h3>
                <p>An experienced student teaches regular meetings. Pair the teacher with someone who welcomes newcomers and helps from another side of the room.</p>
              </div>
              <div>
                <h3>Professional guest</h3>
                <p>A local instructor leads the kickoff, a special workshop, or recurring sessions. Ask about true beginner experience, rates, travel, sound, insurance, and vendor requirements.</p>
              </div>
              <div>
                <h3>Campus partner</h3>
                <p>Campus recreation, a dance department, wellness, or residence life may provide instruction, facilities, funding, or promotion.</p>
              </div>
              <div>
                <h3>Hybrid</h3>
                <p>Hire a professional for the launch and occasional workshops, then let prepared student leaders run practice sessions between visits.</p>
              </div>
            </div>
            <p>Use <Link href="/#find">Hire Line Dancers</Link> to explore instructors near your campus. Confirm experience, group size, styles, equipment, vendor paperwork, accessibility, cancellation terms, and payment directly with the instructor.</p>
          </section>

          <section id="launch-plan">
            <p className="eyebrow">Your first two months</p>
            <h2>An eight-week launch plan</h2>
            <div className="campus-timeline">
              {launchWeeks.map(([week, title, description]) => (
                <div key={week}>
                  <span>{week}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              ))}
            </div>
            <p>Registration delays may change the timeline. Keep building interest and planning within campus rules while approvals are pending.</p>
          </section>

          <section id="first-meeting">
            <p className="eyebrow">Launch night</p>
            <h2>A practical first meeting</h2>
            <p>This sample works for a 75-minute gathering. Adjust it with your instructor and campus requirements.</p>
            <ol className="meeting-agenda">
              <li><strong>0:00 to 0:10, arrival and welcome.</strong> Check in attendees, introduce the leaders, explain the purpose, and point out water, exits, restrooms, photo policies, and the option to observe.</li>
              <li><strong>0:10 to 0:20, orientation and warm-up.</strong> Explain how line dancing works, review a few movements, and let the instructor lead an appropriate warm-up.</li>
              <li><strong>0:20 to 0:40, first beginner dance.</strong> Teach in short sections, practice without music, add music gradually, and repeat without rushing.</li>
              <li><strong>0:40 to 0:50, break and introductions.</strong> Give people time for water and casual conversation.</li>
              <li><strong>0:50 to 1:10, second dance or review.</strong> Choose based on the room’s comfort and energy.</li>
              <li><strong>1:10 to 1:15, closing.</strong> Announce the next meeting, share the club’s communication channel, invite feedback, and thank everyone.</li>
            </ol>
            <div className="article-action-box">
              <p className="article-action-label">The standard for success</p>
              <p>A successful first meeting does not require teaching several dances. It helps new people feel that they can return.</p>
            </div>
          </section>

          <section id="budget">
            <p className="eyebrow">Make it sustainable</p>
            <h2>Build a realistic first-semester budget</h2>
            <p>Possible expenses include instructor fees and travel, room rental, sound equipment, approved music services, vendor or insurance costs, printing, supplies, accessibility accommodations, and special-event costs.</p>
            <p>Possible campus funding sources include student government, student activities grants, recreation, residence life, wellness programs, arts or cultural funds, department co-sponsorships, and approved fundraising.</p>
            <p>Try to keep regular participation free or inexpensive when possible. If you charge dues, explain what they support and ask the school about fee waivers or other ways to participate.</p>
          </section>

          <section id="promotion">
            <p className="eyebrow">Fill the room</p>
            <h2>Promote the feeling, not only the dance style</h2>
            <p>A student who already loves line dancing understands the appeal. A new student needs to know what walking into the room will feel like.</p>
            <ul>
              <li>Beginners are welcome.</li>
              <li>No partner is required.</li>
              <li>No previous dance experience is needed.</li>
              <li>Steps will be taught from the beginning.</li>
              <li>Students may come alone or bring friends.</li>
              <li>Observing and taking breaks are welcome.</li>
              <li>The time, location, accessibility information, and expected activity level are clear.</li>
            </ul>
            <p>Use the official student organization directory, campus event calendar, residence hall channels, approved bulletin boards, orientation fairs, department newsletters, recreation and wellness channels, social media, partner organizations, and personal invitations. Follow campus rules before using class forums, distribution lists, or flyers.</p>
          </section>

          <section id="retention">
            <p className="eyebrow">After the kickoff</p>
            <h2>Turn first-time attendees into returning members</h2>
            <ul>
              <li>Meet at a consistent day and time.</li>
              <li>Announce future dates before students leave.</li>
              <li>Greet first-time attendees personally.</li>
              <li>Begin each meeting with a genuine beginner reset.</li>
              <li>Repeat popular dances across several meetings.</li>
              <li>Give members time to talk before or after dancing.</li>
              <li>Ask which dances, music, and formats they want.</li>
              <li>Create small volunteer jobs for people who want to help.</li>
              <li>Invite experienced members to assist without taking over.</li>
              <li>Develop future officers before current leaders graduate.</li>
            </ul>
            <p>The strongest club culture tells a new student, “You can start here,” every week.</p>
            <h3>Officer roles that match the work</h3>
            <div className="campus-role-list">
              <p><strong>Club lead:</strong> purpose, adviser communication, officer meetings, and long-term planning.</p>
              <p><strong>Operations lead:</strong> rooms, equipment, event checklists, and schedules.</p>
              <p><strong>Treasurer:</strong> budgets, funding requests, approved purchasing, and financial records.</p>
              <p><strong>Programming lead:</strong> lessons, workshops, instructors, and member feedback.</p>
              <p><strong>Communications lead:</strong> promotion, reminders, interest lists, and new-member welcome.</p>
              <p><strong>Member experience lead:</strong> accessibility information, photo consent, private feedback, and newcomer support.</p>
            </div>
          </section>

          <section id="templates">
            <p className="eyebrow">Campus starter resources</p>
            <h2>Copy, personalize, and send</h2>
            <p>Replace the brackets, confirm your school’s required language, and keep each message specific.</p>

            <details className="resource-template" open>
              <summary>Interest message for potential founding members</summary>
              <div className="copy-template">
                <p className="copy-template-label">Copy and paste</p>
                <p>Hi! I am working on starting a beginner-friendly line dancing club at [College]. The goal is to give students a fun way to learn, meet people, and get moving together. No partner or previous dance experience would be required.</p>
                <p>I am looking for a few founding members who would be willing to help with registration, promotion, or the first event. You do not need to be an experienced dancer. Would you be interested in joining the founding group or being added to the interest list?</p>
              </div>
            </details>

            <details className="resource-template">
              <summary>Faculty or staff adviser request</summary>
              <div className="copy-template">
                <p className="copy-template-label">Subject: Adviser request for a new line dancing club</p>
                <p>Hi [Name],</p>
                <p>I am a [year or program] student working to start a beginner-friendly line dancing club at [College]. The club would give students a welcoming way to learn line dancing, meet people, and participate in a shared activity. No partner or previous dance experience would be required.</p>
                <p>Our student organization process requires a faculty or staff adviser. Based on your work with [department, program, or student community], I thought you might connect with what we are building.</p>
                <p>The expected adviser responsibilities are [brief description from the university]. Our founding students would handle regular programming, promotion, and administration.</p>
                <p>Would you be open to a short conversation about serving as our adviser? I am happy to send the draft application, constitution, and current interest list before we meet.</p>
                <p>Thank you,<br />[Name]<br />[Program and graduation year]<br />[Contact information]</p>
              </div>
            </details>

            <details className="resource-template">
              <summary>Student organization application description</summary>
              <div className="copy-template">
                <p className="copy-template-label">Copy and adapt</p>
                <p>[College] Line Dancing Club is a student-led organization that creates welcoming opportunities for students to learn and enjoy line dancing. The club plans to offer beginner-friendly lessons, open practice sessions, social events, and occasional workshops with student or guest instructors. No partner or previous dance experience is required. The organization is open to eligible students of all backgrounds and experience levels, subject to university membership policies. Its purpose is to help students build community, develop dance skills, and enjoy moving to music in a respectful and supportive environment.</p>
              </div>
            </details>

            <details className="resource-template">
              <summary>Campus activities or funding request</summary>
              <div className="copy-template">
                <p className="copy-template-label">Subject: Funding request for a beginner line dancing program</p>
                <p>Hi [Name or committee],</p>
                <p>I am writing on behalf of [Club Name], a [registered or proposed] student organization focused on beginner-friendly line dancing and student community.</p>
                <p>We are requesting [$ amount] to support [event or program] on [date or date range]. The program would be open to [eligible audience] and would give students a structured opportunity to learn line dancing together. No partner or previous dance experience would be required.</p>
                <p>The funding would support [instructor fee, approved vendor costs, venue or sound needs, promotion, or accessibility expenses]. We currently have [number] students on our interest list and plan to promote the program through [channels]. We will follow university requirements for contracting, payment, event registration, accessibility, and risk management.</p>
                <p>Please let me know what additional information would help the committee review this request.</p>
                <p>Thank you,<br />[Name]<br />[Role and club]<br />[Contact information]</p>
              </div>
            </details>

            <details className="resource-template">
              <summary>Social caption and flyer copy</summary>
              <div className="copy-template">
                <p className="copy-template-label">Social caption</p>
                <p>Want to try line dancing at [College]?</p>
                <p>Join us for a beginner-friendly first meeting on [day, date] at [time] in [location]. We will teach the steps from the beginning, so no partner or previous dance experience is needed.</p>
                <p>Come alone, bring friends, dance, take breaks, or watch while you get comfortable.</p>
                <p>[Registration details, accessibility information, and contact]</p>
                <p>Help us get more people dancing.</p>
              </div>
              <div className="copy-template">
                <p className="copy-template-label">Flyer copy</p>
                <p><strong>LINE DANCING AT [COLLEGE]</strong></p>
                <p><strong>Beginners welcome</strong></p>
                <p>Learn the steps. Meet new people. Move to music.</p>
                <p>No partner required<br />No previous dance experience needed<br />Instruction starts from the beginning</p>
                <p><strong>[Day, date]<br />[Time]<br />[Building and room]</strong></p>
                <p>[Registration or QR code]<br />[Accessibility and accommodation contact]<br />[Club social handle]</p>
              </div>
            </details>

            <details className="resource-template">
              <summary>First meeting follow-up</summary>
              <div className="copy-template">
                <p className="copy-template-label">Subject: Thank you for joining our first line dancing meeting</p>
                <p>Hi everyone,</p>
                <p>Thank you for helping us launch [Club Name]. Whether you danced the entire time, tried a few steps, or watched while getting comfortable, we are glad you came.</p>
                <p>Our next meeting is [day, date] at [time] in [location]. We will [brief description]. Beginners are welcome, and we will review the basics.</p>
                <p>Please take this short feedback survey: [link]</p>
                <p>You can also join our [communication channel] here: [link]</p>
                <p>If you are interested in helping with events, promotion, instruction, or club leadership, reply to this message. We would love to build the next part of the club with you.</p>
                <p>See you next time,<br />[Name]<br />[Club Name]</p>
              </div>
            </details>
          </section>

          <section id="faq">
            <p className="eyebrow">Common questions</p>
            <h2>What new founders usually ask</h2>
            <div className="campus-faq-list">
              {frequentlyAsked.map((item) => (
                <details key={item.question}>
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="campus-final-cta">
            <p className="eyebrow">Take the first step</p>
            <h2>Your campus community can start with one message.</h2>
            <p>Check the student organization process. Send the interest note to a few people. Ask one potential adviser for a conversation. Then take the next step.</p>
            <p>A line dancing community begins when someone decides there should be a welcoming place for people to try. That person can be you.</p>
            <div className="campus-guide-actions">
              <Link className="button primary" href="/#find">Find an instructor near campus</Link>
              <a className="button secondary" href={`mailto:${site.email}?subject=Campus line dancing club`}>Share feedback with us</a>
            </div>
          </section>

          <div className="policy-box campus-policy-note">
            <h2>Keep the club campus-led</h2>
            <p>This guide helps students create an independent campus club or student organization. Your college controls recognition, funding, contracts, events, and use of its name. Hire Line Dancers can help you discover instructors, but the club or institution works with each instructor directly.</p>
          </div>
        </div>
      </div>
    </article>
  );
}
