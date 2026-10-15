import type { ProjectRecord } from "@/lib/db/projects";
import { WATCHED_BRANDS } from "@/lib/guardrails";
import { toHandle, truncateAtWord } from "@/lib/listing/text";
import type { ImageAsset } from "@/lib/schemas";
import { fixtureProductName } from "./analysis";

/**
 * Deterministic listing for AI_MODE=fixture. Built only from facts in the project (analysis,
 * source specs, options); anything a buyer expects but the source lacks becomes [CONFIRM: …].
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Drop source/competitor brand names from text that becomes customer-facing. */
function withoutBrands(text: string, brands: string[]) {
  let t = text;
  for (const b of brands) {
    if (b.length < 3) continue;
    t = t.replace(new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "");
  }
  return t.replace(/\s{2,}/g, " ").trim();
}

function specRows(project: ProjectRecord) {
  const specs = project.extractions[0]?.specs ?? {};
  return Object.entries(specs)
    .filter(([k, v]) => k && v && !/price|sku|brand|seller|rating|review/i.test(k))
    .slice(0, 10);
}

export function fixtureListing(project: ProjectRecord) {
  const a = project.analysis;
  const brand = project.brandKit?.selectedName ?? "";
  const sourceBrands = project.extractions
    .map((e) => e.brand)
    .filter((b): b is string => Boolean(b));
  const name = withoutBrands(a?.productName || fixtureProductName(project), [
    ...sourceBrands,
    ...WATCHED_BRANDS,
  ]);
  const type = a?.productType || "Product";
  const material = a?.materials[0];
  const title = truncateAtWord(name, 70);
  const rows = specRows(project);
  const has = (re: RegExp) => rows.some(([k]) => re.test(k));
  const confirmRows: [string, string][] = [];
  if (!has(/dimension|size|height|width|length|diameter/i))
    confirmRows.push(["Dimensions", "[CONFIRM: exact dimensions]"]);
  if (!has(/weight/i)) confirmRows.push(["Weight", "[CONFIRM: product weight]"]);
  if (!material && !has(/material/i)) confirmRows.push(["Material", "[CONFIRM: material]"]);
  const tableRows = [...rows, ...confirmRows]
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v.startsWith("[CONFIRM") ? v : esc(v)}</td></tr>`)
    .join("");
  const diffs = (a?.differentiators ?? []).slice(0, 4);
  const uses = (a?.useCases ?? []).slice(0, 2);
  const bullets = [
    material
      ? `<li><strong>${esc(material)} build</strong>: a material chosen for everyday use.</li>`
      : "",
    ...diffs.map((d) => {
      const [k, ...rest] = d.split(":");
      return rest.length
        ? `<li><strong>${esc(k!.trim())}</strong>: ${esc(rest.join(":").trim())}.</li>`
        : `<li>${esc(d)}.</li>`;
    }),
    uses.length
      ? `<li><strong>Made for</strong> ${esc(uses.join(" and ").toLowerCase())}.</li>`
      : "",
  ].filter(Boolean);
  if (bullets.length < 3)
    bullets.push(`<li><strong>Simple to use</strong>: [CONFIRM: key usage benefit].</li>`);

  const descriptionHtml = [
    `<p>Meet the ${esc(type.toLowerCase())} from ${esc(brand || "our shop")}. ${material ? `Made from ${esc(material.toLowerCase())}, it` : "It"} is designed to be a dependable part of your routine.</p>`,
    `<h3>Why you'll love it</h3>`,
    `<ul>${bullets.join("")}</ul>`,
    `<h3>Details</h3>`,
    `<table><tbody>${tableRows}</tbody></table>`,
    `<h3>What's in the box</h3>`,
    `<ul><li>1 × ${esc(type.toLowerCase())}</li><li>[CONFIRM: anything else included]</li></ul>`,
    `<h3>Care &amp; use</h3>`,
    `<p>[CONFIRM: care instructions, e.g. dishwasher safe or hand wash only].</p>`,
    `<h3>Good to know</h3>`,
    `<p><strong>What is it made of?</strong><br>${material ? esc(material) : "[CONFIRM: material]"}.</p>`,
    `<p><strong>How big is it?</strong><br>[CONFIRM: dimensions and capacity].</p>`,
    `<p><strong>How do I look after it?</strong><br>See the care notes above.</p>`,
    `<p>Orders ship from ${esc(project.inputs.context.shippingOrigin || "[CONFIRM: shipping origin]")} within [CONFIRM: processing time]. See our shipping and refund policies for delivery times and returns.</p>`,
  ].join("\n");

  const tagWords = [
    type,
    ...(a?.materials ?? []),
    ...(a?.colors ?? []),
    project.inputs.context.niche,
    ...type.split(/\s+/),
  ]
    .filter((t): t is string => Boolean(t && t.trim()))
    .map((t) => t.toLowerCase().trim());
  const tags = [...new Set(tagWords)].slice(0, 13);

  const options = project.extractions[0]?.options.length
    ? project.extractions[0].options.slice(0, 3).map((o) => ({ name: o.name, values: o.values }))
    : [{ name: "Title", values: ["Default Title"] }];

  return {
    title,
    productType: type,
    shopifyCategory: "",
    tags,
    descriptionHtml,
    seoTitle: truncateAtWord(`${title}${brand ? ` | ${brand}` : ""}`, 60),
    seoDescription: truncateAtWord(
      `${title}${material ? ` in ${material.toLowerCase()}` : ""}. Thoughtfully designed for everyday use. Explore details, care and shipping info.`,
      155,
    ),
    handle: toHandle(title),
    options,
  };
}

export function fixtureSeo(
  project: ProjectRecord,
  listing: { title: string; seoTitle: string; seoDescription: string; handle: string },
  assets: ImageAsset[],
) {
  return {
    seoTitle: listing.seoTitle,
    seoDescription: listing.seoDescription,
    handle: listing.handle,
    altTexts: assets.map((asset, i) => ({
      index: i + 1,
      altText: asset.altText || `${listing.title}, view ${i + 1}`,
    })),
  };
}
