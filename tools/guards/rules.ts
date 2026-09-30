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
    fix: "Use a registry date picker (apps/web/AGENTS.md); add components/date-picker.tsx first if none fits.",
    check: linesMatching(/type=["'](date|datetime-local)["']/, isWebProduction),
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
    id: "J1",
    name: "no-any",
    fix: "Type it: use the contract's types, unknown plus a guard, or a generic.",
    check: linesMatching(/\bas any\b|:\s*any\b(?![\w-])|<any>|\bany\[\]/, isProductionSource),
  },
  {
    id: "P1",
    name: "no-prototype-routes",
    fix: "Prototypes stay on their own branch; production routes never mount them.",
    check: linesMatching(/prototypes?\/|Prototype/, (path) => path === "apps/web/src/router.tsx"),
  },
];
