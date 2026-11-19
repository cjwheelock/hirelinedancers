// Owner-only deal milestone alerts sent to CJ's personal inbox.
export type AdminDealNotificationJob = {
  job_id: number;
  attempt_number: number;
  delivered_to_email: string;
  booking_id: string;
  payload: Record<string, unknown>;
};

export const ADMIN_DEAL_ALERT_TO = 'cjwheelock1@gmail.com';

export class AdminDealEmailError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]!);
const display = (value: unknown): string =>
  value === null || value === undefined || value === '' ? 'Not provided' : String(value);
export const money = (cents: unknown): string | null => {
  const n = Number(cents);
  return cents === null || cents === undefined || !Number.isFinite(n) ? null
    : `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const oneLine = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

const HEADINGS: Record<string, string> = {
  quote_sent: 'Quote sent',
  quote_signed: 'Quote signed',
  payment_received: 'Payment received',
  payout_sent: 'Instructor payout sent',
};

export function adminDealEmail(job: AdminDealNotificationJob, appUrl: URL) {
  const p = job.payload;
  const kind = String(p.kind || '');
  const heading = HEADINGS[kind];
  if (!heading) throw new AdminDealEmailError(`Unknown deal alert type ${kind}`, false);
  const reviewUrl = new URL('admin/', appUrl);
  reviewUrl.searchParams.set('tab', 'inquiries');
  if (p.inquiry_id) reviewUrl.searchParams.set('inquiry', String(p.inquiry_id));
  const when = [p.event_date, [p.start_time, p.end_time].filter(Boolean).join('–'), p.time_zone]
    .filter(Boolean).join(' · ');
  const fields: [string, unknown][] = [
    ['Instructor', p.instructor_name],
    ['Organizer', p.organizer_name],
    ['Organizer email', p.organizer_email],
    ['Event type', p.event_type],
    ['Event', when],
    ['Venue', [p.venue_name, p.venue_address].filter(Boolean).join(', ')],
    ['City', p.city],
    ['Client total', money(p.total_cents)],
    ['Instructor price', money(p.price_cents)],
    ['Platform revenue', money(p.platform_fee_cents)],
    ['Instructor payout', money(kind === 'payout_sent' ? (p.payout_cents ?? p.instructor_payout_cents) : p.instructor_payout_cents)],
  ];
  if (kind === 'quote_sent') fields.push(['Quote expires', p.expires_at]);
  if (kind === 'quote_signed') fields.push(['Signed', p.organizer_signed_at]);
  if (kind === 'payment_received') fields.push(['Paid', p.paid_at], ['Payment method', p.payment_method_type], ['Payout due', p.payout_due_at]);
  if (kind === 'payout_sent') fields.push(['Paid out', p.paid_out_at]);
  fields.push(['Booking ID', p.booking_id], ['Quote version', p.version]);
  const amount = money(kind === 'payout_sent' ? (p.payout_cents ?? p.instructor_payout_cents) : p.total_cents);
  const who = oneLine(p.instructor_name) || 'Instructor';
  const organizer = oneLine(p.organizer_name);
  const subject = `${heading} · ${who}${organizer ? ` × ${organizer}` : ''}${amount ? ` · ${amount}` : ''}`;
  return {
    to: [ADMIN_DEAL_ALERT_TO],
    subject,
    text: [heading, '', ...fields.map(([l, v]) => `${l}: ${display(v)}`), '', `View inquiry: ${reviewUrl}`].join('\n'),
    html: `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;line-height:1.5"><h1>${escapeHtml(heading)}</h1><table>${fields.map(([l, v]) => `<tr><th align="left" valign="top" style="padding:6px 16px 6px 0">${escapeHtml(l)}</th><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(display(v))}</td></tr>`).join('')}</table><p><a href="${escapeHtml(reviewUrl.toString())}">View inquiry</a></p></body></html>`,
  };
}

export async function sendAdminDealEmail(
  job: AdminDealNotificationJob,
  config: { apiKey: string; from: string; appUrl: URL; replyTo: string },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (job.delivered_to_email !== ADMIN_DEAL_ALERT_TO) {
    throw new AdminDealEmailError('Unexpected administrator notification destination', false);
  }
  const email = adminDealEmail(job, config.appUrl);
  let response: Response;
  try {
    response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `hld-admin-deal-${job.job_id}` },
      body: JSON.stringify({ from: config.from, reply_to: config.replyTo, ...email }),
    });
  } catch {
    throw new AdminDealEmailError('Email provider request did not complete', true);
  }
  const payload = await response.json().catch(() => ({})) as { id?: string };
  if (!response.ok || typeof payload.id !== 'string' || !payload.id) {
    throw new AdminDealEmailError(`Email provider returned ${response.status}`, response.status === 429 || response.status >= 500 || response.ok);
  }
  return payload.id;
}
