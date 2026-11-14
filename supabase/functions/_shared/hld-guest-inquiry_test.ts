import { isHoneypotFilled, parseGuestInquiry, publicGuestError, verifyTurnstile } from "./hld-guest-inquiry.ts";

function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
function throwsWith(fn: () => unknown, fragment: string) {
  try { fn(); } catch (error) { assert(String((error as Error).message).includes(fragment), `expected "${fragment}", got ${(error as Error).message}`); return; }
  throw new Error(`expected an error containing "${fragment}"`);
}
const valid = { email: "  Pat@Example.TEST ", firstName: " Pat ", lastName: "Guest", instructorProfileId: "32000000-0000-0000-0000-000000000022",
  eventType: "weddings", eventDate: "2027-01-10", guestCount: "80", venueHasSpeakers: true };

Deno.test("guest inquiries normalize email and names", () => {
  const input = parseGuestInquiry(valid);
  assert(input.email === "pat@example.test" && input.firstName === "Pat" && input.guestCount === 80, "normalized");
  assert(input.venueHasSpeakers === true && input.venueHasMicrophone === null, "booleans");
});
Deno.test("guest inquiries reject bad input before touching the database", () => {
  throwsWith(() => parseGuestInquiry({ ...valid, email: "not-an-email" }), "valid email");
  throwsWith(() => parseGuestInquiry({ ...valid, firstName: " " }), "name is required");
  throwsWith(() => parseGuestInquiry({ ...valid, instructorProfileId: "x", instructorSlug: null }), "Choose an instructor");
  throwsWith(() => parseGuestInquiry({ ...valid, guestCount: 0 }), "between 1 and 10000");
  throwsWith(() => parseGuestInquiry({ ...valid, message: "x".repeat(3001) }), "too long");
});
Deno.test("the hidden website field marks a bot", () => {
  assert(isHoneypotFilled({ website: "spam.example" }) && !isHoneypotFilled({ website: " " }) && !isHoneypotFilled({}), "honeypot");
});
Deno.test("turnstile is skipped without a secret and enforced with one", async () => {
  assert(await verifyTurnstile(null, undefined, null), "skipped when not configured");
  assert(!(await verifyTurnstile(null, "secret", null)), "missing token fails");
  let sent = "";
  const ok = await verifyTurnstile("token", "secret", "1.2.3.4", async (_url, init) => {
    sent = String(init?.body); return Response.json({ success: true });
  });
  assert(ok && sent.includes("response=token") && sent.includes("remoteip=1.2.3.4"), "verified with Cloudflare");
  assert(!(await verifyTurnstile("token", "secret", null, async () => Response.json({ success: false }))), "failed verification");
  assert(!(await verifyTurnstile("token", "secret", null, async () => { throw new Error("down"); })), "network failure fails closed");
});
Deno.test("only known database errors reach the person", () => {
  assert(publicGuestError("ERROR: Too many requests. Please try again later") === "Too many requests. Please try again later", "rate limit shown");
  assert(publicGuestError("relation private.x does not exist") === "We could not send your inquiry. Please try again.", "internal error hidden");
});

import { confirmationLink, confirmationTokenHash, guestConfirmationEmail, isConfirmationToken, newConfirmationToken } from "./hld-guest-inquiry.ts";

Deno.test("confirmation tokens are random, url safe, and hashed for storage", async () => {
  const a = newConfirmationToken(), b = newConfirmationToken();
  assert(a !== b && isConfirmationToken(a) && isConfirmationToken(b), "two valid distinct tokens");
  assert(!isConfirmationToken("short") && !isConfirmationToken(a + "x") && !isConfirmationToken(null), "rejects malformed tokens");
  const hash = await confirmationTokenHash(a);
  assert(/^[0-9a-f]{64}$/.test(hash) && hash === await confirmationTokenHash(a) && hash !== await confirmationTokenHash(b), "stable sha-256 hex");
});
Deno.test("the confirmation link keeps the token out of the server request", () => {
  const link = confirmationLink(new URL("https://hirelinedancers.com/"), "t".repeat(43));
  assert(link === `https://hirelinedancers.com/confirm-inquiry/#token=${"t".repeat(43)}`, link);
});
Deno.test("the confirmation email names the instructor, the expiry, and is safe HTML", () => {
  const email = guestConfirmationEmail({ to: "pat@example.test", firstName: "Pat", instructorName: "Tara <B>", link: "https://hirelinedancers.com/confirm-inquiry/#token=abc" });
  assert(email.subject === "One click to send your inquiry to Tara <B>", email.subject);
  assert(email.text.includes("Your inquiry to Tara <B> has not been sent yet. Click the button below to send it. This link expires in 7 days."), "explains it is not sent yet");
  assert(email.text.includes("Send my inquiry: https://hirelinedancers.com/confirm-inquiry/#token=abc"), "plain-text link");
  assert(email.html.includes("Tara &lt;B&gt;") && !email.html.includes("<B>"), "escaped");
  assert(!email.text.includes("—") && !email.html.includes("—"), "no em dashes");
  assert(guestConfirmationEmail({ to: "p@e.test", firstName: "P", instructorName: null, link: "x" }).subject === "One click to send your inquiry to the instructor", "fallback name");
});
