import { adminDealEmail, sendAdminDealEmail, type AdminDealNotificationJob } from './hld-admin-deal-email.ts';
const assert = (ok: boolean, msg = 'assertion failed') => { if (!ok) throw new Error(msg); };
const job = (kind: string): AdminDealNotificationJob => ({
  job_id: 7, attempt_number: 1, delivered_to_email: 'cjwheelock1@gmail.com', booking_id: 'b1',
  payload: { kind, booking_id: 'b1', inquiry_id: 'i1', instructor_name: 'Tara', organizer_name: 'Pat L',
    total_cents: 63250, price_cents: 55000, platform_fee_cents: 11000, instructor_payout_cents: 46750, version: 1 },
});
const url = new URL('https://hirelinedancers.com');
Deno.test('subjects name the milestone and amount', () => {
  assert(adminDealEmail(job('quote_sent'), url).subject === 'Quote sent · Tara × Pat L · $632.50');
  assert(adminDealEmail(job('quote_signed'), url).subject.startsWith('Quote signed'));
  assert(adminDealEmail(job('payment_received'), url).subject.startsWith('Payment received'));
  assert(adminDealEmail(job('payout_sent'), url).subject.endsWith('$467.50'));
  assert(adminDealEmail(job('quote_sent'), url).text.includes('inquiry=i1'));
});
Deno.test('unknown types are not retried', () => {
  let threw = false; try { adminDealEmail(job('mystery'), url); } catch { threw = true; } assert(threw);
});
Deno.test('only sends to CJ with an idempotency key', async () => {
  let seen: RequestInit | undefined;
  const id = await sendAdminDealEmail(job('quote_sent'), { apiKey: 'k', from: 'f', appUrl: url, replyTo: 'r' },
    (async (_u: unknown, init?: RequestInit) => { seen = init; return Response.json({ id: 'msg' }); }) as typeof fetch);
  assert(id === 'msg');
  assert((seen!.headers as Record<string, string>)['Idempotency-Key'] === 'hld-admin-deal-7');
  assert(JSON.parse(String(seen!.body)).to[0] === 'cjwheelock1@gmail.com');
  let threw = false;
  try { await sendAdminDealEmail({ ...job('quote_sent'), delivered_to_email: 'x@y.z' }, { apiKey: 'k', from: 'f', appUrl: url, replyTo: 'r' }); } catch { threw = true; }
  assert(threw);
});
