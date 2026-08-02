import Link from "next/link";
import { ApplicationForm } from "@/components/Forms";

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
      <ApplicationForm />
    </section>
  );
}
