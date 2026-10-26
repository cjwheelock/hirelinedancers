import assert from "node:assert/strict";

const assertEquals = (actual: unknown, expected: unknown) => assert.deepEqual(actual, expected);
const assertMatch = (actual: string, pattern: RegExp) => assert.match(actual, pattern);
function assertThrows(fn: () => unknown, errorClass?: new (...args: never[]) => Error, includes?: string) {
  assert.throws(fn, (error: unknown) => {
    if (errorClass && !(error instanceof errorClass)) return false;
    if (includes && !(error instanceof Error && error.message.includes(includes))) return false;
    return true;
  });
}
import {
  bankPaymentAllowed,
  BookingInputError,
  businessDaysUntil,
  cancellationPolicyText,
  maskContactDetails,
  parseQuoteInput,
  quoteAmounts,
  renderAgreement,
  sha256Hex,
  STANDARD_CANCELLATION_WINDOWS,
  validCancellationWindows,
} from "./hld-booking.ts";

const baseQuote = {
  eventDate: "2026-12-15",
  startTime: "18:00",
  endTime: "20:00",
  timeZone: "America/New_York",
  venueName: "The Hall",
  venueAddress: "1 Main St, Brooklyn, NY",
  serviceDescription: "Two hours of beginner line dancing.",
  pricingMode: "hourly",
  hourlyRateCents: 20000,
  hours: 2,
  travelFeeCents: 0,
  providesSpeakers: true,
  providesMicrophone: false,
  cancellationPolicy: "standard",
  insuranceChoice: "instructor_handles_outside_agreement",
  signatureName: "Jess Teacher",
};

Deno.test("a $400 booking charges $420 and pays out $340", () => {
  const amounts = quoteAmounts(parseQuoteInput(baseQuote));
  assertEquals(amounts, {
    instructorFeeBps: 1500,
    clientFeeBps: 500,
    priceCents: 40000,
    clientFeeCents: 2000,
    totalCents: 42000,
    platformFeeCents: 6000,
    instructorPayoutCents: 34000,
  });
});

Deno.test("fees round half away from zero like PostgreSQL", () => {
  const amounts = quoteAmounts({
    pricingMode: "flat",
    hourlyRateCents: null,
    hours: null,
    flatPriceCents: 12350,
    travelFeeCents: 0,
  });
  assertEquals(amounts.clientFeeCents, 618);
  assertEquals(amounts.platformFeeCents, 1853);
  assertEquals(amounts.totalCents, 12968);
});

Deno.test("travel fees are part of the instructor price", () => {
  const amounts = quoteAmounts(parseQuoteInput({ ...baseQuote, travelFeeCents: 5000 }));
  assertEquals(amounts.priceCents, 45000);
  assertEquals(amounts.clientFeeCents, 2250);
});

Deno.test("prices below the minimum are rejected", () => {
  assertThrows(
    () => quoteAmounts(parseQuoteInput({ ...baseQuote, hourlyRateCents: 2000, hours: 1 })),
    BookingInputError,
    "between $50.00",
  );
});

Deno.test("quote input is validated", () => {
  assertThrows(() => parseQuoteInput({ ...baseQuote, timeZone: "Mars/Olympus" }), BookingInputError);
  assertThrows(() => parseQuoteInput({ ...baseQuote, hours: 1.1 }), BookingInputError);
  assertThrows(() => parseQuoteInput({ ...baseQuote, endTime: "18:00" }), BookingInputError);
  assertThrows(() => parseQuoteInput({ ...baseQuote, insuranceChoice: "maybe" }), BookingInputError);
  assertThrows(() => parseQuoteInput({ ...baseQuote, signatureName: " " }), BookingInputError);
});

Deno.test("custom cancellation windows must never increase refunds", () => {
  assertEquals(validCancellationWindows([{ minDaysBeforeEvent: 14, refundPercent: 100 }]), true);
  assertEquals(
    validCancellationWindows([
      { minDaysBeforeEvent: 7, refundPercent: 50 },
      { minDaysBeforeEvent: 14, refundPercent: 100 },
    ]),
    false,
  );
  assertEquals(
    validCancellationWindows([
      { minDaysBeforeEvent: 30, refundPercent: 50 },
      { minDaysBeforeEvent: 7, refundPercent: 100 },
    ]),
    false,
  );
  const parsed = parseQuoteInput({
    ...baseQuote,
    cancellationPolicy: "custom",
    cancellationWindows: [{ minDaysBeforeEvent: 14, refundPercent: 100 }],
  });
  assertEquals(parsed.cancellationWindows, [{ minDaysBeforeEvent: 14, refundPercent: 100 }]);
});

Deno.test("the standard policy matches the commercial terms", () => {
  assertEquals(STANDARD_CANCELLATION_WINDOWS, [
    { minDaysBeforeEvent: 30, refundPercent: 100 },
    { minDaysBeforeEvent: 7, refundPercent: 50 },
  ]);
  assertEquals(cancellationPolicyText(STANDARD_CANCELLATION_WINDOWS).length, 3);
});

Deno.test("the agreement states the amounts and the effective-on-payment rule", async () => {
  const input = parseQuoteInput(baseQuote);
  const text = renderAgreement(input, quoteAmounts(input), {
    instructorName: "Jess Teacher",
    instructorBusiness: null,
    organizerName: "Sarah Planner",
    organizerCompany: "Acme",
    legalName: "OMG Goals Inc.",
  });
  assertMatch(text, /Total due from the Client: \$420\.00/);
  assertMatch(text, /takes effect only when the payment succeeds/);
  assertMatch(text, /December 15, 2026/);
  assertMatch(text, /6:00 PM to 8:00 PM/);
  assertEquals(text.includes("—"), false);
  assertMatch(await sha256Hex(text), /^[0-9a-f]{64}$/);
});

Deno.test("bank payments need five business days before the event", () => {
  const monday = new Date("2026-11-02T15:00:00Z");
  assertEquals(businessDaysUntil("2026-11-09", "America/New_York", monday), 4);
  assertEquals(bankPaymentAllowed("2026-11-09", "America/New_York", monday), false);
  assertEquals(bankPaymentAllowed("2026-11-10", "America/New_York", monday), true);
});

Deno.test("contact details are masked", () => {
  const masked = maskContactDetails(
    "Email sarah@example.com, call (512) 555-0134, or DM @sarahplans at instagram.com/sarahplans",
  ) ?? "";
  assertEquals(masked.includes("sarah@example.com"), false);
  assertEquals(masked.includes("555-0134"), false);
  assertEquals(masked.includes("@sarahplans"), false);
  assertEquals(masked.includes("instagram.com"), false);
  assertEquals(maskContactDetails("We need 60 guests at 6 PM."), "We need 60 guests at 6 PM.");
});
