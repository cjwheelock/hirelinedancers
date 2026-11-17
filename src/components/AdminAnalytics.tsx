"use client";

import { FormEvent, KeyboardEvent, PointerEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, RefreshCw } from "lucide-react";
import { getMarketplaceClient } from "@/lib/marketplace";
import {
  CORRELATION_LAGS,
  CORRELATION_MIN_DAYS,
  correlationRows,
  formatDay,
  niceCeiling,
  parseDailyRows,
  parseTopRows,
  percentChange,
  rangeBounds,
  rollingAverage,
  sliceRange,
  todayInTimeZone,
  total,
  type AnalyticsDay,
  type AnalyticsRange,
  type ManualActivityRow,
  type ManualChannel,
  type TopRow,
  type VisitSummary
} from "@/lib/adminAnalytics";
import { markInternalBrowser } from "./SiteVisitTracker";
import styles from "./AdminAnalytics.module.css";

// Desert Sunset series colors. Each color keeps one meaning across the whole section.
const COLOR = {
  visits: "#4a3a2f",
  emails: "#b8482a",
  dms: "#e9a94b",
  formsOther: "#8a7a6c",
  instructors: "#7a2e1a",
  inquiries: "#1f6f6b",
  ink: "#2a1e17"
} as const;

const RANGES: Array<{ key: AnalyticsRange; label: string; long: string }> = [
  { key: "7d", label: "7d", long: "7 days" },
  { key: "30d", label: "30d", long: "30 days" },
  { key: "90d", label: "90d", long: "90 days" },
  { key: "all", label: "All", long: "all time" }
];

const CHANNELS: Array<{ key: ManualChannel; label: string }> = [
  { key: "instagram_dm", label: "Instagram DMs" },
  { key: "email_manual", label: "Manual emails" },
  { key: "other", label: "Other outreach" }
];

