import type { Metadata } from "next";
import { AuthCallback } from "@/components/AuthCallback";

export const metadata: Metadata = {
  title: "Finishing sign-in",
  robots: { index: false, follow: false }
};

export default function AuthCallbackPage() {
  return <AuthCallback />;
}
