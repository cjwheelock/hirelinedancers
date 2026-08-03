import type { Metadata } from "next";
import { AccountWorkspace } from "@/components/AccountWorkspace";

export const metadata: Metadata = {
  title: "Your account",
  description: "Manage your Hire Line Dancers profile and event inquiries.",
  robots: { index: false, follow: false }
};

export default function AccountPage() {
  return <AccountWorkspace />;
}
