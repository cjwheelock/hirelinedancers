// Administrator actions for booker outreach: preview a lead's email, send a test to yourself,
// and check the Gmail connection. Never sends to a lead.
import { withSupabase } from "npm:@supabase/server@^1";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";
import {
  cityName,
  gmailConfigured,
  gmailSend,
  type OutreachLead,
  type OutreachMarket,
  type OutreachTemplate,
  renderTemplate,
} from "../_shared/hld-outreach.ts";

// deno-lint-ignore no-explicit-any
type Db = any;


async function render(db: Db, leadId: number, kind: string) {
  const { data: lead } = await db.from("outreach_leads").select("*").eq("id", leadId).single();
  if (!lead) throw new Error("Lead not found");
  const [{ data: template }, { data: market }, { data: sm }] = await Promise.all([
    db.from("outreach_templates").select("*").eq("audience", lead.audience).eq("kind", kind).eq("active", true).maybeSingle(),
    db.from("outreach_markets").select("*").eq("service_market_slug", lead.service_market_slug).maybeSingle(),
    db.from("service_markets").select("name").eq("slug", lead.service_market_slug).single(),
  ]);
  if (!template) throw new Error(`No active ${kind} template`);
  if (!market) throw new Error("Market has no outreach settings");
  return { lead, ...renderTemplate(template as OutreachTemplate, lead as OutreachLead, market as OutreachMarket, cityName(sm.name)) };
}

export default {
  fetch: withSupabase<Db>(
    { auth: "user", supabaseOptions: supabaseServerOptions() },
    async (req, ctx) => {
      if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
      const accountId = ctx.userClaims?.id;
      const db = ctx.supabaseAdmin;
      const { data: admin } = await db.from("marketplace_admins").select("account_id").eq("account_id", accountId).maybeSingle();
      if (!admin) return Response.json({ error: "Administrator access required" }, { status: 403 });
      const body = await req.json().catch(() => ({})) as { action?: string; lead_id?: number; kind?: string; to?: string };
      try {
        if (body.action === "status") {
          const { data: cfg } = await db.rpc("outreach_get_config");
          return Response.json({ gmailConfigured: gmailConfigured(), serperConfigured: !!Deno.env.get("SERPER_API_KEY"), config: cfg });
        }
        if (body.action === "preview") {
          const r = await render(db, Number(body.lead_id), body.kind ?? "first_touch");
          return Response.json({ to: r.lead.email, subject: r.subject, body: r.body });
        }
        if (body.action === "send_test") {
          const to = (body.to ?? "").trim().toLowerCase();
          const { data: cfg0 } = await db.rpc("outreach_get_config");
          const { data: me } = await db.from("accounts").select("email").eq("id", accountId).maybeSingle();
          const allowed = new Set([String(cfg0?.sender_email ?? "").toLowerCase(), String(me?.email ?? "").toLowerCase()].filter(Boolean));
          if (!allowed.has(to)) return Response.json({ error: "Tests can only go to your own account email or the sending inbox" }, { status: 400 });
          if (!gmailConfigured()) return Response.json({ error: "Gmail is not connected yet" }, { status: 409 });
          const r = await render(db, Number(body.lead_id), body.kind ?? "first_touch");
          const { data: cfg } = await db.rpc("outreach_get_config");
          const sent = await gmailSend({ fromEmail: cfg.sender_email, fromName: cfg.sender_name, to, subject: `[TEST] ${r.subject}`, body: r.body });
          await db.from("outreach_sends").insert({
            lead_id: null, template_key: body.kind ?? "first_touch", kind: "test", to_email: to, subject: `[TEST] ${r.subject}`,
            body: r.body, status: "sent", gmail_message_id: sent.id, gmail_thread_id: sent.threadId, sent_at: new Date().toISOString(),
          });
          return Response.json({ ok: true, to });
        }
        return Response.json({ error: "Unknown action" }, { status: 400 });
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 400 });
      }
    },
  ),
};
