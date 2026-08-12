export type InstructorOfferCouponShape = {
  valid: boolean;
  livemode: boolean;
  percent_off: number | null;
  amount_off: number | null;
  duration: string;
  duration_in_months: number | null;
  max_redemptions: number | null;
  redeem_by: number | null;
  applies_to?: { products?: string[] } | null;
};

export type InstructorOfferExpectation = {
  expectedLivemode: boolean;
  productId: string;
  months: number;
};

export function instructorOfferCouponMismatches(
  coupon: InstructorOfferCouponShape,
  expectation: InstructorOfferExpectation
): string[] {
  const appliedProducts = coupon.applies_to?.products ?? [];
  const mismatches: string[] = [];

  if (!coupon.valid) mismatches.push("coupon_not_valid");
  if (coupon.livemode !== expectation.expectedLivemode) mismatches.push("wrong_stripe_mode");
  if (coupon.percent_off !== 100) mismatches.push("wrong_percent_off");
  if (coupon.amount_off !== null) mismatches.push("amount_off_present");
  if (coupon.duration !== "repeating") mismatches.push("wrong_duration");
  if (coupon.duration_in_months !== expectation.months) mismatches.push("wrong_duration_months");
  if (coupon.max_redemptions !== null) mismatches.push("max_redemptions_present");
  if (coupon.redeem_by !== null) mismatches.push("redeem_by_present");
  if (appliedProducts.length !== 1 || appliedProducts[0] !== expectation.productId) {
    mismatches.push("wrong_product_restriction");
  }

  return mismatches;
}
