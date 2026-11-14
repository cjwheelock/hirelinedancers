export type AdminInquiryNotificationJob = {
  job_id: number;
  attempt_number: number;
  delivered_to_email: string;
  inquiry_id: string | null;
  matching_request_id?: string | null;
  inquiry: Record<string, unknown>;
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
const display = (value: unknown): string => value === null || value === undefined || value === ''
  ? 'Not provided' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);

function matchingRequestEmail(job: AdminInquiryNotificationJob, supportEmail: string) {
  const request = job.inquiry;
  const requestId = String(request.id ?? job.matching_request_id ?? '');
  const place = [request.event_city, request.event_region].filter(Boolean).join(', ');
  const fields: [string, unknown][] = [
    ['Request ID', requestId], ['Submitted', request.created_at], ['Searched for', request.search_query],
    ['Name', request.contact_name], ['Email', request.contact_email], ['Phone', request.contact_phone],
    ['Event type', request.event_type], ['Event date', request.event_date],
    ['Start time', request.event_start_time], ['Time zone', request.time_zone], ['Venue', request.venue_name],
    ['City', request.event_city], ['Region', request.event_region], ['Postal code', request.event_postal_code],
    ['Guests', request.guest_count], ['Budget', request.budget_range], ['Music requests', request.music_requests],
    ['Speakers available', request.venue_has_speakers], ['Microphone available', request.venue_has_microphone],
    ['Message', request.message],
  ];
  const email = String(request.contact_email || '').trim();
  return {
    to: ['cjwheelock1@gmail.com'],
    reply_to: /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email) ? email : supportEmail,
    subject: `New matching request · ${place || requestId}`,
    text: ['Someone asked Hire Line Dancers to find them an instructor.', '', ...fields.map(([label, value]) => `${label}: ${display(value)}`)].join('\n'),
    html: `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;line-height:1.5"><h1>New matching request</h1><p>Someone asked Hire Line Dancers to find them an instructor.</p><table>${fields.map(([label, value]) => `<tr><th align="left" valign="top" style="padding:6px 16px 6px 0">${escapeHtml(label)}</th><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(display(value))}</td></tr>`).join('')}</table></body></html>`,
  };
}

export function adminInquiryEmail(job: AdminInquiryNotificationJob, appUrl: URL, supportEmail: string) {
  if (job.inquiry.kind === 'matching_request') return matchingRequestEmail(job, supportEmail);
  const inquiry = job.inquiry;
  if (!job.inquiry_id) throw new AdminInquiryEmailError('Inquiry notification is missing its inquiry', false);
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

const MATCHING_REPLY_TO = 'cj@cjwheelock.com';
const validEmail = (value: string) => /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
const humanize = (value: unknown) => {
  const text = String(value ?? '').replace(/-/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
};

// Sent to the person who asked us to find them an instructor.
export function matchingRequestConfirmationEmail(job: AdminInquiryNotificationJob) {
  const request = job.inquiry;
  const to = String(request.contact_email || '').trim();
  if (request.kind !== 'matching_request' || !validEmail(to)) return null;
  const city = String(request.event_city || '').trim();
  const firstName = String(request.contact_name || '').trim().split(/\s+/)[0] || '';
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const intro = `Thanks for asking Hire Line Dancers to find you a line dance instructor${city ? ` in ${city}` : ''}. We have your event details, and here's what happens next.`;
  const steps = [
    "Within 2 business days you'll hear from us with an update, even if we're still searching.",
    "When we find someone available, we'll introduce you and you can message them directly.",
    'You decide. No obligation to book, and you only pay if you do.',
  ];
  const details: [string, unknown][] = [
    ['Event type', humanize(request.event_type)], ['Event date', request.event_date],
    ['Location', [request.event_city, request.event_region].filter(Boolean).join(', ')],
    ['Guests', request.guest_count],
  ];
  const shownDetails = details.filter(([, value]) => value !== null && value !== undefined && value !== '');
  const closing = 'Questions or a tight timeline? Reply to this email and it comes straight to CJ.';
  const signature = 'CJ, founder of Hire Line Dancers';
  return {
    to: [to],
    reply_to: MATCHING_REPLY_TO,
    subject: city ? `We're on it: finding your ${city} line dance instructor` : "We're on it: finding your line dance instructor",
    text: [greeting, '', intro, '', ...steps.map(step => `- ${step}`), '', 'Your request:', ...shownDetails.map(([label, value]) => `${label}: ${String(value)}`), '', closing, '', signature].join('\n'),
    html: `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;line-height:1.55;color:#2a1e17"><p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p><ul>${steps.map(step => `<li style="margin-bottom:6px">${escapeHtml(step)}</li>`).join('')}</ul><p style="margin-bottom:4px"><strong>Your request</strong></p><table>${shownDetails.map(([label, value]) => `<tr><th align="left" style="padding:3px 16px 3px 0">${escapeHtml(label)}</th><td>${escapeHtml(String(value))}</td></tr>`).join('')}</table><p>${escapeHtml(closing)}</p><p>${escapeHtml(signature)}</p></body></html>`,
  };
}

async function postEmail(body: Record<string, unknown>, idempotencyKey: string, apiKey: string, fetcher: typeof fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
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

export async function sendAdminInquiryEmail(
  job: AdminInquiryNotificationJob,
  config: { apiKey: string; from: string; appUrl: URL; supportEmail: string },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (job.delivered_to_email !== 'cjwheelock1@gmail.com') {
    throw new AdminInquiryEmailError('Unexpected administrator notification destination', false);
  }
  const adminId = await postEmail(
    { from: config.from, ...adminInquiryEmail(job, config.appUrl, config.supportEmail) },
    `hld-admin-inquiry-${job.job_id}`, config.apiKey, fetcher,
  );
  // Retries resend both with the same keys, so the provider never delivers duplicates.
  const confirmation = matchingRequestConfirmationEmail(job);
  if (confirmation) {
    await postEmail({ from: config.from, ...confirmation }, `hld-matching-confirmation-${job.job_id}`, config.apiKey, fetcher);
  }
  return adminId;
}
