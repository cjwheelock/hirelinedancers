#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generatedTermsPath,
  loadCommercialTerms,
  numberWord,
  renderGeneratedTerms
} from "./sync-commercial-terms.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const terms = loadCommercialTerms();

function read(relativePath) {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    failures.push(`${relativePath}: missing`);
    return "";
  }
  return readFileSync(path, "utf8");
}

function requireText(relativePath, expected, label = expected) {
  if (!read(relativePath).includes(expected)) failures.push(`${relativePath}: missing ${label}`);
}

function requirePattern(relativePath, pattern, label) {
  if (!pattern.test(read(relativePath))) failures.push(`${relativePath}: missing ${label}`);
}

function formatUsd(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

const generated = readFileSync(generatedTermsPath, "utf8");
if (generated !== renderGeneratedTerms(terms)) {
  failures.push("supabase/functions/_shared/hld-commercial-terms.ts: stale generated contract");
}

const packageJson = JSON.parse(read("package.json"));
if (packageJson.scripts?.["terms:sync"] !== "node scripts/sync-commercial-terms.mjs") {
  failures.push("package.json: terms:sync script is missing or changed");
}
if (packageJson.scripts?.["terms:audit"] !== "node scripts/audit-commercial-terms.mjs") {
  failures.push("package.json: terms:audit script is missing or changed");
}
requireText(".github/workflows/deploy.yml", "npm run terms:audit", "commercial terms CI gate");

const wiredClientSurfaces = [
  "src/app/instructors/join/page.tsx",
  "src/app/legal/refund-policy/page.tsx",
  "src/app/legal/terms/page.tsx",
  "src/components/AccountWorkspace.tsx",
  "src/components/LoginScreen.tsx",
  "src/lib/adminApproval.ts"
];
for (const file of wiredClientSurfaces) requireText(file, "@/lib/commercialTerms", "commercial terms helper import");

const wiredFunctionSurfaces = [
  "supabase/functions/_shared/hld-payment-setup.ts",
  "supabase/functions/_shared/hld-stripe.ts",
  "supabase/functions/create-instructor-payment-setup/index.ts",
  "supabase/functions/process-inquiry-notifications/index.ts",
  "supabase/functions/review-instructor-profile/index.ts",
  "supabase/functions/send-instructor-invitation/index.ts"
];
for (const file of wiredFunctionSurfaces) requireText(file, "hld-commercial-terms.ts", "generated commercial terms import");

const bannedRuntimeLiterals = [
  [/\$14\.99\b/g, "hard-coded membership price"],
  [/\b1499\b/g, "hard-coded membership cents"],
  [/\b(?:two|2)[ -](?:free )?months?\b/gi, "hard-coded offer duration"],
  [/\b90(?:-| )days?\b/gi, "hard-coded guarantee coverage"],
  [/\b14(?:-| )days?\b/gi, "hard-coded timing policy"],
  [/2026-08-07-90-day-paid-invoice-v1/g, "hard-coded guarantee version"]
];
for (const file of [...wiredClientSurfaces, ...wiredFunctionSurfaces]) {
  const source = read(file);
  for (const [pattern, label] of bannedRuntimeLiterals) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) failures.push(`${file}: ${label} must come from the commercial terms contract`);
  }
}

const migrations = terms.database;
const invitationMigration = `supabase/migrations/${migrations.invitationPolicyMigration}`;
requireText(invitationMigration, `interval '${terms.offer.invitationClaimDays} days'`, "invitation claim interval");
requireText(invitationMigration, `interval '${terms.offer.profileSubmissionDays} days'`, "profile submission interval");
requireText(invitationMigration, terms.offer.outreachOfferCode, "outreach offer code");

const paymentSetupMigration = `supabase/migrations/${migrations.paymentSetupPolicyMigration}`;
requireText(paymentSetupMigration, terms.paymentSetup.termsVersion, "payment setup terms version");
requireText(paymentSetupMigration, terms.offer.foundingOfferCode, "founding offer code");
requireText(paymentSetupMigration, terms.offer.outreachOfferCode, "outreach offer code");
requirePattern(paymentSetupMigration, new RegExp(`between\\s+1\\s+and\\s+${terms.offer.foundingInstructorLimit}\\b`, "i"), "founding allocation limit");

const guaranteeMigration = `supabase/migrations/${migrations.guaranteePolicyMigration}`;
requireText(guaranteeMigration, terms.membership.checkoutTermsVersion, "checkout terms version");
requireText(guaranteeMigration, terms.guarantee.termsVersion, "guarantee terms version");
requireText(guaranteeMigration, `interval '${terms.guarantee.coverageDays} days'`, "guarantee coverage interval");
requireText(guaranteeMigration, `interval '${terms.guarantee.coverageDays + terms.guarantee.claimWindowDays} days'`, "guarantee claim deadline interval");

const recoveryMigration = `supabase/migrations/${migrations.billingRecoveryPolicyMigration}`;
requireText(recoveryMigration, `interval '${terms.billingRecovery.graceDays} days'`, "billing recovery interval");

const freeMonthsWord = numberWord(terms.offer.freeBillingCycles);
const docs = ["README.md", "SUPABASE_SETUP.md", "supabase/functions/README.md"];
for (const file of docs) {
  requireText(file, formatUsd(terms.membership.monthlyPriceCents), "active monthly price");
  requirePattern(file, new RegExp(`\\b${terms.guarantee.coverageDays}(?:-| )day`, "i"), "active guarantee coverage");
  requirePattern(file, new RegExp(`\\b${terms.billingRecovery.graceDays}(?:-| )day`, "i"), "active billing recovery period");
  requirePattern(file, new RegExp(`\\bfirst ${terms.offer.foundingInstructorLimit}\\b`, "i"), "active founding limit");
  requirePattern(file, new RegExp(`\\b${freeMonthsWord} (?:free )?months?\\b`, "i"), "active free period");
}

const migrationNames = readdirSync(resolve(root, "supabase/migrations")).filter((name) => name.endsWith(".sql"));
for (const migration of Object.values(migrations)) {
  if (!migrationNames.includes(migration)) failures.push(`config/commercial-terms.json: unknown migration ${migration}`);
}

if (failures.length) {
  console.error("Commercial terms audit failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Commercial terms audit passed for ${terms.contractVersion}.`);
console.log(`Active policy: ${formatUsd(terms.membership.monthlyPriceCents)}/month, ${terms.offer.freeBillingCycles} free cycles, ${terms.guarantee.coverageDays}-day guarantee, ${terms.billingRecovery.graceDays}-day recovery.`);
