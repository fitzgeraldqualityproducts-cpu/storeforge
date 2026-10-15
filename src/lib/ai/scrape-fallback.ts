import "server-only";
import { z } from "zod";
import type { LlmFallback } from "@/lib/scrape";
import { SCRAPE_FALLBACK_SYSTEM } from "./prompts/scrape-fallback";
import { callStructured } from "./structured";

const FallbackOutput = z.object({
  isProductPage: z.boolean(),
  title: z.string().max(300).nullable(),
  description: z.string().max(2000).nullable(),
  price: z.number().nonnegative().nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  brand: z.string().max(120).nullable(),
  sku: z.string().max(120).nullable(),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()).min(1) })).max(3),
  specs: z.array(z.object({ key: z.string(), value: z.string() })).max(40),
  shippingInfo: z.string().max(500).nullable(),
});

/** Vision/LLM extraction used by the scraper when structured parsing came up thin. */
export function llmScrapeFallback(projectId: string | null): LlmFallback {
  return async ({ url, text, screenshot }) => {
    const out = await callStructured({
      task: "scrapeFallback",
      projectId,
      system: SCRAPE_FALLBACK_SYSTEM,
      content: [
        ...(screenshot
          ? [
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: "image/jpeg" as const,
                  data: screenshot.toString("base64"),
                },
              },
            ]
          : []),
        {
          type: "text",
          text: `URL: ${url}\n<source>\n${text}\n</source>\n\nExtract the product data.`,
        },
      ],
      schema: FallbackOutput,
      toolName: "record_page_product",
      toolDescription: "Record the product fields found on the page.",
      maxTokens: 4000,
      effort: "low",
      // Offline mode has no model to read the page, so it reports nothing rather than inventing data.
      fixture: () => ({
        isProductPage: false,
        title: null,
        description: null,
        price: null,
        currency: null,
        brand: null,
        sku: null,
        options: [],
        specs: [],
        shippingInfo: null,
      }),
    });
    if (!out.isProductPage && !out.title) return null;
    return {
      title: out.title,
      description: out.description,
      price: out.price != null ? { amount: out.price, currency: out.currency ?? "USD" } : null,
      brand: out.brand,
      sku: out.sku,
      options: out.options,
      specs: Object.fromEntries(out.specs.map((s) => [s.key, s.value])),
      shippingInfo: out.shippingInfo,
    };
  };
}
