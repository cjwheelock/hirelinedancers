// Booker outreach helpers: template rendering, Gmail API sending from the outreach inbox, and planner research.
// Copy for every email lives in public.outreach_templates and is approved by CJ; nothing here writes copy.

export type OutreachMarket = {
  service_market_slug: string;
  featured_instructor_name: string | null;
  featured_instructor_years: number | null;
  featured_instructor_pronoun: "she" | "he" | "they" | null;
  featured_profile_url: string | null;
  research_localities: string[];
  research_radius_miles: number;
  research_center_lat: number | null;
  research_center_lng: number | null;
};

export type OutreachLead = {
  id: number;
  service_market_slug: string;
  business: string;
  first_name: string | null;
  greeting: string;
  email: string | null;
  website: string | null;
  status: string;
  gmail_thread_id: string | null;
};

export type OutreachTemplate = { key: string; kind: string; subject_template: string; body_template: string };

const PRONOUNS = {
  she: { Possessive: "Her", possessive: "her", subject_has: "she's", object: "her" },
  he: { Possessive: "His", possessive: "his", subject_has: "he's", object: "him" },
  they: { Possessive: "Their", possessive: "their", subject_has: "they've", object: "them" },
} as const;

export function cityName(marketName: string): string {
  return marketName.replace(/\s+(metro|and .*|Bay Area)$/i, "").trim();
}

export function renderTemplate(
  template: OutreachTemplate,
  lead: OutreachLead,
  market: OutreachMarket,
  city: string,
): { subject: string; body: string } {
  const pronoun = PRONOUNS[market.featured_instructor_pronoun ?? "they"];
  const values: Record<string, string> = {
    greeting: lead.greeting,
    city,
    a_city: `${/^[aeiou]/i.test(city) ? "an" : "a"} ${city}`,
    instructor_name: market.featured_instructor_name ?? "",
    instructor_years: market.featured_instructor_years?.toString() ?? "",
    profile_url: market.featured_profile_url ?? "",
    business: lead.business,
    first_name: lead.first_name ?? "",
    ...pronoun,
  };
  const fill = (text: string) =>
    text.replace(/\{([A-Za-z_]+)\}/g, (match, key: string) => {
      if (!(key in values)) throw new Error(`Unknown template field ${match}`);
      if (!values[key]) throw new Error(`Missing value for ${match}`);
      return values[key];
    });
  return { subject: fill(template.subject_template), body: fill(template.body_template) };
}

export type MarketInstructor = {
  instructor_profile_id: string;
  name: string;
  years: number | null;
  pronoun: "she" | "he" | "they" | null;
  profile_url: string;
};

// Cities with several featured instructors alternate between the complete ones; a lead keeps the one it was given.
export function featuredFor(
  market: OutreachMarket,
  instructors: (MarketInstructor & { service_market_slug: string })[],
  leadId: number,
  assigned: string | null,
): { market: OutreachMarket; instructorId: string | null } {
  const complete = instructors.filter((i) => i.service_market_slug === market.service_market_slug && i.years !== null && i.pronoun);
  if (!complete.length) return { market, instructorId: null };
  const pick = complete.find((i) => i.instructor_profile_id === assigned) ?? complete[leadId % complete.length];
  return {
    market: { ...market, featured_instructor_name: pick.name, featured_instructor_years: pick.years, featured_instructor_pronoun: pick.pronoun, featured_profile_url: pick.profile_url },
    instructorId: pick.instructor_profile_id,
  };
}

// ---------- Gmail ----------

export class GmailError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly mayHaveSent = false) {
    super(message);
  }
}

let cachedToken: { value: string; expires: number } | null = null;

export function gmailConfigured(): boolean {
  return ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN"].every((k) =>
    !!Deno.env.get(k)?.trim()
  );
}

