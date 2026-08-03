import type { Metadata } from "next";
import { ContactInstructor } from "@/components/ContactInstructor";

export const metadata: Metadata = {
  title: "Contact an instructor",
  description: "Send an event inquiry to a line dance instructor.",
  robots: { index: false, follow: false }
};

export default function ContactInstructorPage() {
  return <ContactInstructor />;
}
