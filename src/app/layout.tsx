import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { site } from "@/data/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: "Hire a Line Dance Instructor for Events | HireALineDancer.com",
    template: "%s | HireALineDancer.com"
  },
  description: site.description,
  openGraph: {
    title: "HireALineDancer.com",
    description: site.description,
    url: site.url,
    siteName: site.name,
    images: ["/images/line-dance-event-hero.png"],
    type: "website"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
