import type { z } from "zod";
import type { CommandEnvelope } from "@asset/contracts";
import type { AuthContext } from "../auth/types.js";

/** Server-derived actor context, resolved by the auth layer — never client-supplied. */
export type CommandContext = AuthContext;

export interface CommandOutcome {
  commandId: string;
  recordId?: string;
  version?: number;
  warnings: string[];
}

export interface CommandDefinition<P> {
  name: string;
  version: number;
  payloadSchema: z.ZodType<P>;
  /** Runs inside one transaction: validate invariants, write records + audit. */
  execute(ctx: CommandContext, envelope: CommandEnvelope, payload: P): Promise<CommandOutcome>;
}

const registry = new Map<string, CommandDefinition<unknown>>();

export function registerCommand<P>(def: CommandDefinition<P>): void {
  const key = `${def.name}.v${def.version}`;
  if (registry.has(key)) throw new Error(`duplicate command registration: ${key}`);
  registry.set(key, def as CommandDefinition<unknown>);
}

export function resolveCommand(name: string, version: number): CommandDefinition<unknown> {
  const def = registry.get(`${name}.v${version}`);
  if (!def) throw new Error(`unknown command: ${name}.v${version}`);
  return def;
}

export function listCommands(): string[] {
  return [...registry.keys()].sort();
}
