import { randomUUID } from "node:crypto";
import { UserFacingError } from "@/lib/errors";
import { mapLimit, sleep as realSleep } from "@/lib/retry";
import {
  SHOPIFY_STEPS,
  ShopifyResourceMap,
  type CollectionRule,
  type MenuItem,
  type ProductListing,
  type ShopifyPushResult,
  type ShopifyStep,
  type ShopifyStepResult,
  type StoreCollection,
  type StoreContent,
} from "@/lib/schemas";
import { assertNoUserErrors, ShopifyError, type AdminClient, type StagedTarget } from "./client";
import * as Q from "./operations";

/**
 * The Shopify push (spec Section 9). Runs each step in order, records every created resource's
 * GID so a second push updates instead of duplicating, and keeps going after a failed step so
 * the merchant sees a per-step result table and can retry just what failed.
 *
 * Safety rules baked in here:
 * - the product is created as DRAFT; on later pushes its status is left alone;
 * - pages are created hidden; menus and policies are the only things that change in place;
 * - an existing product/page/collection that StoreForge didn't create is never overwritten;
 * - theme files only go into an UNPUBLISHED/DEVELOPMENT theme, never the live (MAIN) one;
 * - dry-run only runs read queries.
 */

export const STEP_LABELS: Record<ShopifyStep, string> = {
  shop: "Check the store connection",
  images: "Upload product images",
  product: "Create the product (draft)",
  inventory: "Set inventory",
  collections: "Create smart collections",
  pages: "Create pages",
  policies: "Update store policies",
  menus: "Update menus",
  theme: "Theme files (unpublished theme)",
};

/** Default source for a fresh copy of Dawn (theme step, when no existing theme is chosen). */
export const DEFAULT_DAWN_SOURCE = "https://github.com/Shopify/dawn/archive/refs/tags/v16.0.0.zip";

const POLICY_TYPES: Record<string, string> = {
  "shipping-policy": "SHIPPING_POLICY",
  "refund-policy": "REFUND_POLICY",
  "privacy-policy": "PRIVACY_POLICY",
  "terms-of-service": "TERMS_OF_SERVICE",
};

export interface PushImage {
  assetId: string;
  fileName: string;
  alt: string;
  variantKey: string | null;
  mimeType: string;
  size: number;
  read: () => Promise<Buffer>;
}

export interface PushInput {
  listing: ProductListing;
  content: StoreContent;
  storeName: string;
  images: PushImage[];
  /** Theme JSON files by path (templates/index.json…), or null when not built. */
  themeFiles: Record<string, string> | null;
}

export interface PushOptions {
  dryRun: boolean;
  includeTheme: boolean;
  themeId: string | null;
  onlySteps?: ShopifyStep[];
  themeSourceUrl?: string;
  /** Called after every step so progress and created IDs are saved as they happen. */
  onUpdate?: (result: ShopifyPushResult, step: ShopifyStep) => Promise<void> | void;
  sleep?: (ms: number) => Promise<void>;
  /** Theme install polling: interval and attempts. */
  themePoll?: { intervalMs: number; attempts: number };
}

export interface PreviousPush {
  resources?: Partial<ShopifyResourceMap> | null;
  steps?: ShopifyStepResult[] | null;
}

