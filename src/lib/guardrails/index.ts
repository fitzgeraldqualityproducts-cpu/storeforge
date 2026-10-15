import type { RiskCategory, Severity } from "@/lib/schemas";

/**
 * Deterministic content guardrails. Used three ways:
 *  1. as an extra validator on AI output (violations are fed back to the model for a retry),
 *  2. as rule-based risk flags on source material in the analysis step,
 *  3. by the guardrail lint test over generated fixtures.
 */

export interface GuardrailViolation {
  rule:
    | "fake_review"
    | "fake_urgency"
    | "medical_claim"
    | "unverified_superlative"
    | "fake_credential"
    | "supplier_mention";
  match: string;
  message: string;
}

const CONDITIONS = [
  "disease",
  "illness",
  "cancer",
  "infection",
  "infections",
  "covid",
  "flu",
  "colds?",
  "diabetes",
  "arthritis",
  "pain",
  "aches?",
  "anxiety",
  "depression",
  "insomnia",
  "acne",
  "eczema",
  "psoriasis",
  "migraines?",
  "headaches?",
  "inflammation",
  "blood\\s+pressure",
  "cholesterol",
  "obesity",
  "hair\\s+loss",
  "back\\s+pain",
  "joint\\s+pain",
  "sciatica",
  "allergies",
  "asthma",
  "adhd",
  "stress",
  "fatigue",
  "wrinkles",
  "cellulite",
  "scoliosis",
  "plantar\\s+fasciitis",
  "tinnitus",
  "neuropathy",
  "symptoms",
  "conditions?",
].join("|");

interface Rule {
  rule: GuardrailViolation["rule"];
  re: RegExp;
  message: string;
}

