export type ProfileReminderJob = {
  id: number;
  recipient_email: string;
  display_name: string;
  city: string | null;
};
export const PROFILE_REMINDER_FROM = 'Hire Line Dancers <inquiries@mail.hirelinedancers.com>';
export const PROFILE_REMINDER_REPLY_TO = 'hello@hirelinedancers.com';
export const PROFILE_REMINDER_URL = 'https://hirelinedancers.com/account/?tab=profile';
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export function profileReminderEmail(job: ProfileReminderJob) {
  const name = job.display_name.trim();
  const place = job.city?.trim() ? `the ${job.city.trim()} area` : 'your area';
  const greeting = name ? `Hey ${name},` : 'Hey,';
  const body = `Thanks for starting your Hire Line Dancers profile! Finish setting it up so people planning events in ${place} can find you and reach out with inquiries.`;
  const help = 'If you have any questions or ran into trouble, just reply here and I’ll help.';
  return {
    from: PROFILE_REMINDER_FROM, reply_to: PROFILE_REMINDER_REPLY_TO, to: [job.recipient_email],
    subject: 'Finish your profile and get discovered',
    text: [greeting,'',body,'',`Finish your profile: ${PROFILE_REMINDER_URL}`,'',help,'','CJ'].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p><p><a href="${escapeHtml(PROFILE_REMINDER_URL)}">Finish your profile</a></p><p>${escapeHtml(help)}</p><p>CJ</p></div>`,
  };
}
export class ProfileReminderError extends Error {
  constructor(message: string, readonly outcome: 'failed' | 'uncertain' | 'cancelled') { super(message); }
}
export async function profileReminderSuppressed(email: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  let response: Response;
  try {
    response = await fetcher(`https://api.resend.com/suppressions/${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new ProfileReminderError('Suppression lookup unavailable; no email sent', 'failed'); }
  if (response.status === 404) return false;
  if (!response.ok) throw new ProfileReminderError(`Suppression lookup returned ${response.status}; no email sent`, 'failed');
  const data = await response.json().catch(() => null) as { email?: string } | null;
  if (typeof data?.email !== 'string' || data.email.toLowerCase() !== email.toLowerCase()) {
    throw new ProfileReminderError('Invalid suppression lookup response; no email sent', 'failed');
  }
  return true;
}
export async function sendProfileReminder(job: ProfileReminderJob, apiKey: string, fetcher: typeof fetch = fetch, testMode = false, beforeSend?: () => Promise<boolean>) {
  if (testMode && (job.id !== 0 || job.recipient_email !== "cjwheelock1@gmail.com")) throw new ProfileReminderError("Invalid test recipient", "failed");
  // Low-volume queue: leave room for the worker's other transactional messages.
  await new Promise(resolve => setTimeout(resolve, 600));
  if (await profileReminderSuppressed(job.recipient_email, apiKey, fetcher)) {
    throw new ProfileReminderError('Recipient is suppressed by email provider', 'cancelled');
  }
  await new Promise(resolve => setTimeout(resolve, 600));
  if (beforeSend && !await beforeSend()) throw new ProfileReminderError('Profile is no longer eligible', 'cancelled');
  let response: Response;
  try {
    response = await fetcher('https://api.resend.com/emails', {
      method:'POST', signal:AbortSignal.timeout(15_000),
      headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`hld-profile-completion-${job.id}`},
      body:JSON.stringify({ ...profileReminderEmail(job), ...(testMode ? { subject: "[TEST] Finish your profile and get discovered" } : {}) }),
    });
  } catch { throw new ProfileReminderError('Provider outcome unknown; reconcile before retry', 'uncertain'); }
  const payload = await response.json().catch(()=>({})) as { id?: string };
  if (!response.ok || !payload.id) {
    throw new ProfileReminderError(`Provider returned ${response.status}`, response.status>=500 || response.ok ? 'uncertain' : 'failed');
  }
  return payload.id;
}
