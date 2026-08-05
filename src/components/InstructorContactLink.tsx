"use client";

import { MouseEvent, ReactNode, useState } from "react";
import { getMarketplaceClient, loginUrl } from "@/lib/marketplace";

export function InstructorContactLink({
  instructorIdentifier,
  className,
  children
}: {
  instructorIdentifier: string;
  className: string;
  children: ReactNode;
}) {
  const [routing, setRouting] = useState(false);
  const contactHref = `/contact/?${new URLSearchParams({ instructor: instructorIdentifier }).toString()}`;

  async function openInquiry(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const client = getMarketplaceClient();
    if (!client) return;

    event.preventDefault();
    setRouting(true);
    const { data, error } = await client.auth.getSession();
    const destination = !error && data.session
      ? contactHref
      : loginUrl(contactHref, "organizer");
    window.location.assign(destination);
  }

  return (
    <a className={className} href={contactHref} aria-busy={routing} onClick={(event) => void openInquiry(event)}>
      {routing ? "Opening inquiry..." : children}
    </a>
  );
}
