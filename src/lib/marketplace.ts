import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

export type AccountRole = "organizer" | "instructor" | "admin";
export type AccountIntent = Exclude<AccountRole, "admin">;

export type MarketplaceAccount = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AccountRole | null;
  company_name: string | null;
  phone_e164: string | null;
  sms_opt_in: boolean;
  onboarding_completed_at: string | null;
};

export type InstructorProfile = {
  id: string;
  account_id: string;
  slug: string | null;
  status: "draft" | "pending_review" | "approved" | "published" | "suspended";
  display_name: string;
  business_name: string | null;
  headline: string | null;
  bio: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  travel_radius_miles: number | null;
  years_teaching: number | null;
  max_group_size: number | null;
  styles: string[];
  event_types: string[];
  age_groups: string[];
  languages: string[];
  favorite_song_name: string | null;
  favorite_song_spotify_url: string | null;
  provides_speakers: boolean | null;
  provides_microphone: boolean | null;
  provides_music_playback: boolean | null;
  liability_insurance_status: "not_provided" | "available" | "required_per_event";
  preferred_response_hours: number;
};

export type InstructorPrivateSettings = {
  instructor_profile_id: string;
  inquiry_email: string;
  inquiry_phone_e164: string | null;
  sms_notifications_enabled: boolean;
  minimum_rate_cents: number | null;
  minimum_hours: number | null;
  payment_methods: string[];
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  response_reminders_enabled: boolean;
};

export type MarketplaceInquiry = {
  id: string;
  created_at: string;
  organizer_account_id: string;
  instructor_profile_id: string;
  instructor_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  company_name: string | null;
  event_type: string | null;
  event_date: string | null;
  event_city: string | null;
  event_region: string | null;
  guest_count: number | null;
  message: string | null;
  status: string;
  booking_outcome: string;
  booking_event_date: string | null;
  outcome_note: string | null;
  outcome_reported_at: string | null;
  outcome_followup_count: number;
  outcome_last_asked_at: string | null;
  outcome_next_ask_at: string | null;
  completion_status: "unknown" | "completed" | "did_not_happen";
  completion_reported_at: string | null;
  completion_followup_count: number;
  completion_last_asked_at: string | null;
  completion_next_ask_at: string | null;
  first_responded_at: string | null;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let browserClient: SupabaseClient | null | undefined;

export const marketplaceConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export function getMarketplaceClient(): SupabaseClient | null {
  if (browserClient !== undefined) return browserClient;
  if (!supabaseUrl || !supabaseAnonKey || typeof window === "undefined") {
    browserClient = null;
    return browserClient;
  }

  browserClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true
    }
  });
  return browserClient;
}

export function cleanReturnPath(value: string | null | undefined, fallback = "/account/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const trustedOrigin = "https://hirelinedancers.invalid";
    const parsed = new URL(value, trustedOrigin);
    if (parsed.origin !== trustedOrigin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function callbackUrl(next = "/account/"): string {
  if (typeof window === "undefined") return "";
  const url = new URL("/auth/callback/", window.location.origin);
  url.searchParams.set("next", cleanReturnPath(next));
  return url.toString();
}

export function cleanAccountIntent(value: string | null | undefined): AccountIntent | null {
  return value === "instructor" || value === "organizer" ? value : null;
}

export function cleanInstructorInvitationToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const token = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export async function instructorInvitationTokenHash(token: string): Promise<string> {
  const cleanToken = cleanInstructorInvitationToken(token);
  if (!cleanToken) throw new Error("The instructor invitation link is invalid.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cleanToken));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function signInUrl(next = "/account/", intent?: AccountIntent): string {
  const query = new URLSearchParams({ next: cleanReturnPath(next) });
  if (intent) query.set("role", intent);
  return `/sign-in/?${query.toString()}`;
}

export function authIdentity(session: Session | null): { user: User | null; email: string | null } {
  return {
    user: session?.user ?? null,
    email: session?.user.email ?? null
  };
}

export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[()\s.-]/g, "");
  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : null;
}

export function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "Something went wrong. Please try again.";
}
