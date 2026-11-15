// Scheduled booker-outreach worker (pg_cron, every 15 minutes).
import { withSupabase } from "npm:@supabase/server@^1";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";
import {
  cityName,
  cleanBusinessName,
  featuredFor,
  crawlPlannerSite,
  domainAcceptsMail,
  GmailError,
  gmailConfigured,
  gmailMessageIdHeader,
  gmailSend,
  gmailThreadState,
  isPlanner,
  milesBetween,
  type MarketInstructor,
  type OutreachLead,
  type OutreachMarket,
  type OutreachTemplate,
  renderTemplate,
  searchBusinessEmail,
  serperMaps,
  websiteHost,
} from "../_shared/hld-outreach.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const DISCOVERY_QUERIES = ["wedding planner", "wedding coordinator", "wedding and event planner"];
// Checkpoint one lead per invocation before the next expensive site is attempted.
const CRAWL_BATCH = 1;
const GRID_QUERIES = ["wedding planner", "wedding coordinator"];
const GRID_POINTS_PER_RUN = 1;

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

type Place = Awaited<ReturnType<typeof serperMaps>>["places"][number];

async function searchPlaces(query: string, locality: string, maxPages: number, log: string[]): Promise<Place[]> {
  // Grid entries look like "@32.85,-96.85,13z"; everything else is a place name.
  const grid = locality.startsWith("@");
  let ll: string | null = grid ? locality : null;
  const out: Place[] = [];
  for (let page = 1; page <= maxPages; page++) {
    let found: Place[] = [];
    try {
      const result = await serperMaps(query, grid ? "" : locality, page, ll);
      found = result.places;
      ll = ll ?? result.ll;
    } catch (e) {
      log.push(`serper ${locality} ${query} p${page}: ${(e as Error).message}`);
    }
    out.push(...found);
    if (found.length < 20) break;
  }
  return out;
}

