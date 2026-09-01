import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const repositoryRoot = new URL("../", import.meta.url);

function source(relativePath) {
  return readFileSync(new URL(relativePath, repositoryRoot), "utf8");
}

function loadTypeScriptModule(relativePath, runtimeImports = {}) {
  const fileUrl = new URL(relativePath, repositoryRoot);
  const transpiled = ts.transpileModule(source(relativePath), {
    fileName: fileUrl.pathname,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(
    errors.length,
    0,
    `TypeScript transpilation failed for ${relativePath}`,
  );

  const commonJsModule = { exports: {} };
  const evaluate = new Function(
    "exports",
    "module",
    "require",
    transpiled.outputText,
  );
  evaluate(commonJsModule.exports, commonJsModule, (specifier) => {
    if (specifier in runtimeImports) return runtimeImports[specifier];
    throw new Error(
      `Unexpected runtime import ${specifier} in ${relativePath}`,
    );
  });
  return commonJsModule.exports;
}

function assertTypeScriptSyntax(relativePath) {
  const fileUrl = new URL(relativePath, repositoryRoot);
  const transpiled = ts.transpileModule(source(relativePath), {
    fileName: fileUrl.pathname,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(
    errors.length,
    0,
    `TypeScript transpilation failed for ${relativePath}`,
  );
}

const couponValidation = loadTypeScriptModule(
  "supabase/functions/_shared/hld-membership-credit-validation.ts",
);

class FakeStripe {
  static errors = { StripeError: class StripeError extends Error {} };
}

const membershipCredit = loadTypeScriptModule(
  "supabase/functions/_shared/hld-membership-credit.ts",
  {
    "npm:stripe@^22": { __esModule: true, default: FakeStripe },
    "./hld-stripe.ts": {
      hasCurrentMembershipTerms: () => true,
      requiredEnv: () => "coupon_free_month",
      stripeInvoiceSubscriptionId: (invoice) =>
        invoice.parent?.subscription_details?.subscription ?? null,
      stripeObjectId: (value) =>
        typeof value === "string" ? value : value?.id ?? null,
      verifiedMembershipPrice: async () => ({ id: "price_monthly" }),
    },
    "./hld-membership-credit-validation.ts": couponValidation,
  },
);

function validCoupon() {
  return {
    id: "membership_free_month_2026",
    valid: true,
    livemode: true,
    percent_off: 100,
    amount_off: null,
    duration: "once",
    duration_in_months: null,
    max_redemptions: null,
    redeem_by: null,
    applies_to: { products: ["prod_membership"] },
  };
}

const expectation = {
  expectedLivemode: true,
  productId: "prod_membership",
};

test("only an exact once, 100-percent, Product-restricted coupon is accepted", () => {
  assert.deepEqual(
    couponValidation.membershipCreditCouponMismatches(
      validCoupon(),
      expectation,
    ),
    [],
  );
});

test("each unsafe coupon difference is rejected", () => {
  const cases = [
    [{ valid: false }, "coupon_not_valid"],
    [{ livemode: false }, "wrong_stripe_mode"],
    [{ percent_off: 99 }, "wrong_percent_off"],
    [{ amount_off: 1499 }, "amount_off_present"],
    [{ duration: "repeating" }, "wrong_duration"],
    [{ duration_in_months: 1 }, "duration_months_present"],
    [{ max_redemptions: 100 }, "max_redemptions_present"],
    [{ redeem_by: 1_900_000_000 }, "redeem_by_present"],
    [{ applies_to: { products: [] } }, "wrong_product_restriction"],
    [{ applies_to: { products: ["prod_other"] } }, "wrong_product_restriction"],
    [
      { applies_to: { products: ["prod_membership", "prod_other"] } },
      "wrong_product_restriction",
    ],
    [{ id: "Z00npt3G" }, "legacy_coupon"],
    [{ id: "FREEMONTH" }, "legacy_coupon"],
  ];

  for (const [change, expectedMismatch] of cases) {
    const mismatches = couponValidation.membershipCreditCouponMismatches(
      { ...validCoupon(), ...change },
      expectation,
    );
    assert.ok(
      mismatches.includes(expectedMismatch),
      `${expectedMismatch} was not returned for ${JSON.stringify(change)}`,
    );
  }
});

test("the grant endpoint supports browser idempotency safely", () => {
  const edge = source(
    "supabase/functions/grant-membership-free-month/index.ts",
  );
  assert.match(edge, /Access-Control-Allow-Headers[\s\S]*idempotency-key/);
  assert.match(edge, /req\.headers\.get\("idempotency-key"\)/);
  assert.match(edge, /idempotencyHeader !== idempotencyKey/);
  assert.match(
    edge,
    /allowedSources = new Set\(\["admin", "referral", "welcome_video"\]\)/,
  );
  assert.match(edge, /\.eq\("is_owner", true\)/);
  assert.match(edge, /issue_membership_credit_entitlement/);
});

test("Stripe application is server-only, non-stacking, and stable on retry", () => {
  const helper = source("supabase/functions/_shared/hld-membership-credit.ts");
  assert.match(helper, /STRIPE_MEMBERSHIP_FREE_MONTH_COUPON_ID/);
  assert.match(helper, /promotionCodes\.list/);
  assert.doesNotMatch(helper, /promotionCodes\.create/);
  assert.doesNotMatch(helper, /coupons\.create/);
  assert.match(helper, /subscriptionHasAnyDiscount/);
  assert.match(helper, /customerHasDiscount/);
  assert.match(helper, /proration_behavior: "none"/);
  assert.match(helper, /idempotencyKey: application\.stripe_idempotency_key/);
  assert.match(helper, /"unsupported_cadence"/);
  assert.match(helper, /"cancellation_scheduled"/);
  assert.doesNotMatch(helper, /automatic_tax/);
  assert.doesNotMatch(helper, /payment_method_types/);
});

test("invoice reconciliation proves exact full-price credit consumption", () => {
  const helper = source("supabase/functions/_shared/hld-membership-credit.ts");
  const webhook = source("supabase/functions/stripe-webhook/index.ts");
  assert.match(helper, /membershipLines\.length !== 1/);
  assert.match(helper, /membershipLines\[0\]\.quantity !== 1/);
  assert.match(helper, /amountCents !== membershipLines\[0\]\.amount/);
  assert.match(helper, /hasCurrentMembershipTerms\(invoiceMetadata\)/);
  assert.match(webhook, /"invoice\.finalized"/);
  assert.match(webhook, /"invoice\.paid"/);
  assert.match(webhook, /reconcileMembershipCreditInvoice/);
  assert.match(webhook, /reconcileOrRequeueCanceledMembershipCredits/);
  assert.match(webhook, /STRIPE_MEMBERSHIP_CREDIT_KEY/);
});

test("deleted-before-finalized webhook delivery cannot reuse a consumed credit", () => {
  const helper = source("supabase/functions/_shared/hld-membership-credit.ts");
  const migration = source(
    "supabase/migrations/20260901031851_membership_credit_entitlements.sql",
  );
  assert.match(helper, /stripe\.invoices\.list/);
  assert.match(helper, /invoiceCreditApplicationId/);
  assert.match(
    helper,
    /\.in\("status", \["applying", "applied", "abandoned"\]\)/,
  );
  assert.match(helper, /matchingInvoice\.status === "draft"/);
  assert.match(
    helper,
    /cancellationResult\.consumptionResult|consumptionResult/,
  );
  assert.match(migration, /application\.status = 'abandoned'/);
  assert.match(
    migration,
    /application\.deferred_reason <> 'subscription_canceled'/,
  );
  assert.match(
    migration,
    /replacement\.status in \('applying', 'applied', 'consumed'\)/,
  );
  assert.match(migration, /'requeueReversed', requeue_reversed/);
  assert.match(migration, /'requeueRecovered', requeue_recovered/);
});

test("cancellation consumes a previously finalized exact invoice before requeue", async () => {
  const applicationId = "92000000-0000-4000-8000-000000000001";
  const entitlementId = "92000000-0000-4000-8000-000000000002";
  const profileId = "92000000-0000-4000-8000-000000000003";
  const invoice = {
    id: "in_creditlate",
    customer: "cus_creditlate",
    currency: "usd",
    billing_reason: "subscription_cycle",
    status: "open",
    livemode: true,
    status_transitions: { finalized_at: 1_900_000_000 },
    parent: {
      subscription_details: {
        subscription: "sub_creditlate",
        metadata: {
          product_line: "hire_line_dancers",
          instructor_profile_id: profileId,
          membership_credit_application_id: applicationId,
          membership_credit_entitlement_id: entitlementId,
          membership_credit_benefit: "membership_free_month_v1",
        },
      },
    },
  };
  const stripe = {
    invoices: {
      list: async () => ({ data: [invoice], has_more: false }),
      listLineItems: async () => ({
        data: [{
          amount: 1500,
          quantity: 1,
          pricing: { price_details: { price: "price_monthly" } },
          discount_amounts: [{ amount: 1500, discount: "di_creditlate" }],
        }],
        has_more: false,
      }),
    },
  };
  const application = {
    id: applicationId,
    entitlement_id: entitlementId,
    instructor_profile_id: profileId,
    status: "applied",
    stripe_idempotency_key: `hld-membership-credit-${applicationId}`,
    stripe_customer_id: "cus_creditlate",
    stripe_subscription_id: "sub_creditlate",
    stripe_price_id: "price_monthly",
    stripe_coupon_id: "coupon_free_month",
    stripe_discount_id: "di_creditlate",
    livemode: true,
    started_at: "2029-12-31T23:00:00.000Z",
    applied_at: "2029-12-31T23:05:00.000Z",
  };
  const rpcCalls = [];
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    async maybeSingle() {
      return { data: application, error: null };
    },
  };
  const supabase = {
    from: () => query,
    async rpc(name, parameters) {
      rpcCalls.push({ name, parameters });
      assert.equal(name, "consume_membership_credit_application");
      return {
        data: { result: "consumed", requeueReversed: false },
        error: null,
      };
    },
  };

  const result = await membershipCredit
    .reconcileOrRequeueCanceledMembershipCredits(
      stripe,
      supabase,
      { priceId: "price_monthly", expectedLivemode: true },
      { id: "evt_subscription_deleted", created: 1_900_000_100 },
      { id: "sub_creditlate" },
      profileId,
    );

  assert.equal(result.requeuedCount, 0);
  assert.equal(result.consumptionResult.result, "consumed");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].parameters.p_stripe_invoice_id, "in_creditlate");
});

test("cancellation recovers a finalized invoice from the applying crash window", async () => {
  const applicationId = "93000000-0000-4000-8000-000000000001";
  const entitlementId = "93000000-0000-4000-8000-000000000002";
  const profileId = "93000000-0000-4000-8000-000000000003";
  const invoice = {
    id: "in_applycrash",
    customer: "cus_applycrash",
    currency: "usd",
    billing_reason: "subscription_cycle",
    status: "open",
    livemode: true,
    discounts: [{
      id: "di_applycrash",
      coupon: { id: "coupon_free_month" },
    }],
    status_transitions: { finalized_at: 1_900_000_000 },
    parent: {
      subscription_details: {
        subscription: "sub_applycrash",
        metadata: {
          product_line: "hire_line_dancers",
          instructor_profile_id: profileId,
          membership_credit_application_id: applicationId,
          membership_credit_entitlement_id: entitlementId,
          membership_credit_benefit: "membership_free_month_v1",
        },
      },
    },
  };
  const subscription = {
    id: "sub_applycrash",
    customer: "cus_applycrash",
    livemode: true,
    metadata: {
      product_line: "hire_line_dancers",
      instructor_profile_id: profileId,
      membership_credit_application_id: applicationId,
      membership_credit_entitlement_id: entitlementId,
      membership_credit_benefit: "membership_free_month_v1",
    },
    items: {
      has_more: false,
      data: [{ price: { id: "price_monthly" }, quantity: 1 }],
    },
  };
  const stripe = {
    invoices: {
      list: async () => ({ data: [invoice], has_more: false }),
      retrieve: async () => invoice,
      listLineItems: async () => ({
        data: [{
          amount: 1500,
          quantity: 1,
          pricing: { price_details: { price: "price_monthly" } },
          discount_amounts: [{ amount: 1500, discount: "di_applycrash" }],
        }],
        has_more: false,
      }),
    },
    coupons: {
      retrieve: async () => ({
        id: "coupon_free_month",
        valid: true,
        livemode: true,
        percent_off: 100,
        amount_off: null,
        duration: "once",
        duration_in_months: null,
        max_redemptions: null,
        redeem_by: null,
        applies_to: { products: ["prod_membership"] },
      }),
    },
    promotionCodes: {
      list: async () => ({ data: [], has_more: false }),
    },
  };
  const application = {
    id: applicationId,
    entitlement_id: entitlementId,
    instructor_profile_id: profileId,
    status: "applying",
    stripe_idempotency_key: `hld-membership-credit-${applicationId}`,
    stripe_customer_id: "cus_applycrash",
    stripe_subscription_id: "sub_applycrash",
    stripe_price_id: "price_monthly",
    stripe_coupon_id: null,
    stripe_discount_id: null,
    livemode: true,
    started_at: "2029-12-31T23:00:00.000Z",
    applied_at: null,
  };
  const rpcCalls = [];
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    async maybeSingle() {
      return { data: application, error: null };
    },
  };
  const supabase = {
    from: () => query,
    async rpc(name, parameters) {
      rpcCalls.push({ name, parameters });
      return {
        data: { result: name.includes("mark_") ? "applied" : "consumed" },
        error: null,
      };
    },
  };

  const result = await membershipCredit
    .reconcileOrRequeueCanceledMembershipCredits(
      stripe,
      supabase,
      {
        priceId: "price_monthly",
        productId: "prod_membership",
        expectedLivemode: true,
      },
      { id: "evt_applycrash_deleted", created: 1_900_000_100 },
      subscription,
      profileId,
    );

  assert.equal(result.requeuedCount, 0);
  assert.deepEqual(
    rpcCalls.map((call) => call.name),
    ["consume_membership_credit_application"],
  );
  assert.equal(rpcCalls[0].parameters.p_stripe_discount_id, "di_applycrash");
});

