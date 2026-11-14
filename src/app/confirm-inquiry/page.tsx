import type { Metadata } from "next";
import { ConfirmGuestInquiry } from "@/components/ConfirmGuestInquiry";

export const metadata: Metadata = {
  title: "Confirm your inquiry",
  robots: { index: false, follow: false }
};

export default function ConfirmInquiryPage() {
  return <ConfirmGuestInquiry />;
}
