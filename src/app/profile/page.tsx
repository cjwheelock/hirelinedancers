import type { Metadata } from "next";
import { PublicProfile } from "./PublicProfile";

export const metadata: Metadata = {
  title: "Line Dance Instructor Profile",
  description: "View a published line dance instructor profile, services, media, equipment details, and availability contact options."
};

export default function ProfilePage() {
  return <PublicProfile />;
}