test("a new-subscription event cannot release a reconciling old application", async () => {
  const applicationId = "94000000-0000-4000-8000-000000000001";
  const entitlementId = "94000000-0000-4000-8000-000000000002";
  const profileId = "94000000-0000-4000-8000-000000000003";
  const application = {
    id: applicationId,
    entitlement_id: entitlementId,
    instructor_profile_id: profileId,
    status: "applying",
    stripe_idempotency_key: `hld-membership-credit-${applicationId}`,
    stripe_customer_id: "cus_oldsub",
    stripe_subscription_id: "sub_oldsub",
    stripe_price_id: "price_monthly",
    stripe_coupon_id: null,
    stripe_discount_id: null,
    livemode: true,
    started_at: "2029-12-31T23:00:00.000Z",
    applied_at: null,
  };
  const oldSubscription = {
    id: "sub_oldsub",
    customer: "cus_oldsub",
    livemode: true,
    status: "canceled",
    cancel_at_period_end: false,
    latest_invoice: null,
    discounts: [],
    metadata: {
      product_line: "hire_line_dancers",
      instructor_profile_id: profileId,
      membership_credit_application_id: applicationId,
      membership_credit_entitlement_id: entitlementId,
      membership_credit_benefit: "membership_free_month_v1",
    },
    items: {
      has_more: false,
      data: [{
        price: { id: "price_monthly" },
        quantity: 1,
        discounts: [],
      }],
    },
  };
  const stripe = {
    subscriptions: {
      retrieve: async () => oldSubscription,
      update: async () =>
        assert.fail("the old credit must not be applied again"),
    },
    customers: {
      retrieve: async () => ({
        id: "cus_oldsub",
        deleted: false,
        livemode: true,
        discount: null,
      }),
    },
    coupons: {
      retrieve: async () => ({
        id: "coupon_free_month",
        valid: true,
        livemode: true,
        percent_off: 100,
        amount_off: null,
        duration: "once",
        duration_in_months: null,
        max_redemptions: null,
        redeem_by: null,
        applies_to: { products: ["prod_membership"] },
      }),
    },
    promotionCodes: {
      list: async () => ({ data: [], has_more: false }),
    },
  };
  const rpcCalls = [];
  const supabase = {
    async rpc(name) {
      rpcCalls.push(name);
      assert.equal(name, "claim_membership_credit_application");
      return {
        data: { result: "resuming", application },
        error: null,
      };
    },
  };
  const config = {
    priceId: "price_monthly",
    productId: "prod_membership",
    expectedLivemode: true,
  };

  const firstPass = await membershipCredit.applyPendingMembershipCredit(
    stripe,
    supabase,
    config,
    profileId,
  );
  const secondPass = await membershipCredit.applyPendingMembershipCredit(
    stripe,
    supabase,
    config,
    profileId,
  );

  assert.equal(firstPass.outcome, "existing");
  assert.equal(secondPass.outcome, "existing");
  assert.equal(firstPass.deferredReason, "stripe_reconciliation_pending");
  assert.deepEqual(rpcCalls, [
    "claim_membership_credit_application",
    "claim_membership_credit_application",
  ]);
});

