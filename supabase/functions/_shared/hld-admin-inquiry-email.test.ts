import { adminInquiryEmail, AdminInquiryEmailError, sendAdminInquiryEmail, type AdminInquiryNotificationJob } from './hld-admin-inquiry-email.ts';
const assert = (condition: unknown, message = 'Assertion failed') => { if (!condition) throw new Error(message); };
const job: AdminInquiryNotificationJob = {
  job_id: 42, attempt_number: 1, delivered_to_email: 'cjwheelock1@gmail.com',
  inquiry_id: '00000000-0000-4000-8000-000000000001',
  inquiry: { contact_name: '<script>alert(1)</script>', contact_email: 'organizer@example.test', contact_phone_e164: '+15555550100', message: 'Call me at +15555550100 or organizer@example.test\n<script>bad</script>', guest_count: 0, venue_has_speakers: false },
};
const config = { apiKey: 'test-only', from: 'test@example.test', appUrl: new URL('https://hirelinedancers.com'), supportEmail: 'hello@hirelinedancers.com' };
Deno.test('admin copy includes unmasked contact details, safe HTML, and authenticated admin route', () => {
  const email = adminInquiryEmail(job, config.appUrl, config.supportEmail);
  assert(email.html.includes('&lt;script&gt;') && !email.html.includes('<script>'));
  assert(email.text.includes('+15555550100') && email.text.includes('organizer@example.test'));
  assert(email.text.includes('Guests: 0') && email.text.includes('Speakers available: No'));
  assert(email.text.includes('https://hirelinedancers.com/admin/?tab=inquiries&inquiry='));
  assert(email.reply_to === 'organizer@example.test');
});
Deno.test('invalid reply-to cannot inject recipient headers', () => {
  const email = adminInquiryEmail({ ...job, inquiry: { contact_email: 'x@test.com\r\nBcc:evil@test.com' } }, config.appUrl, config.supportEmail);
  assert(email.reply_to === config.supportEmail);
});
Deno.test('separate fixed destination and stable idempotency key across attempts', async () => {
  const keys: string[] = [];
  const fetcher = ((_url: unknown, init: RequestInit) => {
    keys.push(new Headers(init.headers).get('Idempotency-Key')!);
    const body = JSON.parse(String(init.body));
    assert(body.to.length === 1 && body.to[0] === 'cjwheelock1@gmail.com');
    return Promise.resolve(Response.json({ id: 'accepted-test' }));
  }) as typeof fetch;
  assert(await sendAdminInquiryEmail(job, config, fetcher) === 'accepted-test');
  await sendAdminInquiryEmail({ ...job, attempt_number: 2 }, config, fetcher);
  assert(keys.join(',') === 'hld-admin-inquiry-42,hld-admin-inquiry-42');
});
Deno.test('wrong destinations fail before any network call', async () => {
  let called = false;
  try {
    await sendAdminInquiryEmail({ ...job, delivered_to_email: 'someone@example.test' }, config, (() => { called = true; throw Error('unexpected'); }) as typeof fetch);
    throw Error('should reject');
  } catch (error) { assert(error instanceof AdminInquiryEmailError && !error.retryable); }
  assert(!called);
});
Deno.test('provider errors are classified without retaining private response details', async () => {
  for (const status of [400, 429, 500]) {
    try {
      await sendAdminInquiryEmail(job, config, (() => Promise.resolve(Response.json({ message: job.inquiry.message }, { status }))) as typeof fetch);
      throw Error('should reject');
    } catch (error) {
      assert(error instanceof AdminInquiryEmailError);
      const failure = error as AdminInquiryEmailError;
      assert(failure.retryable === (status !== 400));
      assert(!failure.message.includes('+15555550100'));
    }
  }
});
Deno.test('network uncertainty remains retryable with the same key', async () => {
  try {
    await sendAdminInquiryEmail(job, config, (() => Promise.reject(Error('private provider details'))) as typeof fetch);
    throw Error('should reject');
  } catch (error) { assert(error instanceof AdminInquiryEmailError && error.retryable && !error.message.includes('private provider details')); }
});
Deno.test('matching requests email the owner with contact details and no instructor route', () => {
  const email = adminInquiryEmail({ ...job, inquiry_id: null, matching_request_id: '00000000-0000-4000-8000-000000000002',
    inquiry: { kind: 'matching_request', id: '00000000-0000-4000-8000-000000000002', contact_name: 'Pat <b>', contact_email: 'pat@example.test', contact_phone: '208-555-0100', event_city: 'Boise', event_region: 'ID', search_query: 'Boise, ID', guest_count: 120 } }, config.appUrl, config.supportEmail);
  assert(email.subject === 'New matching request · Boise, ID');
  assert(email.text.includes('Phone: 208-555-0100') && email.text.includes('Searched for: Boise, ID'));
  assert(email.html.includes('Pat &lt;b&gt;') && !email.text.includes('/admin/'));
  assert(email.reply_to === 'pat@example.test' && email.to[0] === 'cjwheelock1@gmail.com');
});
