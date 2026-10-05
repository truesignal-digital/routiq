import { migrationIntegrity, migrationsBehindBase } from "./migrations.js";
import { isTestFile, matchFile, matchLines, type SourceFile, type Violation } from "./scan.js";

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
    id: "P1",
    name: "no-prototype-routes",
    fix: "Prototypes stay on their own branch; production routes never mount them.",
    check: linesMatching(/prototypes?\/|Prototype/, (path) => path === "apps/web/src/router.tsx"),
  },
];
