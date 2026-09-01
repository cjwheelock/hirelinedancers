export type MembershipCreditCouponLike = {
  id?: string;
  valid?: boolean;
  livemode?: boolean;
  percent_off?: number | null;
  amount_off?: number | null;
  duration?: string;
  duration_in_months?: number | null;
  max_redemptions?: number | null;
  redeem_by?: number | null;
  applies_to?: { products?: string[] | null } | null;
};

export type MembershipCreditCouponExpectation = {
  expectedLivemode: boolean;
  productId: string;
};

const LEGACY_FREE_MONTH_COUPON_ID = "Z00npt3G";

export function membershipCreditCouponMismatches(
  coupon: MembershipCreditCouponLike,
  expectation: MembershipCreditCouponExpectation,
): string[] {
  const mismatches: string[] = [];
  const products = coupon.applies_to?.products ?? [];

  if (!coupon.valid) mismatches.push("coupon_not_valid");
  if (coupon.livemode !== expectation.expectedLivemode) {
    mismatches.push("wrong_stripe_mode");
  }
  if (coupon.percent_off !== 100) mismatches.push("wrong_percent_off");
  if (coupon.amount_off != null) mismatches.push("amount_off_present");
  if (coupon.duration !== "once") mismatches.push("wrong_duration");
  if (coupon.duration_in_months != null) {
    mismatches.push("duration_months_present");
  }
  if (coupon.max_redemptions != null) {
    mismatches.push("max_redemptions_present");
  }
  if (coupon.redeem_by != null) mismatches.push("redeem_by_present");
  if (
    products.length !== 1 || products[0] !== expectation.productId
  ) {
    mismatches.push("wrong_product_restriction");
  }
  if (
    coupon.id === LEGACY_FREE_MONTH_COUPON_ID ||
    coupon.id?.toLowerCase() === "freemonth"
  ) {
    mismatches.push("legacy_coupon");
  }

  return mismatches;
}