async function gmailAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GMAIL_OAUTH_CLIENT_ID")!.trim(),
      client_secret: Deno.env.get("GMAIL_OAUTH_CLIENT_SECRET")!.trim(),
      refresh_token: Deno.env.get("GMAIL_OAUTH_REFRESH_TOKEN")!.trim(),
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !data.access_token) {
    throw new GmailError(`Gmail sign-in failed: ${data.error ?? response.status}`, false);
  }
  cachedToken = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3000) * 1000 };
  return cachedToken.value;
}

async function gmail(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await gmailAccessToken();
  return fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
}

function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function b64url(text: string): string {
  return b64(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;
}

export type SendInput = {
  fromEmail: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string | null;
  inReplyTo?: string | null;
};

// Renders the plain-text body like an email typed in Gmail: full-width paragraphs, blank line between them.
export function bodyToHtml(body: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const link = (t: string) => t.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}">${u}</a>`);
  return `<div dir="ltr">${link(esc(body)).split("\n").map((line) => line ? `<div>${line}</div>` : "<div><br></div>").join("")}</div>`;
}

export async function gmailSend(input: SendInput): Promise<{ id: string; threadId: string }> {
  if (/[\r\n]/.test(input.to + input.subject + input.fromEmail + input.fromName)) {
    throw new GmailError("Header contains a line break", false);
  }
  const boundary = `hld-${crypto.randomUUID()}`;
  const lines = [
    `From: ${encodeHeader(input.fromName)} <${input.fromEmail}>`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (input.inReplyTo) lines.push(`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`);
  const wrap = (text: string) => b64(text).replace(/(.{76})/g, "$1\r\n");
  const mime = [
    lines.join("\r\n"),
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(input.body),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(bodyToHtml(input.body)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const raw = b64url(mime);
  let response: Response;
  try {
    response = await gmail("messages/send", {
      method: "POST",
      body: JSON.stringify(input.threadId ? { raw, threadId: input.threadId } : { raw }),
    });
  } catch (error) {
    // A timeout after the request left may still have sent the email.
    throw new GmailError(`Gmail request failed: ${error instanceof Error ? error.message : error}`, false, true);
  }
  const data = await response.json().catch(() => ({})) as { id?: string; threadId?: string; error?: { message?: string } };
  if (!response.ok || !data.id || !data.threadId) {
    throw new GmailError(`Gmail send failed (${response.status}): ${data.error?.message ?? "unknown"}`, response.status >= 500 || response.status === 429);
  }
  return { id: data.id, threadId: data.threadId };
}

export async function gmailMessageIdHeader(gmailId: string): Promise<string | null> {
  const response = await gmail(`messages/${gmailId}?format=metadata&metadataHeaders=Message-ID`);
  if (!response.ok) return null;
  const data = await response.json() as { payload?: { headers?: { name: string; value: string }[] } };
  return data.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id")?.value ?? null;
}

export type ThreadState = "none" | "replied" | "bounced";

export async function gmailThreadState(threadId: string, senderEmail: string): Promise<ThreadState> {
  const response = await gmail(`threads/${threadId}?format=metadata&metadataHeaders=From`);
  if (!response.ok) return "none";
  const data = await response.json() as { messages?: { payload?: { headers?: { name: string; value: string }[] } }[] };
  let state: ThreadState = "none";
  for (const message of data.messages ?? []) {
    const from = (message.payload?.headers?.find((h) => h.name.toLowerCase() === "from")?.value ?? "").toLowerCase();
    if (!from || from.includes(senderEmail.toLowerCase())) continue;
    if (/mailer-daemon|postmaster|mail delivery/.test(from)) state = "bounced";
    else return "replied";
  }
  return state;
}

// ---------- Research ----------

const KEEP_TYPES = new Set(["Wedding planner", "Event planner", "Party planner", "Event management company", "Wedding service"]);
const NOT_PLANNER = /\b(dj|djs|entertainment|bartend\w*|bar service|cater\w*|photo\w*|video\w*|rental\w*|limo\w*|venue|ranch|hall|ballroom|chapel|hotel|inn|resort|florist|floral|flowers|cake|bakery|band|music|sound|lighting|wedgewood|bounce|tent|transportation|shuttle|church|balloons?|picnics?|staffing|decor)\b/i;
const DIRECTORY_HOSTS = /(theknot|zola\.com|weddingwire|yelp|thumbtack|bark\.com|gigsalad|thebash|facebook\.com|instagram\.com|linktr\.ee|google\.com|texasweddings\.com)/i;

export type Place = {
  title: string;
  type?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  website?: string;
  phoneNumber?: string;
  rating?: number;
  ratingCount?: number;
  cid?: string;
};

export async function serperMaps(query: string, location: string, page: number, ll?: string | null): Promise<{ places: Place[]; ll: string | null }> {
  const key = Deno.env.get("SERPER_API_KEY")?.trim();
  if (!key) throw new Error("SERPER_API_KEY is not set");
  const response = await fetch("https://google.serper.dev/maps", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    // An empty location means a map-grid search: the query runs at the given ll point on every page.
    body: JSON.stringify({
      q: location ? `${query} in ${location}` : query,
      gl: "us",
      page,
      ...((page > 1 || !location) && ll ? { ll } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Serper ${response.status}`);
  const data = await response.json() as { places?: Place[]; ll?: string };
  return { places: data.places ?? [], ll: data.ll ?? null };
}

export function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 3959 * Math.asin(Math.sqrt(a));
}

export function isPlanner(place: Place): boolean {
  if (!place.type || !KEEP_TYPES.has(place.type)) return false;
  const text = `${place.title} ${(place.website ?? "").replace(/[.\-/]/g, " ")}`;
  if (NOT_PLANNER.test(text) && !/plann|coordinat/i.test(place.title)) return false;
  if (place.type === "Wedding service" && !/plan|coordinat|event/i.test(place.title)) return false;
  return true;
}

export function websiteHost(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).host.toLowerCase().replace(/^www\./, "");
    return DIRECTORY_HOSTS.test(host) ? null : host;
  } catch {
    return null;
  }
}

export function cleanBusinessName(name: string): string {
  let b = name.split(/\s[-|–]\s|,/)[0].trim();
  b = b.replace(/\b(LLC|Llc|L\.L\.C\.)\b\.?/g, "").replace(/^the\s+/i, "").trim().replace(/[ ,.]+$/, "");
  if (b === b.toUpperCase()) b = b.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return b;
}

// Bounded email tokens prevent quadratic regex backtracking on base64/script blobs.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,10}/g;
const EMAIL_EXACT = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
const BAD_EMAIL = /(wixpress|sentry|example\.|domain\.com|yourdomain|mysite\.com|email\.com|godaddy|squarespace|@2x|\.png|\.jpe?g|\.gif|\.webp|\.svg|u003e|wix\.com|cloudflare|schema\.org|jquery|noreply|no-reply|privacy@|webmaster)/i;
const NAME_STOP = new Set(
  "the your our a an so here from just going not excited happy passionate based located texas wedding weddings events event planner planning team there and with you this that we in very proud ready thrilled".split(" "),
);
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" };

const MAX_PAGE_BYTES = 300_000;

export async function boundedPageText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (bytes < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, MAX_PAGE_BYTES - bytes);
      text += decoder.decode(part, { stream: true });
      bytes += part.byteLength;
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function getPage(url: string): Promise<{ html: string; url: string }> {
  try {
    const response = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return { html: "", url };
    const type = response.headers.get("content-type") ?? "text/html";
    if (!type.includes("html") && !type.includes("xml")) return { html: "", url };
    return { html: await boundedPageText(response), url: response.url };
  } catch {
    return { html: "", url };
  }
}

function pageText(html: string): string {
  return html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/\s+/g, " ");
}

// Cloudflare email protection stores addresses XOR-encoded in data-cfemail or /cdn-cgi/l/email-protection#...
function cfDecode(enc: string): string {
  const key = parseInt(enc.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < enc.length; i += 2) out += String.fromCharCode(parseInt(enc.slice(i, i + 2), 16) ^ key);
  return out;
}

const OBFUSCATED = /\b([A-Za-z0-9._%+-]{2,64})\s*(?:\[at\]|\(at\)|\{at\}|\s+at\s+)\s*([A-Za-z0-9-]{2,63})\s*(?:\[dot\]|\(dot\)|\s+dot\s+)\s*(com|net|org|co|us|events)\b/gi;

function extractEmails(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) out.add(cfDecode(m[1]).toLowerCase());
  for (const m of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) out.add(cfDecode(m[1]).toLowerCase());
  for (const m of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) {
    try { out.add(decodeURIComponent(m[1]).toLowerCase().trim()); } catch { /* bad escape */ }
  }
  const t = html.replace(/\\u0040/g, "@").replace(/&#64;|&#x40;|%40|\[at\]|\(at\)/gi, "@");
  for (const e of t.match(EMAIL) ?? []) out.add(e.toLowerCase().replace(/\.$/, ""));
  for (const m of pageText(html).matchAll(OBFUSCATED)) out.add(`${m[1]}@${m[2]}.${m[3]}`.toLowerCase());
  return out;
}

export type CrawlResult = { email: string | null; otherEmails: string[]; firstName: string | null; nameEvidence: string | null; formUrl: string | null; reachable: boolean };

const PAGE_KEYWORDS = /contact|about|inquir|connect|team|meet|founder|our-story|who-we-are|faq|book|pricing|services|investment|get-in-touch|hello|start/i;

export async function crawlPlannerSite(site: string): Promise<CrawlResult> {
  const result: CrawlResult = { email: null, otherEmails: [], firstName: null, nameEvidence: null, formUrl: null, reachable: false };
  const home = await getPage(site);
  if (!home.html) return result;
  result.reachable = true;
  const base = new URL(home.url);
  const host = base.host.replace(/^www\./, "");
  const sameHost = (u: URL) => u.host.replace(/^www\./, "") === host;
  const toUrl = (h: string) => { try { return new URL(h, base); } catch { return null; } };
  const links = [...home.html.matchAll(/href=["']([^"'#]+)/gi)].map((m) => toUrl(m[1])).filter((u): u is URL => !!u);
  const sitemap = await getPage(`${base.origin}/sitemap.xml`);
  for (const m of sitemap.html.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    const u = toUrl(m[1].trim());
    if (u) links.push(u);
    if (links.length > 200) break;
  }
  const candidates = [...new Set(links.filter((u) => sameHost(u) && PAGE_KEYWORDS.test(u.pathname) && !/\.xml$/i.test(u.pathname)).map((u) => u.origin + u.pathname))].slice(0, 6);
  const about = candidates.filter((u) => /about|meet|team|founder|our-story|who-we-are/i.test(u));
  const fetched = await Promise.all(candidates.map((u) => getPage(u).then((p) => ({ url: u, html: p.html }))));
  const pages = [{ url: home.url, html: home.html }, ...fetched];

  const emails = new Set<string>();
  for (const p of pages) for (const e of extractEmails(p.html)) emails.add(e);
  const good = [...emails].filter((e) => EMAIL_EXACT.test(e) && !BAD_EMAIL.test(e) && e.length <= 60 && !/^\d/.test(e));
  good.sort((a, b) => Number(b.endsWith("@" + host)) - Number(a.endsWith("@" + host)));
  result.email = good[0] ?? null;
  result.otherEmails = good.slice(1, 5);

  // First name: only strong self-introductions ("I'm Kristin", "my name is Lily", "Meet Shawna" repeated).
  const text = [home.html, ...fetched.filter((p) => about.includes(p.url)).map((p) => p.html)].map(pageText).join(" ");
  const strong = /(?:hi|hey|hello)[,!.]*\s+i['’]m\s+([A-Z][a-z]{2,14})\b|my name is\s+([A-Z][a-z]{2,14})\b/g;
  for (const m of text.matchAll(strong)) {
    const name = m[1] ?? m[2];
    if (name && !NAME_STOP.has(name.toLowerCase())) {
      result.firstName = name;
      result.nameEvidence = text.slice(Math.max(0, m.index! - 30), m.index! + m[0].length + 30).trim();
      break;
    }
  }
  if (!result.firstName) {
    for (const m of text.matchAll(/\bmeet\s+([A-Z][a-z]{2,14})\b/g)) {
      const name = m[1];
      if (NAME_STOP.has(name.toLowerCase())) continue;
      const count = text.split(new RegExp(`\\b${name}\\b`)).length - 1;
      const inEmail = result.email?.split("@")[0].includes(name.toLowerCase());
      if (count >= 2 || inEmail) {
        result.firstName = name;
        result.nameEvidence = text.slice(Math.max(0, m.index! - 30), m.index! + m[0].length + 40).trim();
        break;
      }
    }
  }

  if (!result.email) {
    const formPattern = /<form|wpforms|gform|hsforms|jotform|typeform|honeybook|dubsado|17hats|tave|squarespace-form|form-wrapper|wix-forms/i;
    const withForm = pages.find((p) => formPattern.test(p.html) && (p.url === home.url || /contact|inquir|connect|get-in-touch|book/i.test(p.url)));
    if (withForm) result.formUrl = withForm.url;
  }
  return result;
}

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "icloud.com", "hotmail.com", "outlook.com", "aol.com", "live.com", "me.com", "msn.com", "att.net", "sbcglobal.net", "ymail.com"]);
const letters = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");

// Google (via Serper, 1 credit): '"<business>" <city> <state> email', keeping only addresses that clearly belong to the business.
export async function searchBusinessEmail(business: string, city: string, region: string, website: string | null): Promise<string | null> {
  const key = Deno.env.get("SERPER_API_KEY")?.trim();
  if (!key) return null;
  let data: { organic?: { title?: string; snippet?: string }[]; knowledgeGraph?: unknown };
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: `"${business}" ${city} ${region} email`, gl: "us", num: 10 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    data = await response.json();
  } catch {
    return null;
  }
  const text = (data.organic ?? []).map((o) => `${o.title ?? ""} ${o.snippet ?? ""}`).join(" ") + " " + JSON.stringify(data.knowledgeGraph ?? {});
  const host = websiteHost(website);
  const root = host ? host.split(".").slice(-2).join(".") : null;
  const name = letters(business);
  for (const raw of new Set(text.match(EMAIL) ?? [])) {
    const e = raw.toLowerCase().replace(/\.$/, "");
    if (!EMAIL_EXACT.test(e) || BAD_EMAIL.test(e)) continue;
    const domain = e.split("@")[1];
    const core = letters(domain.split(".")[0]);
    const local = letters(e.split("@")[0]);
    const matches = (root && domain.endsWith(root)) ||
      (core.length >= 5 && (name.includes(core.slice(0, 7)) || core.includes(name.slice(0, 7)))) ||
      (FREE_MAIL.has(domain) && local.length >= 5 && (name.includes(local.slice(0, 7)) || local.includes(name.slice(0, 7))));
    if (matches) return e;
  }
  return null;
}

// True when the email's domain has a mail server; unknown (lookup error) counts as true.
export async function domainAcceptsMail(email: string): Promise<boolean> {
  const domain = email.split("@")[1];
  try {
    const mx = await Deno.resolveDns(domain, "MX");
    if (mx.length) return true;
    const a = await Deno.resolveDns(domain, "A").catch(() => []);
    return a.length > 0;
  } catch (e) {
    return !/no.?data|not.?found|NXDOMAIN/i.test(String(e));
  }
}
