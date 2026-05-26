import { ApplicationForm } from "@/components/Forms";

export const metadata = {
  title: "Apply to List Your Line Dance Instructor Services",
  description: "Apply for manual review and a founding instructor listing on HireALineDancer.com."
};

export default function ApplyPage() {
  return (
    <section className="page-shell split-page">
      <div>
        <p className="eyebrow">Instructor application</p>
        <h1>Get discovered by people planning events in your city.</h1>
        <p className="lede">Apply with your teaching background, service area, event types, and media links. Approved instructors can activate a founding or standard annual profile.</p>
        <ul className="check-list">
          <li>Manual review before payment</li>
          <li>SEO-friendly instructor profile</li>
          <li>City and event category placement</li>
          <li>Lead form and direct buyer inquiries</li>
        </ul>
      </div>
      <ApplicationForm />
    </section>
  );
}