async function researchStep(db: Db, log: string[]): Promise<void> {
  const { data: market } = await db.from("outreach_markets").select("*")
    .in("research_status", ["pending", "discovering", "crawling"]).order("created_at").limit(1).maybeSingle();
  if (!market) return;

  if (market.research_status !== "crawling") {
    const queue: string[] = market.research_localities?.length ? [...market.research_localities] : [];
    if (!queue.length) {
      await db.from("outreach_markets").update({ research_status: "crawling" }).eq("service_market_slug", market.service_market_slug);
      return;
    }
    // One named locality per run, or a batch of map-grid points searched in parallel.
    const batch = queue[0].startsWith("@")
      ? queue.splice(0, queue.findIndex((q) => !q.startsWith("@")) === -1 ? GRID_POINTS_PER_RUN : Math.min(GRID_POINTS_PER_RUN, queue.findIndex((q) => !q.startsWith("@"))))
      : queue.splice(0, 1);
    const searches = batch.flatMap((locality) =>
      (locality.startsWith("@") ? GRID_QUERIES : DISCOVERY_QUERIES).map((q) => searchPlaces(q, locality, locality.startsWith("@") ? 3 : 5, log))
    );
    const places = (await Promise.all(searches)).flat();
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
        crawl_status: "pending",
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
    log.push(`research ${market.service_market_slug}: ${batch.length > 1 ? `${batch.length} grid points` : batch[0]} -> ${inserted} new planners`);
    return;
  }

  const [{ data: pending }, { data: sm }] = await Promise.all([
    db.from("outreach_leads").select("id, business, city, website, email, status, first_name")
      .eq("service_market_slug", market.service_market_slug).eq("crawl_status", "pending").limit(CRAWL_BATCH),
    db.from("service_markets").select("name, region").eq("slug", market.service_market_slug).single(),
  ]);
  if (!pending?.length) {
    await db.from("outreach_markets").update({ research_status: "done", researched_at: new Date().toISOString() })
      .eq("service_market_slug", market.service_market_slug);
    log.push(`research ${market.service_market_slug}: done`);
    return;
  }
  type Pending = { id: number; business: string; city: string | null; website: string | null; email: string | null; status: string; first_name: string | null };
  const enrich = async (lead: Pending) => {
    const r = lead.website ? await crawlPlannerSite(lead.website).catch(() => null) : null;
    let email = r?.email ?? null;
    let foundBy = email ? "website" : null;
    if (!lead.email && !email) {
      email = await searchBusinessEmail(cleanBusinessName(lead.business), lead.city ?? cityName(sm?.name ?? ""), sm?.region ?? "", lead.website);
      if (email) foundBy = "Google search result";
    }
    if (email && !(await domainAcceptsMail(email))) {
      email = null;
      foundBy = null;
    }
    return { lead, r, email, foundBy };
  };
  const results = await Promise.all((pending as Pending[]).map(enrich));
  let found = 0;
  for (const { lead, r, email, foundBy } of results) {
    if (lead.website && !r) {
      await db.from("outreach_leads").update({ crawl_status: "failed" }).eq("id", lead.id);
      continue;
    }
    const update: Record<string, unknown> = { crawl_status: "done" };
    if (r) update.other_emails = r.otherEmails.join(";") || null;
    if (r?.firstName && !lead.first_name) {
      update.first_name = r.firstName;
      update.greeting = `Hi ${r.firstName},`;
      update.name_evidence = r.nameEvidence;
    }
    const untouched = ["new", "form_pending"].includes(lead.status);
    if (!lead.email && email && untouched) {
      update.email = email;
      update.contact_method = "email";
      update.status = "new";
      update.notes = `Email found by ${foundBy}`;
      found++;
    } else if (!lead.email && r?.formUrl && untouched) {
      update.contact_method = "contact_form";
      update.contact_form_url = r.formUrl;
      update.status = "form_pending";
    }
    const { error } = await db.from("outreach_leads").update(update).eq("id", lead.id);
    if (error && update.email) {
      // Same email already belongs to another lead: keep this one without it.
      delete update.email;
      update.contact_method = r?.formUrl ? "contact_form" : lead.website ? "website" : "phone";
      update.status = r?.formUrl ? "form_pending" : lead.status;
      update.notes = `Email ${email} already used by another lead`;
      await db.from("outreach_leads").update(update).eq("id", lead.id);
      found--;
    }
  }
  log.push(`research ${market.service_market_slug}: enriched ${pending.length}, ${found} new emails`);
}

