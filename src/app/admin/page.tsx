import type { Metadata } from "next";
import { AccountWorkspace } from "@/components/AccountWorkspace";

export const metadata: Metadata = {
  title: "Admin account",
  description: "Secure Hire Line Dancers account workspace.",
  robots: { index: false, follow: false }
};

export default function AdminPage() {
  return <AccountWorkspace adminOnly />;
}
