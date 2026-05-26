import Link from "next/link";
import { BadgeCheck, MapPin, Star } from "lucide-react";
import type { Instructor } from "@/data/site";

export function InstructorCard({ instructor, compact = false }: { instructor: Instructor; compact?: boolean }) {
  return (
    <article className={compact ? "instructor-card compact" : "instructor-card"}>
      <div className="avatar" aria-hidden="true">{instructor.name.split(" ").map((word) => word[0]).join("")}</div>
      <div className="card-body">
        <div className="card-title-row">
          <div>
            <h3><Link href={`/instructors/${instructor.slug}/`}>{instructor.business}</Link></h3>
            <p>{instructor.name}</p>
          </div>
          {instructor.founding && <span className="pill"><BadgeCheck size={14} aria-hidden="true" /> Founding</span>}
        </div>
        <p className="muted"><MapPin size={15} aria-hidden="true" /> {instructor.city}, {instructor.state} · travels {instructor.travelRadius} miles</p>
        <div className="rating"><Star size={15} aria-hidden="true" /> {instructor.rating.toFixed(1)} · {instructor.reviews} reviews · ${instructor.startingRate}+</div>
        <p>{instructor.bio}</p>
        <div className="tag-row">
          {instructor.tags.slice(0, compact ? 2 : 4).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </div>
    </article>
  );
}
