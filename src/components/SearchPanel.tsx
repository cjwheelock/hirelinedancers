"use client";

import { useMemo, useState } from "react";
import { CalendarDays, MapPin, Search, Users } from "lucide-react";
import { cities, eventTypes, instructors } from "@/data/site";
import { InstructorCard } from "@/components/InstructorCard";

export function SearchPanel() {
  const [city, setCity] = useState("nashville-tn");
  const [event, setEvent] = useState("");
  const [groupSize, setGroupSize] = useState("100");

  const results = useMemo(() => {
    const selectedCity = cities.find((item) => item.slug === city);
    return instructors
      .filter((instructor) => {
        const cityMatch = !selectedCity || instructor.state === selectedCity.state || instructor.city === selectedCity.city;
        const eventMatch = !event || instructor.events.includes(event);
        const groupMatch = instructor.groupSize >= Number(groupSize || 0);
        return cityMatch && eventMatch && groupMatch;
      })
      .sort((a, b) => Number(b.featured) - Number(a.featured) || b.rating - a.rating);
  }, [city, event, groupSize]);

  return (
    <section className="search-section" id="search">
      <div className="section-heading">
        <p className="eyebrow">Search the directory</p>
        <h2>Find an instructor who fits your event.</h2>
      </div>
      <div className="search-grid">
        <form className="search-form">
          <label>
            <span><MapPin size={16} aria-hidden="true" /> City</span>
            <select value={city} onChange={(event) => setCity(event.target.value)}>
              {cities.map((item) => (
                <option key={item.slug} value={item.slug}>{item.city}, {item.state}</option>
              ))}
            </select>
          </label>
          <label>
            <span><CalendarDays size={16} aria-hidden="true" /> Event type</span>
            <select value={event} onChange={(event) => setEvent(event.target.value)}>
              <option value="">Any event type</option>
              {eventTypes.map((item) => (
                <option key={item.slug} value={item.slug}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span><Users size={16} aria-hidden="true" /> Group size</span>
            <input value={groupSize} onChange={(event) => setGroupSize(event.target.value)} type="number" min="1" />
          </label>
          <button type="button">
            <Search size={18} aria-hidden="true" />
            {results.length} matching instructors
          </button>
        </form>
        <div className="results-list" aria-live="polite">
          {results.length ? results.map((instructor) => (
            <InstructorCard key={instructor.slug} instructor={instructor} compact />
          )) : (
            <div className="empty-state">
              <h3>No exact seeded match yet.</h3>
              <p>Submit an inquiry and we will route it manually while new instructors are reviewed.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
