import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resetEnvCache } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { listAssets } from "@/lib/db/assets";
import { createProject, getProject, updateProject } from "@/lib/db/projects";
import { UserFacingError } from "@/lib/errors";
import { ingestImage } from "@/lib/images/ingest";
import type { JobContext } from "@/lib/jobs/runner";
import { runAnalyze } from "@/lib/pipeline/analyze";
import { parseProductHtml } from "@/lib/scrape/parse";
import { SourceExtraction } from "@/lib/schemas";

// Scripted fake of the Anthropic client: each call to messages.stream().finalMessage() returns
// the next queued response and records the request.
const fake = vi.hoisted(() => ({
  queue: [] as unknown[],
  requests: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/ai/client", () => ({
  anthropic: () => ({
    messages: {
      stream: (req: Record<string, unknown>) => {
        fake.requests.push(structuredClone(req));
        return {
          finalMessage: async () => {
            const next = fake.queue.shift();
            if (!next) throw new Error("no scripted response");
            return next;
          },
        };
      },
    },
  }),
}));

import { AiOutputError, callStructured, toolSchema } from "@/lib/ai/structured";

const usage = { input_tokens: 100, output_tokens: 50 };
const toolMsg = (input: unknown, id = "tu_1") => ({
  role: "assistant",
  stop_reason: "tool_use",
  usage,
  content: [{ type: "tool_use", id, name: "record_thing", input }],
});
const Thing = z.object({ title: z.string().max(20), count: z.number().int() });
const base = {
  task: "test",
  system: "You are a test.",
  content: [{ type: "text" as const, text: "Make a thing" }],
  schema: Thing,
  toolName: "record_thing",
  toolDescription: "Record it",
  fixture: () => ({ title: "fixture", count: 1 }),
};

