import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const repositoryRoot = new URL("../", import.meta.url);

function loadTypeScriptModule(relativePath) {
  const fileUrl = new URL(relativePath, repositoryRoot);
  const source = readFileSync(fileUrl, "utf8");
  const transpiled = ts.transpileModule(source, {
    fileName: fileUrl.pathname,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      strict: true
    }
  });
  const errors = (transpiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `TypeScript transpilation failed for ${relativePath}`);

  const commonJsModule = { exports: {} };
  const evaluate = new Function("exports", "module", "require", transpiled.outputText);
  evaluate(commonJsModule.exports, commonJsModule, () => {
    throw new Error(`Unexpected runtime import in ${relativePath}`);
  });
  return commonJsModule.exports;
}

const approval = loadTypeScriptModule("src/lib/adminApproval.ts");
const offerValidation = loadTypeScriptModule("supabase/functions/_shared/hld-offer-validation.ts");

function assertTypeScriptSyntax(relativePath) {
  const fileUrl = new URL(relativePath, repositoryRoot);
  const transpiled = ts.transpileModule(readFileSync(fileUrl, "utf8"), {
    fileName: fileUrl.pathname,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      strict: true
    }
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.equal(errors.length, 0, `TypeScript transpilation failed for ${relativePath}`);
}

function validCoupon() {
  return {
    valid: true,
    livemode: true,
    percent_off: 100,
    amount_off: null,
    duration: "repeating",
    duration_in_months: 2,
    max_redemptions: null,
    redeem_by: null,
    applies_to: { products: ["prod_membership"] }
  };
}

const offerExpectation = {
  expectedLivemode: true,
  productId: "prod_membership",
  months: 2
};

test("the exact two-month coupon passes every requirement", () => {
  assert.deepEqual(
    offerValidation.instructorOfferCouponMismatches(validCoupon(), offerExpectation),
    []
  );
});

test("each unsafe coupon difference is named for production diagnostics", () => {
  const cases = [
    [{ valid: false }, "coupon_not_valid"],
    [{ livemode: false }, "wrong_stripe_mode"],
    [{ percent_off: 50 }, "wrong_percent_off"],
    [{ amount_off: 1499 }, "amount_off_present"],
    [{ duration: "once" }, "wrong_duration"],
    [{ duration_in_months: 1 }, "wrong_duration_months"],
    [{ max_redemptions: 100 }, "max_redemptions_present"],
    [{ redeem_by: 1_900_000_000 }, "redeem_by_present"],
    [{ applies_to: { products: ["prod_other"] } }, "wrong_product_restriction"]
  ];

  for (const [change, expectedMismatch] of cases) {
    const mismatches = offerValidation.instructorOfferCouponMismatches(
      { ...validCoupon(), ...change },
      offerExpectation
    );
    assert.deepEqual(mismatches, [expectedMismatch]);
  }
});

test("a paid approval receipt requires publication and an active membership", () => {
  const receipt = approval.parseInstructorApprovalReceipt({
    approved: true,
    profileStatus: "published",
    lifetimeAccess: false,
    membershipStatus: "active",
    slug: "dancing-with-tay",
    emailStatus: "pending"
  }, "fallback-slug");

  assert.deepEqual(receipt, {
    profileStatus: "published",
    lifetimeAccess: false,
    membershipStatus: "active",
    slug: "dancing-with-tay",
    emailStatus: "pending"
  });
});

test("a lifetime approval receipt does not require a Stripe membership", () => {
  const receipt = approval.parseInstructorApprovalReceipt({
    approved: true,
    profileStatus: "published",
    lifetimeAccess: true,
    membershipStatus: null,
    slug: "lifetime-instructor",
    emailStatus: "sent"
  }, "fallback-slug");

  assert.equal(receipt.lifetimeAccess, true);
  assert.equal(receipt.membershipStatus, null);
  assert.equal(receipt.emailStatus, "sent");
});

test("the client refuses to claim success without durable publication facts", () => {
  assert.throws(
    () => approval.parseInstructorApprovalReceipt({ approved: false }, "profile"),
    /did not confirm/
  );
  assert.throws(
    () => approval.parseInstructorApprovalReceipt({
      approved: true,
      profileStatus: "approved",
      lifetimeAccess: false,
      membershipStatus: "active"
    }, "profile"),
    /still being confirmed/
  );
  assert.throws(
    () => approval.parseInstructorApprovalReceipt({
      approved: true,
      profileStatus: "published",
      lifetimeAccess: false,
      membershipStatus: "inactive"
    }, "profile"),
    /active membership was not confirmed/
  );
});

test("unknown or absent email state is surfaced as missing", () => {
  assert.equal(approval.normalizeApprovalEmailStatus(undefined), "missing");
  assert.equal(approval.normalizeApprovalEmailStatus("unexpected"), "missing");
  assert.equal(approval.normalizeApprovalEmailStatus("delivered"), "delivered");
  assert.equal(approval.approvalEmailNeedsAttention("missing"), true);
  assert.match(approval.approvalEmailStatusCopy("missing"), /was not queued/);
});

test("the known Stripe configuration failure tells the admin that nothing changed", () => {
  const copy = approval.approvalFailureCopy(
    "The two-month instructor offer is not configured correctly in Stripe.",
    "instructor_offer_configuration_invalid"
  );
  assert.match(copy, /Nothing changed/);
  assert.match(copy, /no approval email was sent/);
});

test("the review page integrates inline accessible states and service email visibility", () => {
  const workspace = readFileSync(new URL("src/components/AccountWorkspace.tsx", repositoryRoot), "utf8");
  assert.match(workspace, /Approved and live/);
  assert.match(workspace, /Approval didn’t complete/);
  assert.match(workspace, /className=\{styles\.approvalFailure\} role="alert"/);
  assert.match(workspace, /instructor_service_notification_jobs/);
  assert.doesNotMatch(workspace, /window\.alert\(|window\.confirm\(/);
});

test("the Stripe validator and approval Edge Function have valid TypeScript syntax", () => {
  assertTypeScriptSyntax("supabase/functions/_shared/hld-stripe.ts");
  assertTypeScriptSyntax("supabase/functions/review-instructor-profile/index.ts");
});

test("new approval copy follows the repository punctuation rule", () => {
  const files = [
    "src/lib/adminApproval.ts",
    "src/components/AccountWorkspace.tsx",
    "supabase/functions/_shared/hld-offer-validation.ts"
  ];
  for (const file of files) {
    assert.doesNotMatch(readFileSync(new URL(file, repositoryRoot), "utf8"), /—/, `${file} contains an em dash`);
  }
});