interface VariantNode {
  id: string;
  sku: string | null;
  selectedOptions: { name: string; value: string }[];
  inventoryItem: { id: string } | null;
}
interface ProductNode {
  id: string;
  handle: string;
  title: string;
  status: string;
  media: { nodes: { id: string; alt: string | null }[] };
  variants: {
    nodes: VariantNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/** True when the listing would be pulled into a smart collection with these rules. */
export function productMatchesRules(
  listing: ProductListing,
  rules: NonNullable<StoreCollection["rules"]>,
): boolean {
  const test = (r: CollectionRule): boolean => {
    const values: (string | number)[] =
      r.column === "TAG"
        ? listing.tags
        : r.column === "TITLE"
          ? [listing.title]
          : r.column === "TYPE"
            ? [listing.productType]
            : r.column === "VENDOR"
              ? [listing.vendor]
              : listing.variants.map((v) => v.price);
    const cond = r.condition.trim().toLowerCase();
    const num = Number(r.condition);
    const one = (v: string | number) => {
      const s = String(v).trim().toLowerCase();
      switch (r.relation) {
        case "EQUALS":
          return typeof v === "number" ? v === num : s === cond;
        case "NOT_EQUALS":
          return typeof v === "number" ? v !== num : s !== cond;
        case "CONTAINS":
          return s.includes(cond);
        case "STARTS_WITH":
          return s.startsWith(cond);
        case "GREATER_THAN":
          return Number(v) > num;
        case "LESS_THAN":
          return Number(v) < num;
      }
    };
    // Shopify treats NOT_EQUALS on tags as "no tag equals".
    return r.relation === "NOT_EQUALS" ? values.every(one) : values.some(one);
  };
  return rules.appliedDisjunctively ? rules.rules.some(test) : rules.rules.every(test);
}

const optionValuesOf = (v: ProductListing["variants"][number]) =>
  [v.option1, v.option2 ?? null, v.option3 ?? null].filter((x): x is string => Boolean(x));

/** Shopify needs at least one option; a listing without options gets Title / Default Title. */
function productOptions(listing: ProductListing) {
  if (!listing.options.length) {
    return [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }];
  }
  return listing.options.map((o, i) => {
    const used = listing.variants
      .map((v) => optionValuesOf(v)[i])
      .filter((x): x is string => Boolean(x));
    const values = [...new Set([...o.values, ...used])];
    return { name: o.name, position: i + 1, values: values.map((name) => ({ name })) };
  });
}

function optionNames(listing: ProductListing) {
  return listing.options.length ? listing.options.map((o) => o.name) : ["Title"];
}

const variantKey = (pairs: { name: string; value: string }[]) =>
  pairs.map((p) => `${p.name.toLowerCase()}=${p.value.toLowerCase()}`).join("|");

function listingVariantKey(listing: ProductListing, v: ProductListing["variants"][number]) {
  const names = optionNames(listing);
  const values = listing.options.length ? optionValuesOf(v) : [v.option1 || "Default Title"];
  return variantKey(names.map((name, i) => ({ name, value: values[i] ?? "" })));
}

/** The image a variant should show: explicit imageId, else an image mapped to its option. */
function variantImage(
  listing: ProductListing,
  v: ProductListing["variants"][number],
  images: PushImage[],
) {
  if (v.imageId) {
    const byId = images.find((i) => i.assetId === v.imageId);
    if (byId) return byId;
  }
  const values = optionValuesOf(v);
  for (const img of images) {
    if (!img.variantKey) continue;
    const at = img.variantKey.indexOf(":");
    const idx = listing.options.findIndex((o) => o.name === img.variantKey!.slice(0, at));
    if (idx >= 0 && values[idx] === img.variantKey.slice(at + 1)) return img;
  }
  return null;
}

const money = (n: number) => n.toFixed(2);

function errorText(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;
  if (err instanceof Error) return `Unexpected error: ${err.message}`;
  return "Unexpected error";
}

export async function pushToShopify(
  client: AdminClient,
  input: PushInput,
  opts: PushOptions,
  previous: PreviousPush | null = null,
): Promise<ShopifyPushResult> {
  const { listing, content } = input;
  const sleep = opts.sleep ?? realSleep;
  const resources = ShopifyResourceMap.parse(previous?.resources ?? {});
  const dry = opts.dryRun;

  // Which steps run this time. A retry of the product re-runs the image upload it depends on.
  const selected = new Set<ShopifyStep>(opts.onlySteps?.length ? opts.onlySteps : SHOPIFY_STEPS);
  selected.add("shop");
  if (selected.has("product")) selected.add("images");
  if (selected.has("images")) selected.add("product");
  if (!opts.includeTheme) selected.delete("theme");

  const prevSteps = new Map((previous?.steps ?? []).map((s) => [s.step, s]));
  const result: ShopifyPushResult = {
    dryRun: dry,
    storeDomain: client.domain,
    apiVersion: client.apiVersion,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    steps: SHOPIFY_STEPS.map((step): ShopifyStepResult => {
      if (selected.has(step)) {
        return {
          step,
          label: STEP_LABELS[step],
          status: "pending",
          detail: "",
          resourceIds: [],
          errors: [],
        };
      }
      const prev = opts.onlySteps?.length ? prevSteps.get(step) : undefined;
      if (prev) return prev;
      return {
        step,
        label: STEP_LABELS[step],
        status: "skipped",
        detail: step === "theme" ? "Not selected" : "Not part of this run",
        resourceIds: [],
        errors: [],
      };
    }),
    resources,
    plannedOperations: [],
    themes: [],
    shopName: "",
    warnings: [],
  };
  const stepOf = (s: ShopifyStep) => result.steps.find((x) => x.step === s)!;
  const plan = (line: string) => result.plannedOperations.push(line);
  const save = async (s: ShopifyStep) => {
    await opts.onUpdate?.(result, s);
  };
  const finish = (s: ShopifyStep, patch: Partial<ShopifyStepResult>) => {
    Object.assign(stepOf(s), patch);
  };

  // ---------- 1. shop ----------
  let locationId: string | null = null;
  try {
    const data = await client.request<{
      shop: { name: string; myshopifyDomain: string; currencyCode: string };
      location: { id: string; name: string } | null;
      themes: { nodes: { id: string; name: string; role: string }[] } | null;
    }>(Q.SHOP_QUERY);
    result.shopName = data.shop.name;
    result.themes = data.themes?.nodes ?? [];
    locationId = data.location?.id ?? null;
    const currency = content.settings.currency?.toUpperCase();
    if (currency && data.shop.currencyCode && currency !== data.shop.currencyCode) {
      result.warnings.push(
        `Your prices are in ${currency} but ${data.shop.name} uses ${data.shop.currencyCode}. Shopify will treat the numbers as ${data.shop.currencyCode}; change the store currency or your prices first.`,
      );
    }
    finish("shop", {
      status: "succeeded",
      detail: `Connected to ${data.shop.name} (${data.shop.myshopifyDomain}), currency ${data.shop.currencyCode}${data.location ? `, inventory location "${data.location.name}"` : ""}.`,
    });
  } catch (err) {
    finish("shop", { status: "failed", errors: [errorText(err)] });
    for (const s of result.steps) {
      if (s.status === "pending")
        Object.assign(s, { status: "skipped", detail: "Needs a working store connection" });
    }
    result.finishedAt = new Date().toISOString();
    await save("shop");
    return result;
  }
  await save("shop");

  // ---------- product lookup (read-only, also used by dry-run) ----------
  const lookupProduct = async (identifier: { id: string } | { handle: string }) =>
    (
      await client.request<{ productByIdentifier: ProductNode | null }>(Q.PRODUCT_LOOKUP_QUERY, {
        identifier,
      })
    ).productByIdentifier;

  let product: ProductNode | null = null;
  let productConflict = false;
  if (selected.has("product") || selected.has("inventory") || selected.has("images")) {
    try {
      if (resources.productId) product = await lookupProduct({ id: resources.productId });
      if (!product) {
        resources.productId = null;
        const byHandle = await lookupProduct({ handle: listing.handle });
        if (byHandle) productConflict = true;
      }
    } catch (err) {
      finish("product", { status: "failed", errors: [errorText(err)] });
    }
  }

  const mediaIds = new Set(product?.media.nodes.map((m) => m.id) ?? []);
  const uploadedFor = (assetId: string) => {
    const id = resources.fileIds[assetId];
    return id && mediaIds.has(id) ? id : null;
  };

  // ---------- 2. images ----------
  const staged = new Map<string, string>();
  if (selected.has("images")) {
    const pending = input.images.filter((img) => !uploadedFor(img.assetId));
    const kept = input.images.length - pending.length;
    if (productConflict) {
      finish("images", {
        status: "skipped",
        detail: "Skipped because the product can't be created (see below).",
      });
    } else if (dry) {
      plan(
        pending.length
          ? `Upload ${pending.length} image${pending.length === 1 ? "" : "s"} (stagedUploadsCreate, then a direct upload to Shopify's storage)${kept ? `; ${kept} already in Shopify` : ""}`
          : `Images: all ${kept} already in Shopify, nothing to upload`,
      );
      finish("images", {
        status: "planned",
        detail: `${pending.length} to upload, ${kept} already uploaded`,
      });
    } else {
      try {
        if (pending.length) {
          const data = await client.request<{
            stagedUploadsCreate: {
              stagedTargets: StagedTarget[] | null;
              userErrors: { field: string[] | null; message: string }[];
            };
          }>(Q.STAGED_UPLOADS_CREATE, {
            input: pending.map((img) => ({
              filename: img.fileName,
              mimeType: img.mimeType,
              resource: "IMAGE",
              httpMethod: "POST",
              fileSize: String(img.size),
            })),
          });
          assertNoUserErrors("stagedUploadsCreate", data.stagedUploadsCreate.userErrors);
          const targets = data.stagedUploadsCreate.stagedTargets ?? [];
          if (targets.length !== pending.length) {
            throw new ShopifyError("Shopify returned fewer upload slots than images requested.");
          }
          await mapLimit(pending, 3, async (img, i) => {
            const target = targets[i]!;
            await client.uploadStaged(target, {
              name: img.fileName,
              mimeType: img.mimeType,
              data: await img.read(),
            });
            staged.set(img.assetId, target.resourceUrl);
          });
        }
        finish("images", {
          status: "succeeded",
          detail: `${pending.length} uploaded${kept ? `, ${kept} already in Shopify` : ""}. They're attached to the product in the next step.`,
        });
      } catch (err) {
        finish("images", {
          status: "failed",
          errors: [errorText(err)],
          detail: `${staged.size} of ${pending.length} uploaded`,
        });
      }
    }
    await save("images");
  }

  // ---------- 3. product ----------
  const variantsInput = (fileIds: Map<string, string> | null) => {
    const existing = new Map(
      (product?.variants.nodes ?? []).map((v) => [variantKey(v.selectedOptions), v.id]),
    );
    const names = optionNames(listing);
    return listing.variants.map((v, i) => {
      const values = listing.options.length ? optionValuesOf(v) : [v.option1 || "Default Title"];
      const img = fileIds ? variantImage(listing, v, input.images) : null;
      const fileId = img ? fileIds?.get(img.assetId) : undefined;
      return {
        id: existing.get(listingVariantKey(listing, v)),
        position: i + 1,
        optionValues: names.map((optionName, k) => ({ optionName, name: values[k] ?? "" })),
        price: money(v.price),
        compareAtPrice:
          v.compareAtPrice != null && v.compareAtPrice > v.price ? money(v.compareAtPrice) : null,
        sku: v.sku || undefined,
        barcode: v.barcode || undefined,
        taxable: true,
        inventoryPolicy: "DENY",
        inventoryItem: {
          tracked: true,
          requiresShipping: true,
          ...(v.costPerItem != null ? { cost: money(v.costPerItem) } : {}),
          measurement: { weight: { value: Math.max(0, v.grams), unit: "GRAMS" } },
        },
        ...(fileId ? { file: { id: fileId } } : {}),
      };
    });
  };

  if (selected.has("product") && stepOf("product").status === "pending") {
    const creating = !product;
    if (productConflict) {
      finish("product", {
        status: "failed",
        errors: [
          `A product with the handle "${listing.handle}" already exists in ${client.domain} and wasn't created by StoreForge, so it won't be overwritten. Change the handle in the listing step (or delete that product) and push again.`,
        ],
      });
    } else if (dry) {
      plan(
        creating
          ? `Create product "${listing.title}" (handle ${listing.handle}) as DRAFT with ${listing.variants.length} variant${listing.variants.length === 1 ? "" : "s"} and ${input.images.length} image${input.images.length === 1 ? "" : "s"} (productSet)`
          : `Update product "${product!.title}" (${product!.id}): title, description, options, variants, images and SEO; its status (${product!.status}) is left as it is (productSet)`,
      );
      finish("product", {
        status: "planned",
        detail: creating ? "Will be created as a draft" : "Will be updated",
      });
    } else {
      try {
        const files = input.images
          .map((img) => {
            const id = uploadedFor(img.assetId);
            if (id) return { id, alt: img.alt };
            const src = staged.get(img.assetId);
            return src
              ? { originalSource: src, alt: img.alt, contentType: "IMAGE", filename: img.fileName }
              : null;
          })
          .filter((f): f is NonNullable<typeof f> => Boolean(f));
        const missing = input.images.length - files.length;
        const productInput = {
          title: listing.title,
          handle: listing.handle,
          descriptionHtml: listing.descriptionHtml,
          vendor: listing.vendor,
          productType: listing.productType,
          tags: listing.tags,
          seo: { title: listing.seoTitle, description: listing.seoDescription },
          // Draft on creation; on later pushes the merchant's own status choice is kept.
          ...(creating ? { status: "DRAFT" } : {}),
          productOptions: productOptions(listing),
          variants: variantsInput(null),
          files,
        };
        const run = async (inputObj: Record<string, unknown>, id: string | null) => {
          const data = await client.request<{
            productSet: {
              product: ProductNode | null;
              userErrors: { field: string[] | null; message: string; code: string | null }[];
            };
          }>(Q.PRODUCT_SET, { identifier: id ? { id } : null, input: inputObj });
          assertNoUserErrors("productSet", data.productSet.userErrors);
          if (!data.productSet.product) throw new ShopifyError("productSet returned no product.");
          return data.productSet.product;
        };
        product = await run(productInput, product?.id ?? null);
        resources.productId = product.id;
        // Media come back in the order the files were sent; map them to our images.
        const sentAssets = input.images.filter(
          (img) => uploadedFor(img.assetId) || staged.has(img.assetId),
        );
        product.media.nodes.forEach((m, i) => {
          const a = sentAssets[i];
          if (a) resources.fileIds[a.assetId] = m.id;
        });
        mediaIds.clear();
        for (const m of product.media.nodes) mediaIds.add(m.id);
        // Second pass for variant images, now that every image has a file ID.
        const fileIds = new Map(Object.entries(resources.fileIds));
        const needsVariantImages = listing.variants.some((v) => {
          const img = variantImage(listing, v, input.images);
          return img && fileIds.has(img.assetId);
        });
        if (needsVariantImages) {
          product = await run(
            {
              productOptions: productOptions(listing),
              variants: variantsInput(fileIds),
              files: input.images
                .map((img) =>
                  fileIds.get(img.assetId) ? { id: fileIds.get(img.assetId)!, alt: img.alt } : null,
                )
                .filter((f): f is NonNullable<typeof f> => Boolean(f)),
            },
            product.id,
          );
        }
        finish("product", {
          status: "succeeded",
          resourceIds: [product.id],
          detail: `${creating ? "Created as a draft" : "Updated"}: ${listing.variants.length} variant${listing.variants.length === 1 ? "" : "s"}, ${product.media.nodes.length} image${product.media.nodes.length === 1 ? "" : "s"}${missing ? ` (${missing} image${missing === 1 ? "" : "s"} missing; retry the image upload)` : ""}.`,
        });
      } catch (err) {
        finish("product", { status: "failed", errors: [errorText(err)] });
      }
    }
    await save("product");
  }

  // ---------- 4. inventory ----------
  if (selected.has("inventory")) {
    if (!product && !dry) {
      finish("inventory", { status: "skipped", detail: "Needs the product first" });
    } else if (!locationId) {
      finish("inventory", {
        status: "failed",
        errors: ["The store has no active location to hold inventory."],
      });
    } else if (dry) {
      const total = listing.variants.reduce((n, v) => n + Math.max(0, v.inventoryQty), 0);
      plan(
        `Set "available" inventory for ${listing.variants.length} variant${listing.variants.length === 1 ? "" : "s"} (total ${total}) at your primary location (inventorySetQuantities)`,
      );
      finish("inventory", { status: "planned", detail: `Total ${total} units` });
    } else {
      try {
        const variants = [...product!.variants.nodes];
        let pageInfo = product!.variants.pageInfo;
        while (pageInfo.hasNextPage) {
          const page = await client.request<{
            product: { variants: ProductNode["variants"] } | null;
          }>(Q.PRODUCT_VARIANTS_PAGE_QUERY, { id: product!.id, after: pageInfo.endCursor });
          if (!page.product) break;
          variants.push(...page.product.variants.nodes);
          pageInfo = page.product.variants.pageInfo;
        }
        const byKey = new Map(variants.map((v) => [variantKey(v.selectedOptions), v]));
        const quantities = listing.variants
          .map((v) => {
            const node = byKey.get(listingVariantKey(listing, v));
            return node?.inventoryItem
              ? {
                  inventoryItemId: node.inventoryItem.id,
                  locationId,
                  quantity: Math.max(0, Math.round(v.inventoryQty)),
                  changeFromQuantity: null,
                }
              : null;
          })
          .filter((q): q is NonNullable<typeof q> => Boolean(q));
        for (let i = 0; i < quantities.length; i += 250) {
          const data = await client.request<{
            inventorySetQuantities: {
              userErrors: { field: string[] | null; message: string; code: string | null }[];
            };
          }>(Q.INVENTORY_SET_QUANTITIES, {
            key: randomUUID(),
            input: {
              name: "available",
              reason: "correction",
              quantities: quantities.slice(i, i + 250),
            },
          });
          assertNoUserErrors("inventorySetQuantities", data.inventorySetQuantities.userErrors);
        }
        finish("inventory", {
          status: "succeeded",
          detail: `Set for ${quantities.length} variant${quantities.length === 1 ? "" : "s"}.`,
        });
      } catch (err) {
        finish("inventory", { status: "failed", errors: [errorText(err)] });
      }
    }
    await save("inventory");
  }

  // ---------- 5. collections ----------
  /** IDs to link from menus, including existing ones StoreForge didn't create. */
  const linkCollections = new Map<string, string>(Object.entries(resources.collectionIds));
  if (selected.has("collections")) {
    const smart = content.collections.filter((c) => c.handle !== "all" && c.rules);
    const notes: string[] = [];
    const errors: string[] = [];
    const ids: string[] = [];
    for (const c of smart) {
      try {
        let id: string | null = resources.collectionIds[c.handle] ?? null;
        if (id) {
          const found = await client.request<{ collectionByIdentifier: { id: string } | null }>(
            Q.COLLECTION_LOOKUP_QUERY,
            { identifier: { id } },
          );
          if (!found.collectionByIdentifier) {
            delete resources.collectionIds[c.handle];
            id = null;
          }
        }
        if (!id) {
          const other = await client.request<{ collectionByIdentifier: { id: string } | null }>(
            Q.COLLECTION_LOOKUP_QUERY,
            { identifier: { handle: c.handle } },
          );
          if (other.collectionByIdentifier) {
            linkCollections.set(c.handle, other.collectionByIdentifier.id);
            notes.push(
              `"${c.title}": a collection with handle ${c.handle} already exists; kept it unchanged`,
            );
            if (dry)
              plan(`Keep your existing collection "${c.handle}" (not created by StoreForge)`);
            continue;
          }
        }
        const matches = productMatchesRules(listing, c.rules!);
        const ruleSet = {
          appliedDisjunctively: c.rules!.appliedDisjunctively,
          rules: c.rules!.rules.map((r) => ({
            column: r.column,
            relation: r.relation,
            condition: r.condition,
          })),
        };
        if (dry) {
          notes.push(
            `"${c.title}" ${matches ? "will include the product" : "won't include the product yet"}`,
          );
          plan(
            `${id ? "Update" : "Create"} smart collection "${c.title}" (handle ${c.handle})${matches ? "; the product matches its rules" : "; the product does NOT match its rules yet"} (${id ? "collectionUpdate" : "collectionCreate"})`,
          );
          continue;
        }
        const payload = { title: c.title, descriptionHtml: c.descriptionHtml, ruleSet };
        if (id) {
          const data = await client.request<{
            collectionUpdate: {
              collection: { id: string } | null;
              userErrors: { field: string[] | null; message: string }[];
            };
          }>(Q.COLLECTION_UPDATE, { input: { id, ...payload } });
          assertNoUserErrors("collectionUpdate", data.collectionUpdate.userErrors);
        } else {
          const data = await client.request<{
            collectionCreate: {
              collection: { id: string } | null;
              userErrors: { field: string[] | null; message: string }[];
            };
          }>(Q.COLLECTION_CREATE, { input: { handle: c.handle, ...payload } });
          assertNoUserErrors("collectionCreate", data.collectionCreate.userErrors);
          id = data.collectionCreate.collection!.id;
          resources.collectionIds[c.handle] = id;
        }
        linkCollections.set(c.handle, id);
        ids.push(id);
        notes.push(
          `"${c.title}" ${matches ? "includes the product" : "doesn't include the product yet (its rules don't match the product's tags or type)"}`,
        );
      } catch (err) {
        errors.push(`${c.title}: ${errorText(err)}`);
      }
    }
    finish("collections", {
      status: errors.length ? "failed" : dry ? "planned" : "succeeded",
      resourceIds: ids,
      errors,
      detail: smart.length
        ? `${notes.join("; ")}${notes.length ? ". " : ""}All Products (/collections/all) is built into Shopify, so it isn't created.`
        : "No smart collections to create. All Products (/collections/all) is built into Shopify.",
    });
    await save("collections");
  }

  // ---------- 6. pages ----------
  const linkPages = new Map<string, string>(Object.entries(resources.pageIds));
  if (selected.has("pages")) {
    const pages = content.pages.filter((p) => p.kind !== "policy");
    const errors: string[] = [];
    const notes: string[] = [];
    const ids: string[] = [];
    for (const p of pages) {
      try {
        let id: string | null = resources.pageIds[p.handle] ?? null;
        if (id) {
          const found = await client.request<{ page: { id: string } | null }>(Q.PAGE_BY_ID_QUERY, {
            id,
          });
          if (!found.page) {
            delete resources.pageIds[p.handle];
            id = null;
          }
        }
        if (!id) {
          const existing = await client.request<{
            pages: { nodes: { id: string; handle: string }[] };
          }>(Q.PAGE_LOOKUP_QUERY, { query: `handle:${p.handle}` });
          const other = existing.pages.nodes.find((n) => n.handle === p.handle);
          if (other) {
            linkPages.set(p.handle, other.id);
            notes.push(`kept your existing "${p.handle}" page`);
            if (dry)
              plan(
                `Keep your existing page "${p.handle}" (not created by StoreForge); menus will link to it`,
              );
            continue;
          }
        }
        if (dry) {
          plan(
            `${id ? "Update" : "Create hidden"} page "${p.title}" (handle ${p.handle}) (${id ? "pageUpdate" : "pageCreate"})`,
          );
          continue;
        }
        if (id) {
          const data = await client.request<{
            pageUpdate: {
              page: { id: string } | null;
              userErrors: { field: string[] | null; message: string; code: string | null }[];
            };
          }>(Q.PAGE_UPDATE, { id, page: { title: p.title, body: p.bodyHtml } });
          assertNoUserErrors("pageUpdate", data.pageUpdate.userErrors);
        } else {
          const data = await client.request<{
            pageCreate: {
              page: { id: string } | null;
              userErrors: { field: string[] | null; message: string; code: string | null }[];
            };
          }>(Q.PAGE_CREATE, {
            page: { title: p.title, handle: p.handle, body: p.bodyHtml, isPublished: false },
          });
          assertNoUserErrors("pageCreate", data.pageCreate.userErrors);
          id = data.pageCreate.page!.id;
          resources.pageIds[p.handle] = id;
        }
        linkPages.set(p.handle, id);
        ids.push(id);
      } catch (err) {
        errors.push(`${p.title}: ${errorText(err)}`);
      }
    }
    finish("pages", {
      status: errors.length ? "failed" : dry ? "planned" : "succeeded",
      resourceIds: ids,
      errors,
      detail: dry
        ? `${pages.length} page${pages.length === 1 ? "" : "s"}`
        : `${ids.length} page${ids.length === 1 ? "" : "s"} saved as hidden (make them visible in Online Store → Pages when ready)${notes.length ? `; ${notes.join("; ")}` : ""}.`,
    });
    await save("pages");
  }

  // ---------- 7. policies ----------
  // Shop policies need the read/write_legal_policies scopes. Without them the policies are
  // created as hidden pages instead (spec: "use shopPolicyUpdate if available, otherwise pages").
  if (selected.has("policies")) {
    const policies = content.pages.filter((p) => p.kind === "policy" && POLICY_TYPES[p.handle]);
    const errors: string[] = [];
    const ids: string[] = [];
    let mode: "policies" | "pages" = "policies";
    let existing = new Map<string, { id: string; body: string }>();
    try {
      const data = await client.request<{
        shop: { shopPolicies: { id: string; type: string; body: string }[] };
      }>(Q.SHOP_POLICIES_QUERY);
      existing = new Map(data.shop.shopPolicies.map((p) => [p.type, { id: p.id, body: p.body }]));
    } catch (err) {
      if (err instanceof ShopifyError && err.code === "ACCESS_DENIED") mode = "pages";
      else errors.push(errorText(err));
    }
    const asPage = async (p: StoreContent["pages"][number]) => {
      let id: string | null = resources.pageIds[p.handle] ?? null;
      if (id) {
        const found = await client.request<{ page: { id: string } | null }>(Q.PAGE_BY_ID_QUERY, {
          id,
        });
        if (!found.page) id = null;
      }
      if (id) {
        const data = await client.request<{
          pageUpdate: {
            page: { id: string } | null;
            userErrors: { field: string[] | null; message: string; code: string | null }[];
          };
        }>(Q.PAGE_UPDATE, { id, page: { title: p.title, body: p.bodyHtml } });
        assertNoUserErrors("pageUpdate", data.pageUpdate.userErrors);
      } else {
        const data = await client.request<{
          pageCreate: {
            page: { id: string } | null;
            userErrors: { field: string[] | null; message: string; code: string | null }[];
          };
        }>(Q.PAGE_CREATE, {
          page: { title: p.title, handle: p.handle, body: p.bodyHtml, isPublished: false },
        });
        assertNoUserErrors("pageCreate", data.pageCreate.userErrors);
        id = data.pageCreate.page!.id;
      }
      resources.pageIds[p.handle] = id;
      linkPages.set(p.handle, id);
      return id;
    };
    if (!errors.length) {
      for (const p of policies) {
        const type = POLICY_TYPES[p.handle]!;
        if (dry) {
          plan(
            mode === "policies"
              ? `${existing.get(type)?.body.trim() ? "Replace your current" : "Add the"} ${p.title.toLowerCase()} in Settings → Policies (shopPolicyUpdate, ${type}). Policies are public as soon as they're saved`
              : `Create a hidden page "${p.title}" (pageCreate). The token lacks the legal-policies scopes, so it can't go in Settings → Policies`,
          );
          continue;
        }
        try {
          if (mode === "pages") {
            ids.push(await asPage(p));
            continue;
          }
          const data = await client.request<{
            shopPolicyUpdate: {
              shopPolicy: { id: string } | null;
              userErrors: { field: string[] | null; message: string; code: string | null }[];
            };
          }>(Q.SHOP_POLICY_UPDATE, { shopPolicy: { type, body: p.bodyHtml } });
          assertNoUserErrors("shopPolicyUpdate", data.shopPolicyUpdate.userErrors);
          const id = data.shopPolicyUpdate.shopPolicy?.id;
          if (id) {
            resources.policyIds[p.handle] = id;
            ids.push(id);
          }
        } catch (err) {
          errors.push(`${p.title}: ${errorText(err)}`);
        }
      }
    }
    finish("policies", {
      status: errors.length ? "failed" : dry ? "planned" : "succeeded",
      resourceIds: ids,
      errors,
      detail:
        mode === "pages"
          ? `Saved as hidden pages because the access token lacks read_legal_policies/write_legal_policies. Add those scopes to put them in Settings → Policies. Have a lawyer review them.`
          : dry
            ? `${policies.length} polic${policies.length === 1 ? "y" : "ies"} in Settings → Policies`
            : `${ids.length} polic${ids.length === 1 ? "y" : "ies"} saved in Settings → Policies. Have a lawyer review them.`,
    });
    await save("policies");
  }

  // ---------- 8. menus ----------
  if (selected.has("menus")) {
    const toItem = (m: MenuItem) => {
      const http = { title: m.title, type: "HTTP", url: m.url };
      switch (m.type) {
        case "FRONTPAGE":
          return { title: m.title, type: "FRONTPAGE", url: "/" };
        case "SEARCH":
          return { title: m.title, type: "SEARCH", url: "/search" };
        case "PAGE": {
          const id = m.handle ? linkPages.get(m.handle) : undefined;
          return id ? { title: m.title, type: "PAGE", resourceId: id } : http;
        }
        case "COLLECTION": {
          const id = m.handle && m.handle !== "all" ? linkCollections.get(m.handle) : undefined;
          return id ? { title: m.title, type: "COLLECTION", resourceId: id } : http;
        }
        case "SHOP_POLICY": {
          const id = m.handle ? resources.policyIds[m.handle] : undefined;
          if (id) return { title: m.title, type: "SHOP_POLICY", resourceId: id };
          // Policies saved as pages (no legal-policies scope) are linked as pages.
          const page = m.handle ? linkPages.get(m.handle) : undefined;
          return page ? { title: m.title, type: "PAGE", resourceId: page } : http;
        }
        default:
          return http;
      }
    };
    const menus = [
      { handle: "main-menu", title: "Main menu", items: content.menus.main },
      { handle: "footer", title: "Footer menu", items: content.menus.footer },
    ];
    const errors: string[] = [];
    const ids: string[] = [];
    try {
      const data = await client.request<{
        menus: { nodes: { id: string; handle: string; title: string }[] };
      }>(Q.MENUS_QUERY);
      for (const menu of menus) {
        const found = data.menus.nodes.find((n) => n.handle === menu.handle);
        if (dry) {
          plan(
            `${found ? `Replace the items in your "${found.title}"` : `Create "${menu.title}"`} menu (${menu.handle}): ${menu.items.map((i) => i.title).join(", ")} (${found ? "menuUpdate" : "menuCreate"})`,
          );
          continue;
        }
        try {
          const items = menu.items.map(toItem);
          if (found) {
            const res = await client.request<{
              menuUpdate: {
                menu: { id: string } | null;
                userErrors: { field: string[] | null; message: string; code: string | null }[];
              };
            }>(Q.MENU_UPDATE, { id: found.id, title: found.title, items });
            assertNoUserErrors("menuUpdate", res.menuUpdate.userErrors);
            resources.menuIds[menu.handle] = found.id;
            ids.push(found.id);
          } else {
            const res = await client.request<{
              menuCreate: {
                menu: { id: string } | null;
                userErrors: { field: string[] | null; message: string; code: string | null }[];
              };
            }>(Q.MENU_CREATE, { title: menu.title, handle: menu.handle, items });
            assertNoUserErrors("menuCreate", res.menuCreate.userErrors);
            resources.menuIds[menu.handle] = res.menuCreate.menu!.id;
            ids.push(res.menuCreate.menu!.id);
          }
        } catch (err) {
          errors.push(`${menu.title}: ${errorText(err)}`);
        }
      }
    } catch (err) {
      errors.push(errorText(err));
    }
    finish("menus", {
      status: errors.length ? "failed" : dry ? "planned" : "succeeded",
      resourceIds: ids,
      errors,
      detail: dry ? "Main menu and footer menu" : `Main menu and footer menu updated.`,
    });
    await save("menus");
  }

  // ---------- 9. theme (opt-in) ----------
  if (selected.has("theme")) {
    const themeName = `${input.storeName} (StoreForge)`.slice(0, 50);
    const source = opts.themeSourceUrl ?? DEFAULT_DAWN_SOURCE;
    try {
      if (!input.themeFiles) throw new ShopifyError("The theme files couldn't be built.");
      type Theme = {
        id: string;
        name: string;
        role: string;
        processing: boolean;
        processingFailed: boolean;
      };
      const getTheme = async (id: string) =>
        (await client.request<{ theme: Theme | null }>(Q.THEME_QUERY, { id })).theme;
      const editable = (t: Theme | null) =>
        Boolean(t && (t.role === "UNPUBLISHED" || t.role === "DEVELOPMENT"));
      let target: Theme | null = null;
      if (opts.themeId) {
        target = await getTheme(opts.themeId);
        if (!target) throw new ShopifyError("The chosen theme no longer exists. Pick another one.");
        if (!editable(target)) {
          throw new ShopifyError(
            `"${target.name}" is your live theme. StoreForge only writes to unpublished themes.`,
          );
        }
      } else if (resources.themeId) {
        const t = await getTheme(resources.themeId);
        if (editable(t)) target = t;
      }
      const files = Object.entries(input.themeFiles).map(([filename, value]) => ({
        filename,
        body: { type: "TEXT", value },
      }));
      if (dry) {
        plan(
          target
            ? `Write ${files.length} theme files (${files.map((f) => f.filename).join(", ")}) into the unpublished theme "${target.name}" (themeFilesUpsert). Your live theme isn't touched`
            : `Install a new unpublished copy of Dawn named "${themeName}" from ${source} (themeCreate), then write ${files.length} theme files into it (themeFilesUpsert). Your live theme isn't touched`,
        );
        finish("theme", {
          status: "planned",
          detail: target ? `Into "${target.name}"` : `New unpublished theme "${themeName}"`,
        });
      } else {
        if (!target) {
          const created = await client.request<{
            themeCreate: {
              theme: Theme | null;
              userErrors: { field: string[] | null; message: string; code: string | null }[];
            };
          }>(Q.THEME_CREATE, { source, name: themeName });
          assertNoUserErrors("themeCreate", created.themeCreate.userErrors);
          target = created.themeCreate.theme!;
          resources.themeId = target.id;
          await save("theme");
          const poll = opts.themePoll ?? { intervalMs: 5000, attempts: 36 };
          for (let i = 0; i < poll.attempts && target.processing; i++) {
            await sleep(poll.intervalMs);
            target = (await getTheme(target.id)) ?? target;
            if (target.processingFailed) break;
          }
          if (target.processingFailed) {
            throw new ShopifyError(
              `Shopify couldn't install Dawn from ${source}. Duplicate Dawn in Online Store → Themes, run the dry run again and pick that copy.`,
            );
          }
          if (target.processing) {
            throw new ShopifyError(
              "Shopify is still installing the theme. Retry this step in a minute.",
            );
          }
        }
        if (!editable(target)) throw new ShopifyError("Refusing to write to a published theme.");
        const res = await client.request<{
          themeFilesUpsert: {
            upsertedThemeFiles: { filename: string }[] | null;
            userErrors: { filename: string | null; message: string; code: string | null }[];
          };
        }>(Q.THEME_FILES_UPSERT, { themeId: target.id, files });
        assertNoUserErrors(
          "themeFilesUpsert",
          res.themeFilesUpsert.userErrors.map((e) => ({
            field: e.filename ? [e.filename] : null,
            message: e.message,
            code: e.code,
          })),
        );
        resources.themeId = target.id;
        finish("theme", {
          status: "succeeded",
          resourceIds: [target.id],
          detail: `${files.length} files written to the unpublished theme "${target.name}". Preview it in Online Store → Themes before publishing.`,
        });
      }
    } catch (err) {
      finish("theme", { status: "failed", errors: [errorText(err)] });
    }
    await save("theme");
  }

  result.finishedAt = new Date().toISOString();
  if (
    !dry &&
    result.resources &&
    Object.keys(result.resources.policyIds).length &&
    stepOf("policies").status === "succeeded"
  ) {
    result.warnings.push(
      "Store policies are public as soon as they're saved. Fill every placeholder and have them reviewed.",
    );
  }
  return result;
}

/** Shopify admin link for a product GID on a store. */
export function adminProductUrl(domain: string, productId: string) {
  const store = domain.replace(/\.myshopify\.com$/, "");
  const num = productId.split("/").pop();
  return `https://admin.shopify.com/store/${store}/products/${num}`;
}
