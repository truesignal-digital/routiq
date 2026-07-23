/**
 * Sessions are stored keyed by workspace+username — never one global blob —
 * so shared-device fast-switching can land later (offline spec) without a
 * storage redesign, and same-named users in different tenants never evict
 * each other. Expired sessions keep the identity around: the login screen
 * re-prompts PIN only, username and workspace prefilled.
 */
export interface Identity {
  username: string;
  workspaceSlug: string;
}

export interface StoredSession extends Identity {
  token: string;
  expiresAt: string;
}

interface PersistedShape {
  sessions: Record<string, StoredSession>;
  activeKey?: string;
  lastIdentity?: Identity;
}

const STORAGE_KEY = "asset.sessions.v1";

function keyOf({ workspaceSlug, username }: Identity): string {
  return `${workspaceSlug}:${username}`;
}

type Listener = () => void;

export class SessionStore {
  private state: PersistedShape;
  private listeners = new Set<Listener>();

  constructor(private storage: Storage) {
    this.state = readPersisted(storage);
  }

  getSession(identity: Identity): StoredSession | undefined {
    return this.state.sessions[keyOf(identity)];
  }

  getActive(): StoredSession | undefined {
    const { activeKey } = this.state;
    if (activeKey === undefined) return undefined;
    const session = this.state.sessions[activeKey];
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return undefined;
    return session;
  }

  getToken(): string | undefined {
    return this.getActive()?.token;
  }

  /** Last-used identity for prefilling login — survives logout and expiry. */
  getLastIdentity(): Identity | undefined {
    return this.state.lastIdentity;
  }

  save(session: StoredSession): void {
    this.state = {
      sessions: { ...this.state.sessions, [keyOf(session)]: session },
      activeKey: keyOf(session),
      lastIdentity: { username: session.username, workspaceSlug: session.workspaceSlug },
    };
    this.persist();
  }

  logout(identity: Identity): void {
    const sessions = { ...this.state.sessions };
    delete sessions[keyOf(identity)];
    this.state = {
      sessions,
      ...(this.state.activeKey === keyOf(identity) ? {} : { activeKey: this.state.activeKey }),
      ...(this.state.lastIdentity === undefined ? {} : { lastIdentity: this.state.lastIdentity }),
    };
    this.persist();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    for (const listener of this.listeners) listener();
  }
}

function readPersisted(storage: Storage): PersistedShape {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return { sessions: {} };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { sessions: {} };
    const shape = parsed as PersistedShape;
    return {
      sessions: shape.sessions ?? {},
      ...(shape.activeKey === undefined ? {} : { activeKey: shape.activeKey }),
      ...(shape.lastIdentity === undefined ? {} : { lastIdentity: shape.lastIdentity }),
    };
  } catch {
    return { sessions: {} };
  }
}
