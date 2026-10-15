import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/config";

const g = globalThis as unknown as { __storeforgeAnthropic?: { key: string; client: Anthropic } };

/** Shared Anthropic client. The SDK retries 429/5xx/connection errors with backoff. */
export function anthropic(): Anthropic {
  const key = env().ANTHROPIC_API_KEY ?? "";
  if (g.__storeforgeAnthropic?.key !== key) {
    g.__storeforgeAnthropic = {
      key,
      client: new Anthropic({ apiKey: key, maxRetries: 3, timeout: 180_000 }),
    };
  }
  return g.__storeforgeAnthropic.client;
}
