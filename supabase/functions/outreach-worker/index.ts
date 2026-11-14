// Scheduled booker-outreach worker (pg_cron, every 15 minutes).
import { withSupabase } from "npm:@supabase/server@^1";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";
import {
  cityName,
  cleanBusinessName,
  crawlPlannerSite,
  GmailError,
  gmailConfigured,
  gmailMessageIdHeader,
  gmailSend,
  gmailThreadState,
  isPlanner,
  milesBetween,
  type OutreachLead,
  type OutreachMarket,
  type OutreachTemplate,
  renderTemplate,
  serperMaps,
  websiteHost,
} from "../_shared/hld-outreach.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const DISCOVERY_QUERIES = ["wedding planner", "wedding coordinator", "wedding and event planner"];
const CRAWL_BATCH = 12;

type Config = {
  enabled: boolean;
  daily_limit: number;
  send_timezone: string;
  send_hour_start: number;
  send_hour_end: number;
  sender_email: string;
  sender_name: string;
  research_enabled: boolean;
};

function localHourAndDay(timezone: string): { hour: number; weekday: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "numeric", hour12: false, weekday: "short" })
    .formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekday: get("weekday") };
}

async function researchStep(db: Db, log: string[]): Promise<void> {
  const { data: market } = await db.from("outreach_markets").select("*")
    .in("research_status", ["pending", "discovering", "crawling"]).order("created_at").limit(1).maybeSingle();
  if (!market) return;

  if (market.research_status !== "crawling") {
    const queue: string[] = market.research_localities?.length ? [...market.research_localities] : [];
    const locality = queue.shift();
    if (!locality) {
      await db.from("outreach_markets").update({ research_status: "crawling" }).eq("service_market_slug", market.service_market_slug);
      return;
    }
    const places = [];
    for (const query of DISCOVERY_QUERIES) {
      let ll: string | null = null;
      for (let page = 1; page <= 5; page++) {
        let found: Awaited<ReturnType<typeof serperMaps>>["places"] = [];
        try {
          const result = await serperMaps(query, locality, page, ll);
          found = result.places;
          ll = ll ?? result.ll;
        } catch (e) {
          log.push(`serper ${locality} ${query} p${page}: ${(e as Error).message}`);
        }
        places.push(...found);
        if (found.length < 20) break;
      }
    }
    let lat = market.research_center_lat as number | null;
    let lng = market.research_center_lng as number | null;
    if (lat === null || lng === null) {
      const located = places.filter((p) => typeof p.latitude === "number");
      located.sort((a, b) => a.latitude! - b.latitude!);
      const mid = located[Math.floor(located.length / 2)];
      lat = mid?.latitude ?? null;
      lng = mid?.longitude ?? null;
    }
    const rows = [];
    const seen = new Set<string>();
    for (const p of places) {
      if (!isPlanner(p)) continue;
      if (lat !== null && lng !== null && typeof p.latitude === "number" &&
        milesBetween(lat, lng, p.latitude, p.longitude!) > market.research_radius_miles) continue;
      const host = websiteHost(p.website);
      const key = host ?? p.cid ?? p.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const city = (p.address ?? "").split(",").slice(-2, -1)[0]?.trim() || null;
      rows.push({
        service_market_slug: market.service_market_slug,
        business: p.title,
        greeting: `Hi ${cleanBusinessName(p.title)} team,`,
        contact_method: host ? "website" : "phone",
        website: host ? p.website : null,
        website_host: host,
        phone: p.phoneNumber ?? null,
        city,
        maps_category: p.type ?? null,
        rating: p.rating ?? null,
        review_count: p.ratingCount ?? null,
        google_maps_cid: p.cid ?? null,
        source: "Google Maps via Serper",
        crawl_status: host ? "pending" : "done",
        status: "new",
      });
    }
    let inserted = 0;
    for (const row of rows) {
      const { error } = await db.from("outreach_leads").insert(row);
      if (!error) inserted++;
    }
    await db.from("outreach_markets").update({
      research_status: queue.length ? "discovering" : "crawling",
      research_localities: queue,
      research_center_lat: lat,
      research_center_lng: lng,
    }).eq("service_market_slug", market.service_market_slug);
    log.push(`research ${market.service_market_slug}: ${locality} -> ${inserted} new planners`);
    return;
  }

  const { data: pending } = await db.from("outreach_leads").select("id, website")
    .eq("service_market_slug", market.service_market_slug).eq("crawl_status", "pending").limit(CRAWL_BATCH);
  if (!pending?.length) {
    await db.from("outreach_markets").update({ research_status: "done", researched_at: new Date().toISOString() })
      .eq("service_market_slug", market.service_market_slug);
    log.push(`research ${market.service_market_slug}: done`);
    return;
  }
  const results = await Promise.all(pending.map((lead: { id: number; website: string }) =>
    crawlPlannerSite(lead.website).catch(() => null).then((r) => ({ lead, r }))
  ));
  for (const { lead, r } of results) {
    if (!r) {
      await db.from("outreach_leads").update({ crawl_status: "failed" }).eq("id", lead.id);
      continue;
    }
    const update: Record<string, unknown> = { crawl_status: "done", other_emails: r.otherEmails.join(";") || null };
    if (r.firstName) {
      update.first_name = r.firstName;
      update.greeting = `Hi ${r.firstName},`;
      update.name_evidence = r.nameEvidence;
    }
    if (r.email) {
      update.email = r.email;
      update.contact_method = "email";
    } else if (r.formUrl) {
      update.contact_method = "contact_form";
      update.contact_form_url = r.formUrl;
      update.status = "form_pending";
    }
    const { error } = await db.from("outreach_leads").update(update).eq("id", lead.id);
    if (error && r.email) {
      // Same email already belongs to another lead: keep this one without it.
      delete update.email;
      update.contact_method = "website";
      update.notes = `Email ${r.email} already used by another lead`;
      await db.from("outreach_leads").update(update).eq("id", lead.id);
    }
  }
  log.push(`research ${market.service_market_slug}: crawled ${pending.length}`);
}

