"use client";

import { Send } from "lucide-react";

export function InquiryForm({ instructorName = "this instructor" }: { instructorName?: string }) {
  return (
    <form className="lead-form" onSubmit={(event) => event.preventDefault()}>
      <label>Name<input required name="name" placeholder="Your name" /></label>
      <label>Email<input required type="email" name="email" placeholder="you@example.com" /></label>
      <label>Event date<input name="date" type="date" /></label>
      <label>Event location<input name="location" placeholder="City or venue" /></label>
      <label>Guest count<input name="guest_count" type="number" min="1" placeholder="100" /></label>
      <label>Message<textarea name="message" rows={4} placeholder={`Tell ${instructorName} about your event.`} /></label>
      <button type="submit"><Send size={17} aria-hidden="true" /> Send inquiry</button>
      <p className="form-note">Static MVP: connect this form to Supabase and Resend before paid launch.</p>
    </form>
  );
}

export function ApplicationForm() {
  return (
    <form className="lead-form wide" onSubmit={(event) => event.preventDefault()}>
      <label>Name<input required name="name" /></label>
      <label>Business name<input name="business" /></label>
      <label>Email<input required type="email" name="email" /></label>
      <label>City and state<input required name="city" placeholder="Austin, TX" /></label>
      <label>Years teaching<input name="years" type="number" min="0" /></label>
      <label>Travel radius<input name="radius" placeholder="50 miles" /></label>
      <label>Links<input name="links" placeholder="Website, Instagram, TikTok, YouTube" /></label>
      <label>Event types<textarea name="events" rows={3} placeholder="Weddings, corporate events, venues, schools..." /></label>
      <label>Teaching/media notes<textarea name="media" rows={4} placeholder="Paste video links and describe your group teaching experience." /></label>
      <button type="submit"><Send size={17} aria-hidden="true" /> Submit application</button>
      <p className="form-note">Applications are manually reviewed before payment and profile activation.</p>
    </form>
  );
}
