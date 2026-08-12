import { freePeriod } from "@/lib/commercialTerms";

export type ApprovalEmailStatus =
  | "pending"
  | "processing"
  | "sent"
  | "delivered"
  | "failed"
  | "canceled"
  | "missing";

export type InstructorApprovalReceipt = {
  profileStatus: "published";
  membershipStatus: string | null;
  lifetimeAccess: boolean;
  slug: string;
  emailStatus: ApprovalEmailStatus;
};

export type ProfileApprovalViewState =
  | { phase: "approving" }
  | { phase: "approved"; receipt: InstructorApprovalReceipt }
  | { phase: "error"; message: string };

export type ApprovalReadinessCheck = {
  key: "membership" | "offer" | "approval_email";
  label: string;
  status: "ready" | "blocked" | "not_required";
  detail: string;
};

export type InstructorApprovalReadiness = {
  ready: boolean;
  instructorProfileId: string;
  lifetimeAccess: boolean;
  hasOffer: boolean;
  checkedAt: string;
  contractVersion: string;
  terms: {
    currency: string;
    monthlyPriceCents: number;
    freeBillingCycles: number;
    guaranteeCoverageDays: number;
  };
  checks: ApprovalReadinessCheck[];
};

export type ApprovalReadinessViewState =
  | { phase: "checking" }
  | { phase: "ready"; receipt: InstructorApprovalReadiness }
  | { phase: "blocked"; receipt: InstructorApprovalReadiness }
  | { phase: "error"; message: string };

const knownEmailStatuses = new Set<ApprovalEmailStatus>([
  "pending",
  "processing",
  "sent",
  "delivered",
  "failed",
  "canceled",
  "missing"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseInstructorApprovalReadiness(value: unknown): InstructorApprovalReadiness {
  if (!isRecord(value) || typeof value.ready !== "boolean") {
    throw new Error("The server did not return approval readiness.");
  }
  if (
    typeof value.instructorProfileId !== "string" ||
    typeof value.lifetimeAccess !== "boolean" ||
    typeof value.hasOffer !== "boolean" ||
    typeof value.checkedAt !== "string" ||
    typeof value.contractVersion !== "string" ||
    !isRecord(value.terms) ||
    typeof value.terms.currency !== "string" ||
    typeof value.terms.monthlyPriceCents !== "number" ||
    typeof value.terms.freeBillingCycles !== "number" ||
    typeof value.terms.guaranteeCoverageDays !== "number" ||
    !Array.isArray(value.checks)
  ) {
    throw new Error("The server returned incomplete approval readiness.");
  }

  const checks = value.checks.map((check) => {
    if (
      !isRecord(check) ||
      !["membership", "offer", "approval_email"].includes(String(check.key)) ||
      typeof check.label !== "string" ||
      !["ready", "blocked", "not_required"].includes(String(check.status)) ||
      typeof check.detail !== "string"
    ) {
      throw new Error("The server returned an invalid approval readiness check.");
    }
    return check as ApprovalReadinessCheck;
  });
  if (checks.length !== 3 || new Set(checks.map((check) => check.key)).size !== 3) {
    throw new Error("The server did not verify every approval dependency.");
  }
  if (value.ready !== checks.every((check) => check.status !== "blocked")) {
    throw new Error("The server returned inconsistent approval readiness.");
  }

  return {
    ready: value.ready,
    instructorProfileId: value.instructorProfileId,
    lifetimeAccess: value.lifetimeAccess,
    hasOffer: value.hasOffer,
    checkedAt: value.checkedAt,
    contractVersion: value.contractVersion,
    terms: {
      currency: value.terms.currency,
      monthlyPriceCents: value.terms.monthlyPriceCents,
      freeBillingCycles: value.terms.freeBillingCycles,
      guaranteeCoverageDays: value.terms.guaranteeCoverageDays
    },
    checks
  };
}

export function normalizeApprovalEmailStatus(value: unknown): ApprovalEmailStatus {
  return typeof value === "string" && knownEmailStatuses.has(value as ApprovalEmailStatus)
    ? value as ApprovalEmailStatus
    : "missing";
}

export function parseInstructorApprovalReceipt(
  value: unknown,
  fallbackSlug: string
): InstructorApprovalReceipt {
  if (!isRecord(value) || value.approved !== true) {
    throw new Error("The server did not confirm that the instructor was approved.");
  }
  if (value.profileStatus !== "published") {
    throw new Error("Approval was recorded, but the live profile is still being confirmed. Try finishing activation again.");
  }

  const lifetimeAccess = value.lifetimeAccess === true;
  const membershipStatus = typeof value.membershipStatus === "string" ? value.membershipStatus : null;
  if (!lifetimeAccess && membershipStatus !== "active" && membershipStatus !== "trialing") {
    throw new Error("The profile is published, but the active membership was not confirmed. Review membership status before continuing.");
  }

  const returnedSlug = typeof value.slug === "string" ? value.slug.trim() : "";
  const slug = returnedSlug || fallbackSlug.trim();
  if (!slug) {
    throw new Error("The profile is published, but its public link was not returned.");
  }

  const emailStatus = normalizeApprovalEmailStatus(value.emailStatus);

  return {
    profileStatus: "published",
    membershipStatus,
    lifetimeAccess,
    slug,
    emailStatus
  };
}

export function approvalEmailStatusCopy(status: ApprovalEmailStatus): string {
  switch (status) {
    case "pending":
      return "Approval email queued.";
    case "processing":
      return "Approval email is being sent.";
    case "sent":
      return "Approval email accepted by Resend.";
    case "delivered":
      return "Approval email delivered.";
    case "failed":
      return "The profile is live, but the approval email failed. Review notification delivery.";
    case "canceled":
      return "The profile is live, but the approval email was canceled. Review notification delivery.";
    default:
      return "The profile is live, but the approval email was not queued. Review notification delivery.";
  }
}

export function approvalEmailNeedsAttention(status: ApprovalEmailStatus): boolean {
  return status === "failed" || status === "canceled" || status === "missing";
}

export function approvalFailureCopy(message: string | null, code: string | null): string {
  if (code === "instructor_offer_configuration_invalid") {
    return `Stripe’s ${freePeriod} instructor offer needs attention. Nothing changed, no membership started, and no approval email was sent.`;
  }
  if (code === "payment_method_failed") {
    return "The saved card could not start the membership. The instructor must save another payment method and resubmit the profile.";
  }
  if (code === "approval_email_configuration_invalid") {
    return "Approval email delivery needs attention. Nothing changed, no membership started, and no approval email was sent.";
  }
  return message?.trim() || "Approval did not complete. Review the profile state, then try again.";
}
