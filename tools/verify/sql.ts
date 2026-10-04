/**
 * First of two read-only layers for `pnpm verify db`. The second is the session
 * itself: psql runs with default_transaction_read_only=on, so a write that slips
 * past this check still fails in Postgres.
 */

const READ_STARTS = new Set(["select", "with", "table", "values", "show", "explain"]);

const WRITE_WORDS = [
  "insert",
  "update",
  "delete",
  "merge",
  "truncate",
  "drop",
  "alter",
  "create",
  "grant",
  "revoke",
  "copy",
  "call",
  "do",
  "lock",
  "vacuum",
  "analyze",
  "refresh",
  "reindex",
  "cluster",
  "into",
  "execute",
  "prepare",
  "listen",
  "notify",
  "discard",
  "set",
  "reset",
  "comment",
  "security",
];

const SIDE_EFFECT_FUNCTIONS =
  /\b(pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|set_config|nextval|setval|dblink\w*|lo_\w+|pg_advisory\w*)\s*\(/i;

/** Removes comments, string literals and quoted identifiers so keywords inside them don't count. */
export function stripSqlNoise(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      out += " ";
    } else if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
    } else if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch && sql[j + 1] === ch) j += 2;
        else if (sql[j] === ch) break;
        else j += 1;
      }
      i = j + 1;
      out += ch === "'" ? " '' " : ' "" ';
    } else if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
      if (tag === undefined) {
        out += ch;
        i += 1;
      } else {
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? sql.length : end + tag.length;
        out += " '' ";
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

export type ReadOnlyVerdict = { ok: true; sql: string } | { ok: false; reason: string };

export function checkReadOnlySql(input: string): ReadOnlyVerdict {
  const sql = input.trim().replace(/;\s*$/, "");
  if (sql === "") return { ok: false, reason: "empty query" };
  const bare = stripSqlNoise(sql).toLowerCase();
  if (bare.includes(";")) return { ok: false, reason: "one statement only" };
  const first = /^\s*\(*\s*([a-z]+)/.exec(bare)?.[1];
  if (first === undefined || !READ_STARTS.has(first)) {
    return { ok: false, reason: `only SELECT, WITH, TABLE, VALUES, SHOW or EXPLAIN may run, got "${first ?? sql.slice(0, 20)}"` };
  }
  const word = WRITE_WORDS.find((w) => new RegExp(`\\b${w}\\b`).test(bare));
  if (word !== undefined) return { ok: false, reason: `"${word.toUpperCase()}" is not allowed in a read-only query` };
  const fn = SIDE_EFFECT_FUNCTIONS.exec(bare)?.[1];
  if (fn !== undefined) return { ok: false, reason: `${fn}() has side effects` };
  return { ok: true, sql };
}
