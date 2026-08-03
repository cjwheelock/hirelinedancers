import type { Metadata } from "next";
import { LoginScreen } from "@/components/LoginScreen";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to contact an instructor or manage your Hire Line Dancers profile.",
  robots: { index: false, follow: false }
};

export default function LoginPage() {
  return <LoginScreen />;
}
