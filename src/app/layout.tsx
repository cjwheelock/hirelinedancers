import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { site } from "@/data/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: "Hire a Line Dance Instructor for Your Event | Hire Line Dancers",
    template: "%s | Hire Line Dancers"
  },
  description: site.description,
  alternates: {
    types: { "application/rss+xml": `${site.url}/feed.xml` }
  },
  openGraph: {
    title: "Hire Line Dancers",
    description: site.description,
    url: site.url,
    siteName: site.name,
    images: ["/images/share-sunset-dance-floor.jpg"],
    type: "website"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${site.url}/#organization`,
    name: site.legalName,
    legalName: site.legalName,
    alternateName: site.name,
    url: site.url,
    email: site.email,
    brand: {
      "@type": "Brand",
      name: site.name
    },
    founder: {
      "@type": "Person",
      name: "CJ Wheelock",
      url: `${site.url}/about/`
    }
  };

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&family=DM+Serif+Display:ital@0;1&display=swap"
        />
      </head>
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
        <Header />
        <main id="main-content">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
