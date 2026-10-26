import terms from "../../config/commercial-terms.json";

const numberWords = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"
];

function numberWord(value: number): string {
  return numberWords[value] ?? String(value);
}

function countLabel(value: number, singular: string, plural = `${singular}s`): string {
  return `${numberWord(value)} ${value === 1 ? singular : plural}`;
}

export const commercialTerms = terms;
export const monthlyPrice = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: terms.currency.toUpperCase(),
  minimumFractionDigits: 2
}).format(terms.membership.monthlyPriceCents / 100);
export const monthlyPriceWithCurrency = `${monthlyPrice} ${terms.currency.toUpperCase()}`;
export const offerValue = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: terms.currency.toUpperCase(),
  minimumFractionDigits: 2
}).format((terms.membership.monthlyPriceCents * terms.offer.freeBillingCycles) / 100);
export const freePeriod = countLabel(terms.offer.freeBillingCycles, "month");
export const billingCycles = countLabel(terms.offer.freeBillingCycles, "monthly billing cycle");
export const freeBillingCycles = `${numberWord(terms.offer.freeBillingCycles)} free monthly billing ${terms.offer.freeBillingCycles === 1 ? "cycle" : "cycles"}`;
export const foundingOfferLabel = `first ${terms.offer.foundingInstructorLimit} instructors`;
export const guaranteeCoverage = `${terms.guarantee.coverageDays}-day`;
export const guaranteeCoverageDays = `${terms.guarantee.coverageDays} days`;
export const guaranteeClaimWindow = countLabel(terms.guarantee.claimWindowDays, "day");
export const invitationClaimWindow = countLabel(terms.offer.invitationClaimDays, "day");
export const profileSubmissionWindow = countLabel(terms.offer.profileSubmissionDays, "day");
export const billingRecoveryWindow = countLabel(terms.billingRecovery.graceDays, "day");
export const billingRecoveryLabel = `${terms.billingRecovery.graceDays}-day`;
export const currentGuaranteeTermsVersion = terms.guarantee.termsVersion;

export function capitalizePolicyText(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Booking commission terms.
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: terms.currency.toUpperCase(),
  minimumFractionDigits: 2
});
export const bookingTermsContract = terms.bookings;
export const instructorFeePercent = `${terms.bookings.instructorFeeBps / 100}%`;
export const clientFeePercent = `${terms.bookings.clientFeeBps / 100}%`;
export const payoutDelayLabel = `${terms.bookings.payoutDelayHours} hours`;
export const problemReportWindowLabel = `${terms.bookings.problemReportWindowHours} hours`;
export const quoteExpiryLabel = countLabel(terms.bookings.quoteExpiryDays, "day");
export const achBusinessDaysLabel = countLabel(terms.bookings.achMinimumBusinessDays, "business day");
export const minimumBookingPrice = usd.format(terms.bookings.minimumPriceCents / 100);
export const standardCancellationSummary = terms.bookings.standardCancellationWindows
  .map((window) => `${window.refundPercent}% refund of the instructor price ${window.minDaysBeforeEvent} or more days before the event`)
  .join("; ")
  + `; no refund within ${terms.bookings.standardCancellationWindows.at(-1)?.minDaysBeforeEvent ?? 0} days of the event`;

export function bookingExample(priceCents: number) {
  const clientFee = Math.round((priceCents * terms.bookings.clientFeeBps) / 10000);
  const platformFee = Math.round((priceCents * terms.bookings.instructorFeeBps) / 10000);
  return {
    price: usd.format(priceCents / 100),
    clientFee: usd.format(clientFee / 100),
    total: usd.format((priceCents + clientFee) / 100),
    platformFee: usd.format(platformFee / 100),
    payout: usd.format((priceCents - platformFee) / 100)
  };
}

// Instructors whose profile is created before this moment (midnight Eastern
// on February 1, 2027, the end of the three-month founding window that opens
// November 1, 2026) are founding instructors and get a profile badge.
export const foundingInstructorCutoff = terms.bookings.foundingInstructorJoinedBefore;
export const foundingInstructorDeadline = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "America/New_York"
}).format(new Date(Date.parse(foundingInstructorCutoff) - 1));

export function isFoundingInstructor(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && created < Date.parse(foundingInstructorCutoff);
}
