import { EventEmitter } from "node:events";
import type { JobEvent } from "@/lib/schemas";

const g = globalThis as unknown as { __storeforgeBus?: EventEmitter };

/** Process-wide event bus used to fan job progress out to SSE subscribers. */
export const bus: EventEmitter = g.__storeforgeBus ?? new EventEmitter();
bus.setMaxListeners(500);
g.__storeforgeBus = bus;

export function emitProjectEvent(projectId: string, event: JobEvent) {
  bus.emit(`project:${projectId}`, event);
}

export function subscribeProject(projectId: string, fn: (e: JobEvent) => void) {
  const key = `project:${projectId}`;
  bus.on(key, fn);
  return () => bus.off(key, fn);
}
