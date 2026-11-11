import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { site } from "@/data/site";
import { profileIdentifier, profilePath, profilePhoto, publishedProfiles } from "@/lib/publishedProfiles";
import { PublicProfile } from "../PublicProfile";

export function generateStaticParams() {
  return publishedProfiles().map(({ profile }) => ({ slug: profileIdentifier(profile) }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const snapshot = publishedProfiles().find(({ profile }) => profileIdentifier(profile) === slug);
  if (!snapshot) return {};
  const { profile, media } = snapshot;
  const location = [profile.city, profile.region].filter(Boolean).join(", ");
  const title = `${profile.display_name}${location ? ` | ${location}` : ""} Line Dance Instructor`;
  const description = [profile.headline, profile.bio].find(value => value && /[\p{L}\p{N}]/u.test(value))
    || "View a published line dance instructor profile, services, media, equipment details, and availability contact options.";
  const url = `${site.url}${profilePath(profile)}`;
  const image = profilePhoto(media) || `${site.url}/images/share-sunset-dance-floor.jpg`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, images: [image], type: "profile" },
    twitter: { card: "summary_large_image", title, description, images: [image] }
  };
}

export default async function InstructorSearchProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const snapshot = publishedProfiles().find(({ profile }) => profileIdentifier(profile) === slug);
  if (!snapshot) notFound();
  return <PublicProfile initialProfile={snapshot.profile} initialMedia={snapshot.media} />;
}
