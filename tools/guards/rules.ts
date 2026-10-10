import { migrationIntegrity, migrationsBehindBase } from "./migrations.js";
import { moduleBoundaryViolations } from "./module-boundaries.js";
import { isTestFile, matchFile, matchLines, type SourceFile, type Violation } from "./scan.js";
import { unsafeSqlConstruction } from "./sql.js";

/**
 * A rule is a mistake that must not spread. Ids match the rule table in
 * docs/audits/2026-09-25-trust-audit.md. Existing violations live in
 * baselines.json and may only shrink; see guards.test.ts.
 */
export interface Rule {
  id: string;
  name: string;
  /** What to do instead, shown next to every violation. */
  fix: string;
  check(files: readonly SourceFile[]): Violation[];
}

const SOURCE = /^(apps\/(api|web)\/src|apps\/api\/scripts|packages\/(contracts|domain)\/src)\/.+\.tsx?$/;

const isSource = (path: string) => SOURCE.test(path);
const isProductionSource = (path: string) => isSource(path) && !isTestFile(path);
const isWebProduction = (path: string) => path.startsWith("apps/web/src/") && isProductionSource(path);
const isApiProduction = (path: string) => path.startsWith("apps/api/src/") && isProductionSource(path);
const isPackageManifest = (path: string) => /(^|\/)package\.json$/.test(path);

function linesMatching(
  pattern: RegExp,
  where: (path: string) => boolean,
): (files: readonly SourceFile[]) => Violation[] {
  return (files) => files.filter((file) => where(file.path)).flatMap((file) => matchLines(file, pattern));
}

/** Dependencies pinned to an exact version on purpose (ARCHITECTURE.md §8). They may move, but never to a range. */
const PINNED = [
  "@aws-sdk/client-s3",
  "@aws-sdk/s3-request-presigner",
  "@sentry/node",
  "@tanstack/react-table",
  "@testcontainers/postgresql",
  "drizzle-kit",
  "drizzle-orm",
  "file-type",
  "recharts",
  "sharp",
  "testcontainers",
];

/** Direct writes are allowed only where the command pipeline or schema setup owns the transaction. */
const WRITE_OWNERS = [
  "apps/api/src/commands/",
  "apps/api/src/provisioning/",
  "apps/api/src/db/",
  "apps/api/src/test/",
  // Sessions and credentials are authentication state, not business records.
  "apps/api/src/auth/local.ts",
];

