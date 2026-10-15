import { formatMoney } from "@/lib/utils";
import type { PricingSuggestion } from "@/lib/schemas";

export const DEFAULT_MARGIN_PCT = 60;

export const COMPARE_AT_WARNING =
  'Only show a compare-at ("was") price you have genuinely charged for a meaningful period. Invented reference prices are deceptive pricing under laws such as the US FTC Guides Against Deceptive Pricing (16 CFR 233), the EU Omnibus Directive (prior price = lowest price in the last 30 days) and UK consumer protection rules.';

export interface PricingInputs {
  currency: string;
  unitCost: number | null;
  targetMarginPct: number | null;
  targetPrice: number | null;
  competitorPrice: number | null;
  competitorSource?: string;
  compareAtEnabled: boolean;
  regularPrice: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Round up to the next .99 (charm pricing); prices under 1 are left at 2 decimals. */
export function charmRound(price: number): number {
  if (price < 1) return round2(price);
  const r = Math.floor(price) + 0.99;
  return round2(r >= price ? r : r + 1);
}

/**
 * Suggest a retail price with every step of the math written out. Priority: the merchant's
 * target price, then cost ÷ (1 − margin), then the market price. Compare-at is only ever the
 * merchant's own regular price, and only when they turn it on.
 */
export function suggestPrice(i: PricingInputs): PricingSuggestion {
  const $ = (n: number) => formatMoney(n, i.currency);
  const steps: string[] = [];
  const warnings: string[] = [];
  const cost = i.unitCost != null && i.unitCost > 0 ? i.unitCost : null;
  let price: number | null = null;

  if (i.competitorPrice != null && i.competitorPrice > 0) {
    steps.push(
      `Market reference: ${$(i.competitorPrice)}${i.competitorSource ? ` (${i.competitorSource})` : ""}.`,
    );
  }
  if (i.targetPrice != null && i.targetPrice > 0) {
    price = round2(i.targetPrice);
    steps.push(`You set a target price of ${$(price)}; using it as is.`);
  } else if (cost != null) {
    const margin = i.targetMarginPct ?? DEFAULT_MARGIN_PCT;
    if (i.targetMarginPct == null)
      steps.push(`No target margin given, so ${DEFAULT_MARGIN_PCT}% is assumed.`);
    const raw = cost / (1 - margin / 100);
    steps.push(
      `Price for a ${margin}% margin = cost ÷ (1 − ${margin}%) = ${$(cost)} ÷ ${round2(1 - margin / 100)} = ${$(round2(raw))}.`,
    );
    price = charmRound(raw);
    if (price !== round2(raw)) steps.push(`Rounded up to ${$(price)}.`);
  } else if (i.competitorPrice != null && i.competitorPrice > 0) {
    price = round2(i.competitorPrice);
    steps.push(`No cost or target given, so the price matches the market reference: ${$(price)}.`);
    warnings.push("Add your unit cost to check this price leaves a profit.");
  } else {
    warnings.push("Add your unit cost, a target margin or a target price to get a suggestion.");
  }

  let marginPct: number | null = null;
  if (price != null && cost != null) {
    marginPct = round2(((price - cost) / price) * 100);
    steps.push(`Margin = (${$(price)} − ${$(cost)}) ÷ ${$(price)} = ${marginPct}%.`);
    if (price <= cost) warnings.push("The price is at or below your cost: every sale loses money.");
    else if (marginPct < 30)
      warnings.push(
        `A ${marginPct}% margin leaves little room for ads, payment fees and returns; 50%+ is common for DTC.`,
      );
  }
  if (price != null && i.competitorPrice != null && i.competitorPrice > 0) {
    const diff = round2(((price - i.competitorPrice) / i.competitorPrice) * 100);
    if (Math.abs(diff) >= 1)
      steps.push(
        `That is ${Math.abs(diff)}% ${diff > 0 ? "above" : "below"} the market reference.`,
      );
    if (diff > 25)
      warnings.push("Noticeably above the market reference: make sure the listing explains why.");
  }

  let compareAtPrice: number | null = null;
  if (i.compareAtEnabled) {
    warnings.push(COMPARE_AT_WARNING);
    if (i.regularPrice == null) {
      warnings.push("Enter the regular price you've actually charged to show a compare-at price.");
    } else if (price != null && i.regularPrice > price) {
      compareAtPrice = round2(i.regularPrice);
      steps.push(
        `Compare-at = your regular price ${$(compareAtPrice)} (${round2((1 - price / compareAtPrice) * 100)}% off).`,
      );
    } else {
      warnings.push("Your regular price isn't higher than this price, so no compare-at is shown.");
    }
  }

  return {
    currency: i.currency,
    unitCost: i.unitCost,
    targetMarginPct: i.targetMarginPct,
    targetPrice: i.targetPrice,
    competitorPrice: i.competitorPrice,
    competitorSource: i.competitorSource ?? "",
    regularPrice: i.regularPrice,
    suggestedPrice: price ?? 0,
    compareAtPrice,
    marginPct,
    steps,
    warnings,
  };
}
