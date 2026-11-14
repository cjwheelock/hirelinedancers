export type ProfileReminderKind = 'profile_24h' | 'profile_72h' | 'payouts';
export type ProfileReminderJob = {
  id: number;
  recipient_email: string;
  display_name: string;
  city: string | null;
  kind?: ProfileReminderKind;
};
export const PROFILE_REMINDER_FROM = 'Hire Line Dancers <inquiries@mail.hirelinedancers.com>';
export const PROFILE_REMINDER_REPLY_TO = 'hello@hirelinedancers.com';
export const PROFILE_REMINDER_URL = 'https://hirelinedancers.com/account/?tab=profile';
export const PAYOUTS_REMINDER_URL = 'https://hirelinedancers.com/account/?tab=payouts';
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export function profileReminderContent(job: ProfileReminderJob) {
  const place = job.city?.trim() ? `the ${job.city.trim()} area` : 'your area';
  switch (job.kind ?? 'profile_24h') {
    case 'profile_72h':
      return {
        subject: 'Your Hire Line Dancers profile is almost there',
        body: `Your profile is still a draft. It only takes a few minutes to finish, and once it is approved, people planning events in ${place} can find you and send you inquiries.`,
        linkLabel: 'Finish your profile', url: PROFILE_REMINDER_URL,
      };
    case 'payouts':
      return {
        subject: 'Set up payouts so you can get paid',
        body: 'Your Hire Line Dancers profile is live. Before you can send a quote and get paid for a booking, connect a Stripe account for payouts. It takes about 5 minutes.',
        linkLabel: 'Set up payouts', url: PAYOUTS_REMINDER_URL,
      };
    default:
      return {
        subject: 'Finish your profile and get discovered',
        body: `Thanks for starting your Hire Line Dancers profile! Finish setting it up so people planning events in ${place} can find you and reach out with inquiries.`,
        linkLabel: 'Finish your profile', url: PROFILE_REMINDER_URL,
      };
  }
}
export function profileReminderEmail(job: ProfileReminderJob) {
  const name = job.display_name.trim();
  const greeting = name ? `Hey ${name},` : 'Hey,';
  const content = profileReminderContent(job);
  const help = 'If you have any questions or ran into trouble, just reply here and I’ll help.';
  return {
    from: PROFILE_REMINDER_FROM, reply_to: PROFILE_REMINDER_REPLY_TO, to: [job.recipient_email],
    subject: content.subject,
    text: [greeting,'',content.body,'',`${content.linkLabel}: ${content.url}`,'',help,'','CJ'].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><p>${escapeHtml(greeting)}</p><p>${escapeHtml(content.body)}</p><p><a href="${escapeHtml(content.url)}">${escapeHtml(content.linkLabel)}</a></p><p>${escapeHtml(help)}</p><p>CJ</p></div>`,
  };
}
export class ProfileReminderError extends Error {
  constructor(message: string, readonly outcome: 'failed' | 'uncertain' | 'cancelled') { super(message); }
}
export async function sendProfileReminder(job: ProfileReminderJob, apiKey: string, fetcher: typeof fetch = fetch, testMode = false, beforeSend?: () => Promise<boolean>) {
  if (testMode && (job.id !== 0 || job.recipient_email !== "cjwheelock1@gmail.com")) throw new ProfileReminderError("Invalid test recipient", "failed");
  // Low-volume queue: leave room for the worker's other transactional messages.
  await new Promise(resolve => setTimeout(resolve, 600));
  // Resend enforces its suppression list on every send, including sending-only keys.
  // An accepted id is not proof of delivery; signed webhook events record delivery separately.
  if (beforeSend && !await beforeSend()) throw new ProfileReminderError('Profile is no longer eligible', 'cancelled');
  let response: Response;
  try {
    response = await fetcher('https://api.resend.com/emails', {
      method:'POST', signal:AbortSignal.timeout(15_000),
      headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`hld-profile-completion-${job.id}`},
      body:JSON.stringify({ ...profileReminderEmail(job), ...(testMode ? { subject: `[TEST] ${profileReminderContent(job).subject}` } : {}) }),
    });
  } catch { throw new ProfileReminderError('Provider outcome unknown; reconcile before retry', 'uncertain'); }
  const payload = await response.json().catch(()=>({})) as { id?: string };
  if (!response.ok || !payload.id) {
    throw new ProfileReminderError(`Provider returned ${response.status}`, response.status>=500 || response.ok ? 'uncertain' : 'failed');
  }
  return payload.id;
}
