export type AdminInquiryNotificationJob = {
  job_id: number;
  attempt_number: number;
  delivered_to_email: string;
  inquiry_id: string;
  inquiry: Record<string, unknown>;
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
const display = (value: unknown): string => value === null || value === undefined || value === ''
  ? 'Not provided' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);

export function adminInquiryEmail(job: AdminInquiryNotificationJob, appUrl: URL, supportEmail: string) {
  const inquiry = job.inquiry;
  const reviewUrl = new URL('admin/', appUrl);
  reviewUrl.searchParams.set('tab', 'inquiries');
  reviewUrl.searchParams.set('inquiry', job.inquiry_id);
  const fields: [string, unknown][] = [
    ['Inquiry ID', job.inquiry_id], ['Submitted', inquiry.created_at],
    ['Name', inquiry.contact_name || inquiry.name], ['Email', inquiry.contact_email || inquiry.email],
    ['Phone', inquiry.contact_phone_e164], ['Company', inquiry.company_name],
    ['Instructor', inquiry.instructor_name || inquiry.instructor_slug],
    ['Event type', inquiry.event_type], ['Event date', inquiry.event_date],
    ['Start time', inquiry.event_start_time], ['Time zone', inquiry.time_zone],
    ['Venue', inquiry.venue_name], ['Location', inquiry.location],
    ['City', inquiry.event_city], ['Region', inquiry.event_region], ['Postal code', inquiry.event_postal_code],
    ['Guests', inquiry.guest_count], ['Budget', inquiry.budget_range], ['Music requests', inquiry.music_requests],
    ['Speakers available', inquiry.venue_has_speakers], ['Microphone available', inquiry.venue_has_microphone],
    ['Reply by', inquiry.reply_by_date], ['Message', inquiry.message],
  ];
  const email = String(inquiry.contact_email || inquiry.email || '').trim();
  return {
    to: ['cjwheelock1@gmail.com'],
    reply_to: /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email) ? email : supportEmail,
    subject: `New Hire Line Dancers inquiry · ${job.inquiry_id}`,
    text: [...fields.map(([label, value]) => `${label}: ${display(value)}`), '', `View inquiry: ${reviewUrl}`].join('\n'),
    html: `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;line-height:1.5"><h1>New inquiry</h1><table>${fields.map(([label, value]) => `<tr><th align="left" valign="top" style="padding:6px 16px 6px 0">${escapeHtml(label)}</th><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(display(value))}</td></tr>`).join('')}</table><p><a href="${escapeHtml(reviewUrl.toString())}">View inquiry</a></p></body></html>`,
  };
}

export class AdminInquiryEmailError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export async function sendAdminInquiryEmail(
  job: AdminInquiryNotificationJob,
  config: { apiKey: string; from: string; appUrl: URL; supportEmail: string },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (job.delivered_to_email !== 'cjwheelock1@gmail.com') {
    throw new AdminInquiryEmailError('Unexpected administrator notification destination', false);
  }
  let response: Response;
  try {
    response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `hld-admin-inquiry-${job.job_id}`,
      },
      body: JSON.stringify({ from: config.from, ...adminInquiryEmail(job, config.appUrl, config.supportEmail) }),
    });
  } catch {
    throw new AdminInquiryEmailError('Administrator email provider request did not complete', true);
  }
  const payload = await response.json().catch(() => ({})) as { id?: string };
  if (!response.ok || typeof payload.id !== 'string' || !payload.id) {
    // Do not log the provider response, which may repeat private inquiry content.
    throw new AdminInquiryEmailError(`Administrator email provider returned ${response.status}`, response.status === 429 || response.status >= 500 || response.ok);
  }
  return payload.id;
}
