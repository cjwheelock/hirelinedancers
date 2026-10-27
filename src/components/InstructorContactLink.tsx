"use client";

import { MouseEvent, ReactNode, useState } from "react";
import { getMarketplaceClient, signInUrl } from "@/lib/marketplace";

export function InstructorContactLink({
  instructorIdentifier,
  className,
  children,
  packageName
}: {
  instructorIdentifier: string;
  className: string;
  children: ReactNode;
  packageName?: string;
}) {
  const [routing, setRouting] = useState(false);
  const params: Record<string, string> = { instructor: instructorIdentifier };
  if (packageName) params.package = packageName;
  const contactHref = `/contact/?${new URLSearchParams(params).toString()}`;

  async function openInquiry(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const client = getMarketplaceClient();
    if (!client) return;

    event.preventDefault();
    setRouting(true);
    const { data, error } = await client.auth.getSession();
    const destination = !error && data.session
      ? contactHref
      : signInUrl(contactHref, "organizer");
    window.location.assign(destination);
  }

  return (
    <a className={className} href={contactHref} aria-busy={routing} onClick={(event) => void openInquiry(event)}>
      {routing ? "Opening inquiry..." : children}
    </a>
  );
}
