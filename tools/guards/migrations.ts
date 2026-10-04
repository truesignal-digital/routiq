import type { SourceFile, Violation } from "./scan.js";

export const MIGRATIONS_DIR = "apps/api/drizzle";
export const JOURNAL = `${MIGRATIONS_DIR}/meta/_journal.json`;
/** Where guards.test.ts puts develop's journal, read with `git show`, so M2 can compare against it. */
export const BASE_JOURNAL = `@base/${JOURNAL}`;

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const SQL = new RegExp(`^${MIGRATIONS_DIR}/((\\d{4})_[^/]+)\\.sql$`);
const SNAPSHOT = new RegExp(`^${MIGRATIONS_DIR}/meta/(\\d{4})_snapshot\\.json$`);

function entriesOf(journal: SourceFile): JournalEntry[] {
  return (JSON.parse(journal.content) as { entries: JournalEntry[] }).entries;
}

/** The journal line that names a tag, so a violation points at the entry to fix. */
function lineOf(journal: SourceFile, tag: string): number {
  const index = journal.content.split("\n").findIndex((line) => line.includes(`"${tag}"`));
  return index === -1 ? 1 : index + 1;
}

/**
 * drizzle's migrator runs journal entries in order and skips any whose `when`
 * is not later than the last migration the database applied, so a reused
 * number or an old `when` silently never runs on a deployed box.
 */
export function migrationIntegrity(files: readonly SourceFile[]): Violation[] {
  const journal = files.find((file) => file.path === JOURNAL);
  if (journal === undefined) return [];
  const entries = entriesOf(journal);
  const violations: Violation[] = [];
  const at = (tag: string, text: string) => violations.push({ path: JOURNAL, line: lineOf(journal, tag), text });

  const sqlFiles = files.flatMap((file) => {
    const match = SQL.exec(file.path);
    return match?.[1] === undefined || match[2] === undefined ? [] : [{ path: file.path, tag: match[1], number: match[2] }];
  });
  const byNumber = new Map<string, string[]>();
  for (const { number, tag } of sqlFiles) byNumber.set(number, [...(byNumber.get(number) ?? []), tag]);
  for (const [number, tags] of byNumber) {
    if (tags.length > 1) {
      for (const { path } of sqlFiles.filter((sql) => sql.number === number)) {
        violations.push({ path, line: 1, text: `migration number ${number} is used by ${tags.join(", ")}` });
      }
    }
  }

  const tags = new Set(entries.map((entry) => entry.tag));
  for (const { path, tag } of sqlFiles) {
    if (!tags.has(tag)) violations.push({ path, line: 1, text: `${tag} has no entry in meta/_journal.json` });
  }
  const sqlTags = new Set(sqlFiles.map((sql) => sql.tag));

  entries.forEach((entry, position) => {
    const number = String(entry.idx).padStart(4, "0");
    if (entry.idx !== position) at(entry.tag, `entry ${position} has idx ${entry.idx}`);
    if (!entry.tag.startsWith(`${number}_`)) at(entry.tag, `idx ${entry.idx} has tag ${entry.tag}`);
    if (!sqlTags.has(entry.tag)) at(entry.tag, `${entry.tag}.sql does not exist`);
    const previous = entries[position - 1];
    if (previous !== undefined && entry.when <= previous.when) {
      at(entry.tag, `${entry.tag} has when ${entry.when}, not later than ${previous.tag} (${previous.when})`);
    }
  });

  const numbers = new Set(entries.map((entry) => String(entry.idx).padStart(4, "0")));
  const snapshots = files
    .flatMap((file) => {
      const number = SNAPSHOT.exec(file.path)?.[1];
      return number === undefined ? [] : [{ file, number }];
    })
    .sort((a, b) => a.number.localeCompare(b.number));
  let previousId: string | undefined;
  for (const { file, number } of snapshots) {
    if (!numbers.has(number)) {
      violations.push({ path: file.path, line: 1, text: `snapshot ${number} has no journal entry` });
    }
    const { id, prevId } = JSON.parse(file.content) as { id: string; prevId: string };
    if (previousId !== undefined && prevId !== previousId) {
      violations.push({ path: file.path, line: 1, text: `prevId ${prevId} is not the previous snapshot's id ${previousId}` });
    }
    previousId = id;
  }

  return violations;
}

/** Fails when develop already holds a different migration at a number this branch uses. */
export function migrationsBehindBase(files: readonly SourceFile[]): Violation[] {
  const journal = files.find((file) => file.path === JOURNAL);
  const base = files.find((file) => file.path === BASE_JOURNAL);
  if (journal === undefined || base === undefined) return [];
  const ours = new Map(entriesOf(journal).map((entry) => [entry.idx, entry.tag]));
  return entriesOf(base).flatMap((theirs) => {
    const tag = ours.get(theirs.idx);
    if (tag === undefined || tag === theirs.tag) return [];
    return [{ path: JOURNAL, line: lineOf(journal, tag), text: `develop has ${theirs.tag} at ${theirs.idx}, this branch has ${tag}` }];
  });
}
