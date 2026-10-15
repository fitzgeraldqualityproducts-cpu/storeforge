import "server-only";
import path from "node:path";
import { dataDir } from "@/lib/config";

const ID_RE = /^[a-zA-Z0-9-]{1,64}$/;
const FILE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/;

export class PathTraversalError extends Error {
  constructor() {
    super("Invalid path");
    this.name = "PathTraversalError";
  }
}

export function assertSafeId(id: string): string {
  if (!ID_RE.test(id)) throw new PathTraversalError();
  return id;
}

export function assertSafeFileName(name: string): string {
  if (!FILE_RE.test(name) || name.includes("..")) throw new PathTraversalError();
  return name;
}

/** Resolve `parts` under `root` and guarantee the result stays inside root. */
export function safeJoin(root: string, ...parts: string[]): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...parts);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new PathTraversalError();
  }
  return target;
}

export function projectDir(projectId: string, ...parts: string[]) {
  return safeJoin(dataDir("projects"), assertSafeId(projectId), ...parts);
}

export function exportsDir(...parts: string[]) {
  return safeJoin(dataDir("exports"), ...parts);
}

/** Convert an absolute path inside the data dir to a portable relative path for storage. */
export function toDataRelative(abs: string) {
  return path.relative(dataDir(), abs).split(path.sep).join("/");
}

export function fromDataRelative(rel: string) {
  return safeJoin(dataDir(), ...rel.split("/"));
}
