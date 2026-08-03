import Link from "next/link";
import { marketplaceConfigured } from "@/lib/marketplace";

export const metadata = {
  title: "Apply to List Your Line Dance Instructor Services",
  description: "Apply to join Hire Line Dancers. Upload a headshot and a few teaching photos, and get discovered by people planning events in your city."
};

export default function ApplyPage() {
  return (
    <section className="page-shell split-page">
      <div>
        <p className="eyebrow">Instructor application</p>
        <h1>Get discovered by people planning events near you.</h1>
        <p className="lede">Tell us about your teaching, add a headshot and a couple of photos in action, and you&rsquo;ll be in front of planners looking to book exactly what you do.</p>
        <ul className="check-list">
          <li>A polished, search-friendly profile with your photos</li>
          <li>Placement on your city and event pages</li>
          <li>Direct inquiries from planners. You set your rates.</li>
          <li>Personally reviewed before any payment</li>
        </ul>
        <p className="form-note" style={{ marginTop: 22 }}>
          Curious about membership first? See <Link href="/instructors/join/" style={{ color: "var(--sunset)", fontWeight: 600 }}>how joining works and pricing</Link>.
        </p>
      </div>
      <aside className="sticky-panel">
        <p className="eyebrow">Build your profile</p>
        <h2>Create one account, then add everything at your own pace.</h2>
        <p>
          Add your headshot, teaching details, travel preferences, private rates, favorite song, photos, and videos. We personally review every profile before membership activation.
        </p>
        {marketplaceConfigured ? (
          <Link className="button primary" href="/login/?next=%2Faccount%2F">
            Create an instructor account
          </Link>
        ) : (
          <>
            <p className="form-note">The new instructor account system is being connected to production.</p>
            <a className="button primary" href="mailto:hello@hirelinedancers.com?subject=Instructor%20account">
              Email us to get started
            </a>
          </>
        )}
      </aside>
    </section>
  );
}
