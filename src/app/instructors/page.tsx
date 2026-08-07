import type { Metadata } from "next";
import { InstructorDirectoryBrowser } from "@/components/SearchPanel";

export const metadata: Metadata = {
  title: "Browse Line Dance Instructors",
  description: "Browse published line dance instructor profiles by service market, event type, and group size.",
  alternates: { canonical: "/instructors/" }
};

export default function InstructorsPage() {
  return (
    <section className="page-shell">
      <h1>Find a line dance instructor.</h1>
      <p className="lede">Browse without an account. Filter published profiles by service market, event or program, and approximate group size. Sign in only when you are ready to contact an instructor.</p>
      <div className="faq-block">
        <InstructorDirectoryBrowser />
      </div>
      <p className="form-note">Instructors are independent providers. Confirm availability, rates, contracts, insurance, travel fees, and venue requirements directly before booking.</p>
    </section>
  );
}