async function sendStep(db: Db, cfg: Config, log: string[]): Promise<void> {
  const { data: claimed, error } = await db.rpc("outreach_claim_batch", { p_limit: 10 });
  if (error) throw error;
  if (!claimed?.length) return;
  const [{ data: templates }, { data: markets }, { data: serviceMarkets }, { data: instructors }] = await Promise.all([
    db.from("outreach_templates").select("*").eq("active", true),
    db.from("outreach_markets").select("*"),
    db.from("service_markets").select("slug, name"),
    db.from("outreach_market_instructors").select("*"),
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
      const featured = featuredFor(market, (instructors ?? []) as (MarketInstructor & { service_market_slug: string })[], lead.id, lead.featured_instructor_profile_id);
      rendered = renderTemplate(template, lead as OutreachLead, featured.market, cityName(sm.name));
      if (featured.instructorId && featured.instructorId !== lead.featured_instructor_profile_id) {
        await db.from("outreach_leads").update({ featured_instructor_profile_id: featured.instructorId }).eq("id", lead.id);
      }
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
    await new Promise((r) => setTimeout(r, 3000));
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

type Snapshot = {
  sent_today: number;
  today: string;
  markets: { slug: string; name: string; queued_at: string | null; sending_approved: boolean; completed_notified_at: string | null; remaining: number; sent: number; replied: number; bounced: number }[];
};

// Status emails to CJ (internal): daily cap reached, a city finished, or a new city needs details.
async function notifyStep(db: Db, cfg: Config & { notify_email: string | null; last_daily_report_on: string | null }, log: string[]): Promise<void> {
  if (!cfg.notify_email) return;
  const notify = (subject: string, body: string) =>
    gmailSend({ fromEmail: cfg.sender_email, fromName: "Hire Line Dancers Outreach", to: cfg.notify_email!, subject, body });

  const { data: missing } = await db.rpc("outreach_activate_markets");
  for (const m of (missing ?? []) as { service_market_slug: string; missing: string[] }[]) {
    const { data: row } = await db.from("outreach_markets").select("details_requested_at, featured_instructor_name").eq("service_market_slug", m.service_market_slug).single();
    if (row?.details_requested_at || !m.missing.length) continue;
    await notify(`Outreach: ${m.service_market_slug} is researched and needs details`,
      `Planner research for ${m.service_market_slug} is done. Before its emails can go out, add the featured instructor's ${m.missing.join(" and ")} for ${row?.featured_instructor_name ?? "the instructor"} in Admin > Outreach > Cities.\n\nThe city will join the sending queue automatically once that's filled in.`);
    await db.from("outreach_markets").update({ details_requested_at: new Date().toISOString() }).eq("service_market_slug", m.service_market_slug);
    log.push(`asked for details: ${m.service_market_slug}`);
  }

  const { data: snap } = await db.rpc("outreach_status_snapshot") as { data: Snapshot };
  if (!snap) return;
  const queue = snap.markets.filter((m) => m.sending_approved && m.remaining > 0);
  const line = (m: Snapshot["markets"][number]) => `${m.name}: ${m.sent} sent, ${m.replied} replied, ${m.bounced} bounced, ${m.remaining} left`;

  for (const m of snap.markets) {
    if (m.sending_approved && m.remaining === 0 && m.sent > 0 && !m.completed_notified_at) {
      const next = queue[0];
      await notify(`Outreach: ${m.name} planners all emailed`,
        `Every wedding planner with an email in ${m.name} has now been contacted.\n\n${line(m)}\n\n${next ? `Next up: ${next.name} (${next.remaining} planners).` : "No other city is queued yet. A new city starts automatically when an instructor joins somewhere new."}`);
      await db.from("outreach_markets").update({ completed_notified_at: new Date().toISOString() }).eq("service_market_slug", m.slug);
      log.push(`city complete: ${m.slug}`);
    }
  }

  if (snap.sent_today >= cfg.daily_limit && cfg.last_daily_report_on !== snap.today) {
    const active = snap.markets.filter((m) => m.sent > 0 || (m.sending_approved && m.remaining > 0));
    await notify(`Outreach: ${snap.sent_today} planner emails sent today`,
      `Today's ${snap.sent_today} emails are out from ${cfg.sender_email}.\n\n${active.map(line).join("\n")}\n\n${queue.length ? `Queue: ${queue.map((m) => m.name).join(", then ")}.` : "Nothing left in the queue."}`);
    await db.rpc("outreach_mark_daily_report", { p_day: snap.today });
    log.push("daily report sent");
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

      if (gmailConfigured() && !skip.has("send")) {
        // Sends every day from send_hour_start until the daily cap is reached.
        const { hour, minute } = localHourAndDay(cfg.send_timezone);
        try {
          if (cfg.enabled && hour >= cfg.send_hour_start && hour < cfg.send_hour_end) await sendStep(db, cfg, log);
          if (minute < 15 || body.skip?.includes("force-replies")) await replyStep(db, cfg, log);
          await notifyStep(db, cfg, log);
        } catch (e) {
          log.push(`send error: ${(e as Error).message}`);
        }
      }
      if (cfg.research_enabled && !skip.has("research")) {
        try {
          await db.rpc("outreach_queue_new_markets");
          if (Deno.env.get("SERPER_API_KEY")) await researchStep(db, log);
        } catch (e) {
          log.push(`research error: ${(e as Error).message}`);
        }
      }

      if (log.length) console.log("outreach-worker", log.join(" | "));
      return Response.json({ ok: true, log });
    },
  ),
};
