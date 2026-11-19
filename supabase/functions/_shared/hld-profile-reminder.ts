export type ProfileReminderJob = {
  id: number;
  recipient_email: string;
  display_name: string;
  city: string | null;
  step?: number | null;
  first_name?: string | null;
};
export const PROFILE_REMINDER_FROM = 'Hire Line Dancers <inquiries@mail.hirelinedancers.com>';
export const PROFILE_REMINDER_REPLY_TO = 'hello@hirelinedancers.com';
export const PROFILE_REMINDER_URL = 'https://hirelinedancers.com/account/?tab=profile';
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
// Greeting uses the account first name; falls back to the first word of the profile name.
export function reminderFirstName(job: ProfileReminderJob) {
  const first = job.first_name?.trim();
  if (first) return first;
  return job.display_name.trim().split(/\s+/)[0] ?? '';
}
// Copy approved by CJ on Nov 18, 2026. Step 1 at 24 hours, step 2 at day 4, step 3 at day 10.
function reminderCopy(job: ProfileReminderJob): { subject: string; paragraphs: string[]; after: string[] } {
  const step = job.step ?? 1;
  if (step === 2) return {
    subject: 'Your profile isn’t live yet',
    paragraphs: ['Quick heads up: your profile is still a draft, so planners can’t see you yet. It only takes a few minutes to finish.'],
    after: [],
  };
  if (step === 3) return {
    subject: 'Still want to get booked?',
    paragraphs: ['Last nudge from me. If you’d like event bookings through Hire Line Dancers, you’re one step away from going live.'],
    after: ['If now’s not the right time, no worries. Just reply and let me know.'],
  };
  const place = job.city?.trim() ? `the ${job.city.trim()} area` : 'your area';
  return {
    subject: 'Finish your profile and get discovered',
    paragraphs: [`Thanks for starting your Hire Line Dancers profile! Finish setting it up so people planning events in ${place} can find you and reach out with inquiries.`],
    after: ['If you have any questions or ran into trouble, just reply here and I’ll help.'],
  };
}
export function profileReminderEmail(job: ProfileReminderJob) {
  const name = reminderFirstName(job);
  const greeting = name ? `Hey ${name},` : 'Hey,';
  const copy = reminderCopy(job);
  const text = [greeting, '', ...copy.paragraphs.flatMap(p => [p, '']), `Finish your profile: ${PROFILE_REMINDER_URL}`, '', ...copy.after.flatMap(p => [p, '']), 'CJ'].join('\n');
  const para = (t: string) => `<p>${escapeHtml(t)}</p>`;
  return {
    from: PROFILE_REMINDER_FROM, reply_to: PROFILE_REMINDER_REPLY_TO, to: [job.recipient_email],
    subject: copy.subject,
    text,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6">${para(greeting)}${copy.paragraphs.map(para).join('')}<p><a href="${escapeHtml(PROFILE_REMINDER_URL)}">Finish your profile</a></p>${copy.after.map(para).join('')}<p>CJ</p></div>`,
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
      body:JSON.stringify((() => { const m = profileReminderEmail(job); return testMode ? { ...m, subject: `[TEST] ${m.subject}` } : m; })()),
    });
  } catch { throw new ProfileReminderError('Provider outcome unknown; reconcile before retry', 'uncertain'); }
  const payload = await response.json().catch(()=>({})) as { id?: string };
  if (!response.ok || !payload.id) {
    throw new ProfileReminderError(`Provider returned ${response.status}`, response.status>=500 || response.ok ? 'uncertain' : 'failed');
  }
  return payload.id;
}
