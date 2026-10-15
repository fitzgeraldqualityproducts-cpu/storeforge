import "server-only";
import { registerHandler } from "./runner";

/** Registers every job type's handler. Called once when the runner starts. */
export function registerAllHandlers() {
  void registerHandler;
}
