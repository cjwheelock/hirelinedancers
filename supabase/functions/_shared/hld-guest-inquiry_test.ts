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
