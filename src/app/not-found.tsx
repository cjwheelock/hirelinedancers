"use client";

import { useEffect, useState } from "react";

export default function NotFound() {
  const [checkingProfile, setCheckingProfile] = useState(true);

  useEffect(() => {
    // Approval emails sent before this fix used a route absent from the static export.
    const match = /^\/instructors\/([^/]+)\/?$/.exec(window.location.pathname);
    if (match) {
      let identifier: string;
      try {
        identifier = decodeURIComponent(match[1]);
      } catch {
        setCheckingProfile(false);
        return;
      }
      const query = new URLSearchParams({ instructor: identifier });
      window.location.replace(`/profile/?${query.toString()}`);
      return;
    }
    setCheckingProfile(false);
  }, []);

  return (
    <section className="page-shell">
      {checkingProfile ? <p role="status">Loading instructor profile...</p> : <>
        <h1>404</h1>
        <p>This page could not be found.</p>
      </>}
    </section>
  );
}
