import type { Metadata } from "next";
import { MatchingRequest } from "@/components/MatchingRequest";

export const metadata: Metadata = {
  title: "Get matched with a line dance instructor",
  description: "Tell us about your event and we'll find a line dance instructor near you.",
  robots: { index: false, follow: true }
};

export default function FindAnInstructorPage() {
  return <MatchingRequest />;
}
