// Pure helpers for the admin Analytics section. Days are Eastern Time calendar days (YYYY-MM-DD).

export const ANALYTICS_TIME_ZONE = "America/New_York";

export type AnalyticsRange = "7d" | "30d" | "90d" | "all";
export type ManualChannel = "instagram_dm" | "email_manual" | "other";

export type AnalyticsDay = {
  day: string;
  visits: number;
  uniqueVisitors: number;
  /** Outreach worker emails plus emails logged by hand. */
  emails: number;
  manualEmails: number;
  dms: number;
  /** Contact form submissions plus other logged outreach. */
  formsOther: number;
  forms: number;
  other: number;
  outreach: number;
  instructors: number;
  published: number;
  /** Instructor inquiries plus matching requests. */
  inquiries: number;
};

export type ManualActivityRow = { day: string; channel: ManualChannel; count: number; note: string | null };
export type VisitSummary = { visits: number; uniqueVisitors: number; firstVisitDay: string | null };
export type TopRow = { label: string; visits: number; uniqueVisitors: number };

const rangeLengths: Record<Exclude<AnalyticsRange, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

export function parseDailyRows(rows: unknown): AnalyticsDay[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.day !== "string") return [];
    const manualEmails = count(row.manual_emails);
    const emails = count(row.emails_sent) + manualEmails;
    const dms = count(row.dms_sent);
    const forms = count(row.form_submissions);
    const other = count(row.other_outreach);
    return [{
      day: row.day.slice(0, 10),
      visits: count(row.visits),
      uniqueVisitors: count(row.unique_visitors),
      emails,
      manualEmails,
      dms,
      forms,
      other,
      formsOther: forms + other,
      outreach: emails + dms + forms + other,
      instructors: count(row.instructors_joined),
      published: count(row.instructors_published),
      inquiries: count(row.inquiries) + count(row.matching_requests)
    }];
  });
}

export function parseTopRows(rows: unknown, key: "referrer_host" | "path"): TopRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    return [{ label: typeof row[key] === "string" ? row[key] as string : "", visits: count(row.visits), uniqueVisitors: count(row.unique_visitors) }];
  });
}

export function todayInTimeZone(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ANALYTICS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function formatDay(day: string, style: "short" | "long" = "short"): string {
  const date = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", style === "long"
    ? { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }
    : { timeZone: "UTC", month: "short", day: "numeric" }).format(date);
}

/** Date bounds for a range ending today. Null start means all recorded days. */
export function rangeBounds(range: AnalyticsRange, today: string) {
  if (range === "all") return { start: null, end: today, previousStart: null, previousEnd: null };
  const length = rangeLengths[range];
  const start = addDays(today, -(length - 1));
  return { start, end: today, previousStart: addDays(start, -length), previousEnd: addDays(start, -1) };
}

/** Splits all loaded days into the selected range and the equal-length period before it. */
export function sliceRange(days: AnalyticsDay[], range: AnalyticsRange): { current: AnalyticsDay[]; previous: AnalyticsDay[] | null } {
  if (range === "all") return { current: days, previous: null };
  const length = rangeLengths[range];
  const current = days.slice(-length);
  const before = days.slice(0, Math.max(0, days.length - length));
  // A previous period only counts when the data reaches back across all of it.
  return { current, previous: before.length >= length ? before.slice(-length) : null };
}

export function total(days: AnalyticsDay[], pick: (day: AnalyticsDay) => number): number {
  return days.reduce((sum, day) => sum + pick(day), 0);
}

/** Trailing mean over up to `size` days, so early days average what exists. */
export function rollingAverage(values: number[], size = 7): number[] {
  let running = 0;
  return values.map((value, index) => {
    running += value;
    if (index >= size) running -= values[index - size];
    return running / Math.min(index + 1, size);
  });
}

export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export const CORRELATION_MIN_DAYS = 14;
export const CORRELATION_LAGS = [0, 1, 3, 7] as const;

export type CorrelationCell = { lag: number; pairs: number; r: number | null };

/** Pearson r between outreach on day d and results on day d + lag. */
export function pearson(x: number[], y: number[], lag = 0): CorrelationCell {
  const pairs = Math.max(0, Math.min(x.length, y.length) - lag);
  if (pairs < CORRELATION_MIN_DAYS) return { lag, pairs, r: null };
  let sumX = 0, sumY = 0;
  for (let i = 0; i < pairs; i += 1) { sumX += x[i]; sumY += y[i + lag]; }
  const meanX = sumX / pairs, meanY = sumY / pairs;
  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < pairs; i += 1) {
    const dx = x[i] - meanX, dy = y[i + lag] - meanY;
    cov += dx * dy; varX += dx * dx; varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return { lag, pairs, r: null };
  return { lag, pairs, r: cov / Math.sqrt(varX * varY) };
}

/** Days from the first day with outreach onward. Earlier days carry no signal. */
export function daysSinceFirstOutreach(days: AnalyticsDay[]): AnalyticsDay[] {
  const first = days.findIndex((day) => day.outreach > 0);
  return first < 0 ? [] : days.slice(first);
}

export function correlationRows(days: AnalyticsDay[]) {
  const active = daysSinceFirstOutreach(days);
  const outreach = active.map((day) => day.outreach);
  const series = [
    { key: "inquiries" as const, values: active.map((day) => day.inquiries) },
    { key: "instructors" as const, values: active.map((day) => day.instructors) }
  ];
  return {
    activeDays: active.length,
    rows: series.map((item) => ({ key: item.key, cells: CORRELATION_LAGS.map((lag) => pearson(outreach, item.values, lag)) }))
  };
}

export function niceCeiling(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 4, 5, 8, 10]) if (value <= step * magnitude) return step * magnitude;
  return 10 * magnitude;
}
