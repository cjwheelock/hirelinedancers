import { redirect } from "next/navigation";

export const metadata = {
  title: "Create an Instructor Account",
  robots: { index: false, follow: false }
};

export default function ApplyPage() {
  redirect("/sign-in/?next=%2Faccount%2F&role=instructor");
}
