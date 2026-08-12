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
    return "Stripe’s two-month instructor offer needs attention. Nothing changed, no membership started, and no approval email was sent.";
  }
  if (code === "payment_method_failed") {
    return "The saved card could not start the membership. The instructor must save another payment method and resubmit the profile.";
  }
  return message?.trim() || "Approval did not complete. Review the profile state, then try again.";
}
