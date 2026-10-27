import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

export type AccountRole = "organizer" | "instructor" | "admin";
export type AccountIntent = Exclude<AccountRole, "admin">;

export type InstructorInvitationLifecycle = {
  status: "pending" | "sending" | "sent" | "delivery_failed" | "claimed" | "accepted" | "expired" | "claim_expired";
  initialClaimDeadlineAt: string;
  claimedAt: string | null;
  profileSubmissionDeadlineAt: string | null;
  accountCreatedAt: string | null;
  profileSubmittedAt: string | null;
  offerCode: string | null;
  offerEligible: boolean;
  offerEarnedAt: string | null;
  grantsLifetimeAccess: boolean;
};

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
  highlights?: ProfileHighlight[];
  packages?: ProfilePackage[];
  created_at?: string | null;
};

export type ProfileHighlight = { title: string; detail?: string };

export type ProfilePackage = {
  name: string;
  description?: string;
  durationHours?: number;
  priceCents?: number | null;
};

export type InstructorSocialLinks = {
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  website?: string;
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
  stripe_payment_method_id: string | null;
  stripe_payment_setup_intent_id: string | null;
  stripe_payment_setup_checkout_session_id: string | null;
  payment_setup_completed_at: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  response_reminders_enabled: boolean;
  instagram_url?: string | null;
  tiktok_url?: string | null;
  youtube_url?: string | null;
  website_url?: string | null;
};

export type InstructorBillingRecovery = {
  id: string;
  instructor_profile_id: string;
  status: "grace_period" | "access_paused" | "recovered" | "closed";
  has_prior_successful_payment: boolean;
  first_failed_at: string;
  last_failed_at: string;
  grace_ends_at: string | null;
  access_paused_at: string | null;
  recovered_at: string | null;
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
  fallback_consent: boolean;
};

export type InquiryThreadStatus =
  | "awaiting_response"
  | "active"
  | "declined"
  | "timed_out"
  | "withdrawn"
  | "closed";

export type InquiryInboxThread = {
  thread_id: string;
  inquiry_id: string;
  thread_status: InquiryThreadStatus | string;
  assignment_order: number;
  counterparty_name: string | null;
  counterparty_profile_slug: string | null;
  event_type: string | null;
  event_date: string | null;
  event_city: string | null;
  event_region: string | null;
  unread_count: number;
  response_due_at: string | null;
  last_message_id: number | null;
  last_message_body: string | null;
  last_message_at: string | null;
  last_message_sender_account_id: string | null;
  next_cursor_at: string | null;
  next_cursor_id: string | null;
};

export type InquiryThreadMessage = {
  id: number;
  thread_id: string;
  sender_account_id: string | null;
  sender_role: "organizer" | "instructor" | "admin" | "system" | string;
  body: string | null;
  message_type: "participant" | "system" | string;
  created_at: string;
  redacted_at: string | null;
};

export type InquiryThreadParticipant = {
  account_id: string;
  participant_role: "organizer" | "instructor" | string;
  display_name: string | null;
  last_read_message_id: number | null;
  last_read_at: string | null;
};

export type InquiryAdminNote = {
  id: number;
  thread_id: string;
  note: string;
  created_at: string;
  author_name: string | null;
};

export type InquiryThreadDetail = {
  thread: Record<string, unknown> & {
    id?: string;
    thread_id?: string;
    inquiry_id?: string;
    status?: string;
    thread_status?: string;
    assignment_source?: string;
    response_due_at?: string | null;
    first_instructor_message_at?: string | null;
    is_current_assignment?: boolean;
  };
  inquiry: MarketplaceInquiry;
  participants: InquiryThreadParticipant[];
  messages: InquiryThreadMessage[];
  admin_notes?: InquiryAdminNote[];
};

export type InquiryFallbackCandidate = {
  instructor_profile_id: string;
  display_name: string;
  service_market_name: string | null;
  active_thread_count: number;
  last_fallback_assigned_at: string | null;
  match_reasons: string[];
  match_score: number;
};

export type MembershipCreditEntitlement = {
  id: string;
  instructor_profile_id: string;
  benefit_code: string;
  source: "admin" | "referral" | "welcome_video";
  status: "pending" | "applying" | "applied" | "consumed" | "voided" | "needs_review";
  source_reference: string;
  awarded_at: string;
  applied_at: string | null;
  consumed_at: string | null;
  expires_at: string | null;
  internal_note: string | null;
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

/** Return only after an explicit account choice is fulfilled, never back to the current page. */
export function accountEntryRedirect(
  role: AccountRole | null,
  intent: AccountIntent | null | undefined,
  isAdmin: boolean,
  returnTo: string | null,
  currentPath: string
): string | null {
  if (!intent || !returnTo) return null;
  if (role !== intent && !(isAdmin && intent === "organizer")) return null;
  const destination = cleanReturnPath(returnTo);
  return destination === cleanReturnPath(currentPath) ? null : destination;
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
