import Stripe from "npm:stripe@^22";
import type { HldStripeConfig } from "./hld-stripe.ts";
import { stripeObjectId } from "./hld-stripe.ts";
import { INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION } from "./hld-commercial-terms.ts";
export { INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION } from "./hld-commercial-terms.ts";

export type InstructorPaymentSetupIdentity = {
  accountId: string;
  instructorProfileId: string;
};

export type VerifiedInstructorPaymentSetup = InstructorPaymentSetupIdentity & {
  customerId: string;
  paymentMethodId: string;
  session: Stripe.Checkout.Session;
  setupIntent: Stripe.SetupIntent;
  paymentMethod: Stripe.PaymentMethod;
};

export function validUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
    ? value
    : null;
}

export function validCheckoutSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^cs_(?:live|test)_[A-Za-z0-9]+$/.test(trimmed) ? trimmed : null;
}

export function instructorPaymentSetupMetadata(
  identity: InstructorPaymentSetupIdentity,
): Record<string, string> {
  return {
    instructor_profile_id: identity.instructorProfileId,
    account_id: identity.accountId,
    product_line: "hire_line_dancers",
    payment_setup_terms_version: INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION,
  };
}

function hasInstructorPaymentSetupMetadata(
  metadata: Stripe.Metadata | null,
  identity: InstructorPaymentSetupIdentity,
): boolean {
  return metadata?.instructor_profile_id === identity.instructorProfileId &&
    metadata?.account_id === identity.accountId &&
    metadata?.product_line === "hire_line_dancers" &&
    metadata?.payment_setup_terms_version ===
      INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION;
}

export async function verifiedInstructorPaymentSetup(
  stripe: Stripe,
  config: HldStripeConfig,
  sessionId: string,
  expected?: Partial<InstructorPaymentSetupIdentity> & { customerId?: string },
): Promise<VerifiedInstructorPaymentSetup> {
  const validSessionId = validCheckoutSessionId(sessionId);
  if (!validSessionId) {
    throw new Error("Stripe Checkout Session identifier is invalid");
  }

  const session = await stripe.checkout.sessions.retrieve(validSessionId, {
    expand: ["setup_intent.payment_method"],
  });
  const instructorProfileId = validUuid(
    session.metadata?.instructor_profile_id ?? session.client_reference_id,
  );
  const accountId = validUuid(session.metadata?.account_id);
  const customerId = stripeObjectId(session.customer);
  const identity = {
    accountId: accountId ?? "",
    instructorProfileId: instructorProfileId ?? "",
  };

  if (
    session.mode !== "setup" || session.status !== "complete" ||
    session.livemode !== config.expectedLivemode || !customerId ||
    !accountId || !instructorProfileId ||
    (config.expectedLivemode &&
      session.consent?.terms_of_service !== "accepted") ||
    session.client_reference_id !== instructorProfileId ||
    !hasInstructorPaymentSetupMetadata(session.metadata, identity) ||
    (expected?.accountId && expected.accountId !== accountId) ||
    (expected?.instructorProfileId &&
      expected.instructorProfileId !== instructorProfileId) ||
    (expected?.customerId && expected.customerId !== customerId)
  ) {
    throw new Error(
      "Checkout Session does not match the instructor payment setup",
    );
  }

  const setupIntentId = stripeObjectId(session.setup_intent);
  if (!setupIntentId) {
    throw new Error("Completed Checkout Session is missing its SetupIntent");
  }
  const setupIntent = typeof session.setup_intent === "object" &&
      session.setup_intent !== null &&
      "status" in session.setup_intent &&
      typeof session.setup_intent.status === "string"
    ? session.setup_intent as Stripe.SetupIntent
    : await stripe.setupIntents.retrieve(setupIntentId, {
      expand: ["payment_method"],
    });
  const setupCustomerId = stripeObjectId(setupIntent.customer);
  if (
    setupIntent.status !== "succeeded" || setupIntent.usage !== "off_session" ||
    setupIntent.livemode !== config.expectedLivemode ||
    setupCustomerId !== customerId ||
    !hasInstructorPaymentSetupMetadata(setupIntent.metadata, identity)
  ) {
    throw new Error("SetupIntent does not match the instructor payment setup");
  }

  const paymentMethodId = stripeObjectId(setupIntent.payment_method);
  if (!paymentMethodId) {
    throw new Error("Successful SetupIntent is missing its PaymentMethod");
  }
  const paymentMethod = typeof setupIntent.payment_method === "object" &&
      setupIntent.payment_method !== null &&
      "type" in setupIntent.payment_method
    ? setupIntent.payment_method as Stripe.PaymentMethod
    : await stripe.paymentMethods.retrieve(paymentMethodId);
  if (
    paymentMethod.type !== "card" || !paymentMethod.card ||
    stripeObjectId(paymentMethod.customer) !== customerId ||
    paymentMethod.livemode !== config.expectedLivemode
  ) {
    throw new Error(
      "PaymentMethod is not an attached card for this instructor",
    );
  }

  return {
    accountId,
    instructorProfileId,
    customerId,
    paymentMethodId,
    session,
    setupIntent,
    paymentMethod,
  };
}
