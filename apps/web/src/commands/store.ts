import type { CommandResult } from "@routiq/contracts";

/**
 * ADR-0001: the UI renders server truth plus explicit pending state — never
 * an optimistically patched cache. This store is the single source for a
 * submission's true state; the offline outbox later adds a `queued` state
 * and persists entries without changing this vocabulary.
 */
export type CommandStatus =
  | { state: "submitting" }
  | { state: "committed"; outcome: CommandResult }
  | { state: "rejected"; code: string; metadata?: Record<string, unknown> };

type Listener = () => void;

export class CommandStatusStore {
  private statuses = new Map<string, CommandStatus>();
  private listeners = new Set<Listener>();

  get(commandId: string): CommandStatus | undefined {
    return this.statuses.get(commandId);
  }

  /** Stable reference between transitions — safe for useSyncExternalStore. */
  getSnapshot(): ReadonlyMap<string, CommandStatus> {
    return this.statuses;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  markSubmitting(commandId: string): void {
    this.transition(commandId, { state: "submitting" });
  }

  markCommitted(commandId: string, outcome: CommandResult): void {
    this.transition(commandId, { state: "committed", outcome });
  }

  markRejected(commandId: string, code: string, metadata?: Record<string, unknown>): void {
    this.transition(commandId, {
      state: "rejected",
      code,
      ...(metadata === undefined ? {} : { metadata }),
    });
  }

  private transition(commandId: string, status: CommandStatus): void {
    this.statuses = new Map(this.statuses).set(commandId, status);
    for (const listener of this.listeners) listener();
  }
}
