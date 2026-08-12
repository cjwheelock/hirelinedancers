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
