import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function("exports", "require", code)(exports, specifier => specifier.startsWith(".") ? load(resolve(dirname(file), specifier)) : require(specifier));
  return exports;
}
const { createBookingPdf } = load(resolve(root, "src/lib/bookingDocument.ts"));
const rules = load(resolve(root, "supabase/functions/_shared/hld-booking.ts"));
const font = readFileSync(resolve(root, "public/fonts/Lato-Regular.ttf")).toString("base64");
function booking(overrides = {}) {
  const input = rules.parseQuoteInput({ eventDate: "2026-12-15", startTime: "18:00", endTime: "20:00", timeZone: "America/New_York", venueName: "The Hall", venueAddress: "1 Main St, Brooklyn, NY", serviceDescription: "Two hours of beginner line dancing.", pricingMode: "hourly", hourlyRateCents: 20000, hours: 2, travelFeeCents: 0, providesSpeakers: true, providesMicrophone: false, cancellationPolicy: "standard", insuranceChoice: "instructor_handles_outside_agreement", signatureName: "Jess Teacher" });
  return {
    id: "00000000-0000-4000-8000-000000000001", agreement_version: rules.BOOKING_AGREEMENT_VERSION,
    agreement_sha256: "a".repeat(64), time_zone: input.timeZone, service_description: input.serviceDescription,
    pricing_mode: "hourly", hourly_rate_cents: 20000, hours: 2, travel_fee_cents: 0,
    price_cents: 40000, client_fee_cents: 2000, total_cents: 42000,
    agreement_text: rules.renderAgreement(input, rules.quoteAmounts(input), { instructorName: "Jess Teacher", instructorBusiness: null, organizerName: "Sarah Planner", organizerCompany: "Acme", legalName: "OMG Goals Inc." }),
    signatures: [{ party_role: "instructor", typed_name: "Jess Teacher", signed_at: "2026-10-27T19:00:00Z" }], ...overrides
  };
}
const normalize = value => value.replace(/\s+/g, " ").trim();
async function inspect(value) {
  const task = getDocument({ data: new Uint8Array(createBookingPdf(value, font)), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const pages = [];
    const bodies = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      pages.push(content.items.filter(item => "str" in item).map(item => item.str).join(" "));
      bodies.push(content.items.filter(item => "str" in item && item.str !== "HIRE LINE DANCERS" && item.str !== value.agreement_version && !/^\d+ \/ \d+$/.test(item.str)).map(item => item.str).join(" "));
    }
    return { pages, text: normalize(bodies.join(" ")), metadata: await pdf.getMetadata() };
  } finally { await task.destroy(); }
}

test("download preserves every agreement clause and the stored document hash", async () => {
  const value = booking();
  const result = await inspect(value);
  for (const line of value.agreement_text.split("\n").filter(line => line.trim() && line !== "HIRE LINE DANCERS BOOKING AGREEMENT" && !line.startsWith("Agreement version:"))) assert.ok(result.text.includes(normalize(line)), line);
  assert.ok(result.text.includes("$420.00"));
  assert.ok(result.metadata.info.Subject.includes(value.agreement_sha256));
  assert.ok(result.pages.length >= 3);
});

test("long services and future clauses paginate without losing their final text", async () => {
  const service = `${"Beginner line dance instruction with breaks. ".repeat(130)}END_OF_SERVICES`;
  const value = booking({ service_description: service });
  value.agreement_text = value.agreement_text.replace("Two hours of beginner line dancing.", service) + "\n\n12. Additional terms\nEND_OF_AGREEMENT";
  const result = await inspect(value);
  assert.ok(result.pages.length > 4);
  assert.ok(result.text.includes(normalize(service)));
  assert.ok(result.text.includes("12. Additional terms END_OF_AGREEMENT"));
  for (let page = 0; page < result.pages.length; page++) assert.ok(result.pages[page].includes(`${page + 1} / ${result.pages.length}`));
});

test("PDF signatures use saved evidence and preserve accented names", async () => {
  const value = booking({ signatures: [{ party_role: "organizer", typed_name: "José García", signed_at: "2026-10-27T19:05:00Z" }] });
  const result = await inspect(value);
  const signatures = result.text.slice(result.text.lastIndexOf("Signatures"));
  assert.ok(signatures.includes("José García"));
  assert.ok(!signatures.includes("Jess Teacher"));
  assert.ok(signatures.includes("Oct 27, 2026"));
});
