import Papa from "papaparse";
import type { ValidationIssue } from "@/lib/schemas";
import {
  csvHeaders,
  csvKeyMap,
  SHOPIFY_LIMITS,
  type CsvFormat,
  type CsvKey,
  type CsvRow,
} from "./csv-format";

export interface CsvValidation {
  ok: boolean;
  format: CsvFormat | null;
  rowCount: number;
  productCount: number;
  checks: { name: string; passed: boolean; detail: string }[];
  issues: ValidationIssue[];
}

const DECIMAL = /^\d+(\.\d{1,2})?$/;
const BOOL = /^(TRUE|FALSE)$/;

/**
 * Re-parse a product CSV and check it the way Shopify's importer would: exact headers, handle
 * consistency, option name/value alignment, numeric prices and weights, unique SKUs, contiguous
 * image positions and description size. Row numbers are 1-based file lines (header = 1).
 */
export function validateProductCsv(text: string, expected?: CsvFormat): CsvValidation {
  const issues: ValidationIssue[] = [];
  const checks: CsvValidation["checks"] = [];
  const add = (name: string, failures: ValidationIssue[], okDetail: string) => {
    issues.push(...failures);
    const errors = failures.filter((f) => f.level === "error");
    checks.push({
      name,
      passed: errors.length === 0,
      detail: failures.length
        ? `${errors.length} error(s), ${failures.length - errors.length} warning(s)`
        : okDetail,
    });
  };
  const err = (check: string, message: string, row: number | null = null): ValidationIssue => ({
    level: "error",
    check,
    message,
    row,
  });
  const warn = (check: string, message: string, row: number | null = null): ValidationIssue => ({
    level: "warning",
    check,
    message,
    row,
  });

  // Encoding: UTF-8 without BOM (the builder never writes one).
  add(
    "encoding",
    text.charCodeAt(0) === 0xfeff ? [err("encoding", "File starts with a byte-order mark.")] : [],
    "UTF-8 without a byte-order mark",
  );

  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const parseErrors = parsed.errors.map((e) =>
    err("parse", `${e.message}`, e.row != null ? e.row + 1 : null),
  );
  add("parse", parseErrors, "Parsed cleanly");
  const [header = [], ...body] = parsed.data;

  // Header: must equal one of the encoded header constants exactly (names and order).
  const formats: CsvFormat[] = expected ? [expected] : ["current", "legacy"];
  const format =
    formats.find((f) => {
      const h = csvHeaders(f);
      return h.length === header.length && h.every((x, i) => x === header[i]);
    }) ?? null;
  add(
    "headers",
    format
      ? []
      : [
          err(
            "headers",
            `Header row doesn't match the ${expected ?? "current or legacy"} Shopify template: ${header.join(", ")}`,
            1,
          ),
        ],
    format ? `Matches the ${format} Shopify template (${header.length} columns)` : "",
  );
  if (!format) {
    return { ok: false, format: null, rowCount: body.length, productCount: 0, checks, issues };
  }

  const map = csvKeyMap(format);
  const rows: CsvRow[] = body.map((cells) => {
    const r: CsvRow = {};
    header.forEach((h, i) => {
      const k = map[h] as CsvKey;
      r[k] = (cells[i] ?? "").trim() === "" ? "" : (cells[i] ?? "");
    });
    return r;
  });
  const widthErrors = body
    .map((cells, i) =>
      cells.length !== header.length
        ? err("columns", `Row has ${cells.length} cells; expected ${header.length}.`, i + 2)
        : null,
    )
    .filter((x): x is ValidationIssue => Boolean(x));
  add("columns", widthErrors, "Every row has the same number of cells as the header");

  // Group rows by handle; a handle's rows must be contiguous and the first must carry the title.
  const handleIssues: ValidationIssue[] = [];
  const products = new Map<string, { first: number; rows: number[] }>();
  let last = "";
  rows.forEach((r, i) => {
    const line = i + 2;
    const h = r.handle ?? "";
    if (!h) {
      handleIssues.push(err("handles", "Missing handle.", line));
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(h))
      handleIssues.push(err("handles", `Handle "${h}" isn't a valid Shopify handle.`, line));
    const p = products.get(h);
    if (!p) {
      products.set(h, { first: i, rows: [i] });
      if (!r.title) handleIssues.push(err("handles", `First row of "${h}" has no title.`, line));
    } else {
      if (last !== h)
        handleIssues.push(err("handles", `Rows for "${h}" aren't next to each other.`, line));
      p.rows.push(i);
      if (r.title && r.title !== rows[p.first]!.title)
        handleIssues.push(err("handles", `"${h}" has two different titles.`, line));
    }
    last = h;
  });
  add("handles", handleIssues, `${products.size} product(s), handles consistent`);

  const isVariantRow = (r: CsvRow) => Boolean(r.option1Value || r.price || r.sku);

  // Options: names on the first row, values on every variant row, aligned to the names.
  const optionIssues: ValidationIssue[] = [];
  const priceIssues: ValidationIssue[] = [];
  const skuIssues: ValidationIssue[] = [];
  const imageIssues: ValidationIssue[] = [];
  const htmlIssues: ValidationIssue[] = [];
  const valueIssues: ValidationIssue[] = [];
  const skus = new Map<string, number>();
  for (const [handle, p] of products) {
    const first = rows[p.first]!;
    const names = [first.option1Name, first.option2Name, first.option3Name];
    if (!names[0])
      optionIssues.push(err("options", `"${handle}" has no Option1 name.`, p.first + 2));
    names.forEach((n, k) => {
      if (k > 0 && n && !names[k - 1])
        optionIssues.push(
          err("options", `"${handle}" has Option${k + 1} without Option${k}.`, p.first + 2),
        );
    });
    const combos = new Set<string>();
    let variantCount = 0;
    for (const i of p.rows) {
      const r = rows[i]!;
      const line = i + 2;
      if (i !== p.first && (r.option1Name || r.option2Name || r.option3Name))
        optionIssues.push(warn("options", "Option names should only be on the first row.", line));
      if (!isVariantRow(r)) {
        if (!r.imageSrc && i !== p.first)
          optionIssues.push(err("options", "Row is neither a variant nor an image row.", line));
        continue;
      }
      variantCount += 1;
      const values = [r.option1Value, r.option2Value, r.option3Value];
      values.forEach((v, k) => {
        if (names[k] && !v) optionIssues.push(err("options", `Missing ${names[k]} value.`, line));
        if (!names[k] && v)
          optionIssues.push(
            err("options", `Option${k + 1} value "${v}" has no option name.`, line),
          );
      });
      const combo = values.filter(Boolean).join(" / ");
      if (combos.has(combo))
        optionIssues.push(err("options", `Duplicate variant "${combo}".`, line));
      combos.add(combo);

      if (!r.price || !DECIMAL.test(r.price))
        priceIssues.push(err("prices", `Price "${r.price ?? ""}" isn't a plain decimal.`, line));
      else if (Number(r.price) <= 0)
        priceIssues.push(err("prices", "Price must be above 0.", line));
      if (r.compareAt) {
        if (!DECIMAL.test(r.compareAt))
          priceIssues.push(
            err("prices", `Compare-at price "${r.compareAt}" isn't a plain decimal.`, line),
          );
        else if (Number(r.compareAt) <= Number(r.price))
          priceIssues.push(err("prices", "Compare-at price must be higher than the price.", line));
      }
      if (r.cost && !DECIMAL.test(r.cost))
        priceIssues.push(err("prices", `Cost "${r.cost}" isn't a plain decimal.`, line));

      if (r.grams && !/^\d+$/.test(r.grams))
        valueIssues.push(err("values", `Weight "${r.grams}" must be whole grams.`, line));
      if (r.qty && !/^-?\d+$/.test(r.qty))
        valueIssues.push(err("values", `Inventory "${r.qty}" must be a whole number.`, line));
      for (const k of ["requiresShipping", "taxable"] as const)
        if (r[k] && !BOOL.test(r[k]!))
          valueIssues.push(err("values", `"${r[k]}" must be TRUE or FALSE.`, line));
      if (r.policy && !/^(deny|continue)$/.test(r.policy))
        valueIssues.push(
          err("values", `Inventory policy "${r.policy}" must be deny or continue.`, line),
        );
      if (r.weightUnit && !/^(g|kg|lb|oz)$/.test(r.weightUnit))
        valueIssues.push(
          err("values", `Weight unit "${r.weightUnit}" must be g, kg, lb or oz.`, line),
        );

      if (r.sku) {
        const seen = skus.get(r.sku);
        if (seen) skuIssues.push(err("skus", `SKU "${r.sku}" is also used on line ${seen}.`, line));
        else skus.set(r.sku, line);
      } else skuIssues.push(warn("skus", "Variant has no SKU.", line));
    }
    if (variantCount === 0)
      optionIssues.push(err("options", `"${handle}" has no variant rows.`, p.first + 2));
    if (variantCount > SHOPIFY_LIMITS.maxVariants)
      optionIssues.push(
        err(
          "options",
          `"${handle}" has ${variantCount} variants; Shopify allows ${SHOPIFY_LIMITS.maxVariants}.`,
        ),
      );

    if (first.published && !BOOL.test(first.published))
      valueIssues.push(
        err("values", `Published "${first.published}" must be TRUE or FALSE.`, p.first + 2),
      );
    if (first.giftCard && !BOOL.test(first.giftCard))
      valueIssues.push(
        err("values", `Gift card "${first.giftCard}" must be TRUE or FALSE.`, p.first + 2),
      );
    if (first.status && !/^(active|draft|archived)$/.test(first.status))
      valueIssues.push(
        err("values", `Status "${first.status}" must be active, draft or archived.`, p.first + 2),
      );

    // Images: positions 1..n without gaps, each with a URL, n ≤ 250.
    const positions = p.rows
      .map((i) => ({ i, r: rows[i]! }))
      .filter(({ r }) => r.imageSrc || r.imagePosition);
    positions.forEach(({ i, r }) => {
      if (!r.imageSrc)
        imageIssues.push(err("images", "Image position without an image URL.", i + 2));
      else if (!/^https?:\/\//.test(r.imageSrc))
        imageIssues.push(
          err("images", `Image URL "${r.imageSrc}" must be a public http(s) URL.`, i + 2),
        );
    });
    const nums = positions.map(({ r }) => Number(r.imagePosition));
    if (nums.some((n, k) => n !== k + 1))
      imageIssues.push(
        err("images", `"${handle}" image positions aren't 1, 2, 3…: ${nums.join(", ")}`),
      );
    if (nums.length > SHOPIFY_LIMITS.maxImages)
      imageIssues.push(
        err(
          "images",
          `"${handle}" has ${nums.length} images; Shopify allows ${SHOPIFY_LIMITS.maxImages}.`,
        ),
      );
    for (const i of p.rows) {
      const v = rows[i]!.variantImage;
      if (v && !/^https?:\/\//.test(v))
        imageIssues.push(
          err("images", `Variant image "${v}" must be a public http(s) URL.`, i + 2),
        );
    }

    const body = first.body ?? "";
    if (!body) htmlIssues.push(warn("html", `"${handle}" has no description.`, p.first + 2));
    else if (body.length > SHOPIFY_LIMITS.descriptionMaxChars)
      htmlIssues.push(err("html", `Description is ${body.length} characters.`, p.first + 2));
    else if (body.length > SHOPIFY_LIMITS.descriptionWarnChars)
      htmlIssues.push(
        warn("html", `Description is unusually long (${body.length} characters).`, p.first + 2),
      );
    if (/<\s*(script|style|iframe|object|embed)\b/i.test(body))
      htmlIssues.push(err("html", "Description contains script/style/embed tags.", p.first + 2));
    const opens = (body.match(/<(p|ul|ol|li|table|tr|td|th|h2|h3)\b[^>]*>/gi) ?? []).length;
    const closes = (body.match(/<\/(p|ul|ol|li|table|tr|td|th|h2|h3)>/gi) ?? []).length;
    if (opens !== closes)
      htmlIssues.push(
        warn("html", `Description has ${opens} opening and ${closes} closing tags.`, p.first + 2),
      );
  }
  add("options", optionIssues, "Option names and values line up");
  add("prices", priceIssues, "Prices are plain decimals above 0");
  add("skus", skuIssues, "SKUs are unique");
  add("values", valueIssues, "Booleans, weights, inventory and status values are valid");
  add("images", imageIssues, "Image positions are contiguous with public URLs");
  add("html", htmlIssues, "Descriptions are a sensible size");

  return {
    ok: issues.every((i) => i.level !== "error"),
    format,
    rowCount: rows.length,
    productCount: products.size,
    checks,
    issues,
  };
}