describe("callStructured (live path with a scripted client)", () => {
  beforeEach(() => {
    process.env.AI_MODE = "live";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    resetEnvCache();
    fake.queue.length = 0;
    fake.requests.length = 0;
  });
  afterEach(() => {
    process.env.AI_MODE = "fixture";
    process.env.ANTHROPIC_API_KEY = "";
    resetEnvCache();
  });

  it("builds a tool from the Zod schema and returns validated output", async () => {
    fake.queue.push(toolMsg({ title: "Hello", count: 2 }));
    await expect(callStructured(base)).resolves.toEqual({ title: "Hello", count: 2 });
    const req = fake.requests[0]!;
    expect(req.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    const tools = req.tools as { name: string; input_schema: Record<string, unknown> }[];
    expect(tools[0]!.name).toBe("record_thing");
    expect(tools[0]!.input_schema.type).toBe("object");
    expect(tools[0]!.input_schema.$schema).toBeUndefined();
    expect(String(req.system)).toContain("record_thing");
  });

  it("feeds schema errors back and retries until valid", async () => {
    fake.queue.push(
      toolMsg({ title: "x".repeat(40), count: 1.5 }, "tu_a"),
      toolMsg({ title: "Fixed", count: 3 }, "tu_b"),
    );
    await expect(callStructured(base)).resolves.toEqual({ title: "Fixed", count: 3 });
    const retry = fake.requests[1]!.messages as { role: string; content: unknown }[];
    expect(retry).toHaveLength(3);
    const toolResult = (
      retry[2]!.content as {
        type: string;
        tool_use_id: string;
        is_error: boolean;
        content: string;
      }[]
    )[0]!;
    expect(toolResult.type).toBe("tool_result");
    expect(toolResult.tool_use_id).toBe("tu_a");
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toMatch(/title/);
    expect(toolResult.content).toMatch(/count/);
    const call = await prisma.aiCall.findFirst({
      where: { task: "test", success: true },
      orderBy: { createdAt: "desc" },
    });
    expect(call?.attempts).toBe(2);
    expect(call?.inputTokens).toBe(200);
  });

  it("gives up after 3 invalid attempts with a user-visible error", async () => {
    fake.queue.push(toolMsg({ title: 1 }), toolMsg({ title: 2 }), toolMsg({ title: 3 }));
    const err = await callStructured(base).catch((e) => e);
    expect(err).toBeInstanceOf(AiOutputError);
    expect(err).toBeInstanceOf(UserFacingError);
    expect(fake.requests).toHaveLength(3);
  });

  it("retries when the model answers without calling the tool", async () => {
    fake.queue.push(
      {
        role: "assistant",
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "Here you go" }],
      },
      toolMsg({ title: "Ok", count: 1 }),
    );
    await expect(callStructured(base)).resolves.toEqual({ title: "Ok", count: 1 });
    const second = fake.requests[1]!.messages as { content: { type: string; text?: string }[] }[];
    expect(second[2]!.content[0]!.text).toMatch(/didn't call/);
  });

  it("runs the semantic check (guardrails) as part of validation", async () => {
    fake.queue.push(
      toolMsg({ title: "Only 3 left!", count: 1 }),
      toolMsg({ title: "In stock", count: 1 }),
    );
    const out = await callStructured({
      ...base,
      check: (v) => (/only \d+ left/i.test(v.title) ? ["- title: fake urgency"] : []),
    });
    expect(out.title).toBe("In stock");
  });

  it("stops immediately on a refusal", async () => {
    fake.queue.push({ role: "assistant", stop_reason: "refusal", usage, content: [] });
    await expect(callStructured(base)).rejects.toThrow(/declined/);
    expect(fake.requests).toHaveLength(1);
  });

  it("explains a missing API key instead of crashing", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    resetEnvCache();
    await expect(callStructured(base)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("fixture mode", () => {
  it("returns schema-validated fixture output and logs the call", async () => {
    await expect(callStructured({ ...base, task: "fixture-test" })).resolves.toEqual({
      title: "fixture",
      count: 1,
    });
    const call = await prisma.aiCall.findFirst({ where: { task: "fixture-test" } });
    expect(call?.mode).toBe("fixture");
  });

  it("emits JSON schemas the API accepts for every tool", () => {
    const s = toolSchema(
      z.object({ a: z.enum(["x", "y"]), b: z.array(z.string()).max(3), c: z.number().default(1) }),
    );
    expect(s.type).toBe("object");
    expect(s.required).toEqual(["a", "b"]);
  });
});

describe("analysis step (fixture mode)", () => {
  it("stores analysis, per-image findings and rule + AI risk flags", async () => {
    const p = await createProject("Analyze");
    const html = readFileSync(path.join(__dirname, "../fixtures/site/product.html"), "utf8");
    const parsed = parseProductHtml(html, "https://shop.example/product.html");
    const extraction = SourceExtraction.parse({
      ...parsed,
      url: "https://shop.example/product.html",
      sourceDomain: "shop.example",
      fetchMethod: "static",
      fetchedAt: new Date().toISOString(),
    });
    await updateProject(p.id, {
      inputs: {
        urls: ["https://shop.example/product.html"],
        context: (await getProject(p.id)).inputs.context,
      },
      extractions: [extraction],
    });
    for (const n of [1, 2, 3]) {
      await ingestImage(
        p.id,
        readFileSync(path.join(__dirname, `../fixtures/site/images/dripper-${n}.jpg`)),
        { origin: "scraped", sourceUrl: `https://shop.example/${n}.jpg` },
      );
    }
    const ctx: JobContext = {
      jobId: "t",
      projectId: p.id,
      type: "analyze",
      payload: {},
      progress: async () => undefined,
    };
    const res = await runAnalyze(ctx);
    const project = await getProject(p.id);
    const a = project.analysis!;
    expect(a.productName).toBe("Stoneware Pour-Over Coffee Dripper");
    expect(project.steps.analysis.status).toBe("ready");
    const cats = a.riskFlags.map((f) => f.category);
    expect(cats).toContain("trademark"); // "Hario V60"
    expect(cats.filter((c) => c === "claims")).toHaveLength(1); // "#1", "best-selling" grouped
    expect(cats).toContain("copyright"); // scraped images
    expect(res.flags).toBe(a.riskFlags.length);
    const assets = await listAssets(p.id);
    expect(assets.every((x) => x.altText.length > 0 && x.role)).toBe(true);

    // Acknowledgements survive a re-run.
    const first = a.riskFlags.find((f) => f.category === "trademark")!;
    await updateProject(p.id, {
      analysis: {
        ...a,
        riskFlags: a.riskFlags.map((f) => (f.id === first.id ? { ...f, acknowledged: true } : f)),
      },
    });
    await runAnalyze(ctx);
    expect(
      (await getProject(p.id)).analysis!.riskFlags.find((f) => f.id === first.id)?.acknowledged,
    ).toBe(true);
  });

  it("fails with a helpful message when there is nothing to analyse", async () => {
    const p = await createProject("Empty");
    const ctx: JobContext = {
      jobId: "t",
      projectId: p.id,
      type: "analyze",
      payload: {},
      progress: async () => undefined,
    };
    await expect(runAnalyze(ctx)).rejects.toThrow(/Upload a few product photos/);
  });
});