const number = new Intl.NumberFormat("en-US");
function ratio(value: number | null, digits = 1) {
  return value === null ? "n/a" : value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export type LogManualOutreach = (day: string, channel: ManualChannel, count: number, mode: "set" | "add", note?: string | null) => Promise<void>;

export type AdminAnalyticsViewProps = {
  days: AnalyticsDay[];
  manual: ManualActivityRow[];
  range: AnalyticsRange;
  onRangeChange: (range: AnalyticsRange) => void;
  visitSummary: VisitSummary | null;
  previousVisitSummary: VisitSummary | null;
  referrers: TopRow[];
  pages: TopRow[];
  refreshing?: boolean;
  busy?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onLog: LogManualOutreach;
  /** Preview only: pins the chart tooltip to a day index. */
  initialHoverIndex?: number | null;
};

function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(240, Math.round(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 0);
  if (values.length < 2 || max === 0) {
    return <svg className={styles.sparkline} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="100" y1="30" y2="30" stroke="#eadfd0" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
  }
  const points = values.map((value, index) => [(index / (values.length - 1)) * 100, 29 - (value / max) * 25] as const);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  return (
    <svg className={styles.sparkline} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L100 32 L0 32 Z`} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Delta({ current, previous, periodLabel }: { current: number; previous: number | null; periodLabel: string }) {
  if (previous === null) return <p className={styles.delta}><span className={styles.deltaFlat}><Minus size={13} aria-hidden="true" />No earlier period</span></p>;
  const change = percentChange(current, previous);
  if (change === null) {
    return <p className={styles.delta}><span className={styles.deltaFlat}><Minus size={13} aria-hidden="true" />{current === 0 ? "No change" : `0 in previous ${periodLabel}`}</span></p>;
  }
  const rounded = Math.round(change);
  const Icon = rounded > 0 ? ArrowUpRight : rounded < 0 ? ArrowDownRight : Minus;
  return (
    <p className={styles.delta}>
      <span className={rounded > 0 ? styles.deltaUp : rounded < 0 ? styles.deltaDown : styles.deltaFlat}>
        <Icon size={13} aria-hidden="true" />{rounded > 0 ? "+" : ""}{rounded}%
      </span>
      <span className={styles.deltaNote}>vs previous {periodLabel}</span>
    </p>
  );
}

function Tile({ label, color, value, today, detail, current, previous, periodLabel, spark }: {
  label: string; color: string; value: number; today: number; detail?: string;
  current: number; previous: number | null; periodLabel: string; spark: number[];
}) {
  return (
    <article className={styles.tile}>
      <p className={styles.tileLabel}><i className={styles.dot} style={{ background: color }} aria-hidden="true" />{label}</p>
      <strong className={styles.tileValue}>{number.format(value)}</strong>
      <p className={styles.tileMeta}>Today {number.format(today)}{detail ? <span> · {detail}</span> : null}</p>
      <Delta current={current} previous={previous} periodLabel={periodLabel} />
      <Sparkline values={spark} color={color} />
    </article>
  );
}

function topRoundedBar(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  return `M${x} ${y + height} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + width - r} Q${x + width} ${y} ${x + width} ${y + r} V${y + height} Z`;
}

function OutreachChart({ days, smooth, initialHoverIndex = null }: { days: AnalyticsDay[]; smooth: boolean; initialHoverIndex?: number | null }) {
  const { ref, width } = useElementWidth<HTMLDivElement>(760);
  const [hover, setHover] = useState<number | null>(initialHoverIndex);
  const compact = width < 520;
  const left = 34;
  const right = 10;
  const topPlot = compact ? 150 : 190;
  const bottomPlot = compact ? 96 : 116;
  const topY = 24;
  const bottomY = topY + topPlot + 40;
  const height = bottomY + bottomPlot + 26;
  const innerWidth = width - left - right;
  const count = days.length;
  const band = count ? innerWidth / count : innerWidth;
  const barWidth = band < 4 ? Math.max(1, band - 0.5) : Math.min(26, band * 0.72);
  const xAt = (index: number) => left + band * (index + 0.5);

  const outreachAverage = useMemo(() => rollingAverage(days.map((day) => day.outreach)), [days]);
  const inquiryValues = useMemo(() => { const raw = days.map((day) => day.inquiries); return smooth ? rollingAverage(raw) : raw; }, [days, smooth]);
  const instructorValues = useMemo(() => { const raw = days.map((day) => day.instructors); return smooth ? rollingAverage(raw) : raw; }, [days, smooth]);

  const outreachMax = niceCeiling(Math.max(...days.map((day) => day.outreach), 0));
  const resultPeak = Math.max(...inquiryValues, ...instructorValues, 0);
  const resultMax = resultPeak <= 1 ? 1 : resultPeak <= 2 ? 2 : niceCeiling(resultPeak);
  const topScale = (value: number) => topY + topPlot - (value / outreachMax) * topPlot;
  const bottomScale = (value: number) => bottomY + bottomPlot - (value / resultMax) * bottomPlot;
  const hasOutreach = days.some((day) => day.outreach > 0);
  const hasResults = days.some((day) => day.inquiries > 0 || day.instructors > 0);
  const showMarkers = !smooth && count <= 31;

  const tickCount = Math.min(count, compact ? 4 : 7);
  const tickIndexes = tickCount <= 1 ? [0] : Array.from({ length: tickCount }, (_, i) => Math.round((i * (count - 1)) / (tickCount - 1)));
  const linePath = (values: number[], scale: (value: number) => number) => values.map((value, index) => `${index ? "L" : "M"}${xAt(index).toFixed(1)} ${scale(value).toFixed(1)}`).join(" ");

  function pointerMove(event: PointerEvent<SVGRectElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientX - bounds.left) / bounds.width) * count);
    setHover(Math.max(0, Math.min(count - 1, index)));
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!count) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      setHover((current) => Math.max(0, Math.min(count - 1, (current ?? count - (step > 0 ? 2 : 0)) + step)));
    } else if (event.key === "Escape") setHover(null);
  }

  const hovered = hover !== null && hover < count ? days[hover] : null;
  const tooltipOnLeft = hover !== null && xAt(hover) > width * 0.55;

  return (
    <div
      ref={ref}
      className={styles.chart}
      tabIndex={0}
      role="group"
      aria-label="Daily outreach and results chart. Use the left and right arrow keys to read each day. The daily table below lists the same values."
      onKeyDown={keyDown}
      onBlur={() => setHover(null)}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
        <text x={0} y={12} className={styles.panelTitle}>Outreach sent per day</text>
        <text x={0} y={bottomY - 12} className={styles.panelTitle}>{smooth ? "Instructors joined and inquiries, 7-day average" : "Instructors joined and inquiries per day"}</text>

        {[0, 0.5, 1].map((step) => (
          <g key={`top-${step}`}>
            <line x1={left} x2={width - right} y1={topScale(outreachMax * step)} y2={topScale(outreachMax * step)} className={step === 0 ? styles.baseline : styles.grid} />
            <text x={left - 8} y={topScale(outreachMax * step) + 4} textAnchor="end" className={styles.axisText}>{outreachMax * step}</text>
          </g>
        ))}
        {(resultMax === 1 && !smooth ? [0, 1] : [0, 0.5, 1]).map((step) => (
          <g key={`bottom-${step}`}>
            <line x1={left} x2={width - right} y1={bottomScale(resultMax * step)} y2={bottomScale(resultMax * step)} className={step === 0 ? styles.baseline : styles.grid} />
            <text x={left - 8} y={bottomScale(resultMax * step) + 4} textAnchor="end" className={styles.axisText}>{resultMax * step}</text>
          </g>
        ))}

        {days.map((day, index) => {
          const segments = [
            { key: "emails", value: day.emails, color: COLOR.emails },
            { key: "dms", value: day.dms, color: COLOR.dms },
            { key: "formsOther", value: day.formsOther, color: COLOR.formsOther }
          ].filter((segment) => segment.value > 0);
          let stacked = 0;
          const gap = barWidth >= 4 ? 2 : 0;
          return (
            <g key={day.day} opacity={hover === null || hover === index ? 1 : 0.55}>
              {segments.map((segment, position) => {
                const y1 = topScale(stacked);
                stacked += segment.value;
                const y0 = topScale(stacked);
                const isTop = position === segments.length - 1;
                const segmentHeight = Math.max(1, y1 - y0 - (isTop ? 0 : gap));
                const x = xAt(index) - barWidth / 2;
                const y = y1 - segmentHeight;
                return isTop
                  ? <path key={segment.key} d={topRoundedBar(x, y, barWidth, segmentHeight, 4)} fill={segment.color} />
                  : <rect key={segment.key} x={x} y={y} width={barWidth} height={segmentHeight} fill={segment.color} />;
              })}
            </g>
          );
        })}
        {smooth && hasOutreach ? <path d={linePath(outreachAverage, topScale)} fill="none" stroke={COLOR.ink} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}

        {count > 1 ? (
          <>
            <path d={linePath(instructorValues, bottomScale)} fill="none" stroke={COLOR.instructors} strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" strokeLinecap="round" />
            <path d={linePath(inquiryValues, bottomScale)} fill="none" stroke={COLOR.inquiries} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        ) : null}
        {showMarkers ? days.map((day, index) => (
          <g key={`marker-${day.day}`}>
            {day.instructors > 0 ? <rect x={xAt(index) - 4} y={bottomScale(day.instructors) - 4} width={8} height={8} fill={COLOR.instructors} stroke="#fff" strokeWidth={2} transform={`rotate(45 ${xAt(index)} ${bottomScale(day.instructors)})`} /> : null}
            {day.inquiries > 0 ? <circle cx={xAt(index)} cy={bottomScale(day.inquiries)} r={4.5} fill={COLOR.inquiries} stroke="#fff" strokeWidth={2} /> : null}
          </g>
        )) : null}

        {!hasOutreach ? <text x={left + innerWidth / 2} y={topY + topPlot / 2} textAnchor="middle" className={styles.emptyText}>No outreach in this range</text> : null}
        {!hasResults ? <text x={left + innerWidth / 2} y={bottomY + bottomPlot / 2 - 6} textAnchor="middle" className={styles.emptyText}>No instructors joined or inquiries in this range</text> : null}

        {tickIndexes.map((index, position) => days[index] ? (
          <text key={`tick-${index}`} x={xAt(index)} y={height - 6} textAnchor={position === 0 && count > 12 ? "start" : position === tickIndexes.length - 1 && count > 12 ? "end" : "middle"} className={styles.axisText}>{formatDay(days[index].day)}</text>
        ) : null)}

        {hover !== null && hovered ? (
          <g pointerEvents="none">
            <line x1={xAt(hover)} x2={xAt(hover)} y1={topY} y2={bottomY + bottomPlot} className={styles.crosshair} />
            <circle cx={xAt(hover)} cy={bottomScale(instructorValues[hover])} r={4.5} fill={COLOR.instructors} stroke="#fff" strokeWidth={2} />
            <circle cx={xAt(hover)} cy={bottomScale(inquiryValues[hover])} r={4.5} fill={COLOR.inquiries} stroke="#fff" strokeWidth={2} />
          </g>
        ) : null}
        <rect x={left} y={topY} width={innerWidth} height={bottomY + bottomPlot - topY} fill="transparent" onPointerMove={pointerMove} onPointerDown={pointerMove} onPointerLeave={() => setHover(null)} />
      </svg>

      {hover !== null && hovered ? (
        <div className={styles.tooltip} role="status" style={tooltipOnLeft ? { right: width - xAt(hover) + 12 } : { left: xAt(hover) + 12 }}>
          <p className={styles.tooltipDate}>{formatDay(hovered.day, "long")}</p>
          <dl>
            <div><dt><i style={{ background: COLOR.emails }} />Emails</dt><dd>{number.format(hovered.emails)}</dd></div>
            <div><dt><i style={{ background: COLOR.dms }} />DMs</dt><dd>{number.format(hovered.dms)}</dd></div>
            <div><dt><i style={{ background: COLOR.formsOther }} />Forms and other</dt><dd>{number.format(hovered.formsOther)}</dd></div>
            <div className={styles.tooltipTotal}><dt>Outreach total</dt><dd>{number.format(hovered.outreach)}</dd></div>
            {smooth ? <div><dt><i style={{ background: COLOR.ink }} />7-day average</dt><dd>{ratio(outreachAverage[hover])}</dd></div> : null}
            <div className={styles.tooltipBreak}><dt><i style={{ background: COLOR.instructors }} />Instructors joined</dt><dd>{number.format(hovered.instructors)}</dd></div>
            <div><dt><i style={{ background: COLOR.inquiries }} />Inquiries</dt><dd>{number.format(hovered.inquiries)}</dd></div>
            <div><dt><i style={{ background: COLOR.visits }} />Site visits</dt><dd>{number.format(hovered.visits)}</dd></div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function strength(r: number) {
  const size = Math.abs(r);
  if (size < 0.1) return "None";
  if (size < 0.3) return "Weak";
  if (size < 0.5) return "Moderate";
  return "Strong";
}

function TopList({ title, rows, emptyLabel, blankLabel }: { title: string; rows: TopRow[]; emptyLabel: string; blankLabel?: string }) {
  const max = Math.max(...rows.map((row) => row.visits), 1);
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h3>{title}</h3>
        {rows.length ? <p className={styles.listHead}><span>Visits</span><span>Visitors</span></p> : null}
      </div>
      {!rows.length ? <p className={styles.empty}>{emptyLabel}</p> : (
        <ol className={styles.topList}>
          {rows.map((row) => (
            <li key={row.label || "(none)"}>
              <span className={styles.topBar} style={{ width: `${Math.max(2, (row.visits / max) * 100)}%` }} aria-hidden="true" />
              <span className={styles.topLabel} title={row.label || blankLabel}>{row.label || blankLabel}</span>
              <span className={styles.topValue}>{number.format(row.visits)}</span>
              <span className={styles.topValueMuted}>{number.format(row.uniqueVisitors)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

type DayDraft = Record<ManualChannel, { count: string; note: string }>;

function DayEditor({ day, manual, busy, onLog, onClose }: { day: string; manual: ManualActivityRow[]; busy: boolean; onLog: LogManualOutreach; onClose: () => void }) {
  const formId = useId();
  const existing = useMemo(() => Object.fromEntries(CHANNELS.map(({ key }) => {
    const row = manual.find((item) => item.day === day && item.channel === key);
    return [key, { count: String(row?.count ?? 0), note: row?.note ?? "" }];
  })) as DayDraft, [day, manual]);
  const [draft, setDraft] = useState<DayDraft>(existing);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    try {
      for (const { key, label } of CHANNELS) {
        const value = Number(draft[key].count);
        if (!Number.isInteger(value) || value < 0 || value > 5000) throw new Error(`${label}: enter a whole number from 0 to 5000.`);
        if (String(value) !== existing[key].count || draft[key].note.trim() !== existing[key].note) {
          await onLog(day, key, value, "set", draft[key].note.trim());
        }
      }
      onClose();
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : "Could not save.");
    }
  }

  return (
    <form className={styles.editor} onSubmit={submit} aria-label={`Edit logged outreach for ${formatDay(day, "long")}`}>
      <p className={styles.editorTitle}>Logged outreach for {formatDay(day, "long")}</p>
      <div className={styles.editorGrid}>
        {CHANNELS.map(({ key, label }) => (
          <div className={styles.editorRow} key={key}>
            <label htmlFor={`${formId}-${key}-count`}>{label}</label>
            <input id={`${formId}-${key}-count`} className={styles.input} type="number" inputMode="numeric" min={0} max={5000} step={1} value={draft[key].count}
              onChange={(event) => setDraft((current) => ({ ...current, [key]: { ...current[key], count: event.target.value } }))} />
            <input className={styles.input} type="text" maxLength={500} placeholder="Note" aria-label={`${label} note`} value={draft[key].note}
              onChange={(event) => setDraft((current) => ({ ...current, [key]: { ...current[key], note: event.target.value } }))} />
          </div>
        ))}
      </div>
      {problem ? <p className={styles.error} role="alert">{problem}</p> : null}
      <div className={styles.editorActions}>
        <button className={styles.primaryButton} type="submit" disabled={busy}>Save</button>
        <button className={styles.ghostButton} type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

export function AdminAnalyticsView({
  days, manual, range, onRangeChange, visitSummary, previousVisitSummary, referrers, pages,
  refreshing = false, busy = false, error = null, onRefresh, onLog, initialHoverIndex = null
}: AdminAnalyticsViewProps) {
  const [smooth, setSmooth] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const [setValue, setSetValue] = useState("");
  const [logProblem, setLogProblem] = useState<string | null>(null);

  const { current, previous } = useMemo(() => sliceRange(days, range), [days, range]);
  const rangeInfo = RANGES.find((item) => item.key === range) ?? RANGES[1];
  const today = days.at(-1) ?? null;
  const todayKey = today?.day ?? todayInTimeZone();
  const firstVisitDay = visitSummary?.firstVisitDay ?? days.find((day) => day.visits > 0)?.day ?? null;

  const sums = useMemo(() => {
    const of = (list: AnalyticsDay[] | null, pick: (day: AnalyticsDay) => number) => (list ? total(list, pick) : null);
    const build = (pick: (day: AnalyticsDay) => number) => ({ current: total(current, pick), previous: of(previous, pick), spark: current.map(pick), today: today ? pick(today) : 0 });
    return {
      visits: build((day) => day.visits),
      emails: build((day) => day.emails),
      dms: build((day) => day.dms),
      outreach: build((day) => day.outreach),
      instructors: build((day) => day.instructors),
      published: build((day) => day.published),
      inquiries: build((day) => day.inquiries)
    };
  }, [current, previous, today]);

  const uniqueVisitors = visitSummary?.uniqueVisitors ?? null;
  const outreach = sums.outreach.current;
  const efficiency = [
    { label: "Inquiries per 100 outreach", value: outreach ? (sums.inquiries.current / outreach) * 100 : null, detail: `${number.format(sums.inquiries.current)} inquiries, ${number.format(outreach)} outreach` },
    { label: "Instructors per 100 outreach", value: outreach ? (sums.instructors.current / outreach) * 100 : null, detail: `${number.format(sums.instructors.current)} joined, ${number.format(outreach)} outreach` },
    { label: "Site visits per outreach", value: outreach ? sums.visits.current / outreach : null, detail: `${number.format(sums.visits.current)} visits, ${number.format(outreach)} outreach`, digits: 2 }
  ];
  const correlation = useMemo(() => correlationRows(current), [current]);
  const tableRows = useMemo(() => [...current].reverse(), [current]);
  const visibleRows = showAllRows ? tableRows : tableRows.slice(0, 14);
  const hasFormsOther = current.some((day) => day.formsOther > 0);

  async function quickLog(count: number, mode: "set" | "add") {
    setLogProblem(null);
    try {
      await onLog(todayKey, "instagram_dm", count, mode);
      if (mode === "set") setSetValue("");
    } catch (caught) {
      setLogProblem(caught instanceof Error ? caught.message : "Could not save.");
    }
  }

  function submitSet(event: FormEvent) {
    event.preventDefault();
    const value = Number(setValue);
    if (setValue.trim() === "" || !Number.isInteger(value) || value < 0 || value > 5000) {
      setLogProblem("Enter a whole number from 0 to 5000.");
      return;
    }
    void quickLog(value, "set");
  }

  return (
    <div className={styles.root} aria-busy={refreshing}>
      <header className={styles.header}>
        <div>
          <h2>Analytics</h2>
          <p className={styles.subhead}>
            Days are counted in Eastern Time.{" "}
            {firstVisitDay ? `Site visits recorded since ${formatDay(firstVisitDay, "long")}.` : "No site visits recorded yet."}
          </p>
        </div>
        <div className={styles.controls}>
          <div className={styles.segmented} role="group" aria-label="Date range">
            {RANGES.map((item) => (
              <button key={item.key} type="button" className={range === item.key ? styles.segmentActive : styles.segment} aria-pressed={range === item.key} aria-label={item.key === "all" ? "All time" : `Last ${item.long}`} onClick={() => onRangeChange(item.key)}>{item.label}</button>
            ))}
          </div>
          {onRefresh ? <button type="button" className={styles.iconButton} aria-label="Refresh analytics" onClick={onRefresh} disabled={refreshing}><RefreshCw size={17} aria-hidden="true" /></button> : null}
        </div>
      </header>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={`${styles.body} ${refreshing ? styles.bodyRefreshing : ""}`}>
        <section className={styles.tiles} aria-label="Totals for the selected range">
          <Tile label="Site visits" color={COLOR.visits} value={sums.visits.current} today={sums.visits.today}
            detail={uniqueVisitors === null ? undefined : `${number.format(uniqueVisitors)} unique visitors`}
            current={sums.visits.current} previous={previous ? (previousVisitSummary?.visits ?? sums.visits.previous) : null} periodLabel={rangeInfo.long} spark={sums.visits.spark} />
          <Tile label="Emails sent" color={COLOR.emails} value={sums.emails.current} today={sums.emails.today}
            current={sums.emails.current} previous={sums.emails.previous} periodLabel={rangeInfo.long} spark={sums.emails.spark} />
          <Tile label="DMs sent" color={COLOR.dms} value={sums.dms.current} today={sums.dms.today}
            current={sums.dms.current} previous={sums.dms.previous} periodLabel={rangeInfo.long} spark={sums.dms.spark} />
          <Tile label="Instructors joined" color={COLOR.instructors} value={sums.instructors.current} today={sums.instructors.today}
            detail={`${number.format(sums.published.current)} published`}
            current={sums.instructors.current} previous={sums.instructors.previous} periodLabel={rangeInfo.long} spark={sums.instructors.spark} />
          <Tile label="Inquiries" color={COLOR.inquiries} value={sums.inquiries.current} today={sums.inquiries.today}
            current={sums.inquiries.current} previous={sums.inquiries.previous} periodLabel={rangeInfo.long} spark={sums.inquiries.spark} />
        </section>

        <section className={styles.card} aria-label="Outreach vs results">
          <div className={styles.cardHeader}>
            <h3>Outreach vs results</h3>
            <label className={styles.toggle}>
              <input type="checkbox" checked={smooth} onChange={(event) => setSmooth(event.target.checked)} />
              <span className={styles.toggleTrack} aria-hidden="true" />
              7-day average
            </label>
          </div>
          <ul className={styles.legend} aria-label="Chart legend">
            <li><i className={styles.legendBox} style={{ background: COLOR.emails }} />Emails</li>
            <li><i className={styles.legendBox} style={{ background: COLOR.dms }} />DMs</li>
            {hasFormsOther ? <li><i className={styles.legendBox} style={{ background: COLOR.formsOther }} />Forms and other</li> : null}
            {smooth ? <li><i className={styles.legendLine} style={{ background: COLOR.ink }} />Outreach, 7-day average</li> : null}
            <li><i className={styles.legendDash} style={{ color: COLOR.instructors }} />Instructors joined</li>
            <li><i className={styles.legendLine} style={{ background: COLOR.inquiries }} />Inquiries</li>
          </ul>
          <OutreachChart days={current} smooth={smooth} initialHoverIndex={initialHoverIndex} />
        </section>

        <section className={styles.efficiency} aria-label="Efficiency">
          {efficiency.map((item) => (
            <article key={item.label} className={styles.efficiencyItem}>
              <p className={styles.tileLabel}>{item.label}</p>
              <strong className={item.value === null ? styles.efficiencyEmpty : styles.efficiencyValue}>{ratio(item.value, item.digits ?? 1)}</strong>
              <p className={styles.tileMeta}>{outreach ? item.detail : "No outreach in this range"}</p>
            </article>
          ))}
        </section>

        <section className={styles.card} aria-label="Correlation">
          <div className={styles.cardHeader}>
            <h3>Correlation with daily outreach</h3>
            <p className={styles.cardNote}>Pearson r, outreach on one day against results the same day or later</p>
          </div>
          {correlation.activeDays < CORRELATION_MIN_DAYS ? (
            <div className={styles.notEnough}>
              <p className={styles.notEnoughTitle}>Not enough data yet</p>
              <p className={styles.cardNote}>
                Needs {CORRELATION_MIN_DAYS} days counted from the first day with outreach. This range has {correlation.activeDays}.
                {range === "7d" ? " Select a longer range." : ""}
              </p>
              <div className={styles.progress} role="progressbar" aria-label="Days of outreach data" aria-valuemin={0} aria-valuemax={CORRELATION_MIN_DAYS} aria-valuenow={correlation.activeDays}>
                <span style={{ width: `${(correlation.activeDays / CORRELATION_MIN_DAYS) * 100}%` }} />
              </div>
            </div>
          ) : (
            <>
              <div className={styles.tableWrap} role="region" aria-label="Correlation table" tabIndex={0}>
                <table className={`${styles.table} ${styles.correlationTable}`}>
                  <thead>
                    <tr><th scope="col">Result</th>{CORRELATION_LAGS.map((lag) => <th scope="col" key={lag}>{lag === 0 ? "Same day" : `${lag} ${lag === 1 ? "day" : "days"} later`}</th>)}</tr>
                  </thead>
                  <tbody>
                    {correlation.rows.map((row) => (
                      <tr key={row.key}>
                        <th scope="row"><i className={styles.dot} style={{ background: row.key === "inquiries" ? COLOR.inquiries : COLOR.instructors }} aria-hidden="true" />{row.key === "inquiries" ? "Inquiries" : "Instructors joined"}</th>
                        {row.cells.map((cell) => (
                          <td key={cell.lag}>
                            {cell.r === null ? <span className={styles.correlationEmpty} title={cell.pairs < CORRELATION_MIN_DAYS ? `Only ${cell.pairs} day pairs at this lag` : "No variation to compare"}>n/a</span> : (
                              <>
                                <strong>{cell.r > 0 ? "+" : ""}{cell.r.toFixed(2)}</strong>
                                <span className={styles.correlationMeter} aria-hidden="true"><span className={cell.r < 0 ? styles.correlationNegative : styles.correlationPositive} style={{ width: `${Math.abs(cell.r) * 50}%` }} /></span>
                                <small>{strength(cell.r)}, {cell.pairs} days</small>
                              </>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.cardNote}>r runs from -1 to +1. Values near 0 mean no linear relationship. A high value does not show that outreach caused the result.</p>
            </>
          )}
        </section>

        <section className={styles.card} aria-label="Daily numbers">
          <div className={styles.cardHeader}>
            <h3>Daily numbers</h3>
            <p className={styles.cardNote}>Newest first</p>
          </div>
          <div className={styles.logBar}>
            <div className={styles.logToday}>
              <p className={styles.tileLabel}><i className={styles.dot} style={{ background: COLOR.dms }} aria-hidden="true" />DMs sent today, {formatDay(todayKey)}</p>
              <strong className={styles.logCount} aria-live="polite">{number.format(today?.dms ?? 0)}</strong>
            </div>
            <div className={styles.logActions}>
              <button type="button" className={styles.stepButton} disabled={busy} onClick={() => void quickLog(1, "add")}>+1</button>
              <button type="button" className={styles.stepButton} disabled={busy} onClick={() => void quickLog(5, "add")}>+5</button>
              <form className={styles.setForm} onSubmit={submitSet}>
                <input className={styles.input} type="number" inputMode="numeric" min={0} max={5000} step={1} aria-label="Set today's DM count" placeholder="Count" value={setValue} onChange={(event) => setSetValue(event.target.value)} />
                <button type="submit" className={styles.ghostButton} disabled={busy}>Set</button>
              </form>
            </div>
          </div>
          {logProblem ? <p className={styles.error} role="alert">{logProblem}</p> : null}

          {!tableRows.length ? <p className={styles.empty}>No days in this range.</p> : (
            <div className={styles.tableWrap} role="region" aria-label="Daily numbers table" tabIndex={0}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" className={styles.numeric}>Visits</th>
                    <th scope="col" className={styles.numeric}>Visitors</th>
                    <th scope="col" className={styles.numeric}>Emails</th>
                    <th scope="col" className={styles.numeric}>DMs</th>
                    <th scope="col" className={styles.numeric}>Forms, other</th>
                    <th scope="col" className={styles.numeric}>Outreach</th>
                    <th scope="col" className={styles.numeric}>Instructors</th>
                    <th scope="col" className={styles.numeric}>Inquiries</th>
                    <th scope="col"><span className={styles.srOnly}>Edit</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((day) => {
                    const cell = (value: number) => <td className={`${styles.numeric} ${value ? "" : styles.zero}`}>{number.format(value)}</td>;
                    return (
                      <FragmentRow key={day.day}>
                        <tr className={day.day === todayKey ? styles.todayRow : undefined}>
                          <th scope="row">{formatDay(day.day)}{day.day === todayKey ? <span className={styles.todayChip}>Today</span> : null}</th>
                          {cell(day.visits)}{cell(day.uniqueVisitors)}{cell(day.emails)}{cell(day.dms)}{cell(day.formsOther)}
                          <td className={`${styles.numeric} ${styles.strongCell} ${day.outreach ? "" : styles.zero}`}>{number.format(day.outreach)}</td>
                          {cell(day.instructors)}{cell(day.inquiries)}
                          <td className={styles.numeric}>
                            <button type="button" className={styles.linkButton} aria-expanded={editingDay === day.day} aria-label={`Edit logged outreach for ${formatDay(day.day, "long")}`} onClick={() => setEditingDay(editingDay === day.day ? null : day.day)}>Edit</button>
                          </td>
                        </tr>
                        {editingDay === day.day ? (
                          <tr className={styles.editorRowWrap}><td colSpan={10}><DayEditor day={day.day} manual={manual} busy={busy} onLog={onLog} onClose={() => setEditingDay(null)} /></td></tr>
                        ) : null}
                      </FragmentRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {tableRows.length > 14 ? <button type="button" className={styles.linkButton} onClick={() => setShowAllRows((value) => !value)}>{showAllRows ? "Show 14 days" : `Show all ${tableRows.length} days`}</button> : null}
        </section>

        <div className={styles.split}>
          <TopList title="Top referrers" rows={referrers} emptyLabel="No site visits in this range." blankLabel="Direct or unknown" />
          <TopList title="Top pages" rows={pages} emptyLabel="No site visits in this range." />
        </div>
      </div>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function AdminAnalytics() {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [days, setDays] = useState<AnalyticsDay[]>([]);
  const [manual, setManual] = useState<ManualActivityRow[]>([]);
  const [visitSummary, setVisitSummary] = useState<VisitSummary | null>(null);
  const [previousVisitSummary, setPreviousVisitSummary] = useState<VisitSummary | null>(null);
  const [referrers, setReferrers] = useState<TopRow[]>([]);
  const [pages, setPages] = useState<TopRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const loadDaily = useCallback(async () => {
    const client = getMarketplaceClient();
    if (!client) throw new Error("Marketplace connection unavailable.");
    // Admin-gated RPC. A null start returns every day since the first recorded activity.
    const [daily, manualRows] = await Promise.all([
      client.rpc("admin_analytics_daily", { p_start: null, p_end: null }),
      client.from("outreach_manual_activity").select("day,channel,count,note").order("day", { ascending: false }).limit(2000)
    ]);
    if (daily.error) throw new Error(daily.error.message);
    if (manualRows.error) throw new Error(manualRows.error.message);
    setDays(parseDailyRows(daily.data));
    setManual((manualRows.data ?? []) as ManualActivityRow[]);
  }, []);

  const loadRange = useCallback(async (nextRange: AnalyticsRange) => {
    const client = getMarketplaceClient();
    if (!client) throw new Error("Marketplace connection unavailable.");
    const bounds = rangeBounds(nextRange, todayInTimeZone());
    const current = { p_start: bounds.start, p_end: bounds.end };
    const [summary, previous, topReferrers, topPages] = await Promise.all([
      client.rpc("admin_analytics_visit_summary", current),
      bounds.previousStart ? client.rpc("admin_analytics_visit_summary", { p_start: bounds.previousStart, p_end: bounds.previousEnd }) : Promise.resolve({ data: null, error: null }),
      client.rpc("admin_analytics_top_referrers", { ...current, p_limit: 8 }),
      client.rpc("admin_analytics_top_pages", { ...current, p_limit: 8 })
    ]);
    const failed = [summary, previous, topReferrers, topPages].find((result) => result.error)?.error;
    if (failed) throw new Error(failed.message);
    const toSummary = (rows: unknown): VisitSummary | null => {
      const row = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : undefined;
      return row ? { visits: Number(row.visits) || 0, uniqueVisitors: Number(row.unique_visitors) || 0, firstVisitDay: typeof row.first_visit_day === "string" ? row.first_visit_day : null } : null;
    };
    return { summary: toSummary(summary.data), previous: toSummary(previous.data), referrers: parseTopRows(topReferrers.data, "referrer_host"), pages: parseTopRows(topPages.data, "path") };
  }, []);

  const refresh = useCallback(async (nextRange: AnalyticsRange, includeDaily: boolean) => {
    const id = requestId.current += 1;
    setRefreshing(true);
    setError(null);
    try {
      const [, ranged] = await Promise.all([includeDaily ? loadDaily() : Promise.resolve(), loadRange(nextRange)]);
      if (id !== requestId.current) return;
      setVisitSummary(ranged.summary);
      setPreviousVisitSummary(ranged.previous);
      setReferrers(ranged.referrers);
      setPages(ranged.pages);
    } catch (caught) {
      if (id === requestId.current) setError(caught instanceof Error ? caught.message : "Could not load analytics.");
    } finally {
      if (id === requestId.current) { setRefreshing(false); setLoaded(true); }
    }
  }, [loadDaily, loadRange]);

  useEffect(() => {
    markInternalBrowser();
    void refresh("30d", true);
  }, [refresh]);

  function changeRange(nextRange: AnalyticsRange) {
    setRange(nextRange);
    void refresh(nextRange, false);
  }

  const logManual: LogManualOutreach = async (day, channel, count, mode, note = null) => {
    const client = getMarketplaceClient();
    if (!client) throw new Error("Marketplace connection unavailable.");
    setBusy(true);
    try {
      const { error: logError } = await client.rpc("admin_log_manual_outreach", { p_day: day, p_channel: channel, p_count: count, p_mode: mode, p_note: note });
      if (logError) throw new Error(logError.message);
      await loadDaily();
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <div className={styles.loading}>Loading analytics...</div>;

  return (
    <AdminAnalyticsView
      days={days}
      manual={manual}
      range={range}
      onRangeChange={changeRange}
      visitSummary={visitSummary}
      previousVisitSummary={previousVisitSummary}
      referrers={referrers}
      pages={pages}
      refreshing={refreshing}
      busy={busy}
      error={error}
      onRefresh={() => void refresh(range, true)}
      onLog={logManual}
    />
  );
}
