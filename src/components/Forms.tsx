"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Send, X } from "lucide-react";
import { eventTypes } from "@/data/site";
import { supabase, supabaseEnabled, uploadImage } from "@/lib/supabase";
import { getSpotifyTrackLinks } from "@/lib/spotify";

const MAX_FILE_MB = 8;

type Picked = { file: File; url: string };

function validImage(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Please choose an image file (JPG, PNG, or HEIC).";
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `Each image must be under ${MAX_FILE_MB}MB.`;
  return null;
}

/* ---------------- Image uploader ---------------- */
function ImageUploader({
  label,
  hint,
  required = false,
  multiple = false,
  max = 1,
  files,
  setFiles,
  setError
}: {
  label: string;
  hint?: string;
  required?: boolean;
  multiple?: boolean;
  max?: number;
  files: Picked[];
  setFiles: (f: Picked[]) => void;
  setError: (msg: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function onPick(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const next = [...files];
    for (const file of incoming) {
      if (next.length >= max) break;
      const err = validImage(file);
      if (err) { setError(err); continue; }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    setFiles(next);
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(i: number) {
    const next = [...files];
    URL.revokeObjectURL(next[i].url);
    next.splice(i, 1);
    setFiles(next);
  }

  return (
    <div className="uploader">
      <label className={required ? "req" : undefined} style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-2)" }}>
        {label}
      </label>
      {hint && <span className="form-hint">{hint}</span>}
      {files.length < max && (
        <div className="dropzone" onClick={() => inputRef.current?.click()} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}>
          <ImagePlus size={26} />
          <div className="dz-title">Click to upload {multiple ? "photos" : "a photo"}</div>
          <div className="dz-sub">JPG or PNG, up to {MAX_FILE_MB}MB{multiple ? ` · up to ${max}` : ""}</div>
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" multiple={multiple} hidden
        onChange={(e) => onPick(e.target.files)} />
      {files.length > 0 && (
        <div className="thumb-row">
          {files.map((f, i) => (
            <div className="thumb" key={f.url}>
              <img src={f.url} alt={`Selected ${i + 1}`} />
              <button type="button" aria-label="Remove" onClick={() => remove(i)}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Application form ---------------- */
export function ApplicationForm() {
  const [headshot, setHeadshot] = useState<Picked[]>([]);
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    const form = e.currentTarget;
    const data = new FormData(form);
    const selectedEvents = data.getAll("events").map(String);

    if (headshot.length === 0) { setError("A headshot is required so planners can see who they’re booking."); return; }
    if (selectedEvents.length === 0) { setError("Choose at least one type of booking you’re open to."); return; }
    if (!supabaseEnabled || !supabase) {
      setError("Applications aren’t connected yet. Please email us at hello@hirelinedancers.com and we’ll get you set up.");
      return;
    }

    const favoriteSong = String(data.get("favorite_song") || "").trim();
    const spotifyUrl = String(data.get("spotify_track_url") || "").trim();
    const spotifyTrack = spotifyUrl ? getSpotifyTrackLinks(spotifyUrl) : null;
    if (spotifyUrl && !spotifyTrack) {
      setError("Please paste a valid Spotify track link, such as https://open.spotify.com/track/...");
      return;
    }
    setStatus("submitting");
    try {
      const folder = `applications/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const headshotUrl = await uploadImage(headshot[0].file, folder);
      const photoUrls: string[] = [];
      for (const p of photos) photoUrls.push(await uploadImage(p.file, folder));

      const { error: dbError } = await supabase.from("instructor_applications").insert({
        name: data.get("name"),
        business: data.get("business"),
        email: data.get("email"),
        phone: data.get("phone"),
        city: data.get("city"),
        years: data.get("years") ? Number(data.get("years")) : null,
        travel_radius: data.get("radius"),
        links: data.get("links"),
        events: selectedEvents.join(","),
        bio: data.get("bio"),
        favorite_song: favoriteSong || null,
        spotify_track_url: spotifyTrack?.openUrl || null,
        headshot_url: headshotUrl,
        photo_urls: photoUrls,
        status: "pending"
      });
      if (dbError) throw dbError;
      setStatus("done");
    } catch (err) {
      console.error(err);
      setStatus("idle");
      setError("Something went wrong submitting your application. Please try again, or email hello@hirelinedancers.com.");
    }
  }

  if (status === "done") {
    return (
      <div className="lead-form wide">
        <div className="form-banner success">
          <strong>Application received!</strong>
        </div>
        <p>Thanks for applying to Hire Line Dancers. We personally review every application and will email you within a few business days. If you&rsquo;re approved, you&rsquo;ll get a secure link to activate your profile.</p>
      </div>
    );
  }

  return (
    <form className="lead-form wide" onSubmit={onSubmit}>
      {error && <div className="form-banner error">{error}</div>}
      <div className="two-col">
        <label className="req">Full name<input required name="name" placeholder="Jordan Wells" /></label>
        <label>Business name<input name="business" placeholder="Dallas Social Line Dance" /></label>
      </div>
      <div className="two-col">
        <label className="req">Email<input required type="email" name="email" placeholder="you@example.com" /></label>
        <label>Phone<input name="phone" type="tel" placeholder="(555) 555-5555" /></label>
      </div>
      <div className="two-col">
        <label className="req">City &amp; state<input required name="city" placeholder="Austin, TX" /></label>
        <label>Years teaching<input name="years" type="number" min="0" placeholder="5" /></label>
      </div>
      <label>How far will you travel?<input name="radius" placeholder="Within 60 miles of Austin" /></label>
      <label>Links<input name="links" placeholder="Website, Instagram, TikTok, YouTube" /></label>
      <fieldset className="event-picker">
        <legend className="req">Which bookings are you open to?</legend>
        <span className="form-hint">Choose all that apply. You can update these preferences later.</span>
        <div className="event-option-grid">
          {eventTypes.map((event) => (
            <label className="event-option" key={event.slug}>
              <input type="checkbox" name="events" value={event.slug} />
              <span>
                <strong>{event.label}</strong>
                <small>{event.bookingHint}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>Tell planners about you<textarea name="bio" rows={4} placeholder="Your style, what makes your lessons fun, the kinds of crowds you love." /></label>
      <div className="two-col">
        <label>
          Favorite line dance song
          <input name="favorite_song" maxLength={200} placeholder="Boot Scootin' Boogie by Brooks & Dunn" />
          <span className="form-hint">Add the song and artist so planners get to know your style.</span>
        </label>
        <label>
          Spotify track link
          <input
            name="spotify_track_url"
            type="url"
            inputMode="url"
            maxLength={512}
            placeholder="https://open.spotify.com/track/..."
          />
          <span className="form-hint">Optional. We will turn this into a playable Spotify preview on your profile.</span>
        </label>
      </div>

      <ImageUploader
        label="Headshot"
        hint="A clear, friendly photo of you. This is the first thing planners see."
        required
        max={1}
        files={headshot}
        setFiles={setHeadshot}
        setError={setError}
      />
      <ImageUploader
        label="Teaching / dancing photos (optional)"
        hint="Add 1–3 photos of you in action with a crowd. These bring your profile to life."
        multiple
        max={3}
        files={photos}
        setFiles={setPhotos}
        setError={setError}
      />

      <button className="button primary" type="submit" disabled={status === "submitting"}>
        {status === "submitting"
          ? (<><Loader2 size={17} className="spin" aria-hidden="true" /> Submitting…</>)
          : (<><Send size={17} aria-hidden="true" /> Submit application</>)}
      </button>
      <p className="form-note">Every application is personally reviewed before payment and profile activation.</p>
    </form>
  );
}

/* ---------------- Buyer inquiry form ---------------- */
export function InquiryForm({ instructorName = "this instructor", instructorSlug = "" }: { instructorName?: string; instructorSlug?: string }) {
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!supabaseEnabled || !supabase) {
      setError("Inquiries aren’t connected yet. Please email hello@hirelinedancers.com and we’ll route your request.");
      return;
    }
    const data = new FormData(e.currentTarget);
    setStatus("submitting");
    try {
      const { error: dbError } = await supabase.from("inquiries").insert({
        instructor_slug: instructorSlug,
        instructor_name: instructorName,
        name: data.get("name"),
        email: data.get("email"),
        event_date: data.get("date") || null,
        location: data.get("location"),
        guest_count: data.get("guest_count") ? Number(data.get("guest_count")) : null,
        message: data.get("message"),
        status: "new"
      });
      if (dbError) throw dbError;
      setStatus("done");
    } catch (err) {
      console.error(err);
      setStatus("idle");
      setError("Something went wrong sending your inquiry. Please try again or email hello@hirelinedancers.com.");
    }
  }

  if (status === "done") {
    return (
      <div className="form-banner success">
        <strong>Inquiry sent!</strong> {instructorName} will be in touch soon to talk dates and details.
      </div>
    );
  }

  return (
    <form className="lead-form" onSubmit={onSubmit}>
      {error && <div className="form-banner error">{error}</div>}
      <label className="req">Name<input required name="name" placeholder="Your name" /></label>
      <label className="req">Email<input required type="email" name="email" placeholder="you@example.com" /></label>
      <div className="two-col">
        <label>Event date<input name="date" type="date" /></label>
        <label>Guest count<input name="guest_count" type="number" min="1" placeholder="100" /></label>
      </div>
      <label>Event location<input name="location" placeholder="City or venue" /></label>
      <label>Message<textarea name="message" rows={4} placeholder={`Tell ${instructorName} about your event.`} /></label>
      <button className="button primary" type="submit" disabled={status === "submitting"}>
        {status === "submitting"
          ? (<><Loader2 size={17} className="spin" aria-hidden="true" /> Sending…</>)
          : (<><Send size={17} aria-hidden="true" /> Send inquiry</>)}
      </button>
    </form>
  );
}