function schemaTables(files: readonly SourceFile[]): string[] {
  const schema = files.find((file) => file.path === "apps/api/src/db/schema.ts");
  if (schema === undefined) return [];
  return [...schema.content.matchAll(/export const (\w+) = pgTable\(/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** Drizzle export name → SQL table name, from schema.ts. */
function schemaTableNames(files: readonly SourceFile[]): Map<string, string> {
  const schema = files.find((file) => file.path === "apps/api/src/db/schema.ts");
  if (schema === undefined) return new Map();
  return new Map(
    [...schema.content.matchAll(/export const (\w+) = pgTable\(\s*"(\w+)"/g)].flatMap((match) =>
      match[1] === undefined || match[2] === undefined ? [] : [[match[1], match[2]] as const],
    ),
  );
}

const APPEND_ONLY_INVENTORY = "apps/api/src/db/append-only.ts";

/**
 * The one documented code path for each write an append-only table still
 * takes (apps/api/src/db/append-only.ts says which columns and why). Adding a
 * row here is a design change: say so in the PR and point at the grant.
 */
const APPEND_ONLY_WRITERS: readonly { path: string; table: string; op: "update" | "delete"; why: string }[] = [
  {
    path: "apps/api/src/commands/activity-legs.ts",
    table: "meterReadings",
    op: "update",
    why: "links a superseded reading to the one that corrects it (superseded_by_id, supersede_reason)",
  },
  {
    path: "apps/api/src/commands/entry-decisions.ts",
    table: "financialPostings",
    op: "update",
    why: "stamps posting_period_id on a pending entry's lines when it is approved",
  },
  {
    path: "apps/api/src/commands/update-pending-entry.ts",
    table: "financialPostings",
    op: "update",
    why: "re-stamps posting_period_id when the author moves a pending entry's date",
  },
  {
    path: "apps/api/src/commands/update-pending-entry.ts",
    table: "financialPostings",
    op: "delete",
    why: "replaces a pending entry's lines (#85); trigger financial_postings_pending_delete refuses any other delete (0034)",
  },
  {
    path: "apps/api/scripts/seed-demo.ts",
    table: "*",
    op: "delete",
    why: "seed-demo --reset wipes the demo workspace as the database owner, never as routiq_app",
  },
];

/**
 * The forms a centred dialog may host (#296): a decision on an existing
 * record, with at most a reason. Approve, reject and reverse an entry; the
 * work-order decisions and cancel; dismiss and resolve a problem; release to
 * service; close and reopen a trip; deactivate a branch or a user, reset a
 * PIN; lock and reopen a period; discard. A name here is the JSX element
 * that sets `surface="dialog"` or the component that renders it.
 */
const DECISION_SURFACES: ReadonlySet<string> = new Set([
  "ApproveEntryForm",
  "RejectEntryForm",
  "ReverseEntryForm",
  "WorkOrderDecisionForm",
  "CancelWorkOrderForm",
  "IssueDecisionForm",
  "IssueSeverityForm",
  "ReleaseForm",
  "CloseTripDialog",
  "ReopenTripDialog",
  "BranchActionDialog",
  "MemberActionDialog",
  "PeriodDecisionDialog",
  "DiscardDialog",
]);

function dialogSurfacesOutsideDecisions(file: SourceFile): Violation[] {
  const code = withoutComments(file.content);
  const lines = file.content.split("\n");
  return [...code.matchAll(/\bsurface\s*[=:]\s*\{?\s*["'`]dialog["'`]/g)].flatMap((match) => {
    const before = code.slice(0, match.index);
    const tag = [...before.matchAll(/<([A-Z]\w*)/g)].at(-1)?.[1];
    const component = [...before.matchAll(/function\s+([A-Z]\w*)/g)].at(-1)?.[1];
    if ((tag !== undefined && DECISION_SURFACES.has(tag)) || (component !== undefined && DECISION_SURFACES.has(component))) {
      return [];
    }
    const line = before.split("\n").length;
    return [{ path: file.path, line, text: (lines[line - 1] ?? "").trim() }];
  });
}

/** Whole-line `//` comments and block comments that open a line, blanked with their line breaks kept. */
function withoutComments(content: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return content
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

function lineAt(file: SourceFile, index: number): Violation {
  const line = file.content.slice(0, index).split("\n").length;
  return { path: file.path, line, text: (file.content.split("\n")[line - 1] ?? "").trim() };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A27. Drizzle `.update(t)` / `.delete(t)`, with `t` imported under another
 * name or reached through a namespace (`schema.notes`), and raw SQL that
 * updates, deletes from or truncates the table, by name or as `${t}`. Limit: a
 * table object handed through a variable, or a table name assembled at run
 * time, is not visible here. The runtime role's grants refuse those writes in
 * the database (db/grants.test.ts, db/append-only.test.ts).
 */
function appendOnlyWrites(files: readonly SourceFile[]): Violation[] {
  const names = schemaTableNames(files);
  if (names.size === 0) return [];
  const inventory = files.find((file) => file.path === APPEND_ONLY_INVENTORY);
  const block = inventory && /APPEND_ONLY_TABLES = \{([\s\S]*?)\n\} as const/.exec(inventory.content)?.[1];
  if (inventory === undefined || block === undefined) {
    return [{ path: APPEND_ONLY_INVENTORY, line: 1, text: "APPEND_ONLY_TABLES not found; the append-only guard has no tables to protect" }];
  }
  const tables = [...block.matchAll(/^\s+(\w+): \{/gm)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
  const unknown = tables.filter((table) => !names.has(table));
  if (tables.length === 0 || unknown.length > 0) {
    return [{ path: APPEND_ONLY_INVENTORY, line: 1, text: `not a schema.ts table: ${unknown.join(", ") || "(none listed)"}` }];
  }

  const sanctioned = (path: string, table: string, op: "update" | "delete") =>
    APPEND_ONLY_WRITERS.some(
      (writer) => writer.path === path && writer.op === op && (writer.table === "*" || writer.table === table),
    );

  return files
    .filter((file) => isProductionSource(file.path) && file.path.startsWith("apps/api/"))
    .flatMap((file) => {
      const code = withoutComments(file.content);
      const aliases = new Map(tables.map((table) => [table, table]));
      for (const imported of code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*\/schema(?:\.js)?["']/g)) {
        for (const spec of (imported[1] ?? "").split(",")) {
          const [name, alias] = spec.trim().split(/\s+as\s+/);
          if (name !== undefined && alias !== undefined && tables.includes(name)) aliases.set(alias, name);
        }
      }
      const identifiers = [...aliases.keys()].map(escapeRegExp).join("|");
      const sqlNames = new Map(tables.map((table) => [names.get(table) ?? table, table]));
      const sqlNamePattern = [...sqlNames.keys()].map(escapeRegExp).join("|");

      const found: { index: number; table: string; op: "update" | "delete" }[] = [];
      for (const match of code.matchAll(new RegExp(`\\.(update|delete)\\(\\s*(?:\\w+\\.)?(${identifiers})\\s*[,)]`, "g"))) {
        found.push({ index: match.index, table: aliases.get(match[2] ?? "") ?? "", op: match[1] === "update" ? "update" : "delete" });
      }
      const verb = String.raw`\b(update|delete\s+from|truncate(?:\s+table)?)\s+(?:only\s+)?`;
      for (const match of code.matchAll(new RegExp(`${verb}(?:"?public"?\\.)?"?(${sqlNamePattern})"?(?!\\w)`, "gi"))) {
        found.push({ index: match.index, table: sqlNames.get((match[2] ?? "").toLowerCase()) ?? "", op: /^update/i.test(match[1] ?? "") ? "update" : "delete" });
      }
      for (const match of code.matchAll(new RegExp(`${verb}\\$\\{\\s*(?:\\w+\\.)?(${identifiers})\\s*\\}`, "gi"))) {
        found.push({ index: match.index, table: aliases.get(match[2] ?? "") ?? "", op: /^update/i.test(match[1] ?? "") ? "update" : "delete" });
      }
      return found
        .filter(({ table, op }) => !sanctioned(file.path, table, op))
        .sort((a, b) => a.index - b.index)
        .map(({ index }) => lineAt(file, index));
    });
}

/**
 * An interactive element whose own tag sets a size below 44 px that applies on
 * a phone: a small Button/SelectTrigger size, or an unprefixed h-, min-h- or
 * size- class under 11. Prefixed classes (desktop:, md:) only apply on wider
 * screens. The tag ends at its first ">" that is not part of an arrow "=>".
 */
const SMALL_CONTROL =
  /<(?:Button|SelectTrigger|Input|TabsList|AlertDialogAction|AlertDialogCancel|Link|button|a|input|select|summary)\b(?:[^<>]|=>)*?(?:\bsize=["'](?:sm|icon-sm|xs|icon-xs)["']|(?<![\w:/[-])(?:min-h|h|size)-(?:[6-9]|10)(?![\w-]))/;

const CATALOG = /^apps\/web\/src\/i18n\/(locales|presets)\/[^/]+\.json$/;

/**
 * Where colours are defined (apps/web/DESIGN.md): the tokens in styles.css and
 * theme.ts's mirror of `--background` for <meta name="theme-color">, which
 * cannot read a CSS variable.
 */
const TOKEN_FILES = ["apps/web/src/styles.css", "apps/web/src/lib/theme.ts"];
/** The logo's geometry: mask cut-outs in pure black and white, and the wordmark's capitals. */
const BRAND = "apps/web/src/components/brand/";

const isWebStyled = (path: string) =>
  (isWebProduction(path) || /^apps\/web\/src\/.+\.css$/.test(path)) && !path.startsWith(BRAND);

/**
 * A hex colour where code writes one (after a quote, a Tailwind `[`, or a CSS
 * `prop:`), so an issue reference like "(#422)" is never a colour; and the CSS
 * colour functions.
 */
const COLOUR_LITERAL =
  /(?:["'`[]|:\s*)#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(/;
/** shadcn's chart selects recharts' own default strokes (`[stroke='#ccc']`) to restyle them with tokens. */
const RECHARTS_ATTRIBUTE_SELECTOR = /\[(?:stroke|fill)='[^']*'\]/g;

function colourLiterals(files: readonly SourceFile[]): Violation[] {
  return files
    .filter((file) => isWebStyled(file.path) && !TOKEN_FILES.includes(file.path))
    .flatMap((file) =>
      matchLines({ ...file, content: file.content.replace(RECHARTS_ATTRIBUTE_SELECTOR, "") }, COLOUR_LITERAL).map(
        (violation) => ({ ...violation, text: (file.content.split("\n")[violation.line - 1] ?? "").trim() }),
      ),
    );
}

/**
 * Each catalog key with its line, for the two-space JSON the catalogs are
 * written in: a key's path is the keys opened above it at shallower depths.
 */
function catalogKeys(file: SourceFile): { path: string; line: number; text: string }[] {
  const stack: string[] = [];
  return file.content.split("\n").flatMap((text, index) => {
    const match = /^( *)"([^"]+)":/.exec(text);
    if (match === null) return [];
    const depth = (match[1] ?? "").length / 2;
    stack.length = Math.max(depth - 1, 0);
    stack.push(match[2] ?? "");
    return [{ path: stack.join("."), line: index + 1, text: text.trim() }];
  });
}

const isWorkflow = (path: string) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);

/**
 * CI's image pulls, off Docker Hub's anonymous rate limit (#603): every
 * `image:` names its registry, and a workflow that runs the test suites tells
 * testcontainers to pull through the mirror.
 */
function dockerHubPulls(files: readonly SourceFile[]): Violation[] {
  return files.filter((file) => isWorkflow(file.path)).flatMap((file) => {
    // A first path segment with a dot or a port is a registry host; anything else resolves to Docker Hub.
    const bareImages = matchLines(file, /^\s*image:\s*["']?(?![\w.-]+[.:][\w.-]*\/)[\w.-]+(\/[\w.-]+)*(:[\w.-]+)?["']?\s*$/);
    const mirrored = /^\s*TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX:\s*\S/m.test(file.content);
    const testSteps = mirrored ? [] : matchLines(file, /\bpnpm\b.*\btest\b/);
    return [...bareImages, ...testSteps];
  });
}

export const RULES: readonly Rule[] = [
  {
    id: "A2",
    name: "single-lockfile",
    fix: "This is a pnpm workspace; delete the lockfile and use pnpm.",
    check: (files) =>
      files
        .filter((file) => /(^|\/)(package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(file.path))
        .map((file) => ({ path: file.path, line: 1, text: "foreign lockfile" })),
  },
  {
    id: "A7",
    name: "pinned-stay-pinned",
    fix: "Keep the exact version (no ^ or ~); bump it deliberately if you must.",
    check: (files) =>
      files.filter((file) => isPackageManifest(file.path)).flatMap((file) =>
        PINNED.flatMap((name) => {
          const match = new RegExp(`"${name.replace(/[/.]/g, "\\$&")}"\\s*:\\s*"([^"]+)"`).exec(file.content);
          const version = match?.[1];
          if (version === undefined || /^\d+\.\d+\.\d+$/.test(version)) return [];
          const line = file.content.slice(0, match?.index ?? 0).split("\n").length;
          return [{ path: file.path, line, text: `${name}: ${version}` }];
        }),
      ),
  },
  {
    id: "A9",
    name: "zod4-spellings",
    fix: "Use the Zod 4 top-level formats: z.uuid(), z.email(), z.url(), z.iso.datetime(), z.iso.date().",
    check: linesMatching(/z\.string\(\)\.(uuid|email|url|datetime|date|ip|cuid|base64)\(/, isSource),
  },
  {
    id: "A10",
    name: "tailwind-css-first",
    fix: "Tailwind 4 is configured in CSS (apps/web/src/styles.css); delete the config file.",
    check: (files) =>
      files
        .filter((file) => /^apps\/web\/tailwind\.config\./.test(file.path))
        .map((file) => ({ path: file.path, line: 1, text: "tailwind config file" })),
  },
  {
    id: "A12",
    name: "no-radix",
    fix: "The headless layer is Base UI (@base-ui/react); vendor the base-nova shadcn component instead.",
    check: linesMatching(
      /@radix-ui\//,
      (path) => isSource(path) || isPackageManifest(path) || path === "pnpm-lock.yaml",
    ),
  },
  {
    id: "A16",
    name: "writes-through-commands",
    fix: "Write through a registered command (apps/api/src/commands/); the dispatcher owns the transaction, receipt and audit event.",
    check: (files) => {
      const tables = schemaTables(files);
      if (tables.length === 0) return [];
      const write = new RegExp(`\\.(insert|update|delete)\\(\\s*(${tables.join("|")})\\s*\\)`);
      return linesMatching(
        write,
        (path) => isApiProduction(path) && !WRITE_OWNERS.some((owner) => path.startsWith(owner)),
      )(files);
    },
  },
  {
    id: "A27",
    name: "append-only-tables",
    fix: "Append-only rows are never edited or deleted (apps/api/src/db/append-only.ts): write a new row that supersedes, reverses or follows up the original. A new sanctioned path is a design change; it needs a grant in a migration and a row in APPEND_ONLY_WRITERS.",
    check: appendOnlyWrites,
  },
  {
    id: "A18",
    name: "named-command-routes",
    fix: "Call POST /v1/commands/:name (ADR-0002); the generic facade takes no new callers, tests included.",
    check: (files) => {
      const genericEndpoint = /["'`]\/v1\/commands["'`]/;
      return files
        .filter((file) => isSource(file.path) && file.path !== "apps/api/src/commands/routes.ts" && file.path !== "apps/api/src/server.ts")
        .flatMap((file) => {
          const lines = file.content.split('\n');
          const violations: Violation[] = [];
          lines.forEach((line, index) => {
            if (!genericEndpoint.test(line)) return;
            // Exception (a): bare string entry in a list
            if (/^\s*["'`]\/v1\/commands["'`]\s*,?\s*$/.test(line)) return;
            // Exception (b): GET registration on same line
            if (/\.get\(\s*["'`]\/v1\/commands/.test(line)) return;
            // Exception (c): method: "GET" within 3 preceding lines
            for (let j = Math.max(0, index - 3); j < index && j < lines.length; j++) {
              const prevLine = lines[j];
              if (prevLine && /method\s*:\s*["'`]GET["'`]/i.test(prevLine)) return;
            }
            violations.push({ path: file.path, line: index + 1, text: line });
          });
          return violations;
        });
    },
  },
  {
    id: "A24",
    name: "money-no-cents",
    fix: "XAF has exponent 0: amounts are whole minor units. Format with @routiq/domain (formatXAF).",
    check: linesMatching(
      /\b\w+Minor\s*[/*]\s*100\b|(?:amount|cost|total|balance|price)\w*.*\.toFixed\(2\)/i,
      isProductionSource,
    ),
  },
  {
    id: "A33a",
    name: "no-supabase",
    fix: "Business code stays portable to the on-prem appliance (§6a); no Supabase runtime features.",
    check: linesMatching(/@supabase\//, (path) => isSource(path) || isPackageManifest(path)),
  },
  {
    id: "A33b",
    name: "s3-only-in-storage",
    fix: "Go through apps/api/src/storage/; only that module talks to the S3 API.",
    check: linesMatching(
      /from\s+["']@aws-sdk\//,
      (path) => isApiProduction(path) && !path.startsWith("apps/api/src/storage/"),
    ),
  },
  {
    id: "A35",
    name: "no-ai-sdk",
    fix: "AI arrives later as a principal calling the same commands (§7); no provider SDK in application code.",
    check: linesMatching(
      /from\s+["'](openai|@anthropic-ai\/[^"']+|@google\/genai|@google\/generative-ai|ai|@ai-sdk\/[^"']+)["']/,
      isProductionSource,
    ),
  },
  {
    id: "A38",
    name: "no-sentence-concat",
    fix: "Put the whole sentence in the catalog with ICU arguments: t(\"key\", { name }).",
    check: linesMatching(/\bt\([^)]*\)\s*\+|\+\s*t\(/, isWebProduction),
  },
  {
    id: "E1",
    name: "components-registered",
    fix: "Add the file to apps/web/registry.json in the same change.",
    check: (files) => {
      const registry = files.find((file) => file.path === "apps/web/registry.json");
      if (registry === undefined) return [];
      const parsed = JSON.parse(registry.content) as { items: { files: { path: string }[] }[] };
      const registered = new Set(parsed.items.flatMap((item) => item.files.map((entry) => entry.path)));
      return files
        .filter(
          (file) =>
            /^apps\/web\/src\/components\/.+\.tsx?$/.test(file.path) &&
            !isTestFile(file.path) &&
            !registered.has(file.path.slice("apps/web/".length)),
        )
        .map((file) => ({ path: file.path, line: 1, text: "not listed in apps/web/registry.json" }));
    },
  },
  {
    id: "G1",
    name: "no-optimistic-cache",
    fix: "Render server truth plus the command's pending state (ADR-0001); never patch the query cache.",
    check: linesMatching(/\b(setQueryData|onMutate)\b/, isWebProduction),
  },
  {
    id: "C1",
    name: "ci-images-off-docker-hub",
    fix: "Anonymous Docker Hub pulls are rate-limited and failed every CI run for hours (#603). Pull through the mirror: `image: mirror.gcr.io/library/postgres:17` (or another registry host), and set `TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX: mirror.gcr.io` in the env of a workflow that runs the tests.",
    check: dockerHubPulls,
  },
  {
    id: "C2",
    name: "no-define-in-web-build",
    fix: "A value compiled in through Vite `define` (commit, date, build id) renames the chunk it lands in and every chunk importing it, so the JS size totals move with each commit (#598). Put it in index.html instead, as the `routiq-version` meta tag in apps/web/vite.config.ts does, and read it at run time.",
    check: linesMatching(/^\s*define\s*:/, (path) => /^apps\/[^/]+\/vite\.config\.[cm]?[jt]s$/.test(path)),
  },
  {
    id: "H6",
    name: "toast-through-notify",
    fix: "Use notifyCommandSuccess / notifyCommandError from lib/notify.ts.",
    check: linesMatching(
      /from\s+["'][^"']*components\/ui\/toast(\.js)?["']/,
      (path) =>
        isWebProduction(path) &&
        !path.startsWith("apps/web/src/components/ui/") &&
        path !== "apps/web/src/lib/notify.ts" &&
        path !== "apps/web/src/shell/AppShell.tsx",
    ),
  },
  {
    id: "H8",
    name: "tabs-height-on-list",
    fix: "Put the height on TabsList (44 px touch target), never min-h on TabsTrigger.",
    check: (files) =>
      files
        .filter((file) => isWebProduction(file.path) && file.path.endsWith(".tsx"))
        .flatMap((file) => matchFile(file, /<TabsTrigger\b[^>]*\bmin-h-/)),
  },
  {
    id: "H9",
    name: "no-native-date-inputs",
    fix: "Use DateField or DateTimeField from components/date-field.tsx (apps/web/AGENTS.md).",
    check: linesMatching(/\btype\s*=\s*\{?\s*["'`](date|datetime-local)["'`]/, isWebProduction),
  },
  {
    id: "H13",
    name: "touch-targets-44",
    fix: "Controls are 44 px on phone (#23): use the primitive's default size, or a desktop-only size (size=\"desktop-sm\", size=\"desktop-icon-sm\", className=\"desktop:h-9\") for a compact look on a wide screen with a mouse.",
    check: (files) =>
      files
        .filter(
          (file) =>
            isWebProduction(file.path) &&
            file.path.endsWith(".tsx") &&
            !file.path.startsWith("apps/web/src/components/ui/"),
        )
        .flatMap((file) => matchFile(file, SMALL_CONTROL)),
  },
  {
    id: "H12",
    name: "business-date-helper",
    fix: "Business days come from apps/api/src/reads/business-date.ts (workspace time zone).",
    check: linesMatching(
      /toISOString\(\)\.slice\(0,\s*10\)/,
      (path) => isProductionSource(path) && path !== "apps/api/src/reads/business-date.ts",
    ),
  },
  {
    id: "H14",
    name: "one-status-badge",
    fix: "Render the status through its domain's badge (e.g. finance/EntryStatusBadge.tsx); only that file maps the status to a tone.",
    check: linesMatching(
      // A *_TONE(S) constant, a Record from a status type to tones, or an inline tone={status === …}.
      /\b[A-Z][A-Z0-9_]*_TONES?\b|Record<[^,]*[Ss]tatus[^,]*,[^>]*([Tt]one|"(success|warning|info|danger|neutral)")|\btone=\{[^}]*\b(status|state)\s*[!=]==/,
      (path) => isWebProduction(path) && !/^apps\/web\/src\/[\w-]+\/[A-Z]\w*StatusBadge\.tsx$/.test(path),
    ),
  },
  {
    id: "H19",
    name: "no-bare-dash",
    fix: 'A missing value is said in words: notRecorded() from lib/format.ts, or <NotRecorded /> (components/not-recorded.tsx) with onAdd when the viewer may fill it (#306). A value the viewer may not read is left out. Never a bare "—". The one exception is MetricStrip\'s failed-read state.',
    check: (files) => {
      const scoped = files.filter(
        (file) => isWebProduction(file.path) && file.path !== "apps/web/src/components/metric-strip.tsx",
      );
      return [
        // "—" as a whole string literal.
        ...linesMatching(/(["'`])\u2014\1/, () => true)(scoped),
        // "—" as the whole text of a JSX element, or alone on a line as JSX
        // text: Prettier puts it there once the element wraps.
        ...scoped.flatMap((file) => matchFile(file, />\s*\u2014\s*<|^[ \t]*\u2014[ \t]*$/m)),
      ];
    },
  },
  {
    id: "H15",
    name: "submit-labels-in-commands",
    fix: "A form's button names its command: put it at commands.<command-name>.submit and render it through CommandForm's `command` prop (apps/web/src/commands/labels.ts).",
    check: (files) =>
      files
        .filter((file) => CATALOG.test(file.path))
        .flatMap((file) =>
          catalogKeys(file)
            .filter((key) => /submit$/i.test(key.path) && !key.path.startsWith("commands."))
            .map(({ line, text }) => ({ path: file.path, line, text })),
        ),
  },
  {
    id: "H16",
    name: "money-format-in-one-place",
    fix: "Format through lib/format.ts: formatMoney with a sign context (ledger + direction, net, record), not signDisplay or a hand-built Intl.NumberFormat.",
    check: linesMatching(
      /\bnew Intl\.NumberFormat\b|\bsignDisplay\b|\bformatXAF\b/,
      (path) => isWebProduction(path) && path !== "apps/web/src/lib/format.ts",
    ),
  },
  {
    id: "H17",
    name: "forms-have-harness-tests",
    fix: "Give the form a sibling <Name>.test.tsx that runs describeCommandForm from apps/web/src/test/form-harness.ts: the six command-form tests (docs/design/consistency/README.md, Recipe: a new form).",
    check: (files) => {
      const harnessed = new Set(
        files
          .filter((file) => isTestFile(file.path) && /test\/form-harness(\.js)?["']/.test(file.content))
          .map((file) => file.path.replace(/\.test\.tsx?$/, "")),
      );
      return files
        .filter(
          (file) =>
            isWebProduction(file.path) &&
            /(Forms?|Dialogs?)\.tsx$/.test(file.path) &&
            !harnessed.has(file.path.replace(/\.tsx$/, "")),
        )
        .map((file) => ({ path: file.path, line: 1, text: "no sibling test runs the form harness" }));
    },
  },
  {
    id: "H18",
    name: "dialogs-only-for-decisions",
    fix: "Recording or editing a fact opens the side panel: surface=\"sheet\" (or \"panel\" inside a record panel). A centred dialog is only for a decision on an existing record, the allow-list DECISION_SURFACES in tools/guards/rules.ts (docs/design/consistency/README.md, Surface by job).",
    check: (files) =>
      files
        .filter(
          (file) =>
            isWebProduction(file.path) &&
            file.path.endsWith(".tsx") &&
            file.path !== "apps/web/src/components/command-form.tsx",
        )
        .flatMap(dialogSurfacesOutsideDecisions),
  },
  {
    id: "DS-1",
    name: "figures-tabular-sans",
    fix: "Figures (money, counts, record numbers, codes) use `tabular-nums` in the sans face, never `font-mono` or a monospace family (apps/web/DESIGN.md).",
    check: linesMatching(/\bfont-mono\b|--font-mono\b|\bmonospace\b/, isWebStyled),
  },
  {
    id: "DS-2",
    name: "colours-from-tokens",
    fix: "Use a semantic token class (bg-primary, text-muted-foreground, fill-chart-1) or var(--token); colours are defined only in apps/web/src/styles.css (apps/web/DESIGN.md).",
    check: colourLiterals,
  },
  {
    id: "DS-4",
    name: "labels-sentence-case",
    fix: "Write labels, eyebrows and badges in sentence case in the catalog and render them as written; no `uppercase` class or text-transform (apps/web/DESIGN.md). A code the user types in capitals is capitalised in the value, not by CSS.",
    check: linesMatching(/\buppercase\b|\bsmall-caps\b/, isWebStyled),
  },
  {
    id: "DS-5",
    name: "page-width-from-frame",
    fix: "A screen takes its width from the page frame, PageContainer (components/page-container.tsx): one width for every page, so moving between pages never makes the content jump (#658, docs/design/consistency/fullpages.html#frame). Drop the max-w-* class; a measure that belongs to a part (PageHeader's description, a form column) lives in that component under components/.",
    check: linesMatching(
      /(?<![\w-])max-w-|\bmaxWidth\s*:/,
      // The sign-in page sits outside the app shell, so it has no page frame to take a width from.
      (path) =>
        isWebProduction(path) &&
        path.startsWith("apps/web/src/screens/") &&
        path !== "apps/web/src/screens/LoginScreen.tsx",
    ),
  },
  {
    id: "J1",
    name: "no-any",
    fix: "Type it: use the contract's types, unknown plus a guard, or a generic.",
    check: linesMatching(/\bas any\b|:\s*any\b(?![\w-])|<any>|\bany\[\]/, isProductionSource),
  },
  {
    id: "M1",
    name: "migrations-numbered-once",
    fix: "Each migration in apps/api/drizzle takes the next free number: one NNNN per .sql file, one journal entry per file with idx NNNN and the same tag, `when` later than the entry before it, and snapshots chained by prevId. After a renumber, rename the .sql and its snapshot together and give the entry a `when` later than the last one; drizzle skips a migration whose `when` is older than one the database already ran.",
    check: migrationIntegrity,
  },
  {
    id: "M2",
    name: "migrations-after-develop",
    fix: "develop already took this migration number. Merge origin/develop, then renumber your migrations after develop's last one (see M1). The check reads origin/develop as last fetched; set GUARD_BASE_REF to compare against another ref.",
    check: migrationsBehindBase,
  },
  {
    id: "T1",
    name: "migration-sql-in-own-database",
    fix: "A migration's SQL runs over every workspace, and test files share one database in parallel (#104). Use createTestApp({ isolated: true }) from apps/api/src/test/fixture.ts, or create a database of your own.",
    check: (files) =>
      files
        .filter(
          (file) =>
            file.path.startsWith("apps/api/src/") &&
            isTestFile(file.path) &&
            !/isolated: true|create database/i.test(file.content),
        )
        .flatMap((file) => matchLines(file, /\d{4}_\w+\.sql|drizzle\/\$\{/).slice(0, 1)),
  },
  {
    id: "D1",
    name: "workspace-day-one-helper",
    fix: "Get the workspace time zone from workspaceTimezone() in apps/api/src/reads/workspace-day.ts, then pass it to currentBusinessDate() or currentPeriodCode(). \"The workspace's day\" has drifted between copies before (#511, #555, #560; #580).",
    check: linesMatching(
      /\bworkspaces\.timezone\b/,
      (path) => isApiProduction(path) && path !== "apps/api/src/reads/workspace-day.ts" && path !== "apps/api/src/db/schema.ts",
    ),
  },
  {
    id: "P1",
    name: "no-prototype-routes",
    fix: "Prototypes stay on their own branch; production routes never mount them.",
    check: linesMatching(/prototypes?\/|Prototype/, (path) => path === "apps/web/src/router.tsx"),
  },
  {
    id: "W1",
    name: "commands-through-the-client",
    fix: "Send commands with the command client (apps/web/src/commands/client.ts). It is the one place that tracks their status and times the command:<name> journey (ADR-0011); a direct fetch to /v1/commands is invisible to both.",
    check: linesMatching(/["'`]\/v1\/commands/, (path) => isWebProduction(path) && !path.includes("/test/") && path !== "apps/web/src/commands/client.ts"),
  },
  {
    id: "V1",
    name: "flow-shots-captioned",
    fix: 'Give the shot a caption: shot("label", { caption: "One English sentence: what this frame proves" }), and a highlight locator where something changed. Reels show the caption under the frame; without it a reviewer sees only the label.',
    check: linesMatching(/\bshot\(\s*(["'`])[^"'`]*\1\s*\)/, (path) => path.startsWith("tools/verify/flows/") && path.endsWith(".ts")),
  },
  {
    id: "B1",
    name: "module-boundaries",
    fix: "Core never imports a module, and a module imports another only when its web manifest lists it in `uses` (AGENTS.md, Core vs modules; #330). Give core a slot the module fills through its manifest (apps/web/src/modules/manifest.ts), move a helper every module shares into core, or wire the module in at the composition entry (apps/web/src/modules/index.ts, router.tsx). Which paths are core, module or composition: tools/guards/module-boundaries.ts.",
    check: moduleBoundaryViolations,
  },
  {
    id: "S1",
    name: "sql-from-bound-values",
    fix: "Build SQL with the drizzle sql`...` template, which binds every ${value} as a parameter, or pg's query(text, [values]) with $1, $2 placeholders. Never put a value into SQL text with ${}, + or .join(), and never pass anything but a string literal to sql.raw. A dynamic table or column name goes through sql.identifier() (or pg.escapeIdentifier()) after it is checked against an allowlist. Limits and details: tools/guards/sql.ts.",
    check: (files) => files.filter((file) => isProductionSource(file.path)).flatMap(unsafeSqlConstruction),
  },
];
