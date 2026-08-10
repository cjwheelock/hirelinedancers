import { site } from "@/data/site";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <section className="page-shell article-page">
      <h1>Privacy Policy</h1>
      <p>Last updated: August 10, 2026.</p>
      <p>This Privacy Policy describes how {site.legalName}, which operates Hire Line Dancers, collects, uses, and shares information.</p>
      <h2>Information we collect</h2>
      <p>Hire Line Dancers collects information you provide when you create an account, build an instructor profile, upload media, submit an event inquiry, manage a membership, or contact us. This may include your name, email address, phone number, company, event details, profile information, photos, videos, notification preferences, and messages.</p>
      <p>Authentication may be provided through Google or a secure email sign-in link. Our authentication and database provider may process account identifiers, session information, IP addresses, browser details, and security logs needed to operate and protect the service.</p>
      <h2>How information is used and shared</h2>
      <p>We use account and profile information to review, publish, and operate instructor listings. We share an organizer&rsquo;s inquiry details with the selected instructor so the instructor can respond directly by email. We use an email provider to deliver transactional inquiry alerts, booking follow-ups, event follow-ups, and service notices.</p>
      <p>Instructor profiles and approved media are public. Private rates, personal contact details, membership records, and account settings are not displayed on public profiles.</p>
      <p>Stripe processes instructor membership payments. Hire Line Dancers does not receive or store full card numbers. Stripe may process billing, payment, fraud-prevention, and device information under its own privacy policy.</p>
      <p>Analytics may be used to understand search behavior, page views, inquiries, applications, payments, notification delivery, and self-reported lead outcomes.</p>
      <h2>Notifications</h2>
      <p>Inquiry, profile approval, administrative review, billing recovery, and follow-up notifications are currently delivered by email. Billing recovery messages may include a secure, expiring sign-in link that opens the instructor account. Text notifications are paused and cannot currently be enabled in account settings. We do not sell or share previously supplied text-message consent information for third-party marketing.</p>
      <p>Instructor profiles may include Spotify players. When a visitor loads one of these players, Spotify may receive technical information such as the visitor&rsquo;s IP address, browser details, and interaction with the player under <a href="https://www.spotify.com/us/legal/privacy-policy/" target="_blank" rel="noopener noreferrer">Spotify&rsquo;s own privacy practices</a>.</p>
      <h2>Your choices</h2>
      <p>You may update account and profile information through your account. For access, correction, deletion, or other privacy requests, contact <a href="mailto:hello@hirelinedancers.com">hello@hirelinedancers.com</a>. Some information may be retained when required for security, fraud prevention, payment records, dispute handling, or legal compliance.</p>
    </section>
  );
}
