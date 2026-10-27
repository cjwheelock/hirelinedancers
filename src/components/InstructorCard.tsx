"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Instructor } from "@/data/site";

function initials(name: string) {
  return name.split(" ").map((word) => word[0]).join("").slice(0, 2);
}

export function InstructorCard({ instructor, compact = false }: { instructor: Instructor; compact?: boolean }) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const photoRef = useRef<HTMLImageElement>(null);
  const photoAvailable = Boolean(instructor.photo && failedPhoto !== instructor.photo);

  useEffect(() => {
    const image = photoRef.current;
    if (instructor.photo && image?.complete && image.naturalWidth === 0) {
      setFailedPhoto(instructor.photo);
    }
  }, [instructor.photo]);

  return (
    <article className={compact ? "instructor-card compact" : "instructor-card"}>
      <div className="card-top">
        <div className="avatar" aria-hidden={photoAvailable ? undefined : "true"}>
          {photoAvailable ? (
            <img
              ref={photoRef}
              src={instructor.photo}
              alt={`${instructor.name}, line dance instructor`}
              onError={() => setFailedPhoto(instructor.photo ?? null)}
            />
          ) : (
            initials(instructor.name)
          )}
        </div>
        <div className="card-title-row">
          <div>
            <h3><Link href={`/instructors/${instructor.slug}/`}>{instructor.name}</Link></h3>
            <p className="card-sub">{instructor.business} · {instructor.city}, {instructor.state}</p>
          </div>
          <span className="pill">Example profile</span>
        </div>
      </div>

      <p className="muted">Illustrative directory preview</p>

      <p className="bio">{instructor.bio}</p>

      <div className="tag-row">
        {instructor.tags.slice(0, compact ? 2 : 3).map((tag) => <span key={tag}>{tag}</span>)}
      </div>

      <Link className="button secondary small" href={`/instructors/${instructor.slug}/`}>
        <MapPin size={15} aria-hidden="true" /> View example profile
      </Link>
    </article>
  );
}
