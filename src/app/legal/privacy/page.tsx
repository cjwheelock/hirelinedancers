import { site } from "@/data/site";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <section className="page-shell article-page">
      <h1>Privacy Policy</h1>
      <p>Last updated: October 27, 2026.</p>
      <p>This Privacy Policy describes how {site.legalName}, which operates Hire Line Dancers, collects, uses, and shares information.</p>
      <h2>Information we collect</h2>
      <p>Hire Line Dancers collects information you provide when you create an account, build an instructor profile, upload media, submit an event inquiry, manage a membership, or contact us. This may include your name, email address, phone number, company, event details, profile information, photos, videos, notification preferences, and messages.</p>
      <p>Authentication may be provided through Google or a secure email sign-in link. Our authentication and database provider may process account identifiers, session information, IP addresses, browser details, and security logs needed to operate and protect the service.</p>
      <h2>How information is used and shared</h2>
      <p>We use account and profile information to review, publish, and operate instructor listings. We share an organizer&rsquo;s inquiry details with the selected instructor so the organizer and instructor can communicate through Hire Line Dancers. Authorized administrators may view messages to support inquiries, investigate delivery problems, respond to safety or abuse concerns, and operate the marketplace.</p>
      <p>If the selected instructor has not replied within 48 hours or is unavailable, Hire Line Dancers may recommend other instructors. The organizer chooses who receives the saved event details and opening message. Previous conversation history is not shared with the recommended instructors. The service records which instructors received the inquiry and does not place replacement instructors into an existing private conversation.</p>
      <p>Instructor profiles and approved media are public. Private rates, personal contact details, membership records, and account settings are not displayed on public profiles.</p>
      <p>Stripe processes booking payments, refunds, instructor payouts, and legacy membership payments. Instructors provide identity, tax, and bank details directly to Stripe through Stripe Connect; Hire Line Dancers receives only the status of that setup. Hire Line Dancers does not receive or store full card numbers or bank account numbers. Stripe may process billing, payment, identity, fraud-prevention, and device information under its own privacy policy.</p>
      <p>When an organizer or instructor signs a booking agreement, Hire Line Dancers records the typed name, account email address, time, IP address, browser details, and a fingerprint of the agreement text as the electronic signature record.</p>
      <p>Phone numbers, email addresses, and social profile links in messages are hidden from the other party until a booking is paid. Hire Line Dancers keeps the original message text so administrators can support the conversation and review disputes. After a booking is paid, the organizer and instructor can see each other&rsquo;s contact details for the event.</p>
      <p>Analytics may be used to understand search behavior, page views, inquiries, applications, payments, notification delivery, and self-reported lead outcomes.</p>
      <h2>Notifications</h2>
      <p>Inquiry, message, response-reminder, profile approval, administrative review, billing recovery, and follow-up notifications are currently delivered by email. These messages may include a secure sign-in link that opens the relevant account or conversation. Where text alerts are available, instructors can verify a phone number and opt in through their account. When text alerts are available, Twilio verifies numbers and delivers alerts, and we record consent, opt-outs, and delivery status. Instructors can turn off text alerts in their account or reply STOP. Text-message consent information is not sold or shared for third-party marketing.</p>
      <p>Instructor profiles may include Spotify players. When a visitor loads one of these players, Spotify may receive technical information such as the visitor&rsquo;s IP address, browser details, and interaction with the player under <a href="https://www.spotify.com/us/legal/privacy-policy/" target="_blank" rel="noopener noreferrer">Spotify&rsquo;s own privacy practices</a>.</p>
      <h2>Your choices</h2>
      <p>You may update account and profile information through your account. For access, correction, deletion, or other privacy requests, contact <a href="mailto:hello@hirelinedancers.com">hello@hirelinedancers.com</a>. Some information may be retained when required for security, fraud prevention, payment records, dispute handling, or legal compliance.</p>
    </section>
  );
}
