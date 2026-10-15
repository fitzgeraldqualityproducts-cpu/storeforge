import { finalizeCandidate, nameIsUsable } from "@/lib/brand/names";
import type { ProjectRecord } from "@/lib/db/projects";
import type { Palette, Tone } from "@/lib/schemas";
import { fixtureProductName } from "./analysis";

/**
 * Deterministic brand output for AI_MODE=fixture, derived from the product's own words and the
 * chosen tone so names and copy differ per project without calling a model.
 */

const TONE_WORDS: Record<Tone, string[]> = {
  Premium: ["Crest", "Ardent", "Marlow", "Keel"],
  Playful: ["Pip", "Bramble", "Doodle", "Juniper"],
  Minimal: ["Still", "Plain", "Field", "Mono"],
  Bold: ["Grit", "Rally", "Forge", "Volt"],
  Cozy: ["Hearth", "Ember", "Linden", "Nook"],
  Clinical: ["Lucid", "Metric", "Axis", "Clarity"],
  Luxury: ["Aurel", "Velour", "Solenne", "Opal"],
};

const TONE_SUFFIX: Record<Tone, string[]> = {
  Premium: ["craft", "mark"],
  Playful: ["pop", "bee"],
  Minimal: ["form", "line"],
  Bold: ["works", "co"],
  Cozy: ["nook", "home"],
  Clinical: ["lab", "kit"],
  Luxury: ["atelier", "house"],
};

export const TONE_PALETTES: Record<Tone, Palette> = {
  Premium: {
    primary: "#1F3A5F",
    secondary: "#8A6F4E",
    accent: "#C9A227",
    background: "#FAF8F4",
    text: "#1C1C1E",
    surface: "#F1ECE3",
  },
  Playful: {
    primary: "#B4235A",
    secondary: "#2E7D6B",
    accent: "#F2B705",
    background: "#FFFBF5",
    text: "#2B2135",
    surface: "#FDEFE3",
  },
  Minimal: {
    primary: "#222222",
    secondary: "#6B6B6B",
    accent: "#9C7A54",
    background: "#FFFFFF",
    text: "#1A1A1A",
    surface: "#F4F4F2",
  },
  Bold: {
    primary: "#C2410C",
    secondary: "#111827",
    accent: "#FACC15",
    background: "#FFFFFF",
    text: "#111827",
    surface: "#F3F4F6",
  },
  Cozy: {
    primary: "#8C4A2F",
    secondary: "#6B7F5E",
    accent: "#D9A441",
    background: "#FBF6EF",
    text: "#2E2620",
    surface: "#F2E8DA",
  },
  Clinical: {
    primary: "#0B5CAD",
    secondary: "#5A6B7B",
    accent: "#14B8A6",
    background: "#FFFFFF",
    text: "#14212E",
    surface: "#F2F6FA",
  },
  Luxury: {
    primary: "#2A2420",
    secondary: "#7A6A55",
    accent: "#B08D57",
    background: "#F7F4EF",
    text: "#1E1A17",
    surface: "#EDE6DC",
  },
};

const TONE_FONTS: Record<Tone, { heading: string; body: string }> = {
  Premium: { heading: "Libre Baskerville", body: "Inter" },
  Playful: { heading: "Rubik", body: "Nunito Sans" },
  Minimal: { heading: "DM Sans", body: "Inter" },
  Bold: { heading: "Archivo Black", body: "Archivo" },
  Cozy: { heading: "Lora", body: "Karla" },
  Clinical: { heading: "Instrument Sans", body: "Source Sans Pro" },
  Luxury: { heading: "Playfair Display", body: "Montserrat" },
};