// Patterns are written for customer-facing copy. Placeholder blocks that tell the merchant to
// add real reviews ("Add real reviews here") are explicitly allowed.
const RULES: Rule[] = [
  {
    rule: "fake_review",
    re: /(?:[★⭐]{3,}|\b[1-5](?:\.\d)?\s?(?:\/\s?5|out of 5)\s?stars?\b|\b\d[\d,.]*\+?\s+(?:happy|satisfied|verified)\s+(?:customers|buyers|reviews)\b|\b(?:rated|loved by)\s+(?:by\s+)?\d[\d,.]*\+?\s+(?:customers|people|users)\b|"[^"]{10,200}"\s*[—–-]\s*[A-Z][a-z]+\s+[A-Z]\.?(?=\s|$|,))/giu,
    message: "Looks like a review, rating or testimonial. StoreForge never invents social proof.",
  },
  {
    rule: "fake_urgency",
    re: /\b(?:only\s+\d+\s+(?:left|remaining)|selling\s+fast|almost\s+(?:gone|sold\s+out)|limited\s+time\s+only|(?:hurry|act\s+now|don'?t\s+miss\s+out)\b|offer\s+ends\s+(?:soon|today|tonight|in)|last\s+chance|while\s+supplies\s+last|\d+\s+people\s+(?:are\s+)?(?:viewing|looking\s+at)|countdown)/giu,
    message:
      "Fake urgency or scarcity. Remove it unless it is literally true and you can prove it.",
  },
  {
    rule: "medical_claim",
    re: new RegExp(
      `\\b(?:(?:cures?|cured|treats?|treating|treatment\\s+(?:for|of)|heals?|healing|prevents?|relieves?|relief\\s+(?:for|from)|reduces?|eliminates?|fights?)\\s+(?:\\w+\\s+){0,2}(?:${CONDITIONS})|clinically\\s+(?:proven|tested|shown)|doctor[- ]recommended|fda[- ](?:approved|cleared)|medical[- ]grade|boosts?\\s+(?:your\\s+)?(?:immunity|immune\\s+system)|detox(?:ify|ifies|ifying)?\\b|anti[- ]inflammatory|anti[- ]aging\\s+(?:cure|treatment))`,
      "giu",
    ),
    message:
      "Health or medical claim. Shopify and advertising law require substantiation; remove it.",
  },
  {
    rule: "unverified_superlative",
    re: /(?:(?<![#&\w])#\s?1\b|\bnumber\s+one\b|\bno\.\s?1\b|\bbest[- ]selling\b|\bbestseller\b|\bworld'?s\s+(?:best|first|finest)\b|\bbest\s+in\s+the\s+(?:world|market|industry)\b|\bguaranteed\s+results\b|\b100%\s+(?:effective|guaranteed|safe)\b)/giu,
    message: "Unverifiable superlative. Keep it only if you can prove it.",
  },
  {
    rule: "fake_credential",
    re: /\b(?:as\s+seen\s+(?:on|in)|award[- ]winning|featured\s+(?:on|in)\s+[A-Z]|certified\s+organic|dermatologist[- ](?:tested|approved|recommended)|eco[- ]certified|iso\s?9001|ce\s+certified)\b/giu,
    message: "Award, press or certification claim. Only include it with proof.",
  },
  {
    rule: "supplier_mention",
    re: /\b(?:ali\s?express|alibaba|1688\.com|dhgate|temu|wish\.com|cj\s?dropshipping|dropship(?:ping|ped)?|wholesale\s+supplier)\b/giu,
    message: "Mentions the supplier or dropshipping in customer-facing copy.",
  },
];

/** Strip tags so HTML copy is checked as text (keeps link text, drops attributes). */
function plain(text: string) {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function findGuardrailViolations(text: string): GuardrailViolation[] {
  const t = plain(text);
  const out: GuardrailViolation[] = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    for (const m of t.matchAll(r.re)) {
      out.push({ rule: r.rule, match: m[0].trim(), message: r.message });
    }
  }
  return out;
}

/** Walk any JSON value and collect violations from every string, with the path for context. */
export function findViolationsDeep(
  value: unknown,
  path = "",
): (GuardrailViolation & { path: string })[] {
  if (typeof value === "string") return findGuardrailViolations(value).map((v) => ({ ...v, path }));
  if (Array.isArray(value)) return value.flatMap((v, i) => findViolationsDeep(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      findViolationsDeep(v, path ? `${path}.${k}` : k),
    );
  }
  return [];
}

export function describeViolations(v: (GuardrailViolation & { path?: string })[]): string {
  return v
    .slice(0, 12)
    .map((x) => `- ${x.path ? `${x.path}: ` : ""}"${x.match}" (${x.message})`)
    .join("\n");
}

/* ------------------------------------------------------------------------------------------ */
/* Rule-based risk signals on SOURCE material (analysis step).                                */
/* ------------------------------------------------------------------------------------------ */

export interface RuleRiskFlag {
  severity: Severity;
  category: RiskCategory;
  message: string;
  suggestedFix: string;
}

/** Well-known brands that are commonly counterfeited or used without permission in listings. */
export const WATCHED_BRANDS = [
  "Nike",
  "Adidas",
  "Apple",
  "AirPods",
  "iPhone",
  "Samsung",
  "Sony",
  "Bose",
  "Beats",
  "JBL",
  "Dyson",
  "Gucci",
  "Louis Vuitton",
  "Chanel",
  "Prada",
  "Hermès",
  "Hermes",
  "Rolex",
  "Cartier",
  "Ray-Ban",
  "Oakley",
  "Disney",
  "Marvel",
  "Pokémon",
  "Pokemon",
  "LEGO",
  "Barbie",
  "Hello Kitty",
  "Star Wars",
  "Harry Potter",
  "Stanley",
  "YETI",
  "Hydro Flask",
  "Owala",
  "Lululemon",
  "The North Face",
  "Supreme",
  "Off-White",
  "Balenciaga",
  "Dior",
  "Versace",
  "Burberry",
  "Michael Kors",
  "Coach",
  "Pandora",
  "Swarovski",
  "Tiffany",
  "GoPro",
  "DJI",
  "Nintendo",
  "PlayStation",
  "Xbox",
  "Hario",
  "Chemex",
  "Keurig",
  "Nespresso",
  "KitchenAid",
  "Vitamix",
  "Le Creuset",
  "Crocs",
  "UGG",
  "Birkenstock",
  "Converse",
  "Vans",
  "New Balance",
  "Under Armour",
  "Puma",
  "Ninja",
  "Instant Pot",
  "Tesla",
];

const RESTRICTED: {
  re: RegExp;
  category: RiskCategory;
  severity: Severity;
  message: string;
  fix: string;
}[] = [
  {
    re: /\b(?:firearm|gun|rifle|pistol|ammunition|ammo|silencer|suppressor|switchblade|brass\s+knuckles|taser|stun\s+gun|pepper\s+spray|crossbow)\b/i,
    category: "prohibited_category",
    severity: "block",
    message: "Weapons and weapon accessories are prohibited or heavily restricted on Shopify.",
    fix: "Don't sell this product on Shopify, or confirm it is permitted under Shopify's Acceptable Use Policy and local law.",
  },
  {
    re: /\b(?:vape|e-?cig(?:arette)?|e-?liquid|nicotine|cbd|thc|delta[- ]?8|kratom|cannabis|hemp\s+oil)\b/i,
    category: "restricted_category",
    severity: "block",
    message:
      "Vapes, nicotine, CBD/THC and similar products are restricted and need specific approvals.",
    fix: "Check Shopify's restricted-items rules and your payment provider's policies before listing.",
  },
  {
    re: /\b(?:supplement|capsules?|gummies|vitamin|probiotic|collagen|weight\s+loss|fat\s+burn(?:er|ing)|keto\s+pills?|nootropic|testosterone)\b/i,
    category: "restricted_category",
    severity: "warn",
    message: "Dietary supplements need compliant labeling and must not make disease claims.",
    fix: "Confirm labeling (supplement facts, FDA disclaimer in the US) and remove any treatment claims.",
  },
  {
    re: /\b(?:medical\s+device|thermometer|blood\s+pressure|pulse\s+oximeter|hearing\s+aid|contact\s+lens(?:es)?|tens\s+unit|posture\s+corrector|orthopedic)\b/i,
    category: "restricted_category",
    severity: "warn",
    message: "This may be a regulated medical device.",
    fix: "Check whether the product needs FDA (or local) registration before selling it.",
  },
  {
    re: /\b(?:adult\s+toy|sex\s+toy|vibrator|lingerie\s+for\s+adults|xxx|erotic)\b/i,
    category: "restricted_category",
    severity: "warn",
    message: "Adult products have extra restrictions with Shopify Payments and many apps.",
    fix: "Review Shopify Payments' restricted businesses list and age-gate the store if needed.",
  },
  {
    re: /\b(?:lithium|li-?ion|li-?po|rechargeable\s+battery|power\s*bank|battery\s+pack|\d{3,5}\s?mah)\b/i,
    category: "battery_shipping",
    severity: "info",
    message:
      "Contains batteries: shipping lithium batteries has carrier restrictions (UN38.3, air limits).",
    fix: "Confirm your supplier has UN38.3 test reports and that your carriers accept the battery type.",
  },
  {
    re: /\b(?:baby|infant|toddler|kids?|children'?s|for\s+children|nursery|teether|pacifier|crib|ages?\s+\d+\s*(?:\+|and\s+up|-\s*\d+))\b/i,
    category: "child_safety",
    severity: "warn",
    message:
      "Children's products in the US need CPSIA compliance (testing, Children's Product Certificate, tracking labels).",
    fix: "Get a Children's Product Certificate from your supplier or don't market the product to children.",
  },
  {
    re: /\b(?:serum|moisturi[sz]er|sunscreen|spf\s?\d+|skin\s?care|cosmetic|lotion|shampoo|toothpaste|whitening)\b/i,
    category: "labeling",
    severity: "info",
    message:
      "Cosmetics need an ingredient list and compliant labeling; SPF and whitening claims are regulated.",
    fix: "Confirm INCI ingredient labeling and avoid drug claims (e.g. SPF without testing).",
  },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function detectSourceRisks(text: string, imageCount = 0): RuleRiskFlag[] {
  const t = plain(text);
  const flags: RuleRiskFlag[] = [];
  const brands = WATCHED_BRANDS.filter((b) =>
    new RegExp(`(?<![\\w-])${escape(b)}(?![\\w-])`, "i").test(t),
  );
  if (brands.length) {
    const unique = [...new Set(brands.map((b) => b.toLowerCase()))].slice(0, 6);
    flags.push({
      severity: "warn",
      category: "trademark",
      message: `Mentions trademarked brand name${unique.length > 1 ? "s" : ""}: ${brands.slice(0, 6).join(", ")}.`,
      suggestedFix:
        "Don't use other brands' names in your title, tags or ads. A factual compatibility note (\"fits #2 cone filters\") is safer than naming the brand.",
    });
    if (
      /\b(?:replica|1:1|aaa\s+quality|inspired\s+by|dupe|same\s+as\s+original|high\s+copy)\b/i.test(
        t,
      )
    ) {
      flags.push({
        severity: "block",
        category: "counterfeit",
        message: "Signals of a replica/counterfeit product alongside a brand name.",
        suggestedFix: "Don't sell counterfeit or replica goods; Shopify will close the store.",
      });
    }
  }
  const violations = findGuardrailViolations(t);
  const quoted = (rules: GuardrailViolation["rule"][]) => [
    ...new Set(violations.filter((v) => rules.includes(v.rule)).map((v) => `"${v.match}"`)),
  ];
  const medical = quoted(["medical_claim"]);
  if (medical.length) {
    flags.push({
      severity: "block",
      category: "medical",
      message: `The source makes health claims: ${medical.slice(0, 5).join(", ")}.`,
      suggestedFix:
        "Don't repeat medical or treatment claims. Describe what the product physically does instead.",
    });
  }
  const claims = quoted(["unverified_superlative", "fake_credential"]);
  if (claims.length) {
    flags.push({
      severity: "warn",
      category: "claims",
      message: `The source uses claims that need proof: ${claims.slice(0, 5).join(", ")}.`,
      suggestedFix:
        "Leave them out of your copy unless you can substantiate them for your own store.",
    });
  }
  for (const r of RESTRICTED) {
    const m = t.match(r.re);
    if (m)
      flags.push({
        severity: r.severity,
        category: r.category,
        message: `${r.message} (matched "${m[0]}")`,
        suggestedFix: r.fix,
      });
  }
  if (imageCount > 0 && /©|copyright|all rights reserved/i.test(t)) {
    flags.push({
      severity: "info",
      category: "copyright",
      message: "The source page asserts copyright over its content.",
      suggestedFix: "Use your own photos and let StoreForge write original copy.",
    });
  }
  // De-duplicate by category + message.
  const seen = new Set<string>();
  return flags.filter((f) => {
    const k = `${f.category}|${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
