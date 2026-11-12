import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const require = createRequire(import.meta.url);
const source = path => readFileSync(new URL(path, root), "utf8");
const terms = JSON.parse(source("config/commercial-terms.json"));
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const output = ts.transpileModule(source(path), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const commonJsModule = { exports: {} };
  new Function("module", "exports", "require", output)(commonJsModule, commonJsModule.exports, name => {
    if (name === "@/lib/booking") return load("src/lib/booking.ts");
    if (name === "@/lib/marketplace") return {};
    if (name.endsWith("commercial-terms.json")) return terms;
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    return require(name);
  });
  cache.set(path, commonJsModule.exports);
  return commonJsModule.exports;
}
const Guide = load("src/components/InstructorPricingGuide.tsx").InstructorPricingGuide;
const markup = renderToStaticMarkup(createElement(Guide));
const visible = markup.replace(/<[^>]*>/g, "").replaceAll("&#x27;", "'").replaceAll("&#x2019;", "’");

test("approved guidance recommends an inclusive rate without making it mandatory", () => {
  assert.ok(visible.includes("We recommend charging $125–$250 per hour with a two-hour minimum, including travel."));
  assert.ok(visible.includes("Use it as a starting point when setting your rates."));
  assert.ok(visible.includes("Larger corporate events may justify a higher rate."));
  assert.ok(visible.includes("Published event prices vary widely by location"));
  assert.doesNotMatch(markup, /<input|<button|<form/);
  assert.doesNotMatch(visible, /\$400|\$500|travel add-on|must charge/);
});

test("fee education uses the existing commercial contract and a fixed $100 example", () => {
  const booking = load("src/lib/booking.ts");
  assert.equal(terms.bookings.instructorFeeBps, 1500);
  assert.equal(terms.bookings.clientFeeBps, 500);
  assert.equal(booking.previewAmounts(10000).instructorPayoutCents, 8500);
  assert.ok(visible.includes("Hire Line Dancers takes a 15% fee from your instructor price."));
  assert.ok(visible.includes("$100 / hour"));
  assert.ok(visible.includes("$85 / hour"));
  assert.ok(visible.includes("Before any other deductions."));
});

test("guidance is limited to private profile pricing and booking defaults", () => {
  for (const path of ["src/components/ProfileEditor.tsx", "src/components/PayoutsCard.tsx"]) {
    assert.match(source(path), /<InstructorPricingGuide\s*\/>/);
    assert.match(source(path), /min="0\.5" max="24"/);
  }
  for (const path of ["src/components/BookingPanel.tsx", "src/components/BookingAgreementReview.tsx", "src/app/profile/PublicProfile.tsx"]) {
    assert.doesNotMatch(source(path), /InstructorPricingGuide|We recommend charging|A quick guide to pricing/);
  }
});

test("mockup annotations are not product copy", () => {
  for (const text of ["Teach it while instructors set their rates", "Keep the quote clean", "PROPOSED HOME", "REVISED MOCKUP", "Static concept only", "Help instructors set their rates."]) {
    assert.ok(!visible.includes(text));
  }
});
