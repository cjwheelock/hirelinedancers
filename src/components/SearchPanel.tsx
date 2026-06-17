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
    <section className="search-section" id="find">
      <div className="section-heading">
        <p className="eyebrow">Find your match</p>
        <h2>Tell us about your event. We&rsquo;ll show you who&rsquo;s nearby.</h2>
        <p>Pick your city, the kind of event, and roughly how many guests. We&rsquo;ll match you with vetted instructors who love a crowd that size.</p>
      </div>
      <div className="search-grid">
        <form className="search-form" onSubmit={(e) => e.preventDefault()}>
          <label>
            <span><MapPin size={16} aria-hidden="true" /> Your city</span>
            <select value={city} onChange={(e) => setCity(e.target.value)}>
              {cities.map((item) => (
                <option key={item.slug} value={item.slug}>{item.city}, {item.state}</option>
              ))}
            </select>
          </label>
          <label>
            <span><CalendarDays size={16} aria-hidden="true" /> Type of event</span>
            <select value={event} onChange={(e) => setEvent(e.target.value)}>
              <option value="">Any event</option>
              {eventTypes.map((item) => (
                <option key={item.slug} value={item.slug}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span><Users size={16} aria-hidden="true" /> Approx. group size</span>
            <input value={groupSize} onChange={(e) => setGroupSize(e.target.value)} type="number" min="1" />
          </label>
          <button className="button primary" type="button">
            <Search size={18} aria-hidden="true" />
            Show {results.length} instructor{results.length === 1 ? "" : "s"} near me
          </button>
        </form>
        <div className="results-list" aria-live="polite">
          {results.length ? results.map((instructor) => (
            <InstructorCard key={instructor.slug} instructor={instructor} compact />
          )) : (
            <div className="empty-state">
              <h3>No instructor listed here just yet.</h3>
              <p>We&rsquo;re adding instructors in new cities every week. Send us your event details and we&rsquo;ll personally help you find someone.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