const TONE_VOICE: Record<Tone, { adjectives: string[]; do: string[]; dont: string[] }> = {
  Premium: {
    adjectives: ["assured", "precise", "polished"],
    do: [
      "Lead with a concrete detail of how it is made or used",
      "Keep sentences short and confident",
      "Name materials and dimensions exactly",
      "Let one strong benefit carry each paragraph",
    ],
    dont: [
      "Don't stack adjectives",
      "Don't use exclamation marks",
      "Don't compare yourself to other brands",
      "Don't promise results you can't show",
    ],
  },
  Playful: {
    adjectives: ["warm", "witty", "upbeat"],
    do: [
      "Write like you're talking to a friend",
      "Use a light pun where it fits naturally",
      "Keep facts accurate even when the tone is fun",
      "End sections with a friendly nudge, not pressure",
    ],
    dont: [
      "Don't joke at the customer's expense",
      "Don't bury the key facts under jokes",
      "Don't use more than one exclamation mark per section",
      "Don't use slang that will date quickly",
    ],
  },
  Minimal: {
    adjectives: ["calm", "clear", "spare"],
    do: [
      "Say one thing per sentence",
      "Prefer facts to adjectives",
      "Use plain everyday words",
      "Leave room: short paragraphs and lists",
    ],
    dont: [
      "Don't use exclamation marks",
      "Don't use filler like 'truly' or 'really'",
      "Don't repeat the product name in every line",
      "Don't over-explain",
    ],
  },
  Bold: {
    adjectives: ["direct", "energetic", "confident"],
    do: [
      "Start with a strong verb",
      "Keep paragraphs to two lines",
      "State the benefit plainly",
      "Use specific numbers from the specs",
    ],
    dont: [
      "Don't hype without substance",
      "Don't use all caps for emphasis",
      "Don't make claims you can't back up",
      "Don't hedge every sentence",
    ],
  },
  Cozy: {
    adjectives: ["warm", "gentle", "homely"],
    do: [
      "Describe the moment the product is used",
      "Use sensory words for texture and feel",
      "Keep the pace unhurried",
      "Invite rather than instruct",
    ],
    dont: [
      "Don't rush or pressure the reader",
      "Don't use technical jargon without explaining it",
      "Don't overload with exclamation marks",
      "Don't exaggerate how it will change someone's life",
    ],
  },
  Clinical: {
    adjectives: ["precise", "neutral", "trustworthy"],
    do: [
      "Use exact measurements and materials",
      "Explain how it works in plain technical language",
      "Separate facts from usage suggestions",
      "Point to care and safety instructions",
    ],
    dont: [
      "Don't use emotional appeals",
      "Don't imply medical benefits",
      "Don't use vague words like 'amazing'",
      "Don't round numbers in a misleading way",
    ],
  },
  Luxury: {
    adjectives: ["refined", "understated", "considered"],
    do: [
      "Lead with materials and craftsmanship",
      "Write unhurried, elegant sentences",
      "Use restraint: fewer, better words",
      "Describe details a careful eye would notice",
    ],
    dont: [
      "Don't use discount or deal language",
      "Don't use exclamation marks",
      "Don't overuse the word 'luxury'",
      "Don't make origin claims you can't verify",
    ],
  },
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

function productWords(project: ProjectRecord): string[] {
  const a = project.analysis;
  const text = [a?.productType, ...(a?.materials ?? []), fixtureProductName(project)]
    .filter(Boolean)
    .join(" ");
  const stop = new Set([
    "with",
    "and",
    "for",
    "the",
    "set",
    "pack",
    "cover",
    "product",
    "everyday",
  ]);
  return [
    ...new Set(
      text
        .split(/[^A-Za-z]+/)
        .map((w) => w.toLowerCase())
        .filter((w) => w.length >= 4 && w.length <= 9 && !stop.has(w)),
    ),
  ];
}

/** A trimmed stem suitable for compounding ("stoneware" → "stone", "dripper" → "drip"). */
function stem(w: string) {
  const m = w.match(/^(.{3,6}?)(ware|per|ing|er|ed|s)$/);
  return m ? m[1]! : w.slice(0, 6);
}

export function fixtureBrandNames(project: ProjectRecord) {
  const tone = project.inputs.context.tone;
  const avoid = project.extractions.map((e) => e.brand).filter((b): b is string => Boolean(b));
  const words = productWords(project);
  const h = hash(fixtureProductName(project));
  const toneWords = TONE_WORDS[tone];
  const suffixes = TONE_SUFFIX[tone];
  const stems = words.map(stem);
  const s0 = stems[0] ?? "good";
  const s1 = stems[1] ?? stems[0] ?? "made";
  const pool = [
    `${cap(toneWords[h % 4]!)} ${cap(s0)}`,
    `${cap(s1)}${suffixes[0]}`,
    `${cap(toneWords[(h + 1) % 4]!)}`,
    `${cap(s0)}${suffixes[1]}`,
    `${cap(s0.slice(0, 4))}${"aeo"[h % 3]}`,
    `${cap(toneWords[(h + 2) % 4]!)} ${cap(s1)}`,
    `${cap(toneWords[(h + 3) % 4]!)}${suffixes[0]}`,
    `${cap(s1.slice(0, 4))}ly`,
  ];
  const out: ReturnType<typeof finalizeCandidate>[] = [];
  for (const name of pool) {
    if (out.length === 6) break;
    if (out.some((c) => c.name.toLowerCase() === name.toLowerCase())) continue;
    const c = finalizeCandidate(
      {
        name,
        rationale: `Built from the product's own vocabulary ("${s0}") with a ${tone.toLowerCase()} feel.`,
      },
      { avoid },
    );
    if (c.checks && nameIsUsable(c.checks)) out.push(c);
  }
  for (let i = 0; out.length < 6; i++) {
    out.push(
      finalizeCandidate({
        name: `${cap(toneWords[i % 4]!)}${suffixes[i % 2]}${i >= 4 ? "e" : ""}`,
        rationale: `A short, ownable name with a ${tone.toLowerCase()} feel.`,
      }),
    );
  }
  return {
    candidates: out.map((c) => ({
      name: c.name,
      rationale: c.rationale,
      domainSuggestion: c.domainSuggestion,
    })),
  };
}

export function fixtureBrandDetails(project: ProjectRecord) {
  const tone = project.inputs.context.tone;
  const type = (project.analysis?.productType || fixtureProductName(project)).toLowerCase();
  let tagline = `The everyday ${type}`;
  if (tagline.length > 60) tagline = tagline.slice(0, 60).replace(/\s+\S*$/, "");
  return {
    tagline,
    voice: TONE_VOICE[tone],
    palette: TONE_PALETTES[tone],
    fonts: { heading: TONE_FONTS[tone].heading, body: TONE_FONTS[tone].body },
  };
}