test("the database ledger is private, idempotent, and serialized", () => {
  const migration = source(
    "supabase/migrations/20260901031851_membership_credit_entitlements.sql",
  );
  assert.match(
    migration,
    /create table public\.membership_credit_entitlements/,
  );
  assert.match(
    migration,
    /create table public\.membership_credit_applications/,
  );
  assert.match(migration, /unique \(source, source_reference\)/);
  assert.match(
    migration,
    /membership_credit_applications_one_live_entitlement/,
  );
  assert.match(migration, /membership_credit_applications_one_live_profile/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(
    migration,
    /alter table public\.membership_credit_entitlements enable row level security/,
  );
  assert.match(
    migration,
    /revoke all on public\.membership_credit_entitlements/,
  );
  assert.match(
    migration,
    /grant execute on function public\.issue_membership_credit_entitlement[\s\S]*to service_role/,
  );
  assert.match(
    migration,
    /grant execute on function public\.admin_list_membership_credit_entitlements\(uuid\)[\s\S]*to authenticated/,
  );
  assert.match(migration, /admin_note text/);
  assert.match(migration, /'pending', 'applying', 'applied', 'consumed'/);
});

test("the Edge configuration requires a verified user JWT", () => {
  const config = source("supabase/config.toml");
  assert.match(
    config,
    /\[functions\.grant-membership-free-month\]\s*verify_jwt = true/,
  );
});

test("membership-credit TypeScript sources have valid syntax", () => {
  for (
    const relativePath of [
      "supabase/functions/_shared/hld-membership-credit-validation.ts",
      "supabase/functions/_shared/hld-membership-credit.ts",
      "supabase/functions/grant-membership-free-month/index.ts",
      "supabase/functions/stripe-webhook/index.ts",
    ]
  ) {
    assertTypeScriptSyntax(relativePath);
  }
});

test("owned backend files contain no em dash", () => {
  for (
    const relativePath of [
      "supabase/functions/_shared/hld-membership-credit-validation.ts",
      "supabase/functions/_shared/hld-membership-credit.ts",
      "supabase/functions/grant-membership-free-month/index.ts",
      "supabase/migrations/20260901031851_membership_credit_entitlements.sql",
      "supabase/functions/README.md",
    ]
  ) {
    assert.doesNotMatch(source(relativePath), /—/, relativePath);
  }
});