async function sendStep(db: Db, cfg: Config, log: string[]): Promise<void> {
  const { data: claimed, error } = await db.rpc("outreach_claim_batch", { p_limit: 3 });
  if (error) throw error;
  if (!claimed?.length) return;
  const [{ data: templates }, { data: markets }, { data: serviceMarkets }] = await Promise.all([
    db.from("outreach_templates").select("*").eq("active", true),
    db.from("outreach_markets").select("*"),
    db.from("service_markets").select("slug, name"),
  ]);
  for (const item of claimed as { lead_id: number; kind: "first_touch" | "follow_up" }[]) {
    const { data: lead } = await db.from("outreach_leads").select("*").eq("id", item.lead_id).single();
    const release = (status: string, note?: string) =>
      db.from("outreach_leads").update({ status, locked_at: null, ...(note ? { notes: note } : {}) }).eq("id", item.lead_id);
    const template = (templates as (OutreachTemplate & { audience: string })[])
      .find((t) => t.audience === lead.audience && t.kind === item.kind);
    const market = (markets as OutreachMarket[]).find((m) => m.service_market_slug === lead.service_market_slug);
    const sm = (serviceMarkets as { slug: string; name: string }[]).find((m) => m.slug === lead.service_market_slug);
    if (!template || !market || !sm) {
      await release(item.kind === "first_touch" ? "approved" : "sent");
      continue;
    }
    let rendered;
    try {
      rendered = renderTemplate(template, lead as OutreachLead, market, cityName(sm.name));
    } catch (e) {
      await release(item.kind === "first_touch" ? "approved" : "sent", `Not sent: ${(e as Error).message}`);
      log.push(`skip lead ${lead.id}: ${(e as Error).message}`);
      continue;
    }
    const { data: sendRow, error: insertError } = await db.from("outreach_sends").insert({
      lead_id: lead.id, template_key: template.key, kind: item.kind, to_email: lead.email,
      subject: item.kind === "follow_up" ? `Re: ${rendered.subject}` : rendered.subject, body: rendered.body,
    }).select("id").single();
    if (insertError) {
      await release("uncertain", "A send for this step already exists; check Gmail Sent.");
      continue;
    }
    try {
      let inReplyTo: string | null = null;
      if (item.kind === "follow_up") {
        const { data: first } = await db.from("outreach_sends").select("gmail_message_id")
          .eq("lead_id", lead.id).eq("kind", "first_touch").eq("status", "sent").maybeSingle();
        inReplyTo = first?.gmail_message_id ? await gmailMessageIdHeader(first.gmail_message_id) : null;
      }
      const sent = await gmailSend({
        fromEmail: cfg.sender_email, fromName: cfg.sender_name, to: lead.email,
        subject: item.kind === "follow_up" ? `Re: ${rendered.subject}` : rendered.subject,
        body: rendered.body, threadId: item.kind === "follow_up" ? lead.gmail_thread_id : null, inReplyTo,
      });
      const now = new Date().toISOString();
      await db.from("outreach_sends").update({ status: "sent", sent_at: now, gmail_message_id: sent.id, gmail_thread_id: sent.threadId }).eq("id", sendRow.id);
      await db.from("outreach_leads").update(item.kind === "first_touch"
        ? { status: "sent", first_sent_at: now, gmail_thread_id: sent.threadId, locked_at: null }
        : { status: "followed_up", follow_up_sent_at: now, locked_at: null }).eq("id", lead.id);
      log.push(`sent ${item.kind} to lead ${lead.id}`);
    } catch (e) {
      const err = e instanceof GmailError ? e : new GmailError(String(e), false, true);
      await db.from("outreach_sends").update({ status: err.mayHaveSent ? "uncertain" : "failed", error: err.message }).eq("id", sendRow.id);
      await release(err.mayHaveSent ? "uncertain" : "send_failed", err.message.slice(0, 300));
      log.push(`send error lead ${lead.id}: ${err.message}`);
      if (/sign-in failed/.test(err.message)) break;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

async function replyStep(db: Db, cfg: Config, log: string[]): Promise<void> {
  const { data: leads } = await db.from("outreach_leads").select("id, email, gmail_thread_id")
    .in("status", ["sent", "followed_up"]).not("gmail_thread_id", "is", null).limit(200);
  for (const lead of leads ?? []) {
    const state = await gmailThreadState(lead.gmail_thread_id, cfg.sender_email).catch(() => "none");
    if (state === "replied") {
      await db.from("outreach_leads").update({ status: "replied", replied_at: new Date().toISOString() }).eq("id", lead.id);
      log.push(`reply from lead ${lead.id}`);
    } else if (state === "bounced") {
      await db.from("outreach_leads").update({ status: "bounced" }).eq("id", lead.id);
      await db.from("outreach_suppressions").upsert({ value: lead.email, reason: "bounced" });
      log.push(`bounce lead ${lead.id}`);
    }
  }
}

export default {
  fetch: withSupabase<Db>(
    { auth: "secret:automations", cors: false, supabaseOptions: supabaseServerOptions() },
    async (req, ctx) => {
      if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
      const body = await req.json().catch(() => ({})) as { skip?: string[] };
      const skip = new Set(body.skip ?? []);
      const db = ctx.supabaseAdmin;
      const log: string[] = [];
      const { data: cfg, error } = await db.rpc("outreach_get_config");
      if (error || !cfg) return Response.json({ error: "Outreach config unavailable" }, { status: 500 });

      if (cfg.research_enabled && !skip.has("research")) {
        try {
          await db.rpc("outreach_queue_new_markets");
          if (Deno.env.get("SERPER_API_KEY")) await researchStep(db, log);
        } catch (e) {
          log.push(`research error: ${(e as Error).message}`);
        }
      }

      if (gmailConfigured() && !skip.has("send")) {
        const { hour, minute, weekday } = localHourAndDay(cfg.send_timezone);
        const weekdayOk = !["Sat", "Sun"].includes(weekday);
        try {
          if (cfg.enabled && weekdayOk && hour >= cfg.send_hour_start && hour < cfg.send_hour_end) await sendStep(db, cfg, log);
          if (minute < 15 || body.skip?.includes("force-replies")) await replyStep(db, cfg, log);
        } catch (e) {
          log.push(`send error: ${(e as Error).message}`);
        }
      }
      if (log.length) console.log("outreach-worker", log.join(" | "));
      return Response.json({ ok: true, log });
    },
  ),
};
