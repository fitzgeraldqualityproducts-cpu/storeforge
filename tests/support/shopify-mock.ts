/**
 * An in-memory stand-in for the Shopify Admin GraphQL API, used through an injected `fetch`.
 * It understands the operations StoreForge sends (matched by operation name), keeps products,
 * pages, collections, menus, policies and themes in memory, and can simulate throttling,
 * missing scopes and userErrors. Responses mirror the shapes of the real API.
 */

type Json = Record<string, unknown>;

interface MockVariant {
  id: string;
  sku: string | null;
  selectedOptions: { name: string; value: string }[];
  inventoryItem: { id: string };
  file: string | null;
}
interface MockProduct {
  id: string;
  handle: string;
  title: string;
  status: string;
  input: Json;
  media: { id: string; alt: string | null; source: string }[];
  variants: MockVariant[];
}

export interface MockShopifyOptions {
  shopName?: string;
  currency?: string;
  /** Respond THROTTLED to the first N GraphQL requests. */
  throttleFirst?: number;
  /** Policies query/mutation fail with ACCESS_DENIED (token lacks legal-policies scopes). */
  noPolicyScope?: boolean;
  /** Return userErrors for pageCreate this many times. */
  pageCreateErrors?: number;
  /** HTTP status to return for every GraphQL call (e.g. 401). */
  httpStatus?: number;
  /** themeCreate: polls before processing finishes, and whether it fails. */
  themeProcessingPolls?: number;
  themeFails?: boolean;
}

