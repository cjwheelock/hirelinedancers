import { withSupabase } from "npm:@supabase/server@^1";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";
import { ProfileReminderError, type ProfileReminderJob, sendProfileReminder } from "../_shared/hld-profile-reminder.ts";

// Dedicated worker for the three-step profile completion sequence (day 1, 4, 10).
// Called every minute by pg_cron with the automations secret key.
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;

async function processReminder(rpc: Rpc, apiKey: string, job: ProfileReminderJob): Promise<string> {
  const { data: sendable, error: checkError } = await rpc("profile_completion_reminder_is_sendable", { p_job_id: job.id });
  if (checkError) throw new Error("Unable to check profile reminder eligibility");
  let status = "cancelled", providerMessageId: string | null = null, failure: string | null = null;
  if (sendable) {
    try {
      providerMessageId = await sendProfileReminder(job, apiKey, fetch, false, async () => {
        const { data, error } = await rpc("profile_completion_reminder_is_sendable", { p_job_id: job.id });
        if (error) throw new ProfileReminderError("Final eligibility check failed; no email sent", "failed");
        return data === true;
      });
      status = "sent";
    } catch (error) {
      const known = error instanceof ProfileReminderError ? error : new ProfileReminderError("Unknown reminder failure", "uncertain");
      status = known.outcome; failure = known.message;
    }
  }
  const { data, error } = await rpc("complete_profile_completion_reminder", {
    p_job_id: job.id, p_status: status, p_provider_message_id: providerMessageId, p_error: failure,
  });
  // Acknowledgement failure is not a failed send: the lease expires to "uncertain", never an automatic duplicate.
  if (error) throw new Error("Unable to acknowledge profile reminder");
  return String(data);
}

export default {
  fetch: withSupabase(
    { auth: "secret:automations", cors: false, supabaseOptions: supabaseServerOptions() },
    async (req, ctx) => {
      if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
      const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
      if (!apiKey) return Response.json({ error: "Reminder worker is not configured" }, { status: 503 });
      const body = await req.json().catch(() => ({})) as { limit?: number };
      const limit = Math.max(1, Math.min(Number(body.limit) || 5, 10));
      // deno-lint-ignore no-explicit-any
      const admin = ctx.supabaseAdmin as any;
      const rpc: Rpc = (fn, args) => admin.rpc(fn, args);
      const { data, error } = await rpc("claim_profile_completion_reminder_sequence", { p_limit: limit });
      if (error) {
        console.error("Unable to claim profile completion reminders", error.code);
        return Response.json({ error: "Unable to claim reminders" }, { status: 500 });
      }
      const settled: string[] = [];
      for (const job of (data ?? []) as ProfileReminderJob[]) {
        try { settled.push(await processReminder(rpc, apiKey, job)); }
        catch { settled.push("worker_error"); }
      }
      return Response.json({ reminders: settled });
    },
  ),
};
