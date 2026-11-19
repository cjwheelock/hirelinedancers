import { withSupabase } from "npm:@supabase/server@^1";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";
import { AdminDealEmailError, type AdminDealNotificationJob, sendAdminDealEmail } from "../_shared/hld-admin-deal-email.ts";

// Owner alerts for quote sent, quote signed, payment received and payout sent.
// Called every minute by pg_cron with the automations secret key.
export default {
  fetch: withSupabase(
    { auth: "secret:automations", cors: false, supabaseOptions: supabaseServerOptions() },
    async (req, ctx) => {
      if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
      const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
      const from = Deno.env.get("RESEND_FROM_EMAIL")?.trim();
      if (!apiKey || !from) return Response.json({ error: "Deal alert worker is not configured" }, { status: 503 });
      const appUrl = new URL(Deno.env.get("APP_URL")?.trim() || "https://hirelinedancers.com");
      const replyTo = Deno.env.get("SUPPORT_EMAIL")?.trim() || "hello@hirelinedancers.com";
      const body = await req.json().catch(() => ({})) as { limit?: number };
      const limit = Math.max(1, Math.min(Number(body.limit) || 10, 25));
      // deno-lint-ignore no-explicit-any
      const admin = ctx.supabaseAdmin as any;
      const { data, error } = await admin.rpc("claim_admin_deal_notification_jobs", { p_limit: limit, p_lock_timeout: "10 minutes" });
      if (error) {
        console.error("Unable to claim deal alerts", error.code);
        return Response.json({ error: "Unable to claim deal alerts" }, { status: 500 });
      }
      const settled: string[] = [];
      for (const job of (data ?? []) as AdminDealNotificationJob[]) {
        let providerMessageId: string | undefined;
        let failure: AdminDealEmailError | undefined;
        try {
          providerMessageId = await sendAdminDealEmail(job, { apiKey, from, appUrl, replyTo });
        } catch (e) {
          failure = e instanceof AdminDealEmailError ? e : new AdminDealEmailError("Deal alert failed", true);
        }
        const { data: status, error: ackError } = await admin.rpc("complete_admin_deal_notification_job", {
          p_job_id: job.job_id, p_attempt_number: job.attempt_number,
          p_success: !!providerMessageId, p_provider_message_id: providerMessageId ?? null,
          p_error: failure?.message ?? null, p_retryable: failure?.retryable ?? false,
        });
        settled.push(ackError ? "ack_error" : String(status));
      }
      return Response.json({ alerts: settled });
    },
  ),
};