export function createMockShopify(opts: MockShopifyOptions = {}) {
  let seq = 1000;
  const gid = (type: string) => `gid://shopify/${type}/${++seq}`;
  const state = {
    products: [] as MockProduct[],
    collections: [] as { id: string; handle: string; input: Json }[],
    pages: [] as {
      id: string;
      handle: string;
      title: string;
      body: string;
      isPublished: boolean;
    }[],
    policies: new Map<string, { id: string; body: string }>(),
    menus: [
      { id: "gid://shopify/Menu/1", handle: "main-menu", title: "Main menu", items: [] as Json[] },
      { id: "gid://shopify/Menu/2", handle: "footer", title: "Footer menu", items: [] as Json[] },
    ],
    themes: [
      {
        id: "gid://shopify/OnlineStoreTheme/1",
        name: "Dawn",
        role: "MAIN",
        polls: 0,
        files: {} as Record<string, string>,
      },
      {
        id: "gid://shopify/OnlineStoreTheme/2",
        name: "Dawn copy",
        role: "UNPUBLISHED",
        polls: 0,
        files: {} as Record<string, string>,
      },
    ],
    inventory: new Map<string, number>(),
    uploads: [] as { url: string; fileName: string; bytes: number }[],
    staged: 0,
  };
  const calls: { operation: string; variables: Json; headers: Record<string, string> }[] = [];
  let throttleLeft = opts.throttleFirst ?? 0;
  let pageErrorsLeft = opts.pageCreateErrors ?? 0;

  const cost = (available = 1900) => ({
    requestedQueryCost: 50,
    actualQueryCost: 20,
    throttleStatus: { maximumAvailable: 2000, currentlyAvailable: available, restoreRate: 100 },
  });
  const ok = (data: Json) => ({ data, extensions: { cost: cost() } });
  const denied = (field: string) => ({
    data: null,
    errors: [
      {
        message: `Access denied for ${field} field. Required access: \`read_legal_policies\` access scope.`,
        extensions: { code: "ACCESS_DENIED" },
      },
    ],
  });

  const productView = (p: MockProduct) => ({
    id: p.id,
    handle: p.handle,
    title: p.title,
    status: p.status,
    media: { nodes: p.media.map((m) => ({ id: m.id, alt: m.alt })) },
    variants: {
      nodes: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        selectedOptions: v.selectedOptions,
        inventoryItem: v.inventoryItem,
      })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  });

  const findProduct = (identifier: Json) =>
    state.products.find((p) =>
      identifier.id ? p.id === identifier.id : p.handle === identifier.handle,
    ) ?? null;

  function productSet(vars: Json) {
    const input = vars.input as Json;
    const identifier = vars.identifier as Json | null;
    let product = identifier ? findProduct(identifier) : null;
    if (identifier?.id && !product) {
      return {
        productSet: {
          product: null,
          userErrors: [
            {
              field: ["identifier"],
              message: "Product does not exist",
              code: "PRODUCT_DOES_NOT_EXIST",
            },
          ],
        },
      };
    }
    if (!product) {
      if (state.products.some((p) => p.handle === input.handle)) {
        return {
          productSet: {
            product: null,
            userErrors: [
              {
                field: ["input", "handle"],
                message: "Handle has already been taken",
                code: "TAKEN",
              },
            ],
          },
        };
      }
      product = {
        id: gid("Product"),
        handle: String(input.handle),
        title: String(input.title),
        status: String(input.status ?? "ACTIVE"),
        input: {},
        media: [],
        variants: [],
      };
      state.products.push(product);
    }
    if (input.title) product.title = String(input.title);
    if (input.status) product.status = String(input.status);
    product.input = { ...product.input, ...input };
    if (Array.isArray(input.files)) {
      product.media = (input.files as Json[]).map((f) => {
        if (f.id) {
          const existing = product!.media.find((m) => m.id === f.id);
          if (!existing) throw new Error(`File ${String(f.id)} not on product`);
          return { ...existing, alt: (f.alt as string) ?? existing.alt };
        }
        return {
          id: gid("MediaImage"),
          alt: (f.alt as string) ?? null,
          source: String(f.originalSource),
        };
      });
    }
    if (Array.isArray(input.variants)) {
      product.variants = (input.variants as Json[]).map((v) => {
        const existing = v.id ? product!.variants.find((x) => x.id === v.id) : undefined;
        const file = (v.file as Json | undefined)?.id as string | undefined;
        if (file && !product!.media.some((m) => m.id === file))
          throw new Error("variant file not on product");
        return {
          id: existing?.id ?? gid("ProductVariant"),
          sku: (v.sku as string) ?? null,
          selectedOptions: (v.optionValues as Json[]).map((o) => ({
            name: String(o.optionName),
            value: String(o.name),
          })),
          inventoryItem: existing?.inventoryItem ?? { id: gid("InventoryItem") },
          file: file ?? existing?.file ?? null,
        };
      });
    }
    return { productSet: { product: productView(product), userErrors: [] } };
  }

  function handle(operation: string, vars: Json): unknown {
    switch (operation) {
      case "StoreForgeVerify":
        return ok({
          shop: {
            name: opts.shopName ?? "Mock Store",
            myshopifyDomain: "mock-store.myshopify.com",
          },
        });
      case "StoreForgeShop":
        return ok({
          shop: {
            name: opts.shopName ?? "Mock Store",
            myshopifyDomain: "mock-store.myshopify.com",
            currencyCode: opts.currency ?? "USD",
          },
          location: { id: "gid://shopify/Location/1", name: "Shop location" },
          themes: {
            nodes: state.themes
              .filter((t) => t.role !== "MAIN")
              .map(({ id, name, role }) => ({ id, name, role })),
          },
        });
      case "StoreForgeProduct": {
        const p = findProduct(vars.identifier as Json);
        return ok({ productByIdentifier: p ? productView(p) : null });
      }
      case "StoreForgeVariants":
        return ok({ product: null });
      case "StoreForgeStagedUploads":
        return ok({
          stagedUploadsCreate: {
            stagedTargets: (vars.input as Json[]).map(() => {
              const n = ++state.staged;
              return {
                url: `https://shopify-staged-uploads.storage.googleapis.com/mock-${n}`,
                resourceUrl: `https://shopify-staged-uploads.storage.googleapis.com/tmp/mock-${n}`,
                parameters: [{ name: "key", value: `tmp/mock-${n}` }],
              };
            }),
            userErrors: [],
          },
        });
      case "StoreForgeProductSet":
        return ok(productSet(vars));
      case "StoreForgeInventory": {
        const input = vars.input as Json;
        if (!vars.key) throw new Error("missing @idempotent key");
        for (const q of input.quantities as Json[]) {
          if (!("changeFromQuantity" in q)) throw new Error("changeFromQuantity is required");
          state.inventory.set(String(q.inventoryItemId), Number(q.quantity));
        }
        return ok({
          inventorySetQuantities: {
            inventoryAdjustmentGroup: { id: gid("InventoryAdjustmentGroup") },
            userErrors: [],
          },
        });
      }
      case "StoreForgeCollection": {
        const id = (vars.identifier as Json).id;
        const h = (vars.identifier as Json).handle;
        const c = state.collections.find((x) => (id ? x.id === id : x.handle === h));
        return ok({
          collectionByIdentifier: c
            ? { id: c.id, handle: c.handle, ruleSet: c.input.ruleSet ?? null }
            : null,
        });
      }
      case "StoreForgeCollectionCreate": {
        const input = vars.input as Json;
        const c = { id: gid("Collection"), handle: String(input.handle), input };
        state.collections.push(c);
        return ok({
          collectionCreate: { collection: { id: c.id, handle: c.handle }, userErrors: [] },
        });
      }
      case "StoreForgeCollectionUpdate": {
        const input = vars.input as Json;
        const c = state.collections.find((x) => x.id === input.id)!;
        c.input = { ...c.input, ...input };
        return ok({
          collectionUpdate: { collection: { id: c.id, handle: c.handle }, userErrors: [] },
        });
      }
      case "StoreForgePage": {
        const h = String(vars.query).replace(/^handle:/, "");
        return ok({
          pages: {
            nodes: state.pages
              .filter((p) => p.handle === h)
              .map(({ id, handle }) => ({ id, handle })),
          },
        });
      }
      case "StoreForgePageById": {
        const p = state.pages.find((x) => x.id === vars.id);
        return ok({ page: p ? { id: p.id, handle: p.handle } : null });
      }
      case "StoreForgePageCreate": {
        const page = vars.page as Json;
        if (pageErrorsLeft > 0) {
          pageErrorsLeft--;
          return ok({
            pageCreate: {
              page: null,
              userErrors: [
                { field: ["page", "body"], message: "Body is invalid", code: "INVALID" },
              ],
            },
          });
        }
        const p = {
          id: gid("Page"),
          handle: String(page.handle),
          title: String(page.title),
          body: String(page.body),
          isPublished: Boolean(page.isPublished),
        };
        state.pages.push(p);
        return ok({ pageCreate: { page: { id: p.id, handle: p.handle }, userErrors: [] } });
      }
      case "StoreForgePageUpdate": {
        const p = state.pages.find((x) => x.id === vars.id)!;
        const page = vars.page as Json;
        Object.assign(p, { title: page.title ?? p.title, body: page.body ?? p.body });
        return ok({ pageUpdate: { page: { id: p.id, handle: p.handle }, userErrors: [] } });
      }
      case "StoreForgePolicies":
        if (opts.noPolicyScope) return denied("shopPolicies");
        return ok({
          shop: {
            shopPolicies: [...state.policies].map(([type, p]) => ({
              id: p.id,
              type,
              body: p.body,
            })),
          },
        });
      case "StoreForgePolicy": {
        if (opts.noPolicyScope) return denied("shopPolicyUpdate");
        const sp = vars.shopPolicy as Json;
        const existing = state.policies.get(String(sp.type));
        const id = existing?.id ?? gid("ShopPolicy");
        state.policies.set(String(sp.type), { id, body: String(sp.body) });
        return ok({ shopPolicyUpdate: { shopPolicy: { id, type: sp.type }, userErrors: [] } });
      }
      case "StoreForgeMenus":
        return ok({
          menus: { nodes: state.menus.map(({ id, handle, title }) => ({ id, handle, title })) },
        });
      case "StoreForgeMenuUpdate": {
        const m = state.menus.find((x) => x.id === vars.id)!;
        m.items = vars.items as Json[];
        return ok({ menuUpdate: { menu: { id: m.id, handle: m.handle }, userErrors: [] } });
      }
      case "StoreForgeMenuCreate": {
        const m = {
          id: gid("Menu"),
          handle: String(vars.handle),
          title: String(vars.title),
          items: vars.items as Json[],
        };
        state.menus.push(m);
        return ok({ menuCreate: { menu: { id: m.id, handle: m.handle }, userErrors: [] } });
      }
      case "StoreForgeTheme": {
        const t = state.themes.find((x) => x.id === vars.id);
        if (!t) return ok({ theme: null });
        t.polls++;
        const processing = t.polls <= (opts.themeProcessingPolls ?? 0) && !opts.themeFails;
        return ok({
          theme: {
            id: t.id,
            name: t.name,
            role: t.role,
            processing,
            processingFailed: Boolean(opts.themeFails),
          },
        });
      }
      case "StoreForgeThemeCreate": {
        const t = {
          id: gid("OnlineStoreTheme"),
          name: String(vars.name),
          role: "UNPUBLISHED",
          polls: 0,
          files: {},
        };
        state.themes.push(t);
        return ok({
          themeCreate: {
            theme: { id: t.id, name: t.name, role: t.role, processing: true },
            userErrors: [],
          },
        });
      }
      case "StoreForgeThemeFiles": {
        const t = state.themes.find((x) => x.id === vars.themeId)!;
        if (t.role === "MAIN") throw new Error("wrote to the live theme");
        for (const f of vars.files as Json[])
          t.files[String(f.filename)] = String((f.body as Json).value);
        return ok({
          themeFilesUpsert: {
            upsertedThemeFiles: (vars.files as Json[]).map((f) => ({ filename: f.filename })),
            userErrors: [],
          },
        });
      }
      default:
        throw new Error(`Mock Shopify: unknown operation ${operation}`);
    }
  }

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://shopify-staged-uploads.storage.googleapis.com/")) {
      const form = init?.body as FormData;
      const file = form.get("file") as File;
      state.uploads.push({ url, fileName: file.name, bytes: file.size });
      return new Response(null, { status: 201 });
    }
    if (
      !/^https:\/\/[a-z0-9-]+\.myshopify\.com\/admin\/api\/\d{4}-\d{2}\/graphql\.json$/.test(url)
    ) {
      throw new Error(`Mock Shopify: unexpected URL ${url}`);
    }
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Json };
    const operation = body.query.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? "anonymous";
    calls.push({ operation, variables: body.variables, headers });
    if (opts.httpStatus) return new Response("{}", { status: opts.httpStatus });
    if (throttleLeft > 0) {
      throttleLeft--;
      return Response.json({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: { cost: cost(10) },
      });
    }
    return Response.json(handle(operation, body.variables));
  }) as typeof fetch;

  const mutations = () =>
    calls.filter(
      (c) =>
        !/^StoreForge(Shop|Product|Variants|Collection|Page|PageById|Policies|Menus|Theme|Verify)$/.test(
          c.operation,
        ),
    );

  return { fetch: fetchImpl, state, calls, mutations };
}
