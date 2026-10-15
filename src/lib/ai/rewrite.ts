import "server-only";
import { z } from "zod";
import type { ProjectRecord } from "@/lib/db/projects";
import { describeViolations, findGuardrailViolations } from "@/lib/guardrails";
import { sanitizeListingHtml } from "@/lib/html/sanitize";
import { confirmMarkers, truncateAtWord } from "@/lib/listing/text";
import { Tone, type RewriteOperation } from "@/lib/schemas";
import { productFacts, styleOf } from "./context";
import { globalRules } from "./prompts/global";
import { REWRITE_SYSTEM } from "./prompts/rewrite";
import { callStructured } from "./structured";

export interface RewriteRequest {
  project: ProjectRecord;
  /** Human label of the field, e.g. "Product title". */
  label: string;
  current: string;
  operation: RewriteOperation;
  html?: boolean;
  tone?: string;
  instruction?: string;
  maxLength?: number;
  /** Extra semantic checks (e.g. similarity to the source). Return problems to retry. */
  check?: (value: string) => string[];
  /** Offline output for AI_MODE=fixture when the operation is "regenerate". */
  fixture?: () => string;
}

const Output = z.object({ value: z.string().min(1) });

/** Fixture "shorten": keep the first sentence of each paragraph and up to 3 list items. */
function fixtureShorten(current: string, html: boolean, max?: number) {
  if (!html) {
    const target = Math.max(10, Math.round(current.length * 0.6));
    return truncateAtWord(current, Math.min(target, max ?? target));
  }
  let out = current.replace(/<p>([\s\S]*?)<\/p>/gi, (_m, body: string) => {
    if (/<strong>/.test(body)) return `<p>${body}</p>`;
    const first = body.match(/^[\s\S]*?[.!?](?=\s|$)/);
    return `<p>${first ? first[0] : body}</p>`;
  });
  out = out.replace(/<ul>([\s\S]*?)<\/ul>/gi, (_m, body: string) => {
    const items = body.match(/<li>[\s\S]*?<\/li>/gi) ?? [];
    return `<ul>${items.slice(0, 3).join("")}</ul>`;
  });
  return out;
}

/** Generic "regenerate / make shorter / change tone" for one field, with the voice guide. */
export async function rewriteField(req: RewriteRequest): Promise<string> {
  const { project } = req;
  const voice = project.brandKit?.voice;
  const markers = confirmMarkers(req.current);
  const style = styleOf(project);
  const requested = Tone.safeParse(req.tone);
  const tone = req.operation === "change_tone" && requested.success ? requested.data : style.tone;
  const opLine =
    req.operation === "change_tone"
      ? `Operation: change_tone → ${tone}`
      : `Operation: ${req.operation}`;
  const out = await callStructured({
    task: `rewriteField:${req.operation}`,
    projectId: project.id,
    system: `${REWRITE_SYSTEM}\n\n${globalRules({ ...style, tone })}`,
    content: [
      {
        type: "text",
        text: [
          productFacts(project, { includeAnalysis: true }),
          voice
            ? `BRAND VOICE\nAdjectives: ${voice.adjectives.join(", ")}\nDo:\n- ${voice.do.join("\n- ")}\nDon't:\n- ${voice.dont.join("\n- ")}`
            : "",
          `Field: ${req.label}${req.maxLength ? ` (max ${req.maxLength} characters)` : ""}\nFormat: ${req.html ? "HTML" : "plain text"}\n${opLine}`,
          req.instruction ? `Merchant instruction: ${req.instruction}` : "",
          `Current value:\n<current>\n${req.current}\n</current>`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: Output,
    toolName: "record_rewrite",
    toolDescription: "Record the rewritten value of the field.",
    maxTokens: req.html ? 6000 : 1500,
    effort: "low",
    check: (v) => {
      const problems: string[] = [];
      const text = req.html ? sanitizeListingHtml(v.value) : v.value;
      if (req.maxLength && text.length > req.maxLength)
        problems.push(`- value: ${text.length} characters; the limit is ${req.maxLength}`);
      const kept = confirmMarkers(text);
      const dropped = markers.filter((m) => !kept.includes(m));
      if (dropped.length)
        problems.push(
          `- value: keep the unresolved placeholders ${dropped.map((m) => `[CONFIRM: ${m}]`).join(", ")}`,
        );
      const g = findGuardrailViolations(text);
      if (g.length) problems.push(describeViolations(g));
      problems.push(...(req.check?.(text) ?? []));
      return problems;
    },
    fixture: () => ({
      value:
        req.operation === "shorten"
          ? fixtureShorten(req.current, Boolean(req.html), req.maxLength)
          : req.operation === "regenerate" && req.fixture
            ? req.fixture()
            : req.current,
    }),
  });
  const value = req.html ? sanitizeListingHtml(out.value) : out.value.trim();
  return req.maxLength && !req.html ? truncateAtWord(value, req.maxLength) : value;
}
