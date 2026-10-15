import "server-only";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { UserFacingError } from "@/lib/errors";
import { log } from "@/lib/log";
import { anthropic } from "./client";

type ContentBlock = Anthropic.Messages.ContentBlockParam;

export class AiUnavailableError extends UserFacingError {
  constructor() {
    super(
      "AI generation isn't configured. Add ANTHROPIC_API_KEY to .env.local and restart (or set AI_MODE=fixture for offline demo output).",
    );
    this.name = "AiUnavailableError";
  }
}

export class AiOutputError extends UserFacingError {
  constructor(task: string, detail: string) {
    super(`The AI couldn't produce a valid ${task} after 3 attempts. ${detail}`.trim());
    this.name = "AiOutputError";
  }
}

export interface StructuredCall<T> {
  /** Task name for logs and the AiCall table, e.g. "analyzeProductImages". */
  task: string;
  projectId?: string | null;
  system: string;
  content: ContentBlock[];
  schema: z.ZodType<T>;
  toolName: string;
  toolDescription: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** Extra semantic checks (guardrails, lengths). Return human-readable problems to retry. */
  check?: (value: T) => string[];
  /** Deterministic output for AI_MODE=fixture (tests and offline demos). */
  fixture: () => T | Promise<T>;
}

export const MAX_ATTEMPTS = 3; // first try + 2 retries with the validation error fed back

/** Zod → JSON Schema for the tool's input_schema (draft 2020-12 minus the $schema key). */
export function toolSchema(schema: z.ZodType): Anthropic.Messages.Tool.InputSchema {
  const js = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  delete js.$schema;
  if (js.type !== "object") throw new Error("Tool schemas must be objects");
  return js as Anthropic.Messages.Tool.InputSchema;
}

function formatZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 15)
    .map((i) => `- ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("\n");
}

async function record(data: {
  task: string;
  projectId?: string | null;
  model: string;
  mode: "live" | "fixture";
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  attempts: number;
  success: boolean;
  error?: string | null;
}) {
  try {
    await prisma.aiCall.create({
      data: {
        id: randomUUID(),
        task: data.task,
        projectId: data.projectId ?? null,
        model: data.model,
        mode: data.mode,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        latencyMs: data.latencyMs,
        attempts: data.attempts,
        success: data.success,
        error: data.error?.slice(0, 2000) ?? null,
      },
    });
  } catch (err) {
    log.warn("ai.record_failed", { task: data.task, error: err });
  }
}

/**
 * Ask Claude for structured output through a single tool whose input schema is generated from
 * the Zod schema. The response is validated with Zod (plus `check`), and on failure the error
 * is sent back as a tool_result so the model can correct itself (max 2 retries).
 *
 * Forced tool_choice isn't available on current Claude models, so the tool is offered with
 * tool_choice "auto" and the system prompt says to call it; a reply without the call counts as
 * a failed attempt.
 */
export async function callStructured<T>(c: StructuredCall<T>): Promise<T> {
  const e = env();
  const started = Date.now();

  if (e.AI_MODE === "fixture") {
    const value = c.schema.parse(await c.fixture());
    await record({
      task: c.task,
      projectId: c.projectId,
      model: "fixture",
      mode: "fixture",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - started,
      attempts: 1,
      success: true,
    });
    return value;
  }
  if (!e.ANTHROPIC_API_KEY) throw new AiUnavailableError();

  const client = anthropic();
  const model = e.ANTHROPIC_MODEL;
  const tool: Anthropic.Messages.Tool = {
    name: c.toolName,
    description: c.toolDescription,
    input_schema: toolSchema(c.schema),
  };
  const system = `${c.system}\n\nReturn your answer by calling the \`${c.toolName}\` tool exactly once with the complete result. Do not reply with plain text.`;
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: c.content }];
  let inputTokens = 0;
  let outputTokens = 0;
  let lastProblem = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Anthropic.Messages.Message;
    try {
      res = await client.messages
        .stream({
          model,
          max_tokens: c.maxTokens ?? 16_000,
          system,
          tools: [tool],
          tool_choice: { type: "auto", disable_parallel_tool_use: true },
          output_config: { effort: c.effort ?? "medium" },
          messages,
        })
        .finalMessage();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await record({
        task: c.task,
        projectId: c.projectId,
        model,
        mode: "live",
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - started,
        attempts: attempt,
        success: false,
        error: msg,
      });
      log.error("ai.request_failed", { task: c.task, attempt, error: err });
      const status = (err as { status?: number }).status;
      if (status === 401)
        throw new UserFacingError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.");
      if (status === 404)
        throw new UserFacingError(
          `The model "${model}" isn't available to this API key. Check ANTHROPIC_MODEL.`,
        );
      throw new UserFacingError(
        `The AI service didn't respond (${status ? `HTTP ${status}` : "network error"}). Retry this step.`,
      );
    }
    inputTokens += res.usage.input_tokens;
    outputTokens += res.usage.output_tokens;

    if (res.stop_reason === "refusal") {
      await record({
        task: c.task,
        projectId: c.projectId,
        model,
        mode: "live",
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - started,
        attempts: attempt,
        success: false,
        error: "refusal",
      });
      throw new UserFacingError(
        "The AI declined this request under its usage policies. Check the product and inputs (restricted products can trigger this), then edit and retry.",
      );
    }

    const call = res.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use" && b.name === c.toolName,
    );
    let problem: string;
    if (!call) {
      problem =
        res.stop_reason === "max_tokens"
          ? "Your reply was cut off before the tool call finished. Be more concise."
          : `You didn't call the \`${c.toolName}\` tool. Call it now with the complete result.`;
    } else if (res.stop_reason === "max_tokens") {
      problem =
        "The tool input was cut off (output limit). Call the tool again with more concise content.";
    } else {
      const parsed = c.schema.safeParse(call.input);
      if (parsed.success) {
        const issues = c.check?.(parsed.data) ?? [];
        if (!issues.length) {
          await record({
            task: c.task,
            projectId: c.projectId,
            model,
            mode: "live",
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - started,
            attempts: attempt,
            success: true,
          });
          return parsed.data;
        }
        problem = `The content breaks these rules:\n${issues.join("\n")}`;
      } else {
        problem = `The tool input didn't match the schema:\n${formatZodError(parsed.error)}`;
      }
    }
    lastProblem = problem;
    log.warn("ai.retry", { task: c.task, attempt, problem: problem.slice(0, 500) });
    // Feed the problem back. Assistant content (including thinking blocks) is passed back unchanged.
    messages.push({ role: "assistant", content: res.content });
    const fix = `${problem}\n\nFix every problem and call \`${c.toolName}\` again with the full corrected result.`;
    messages.push({
      role: "user",
      content: call
        ? [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: fix }]
        : [{ type: "text", text: fix }],
    });
  }

  await record({
    task: c.task,
    projectId: c.projectId,
    model,
    mode: "live",
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - started,
    attempts: MAX_ATTEMPTS,
    success: false,
    error: lastProblem,
  });
  throw new AiOutputError(c.task, lastProblem.split("\n").slice(0, 4).join(" "));
}
