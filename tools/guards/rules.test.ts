import { describe, expect, it } from "vitest";
import { evaluate } from "./baseline.js";
import { RULES, type Rule } from "./rules.js";
import type { SourceFile } from "./scan.js";

function rule(id: string): Rule {
  const found = RULES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found;
}

const file = (path: string, content: string): SourceFile => ({ path, content });

const SCHEMA = file(
  "apps/api/src/db/schema.ts",
  'export const assets = pgTable("assets", {});\nexport const sessions = pgTable("sessions", {});',
);
const REGISTRY = file(
  "apps/web/registry.json",
  JSON.stringify({ items: [{ files: [{ path: "src/components/page.tsx" }] }] }),
);

/** One snippet each rule must catch, and the paved-path version it must allow. */
const CASES: { id: string; bad: SourceFile[]; good: SourceFile[] }[] = [
  { id: "A2", bad: [file("package-lock.json", "{}")], good: [file("pnpm-lock.yaml", "")] },
  {
    id: "A7",
    bad: [file("apps/api/package.json", '{ "dependencies": { "drizzle-orm": "^0.45.2" } }')],
    good: [file("apps/api/package.json", '{ "dependencies": { "drizzle-orm": "0.46.0" } }')],
  },
  {
    id: "A9",
    bad: [file("packages/contracts/src/x.ts", "const id = z.string().uuid();")],
    good: [file("packages/contracts/src/x.ts", "const id = z.uuid();")],
  },
  { id: "A10", bad: [file("apps/web/tailwind.config.ts", "")], good: [file("apps/web/src/styles.css", "")] },
  {
    id: "A12",
    bad: [file("apps/web/src/x.tsx", 'import { Dialog } from "@radix-ui/react-dialog";')],
    good: [file("apps/web/src/x.tsx", 'import { Dialog } from "@base-ui/react/dialog";')],
  },
  {
    id: "A16",
    bad: [SCHEMA, file("apps/api/src/reads/x.ts", "await tx.insert(assets).values(row);")],
    good: [
      SCHEMA,
      file("apps/api/src/commands/x.ts", "await tx.insert(assets).values(row);"),
      file("apps/api/src/auth/local.ts", "await executor.insert(sessions).values(row);"),
      file("apps/api/src/reads/x.ts", "seen.delete(id);"),
    ],
  },
  {
    id: "A18",
    bad: [
      file("apps/api/src/commands/x.test.ts", 'const res = await fetch("/v1/commands", { method: "POST" });'),
      file("apps/api/src/commands/x.test.ts", 'await post("/v1/commands", payload);'),
    ],
    good: [
      file("apps/api/src/commands/x.test.ts", 'url: "/v1/commands/register-asset",'),
      // Bare string in a list (define-read.ts pattern)
      file("apps/api/src/reads/define-read.ts", '  "/v1/commands",'),
      // GET registration
      file("apps/api/src/server.ts", 'app.get("/v1/commands", async (request) => {'),
      // In a dictionary
      file("apps/api/src/reads/x.ts", 'const READS = { "/v1/commands": { method: "GET" } };'),
    ],
  },
  {
    id: "A24",
    bad: [file("apps/web/src/x.ts", "const xaf = amountMinor / 100;")],
    good: [
      file("apps/web/src/x.ts", "const left = (offset / span) * 100;"),
      // Percentages should not flag
      file("apps/web/src/vehicle/tabs/MaintenanceTab.tsx", "percent: Math.round(((wo.actualCostMinor - wo.expectedCostMinor) / wo.expectedCostMinor) * 100),"),
      file("apps/web/src/vehicle/tabs/MoneyTab.tsx", "{Math.round((category.expenseMinor / Math.max(1, total)) * 100)}%"),
      file("apps/web/src/vehicle/tabs/MoneyTab.tsx", "style={{ width: `${Math.max(0, (category.expenseMinor / max) * 100)}%` }}"),
    ],
  },
  {
    id: "A33a",
    bad: [file("apps/api/src/x.ts", 'import { createClient } from "@supabase/supabase-js";')],
    good: [file("apps/api/src/x.ts", 'import { Pool } from "pg";')],
  },
  {
    id: "A33b",
    bad: [file("apps/api/src/reads/x.ts", 'import { S3Client } from "@aws-sdk/client-s3";')],
    good: [file("apps/api/src/storage/s3.ts", 'import { S3Client } from "@aws-sdk/client-s3";')],
  },
  {
    id: "A35",
    bad: [file("apps/api/src/x.ts", 'import OpenAI from "openai";')],
    good: [file("apps/api/src/x.ts", 'import { z } from "zod";')],
  },
  {
    id: "A38",
    bad: [file("apps/web/src/x.tsx", 'const label = t("asset.count") + " " + name;')],
    good: [file("apps/web/src/x.tsx", 'const label = t("asset.count", { name });')],
  },
  {
    id: "E1",
    bad: [REGISTRY, file("apps/web/src/components/new-thing.tsx", "")],
    good: [REGISTRY, file("apps/web/src/components/page.tsx", ""), file("apps/web/src/components/page.test.tsx", "")],
  },
  {
    id: "G1",
    bad: [file("apps/web/src/x.ts", "queryClient.setQueryData(key, next);")],
    good: [file("apps/web/src/x.ts", "queryClient.invalidateQueries({ queryKey: key });")],
  },
  {
    id: "H6",
    bad: [file("apps/web/src/screens/X.tsx", 'import { toast } from "@/components/ui/toast.js";')],
    good: [file("apps/web/src/lib/notify.ts", 'import { toast } from "@/components/ui/toast.js";')],
  },
  {
    id: "H8",
    bad: [file("apps/web/src/X.tsx", '<TabsTrigger\n  value="a"\n  className="min-h-11"\n>')],
    good: [file("apps/web/src/X.tsx", '<TabsList className="h-11">\n<TabsTrigger value="a">')],
  },
  {
    id: "H9",
    bad: [file("apps/web/src/screens/X.tsx", '<Input type="date" {...field} />')],
    good: [file("apps/web/src/screens/X.tsx", "<DateRangePicker {...field} />")],
  },
  {
    id: "H12",
    bad: [file("apps/api/src/reads/x.ts", "const day = now.toISOString().slice(0, 10);")],
    good: [file("apps/api/src/reads/business-date.ts", "return shifted.toISOString().slice(0, 10);")],
  },
  {
    id: "J1",
    bad: [file("apps/web/src/x.ts", "const ability = rules as any;")],
    good: [file("apps/web/src/x.test.ts", "const payload = good as any;"), file("apps/web/src/x.ts", "const count: number = 1;")],
  },
  {
    id: "P1",
    bad: [file("apps/web/src/router.tsx", 'import { MaintenancePrototypeScreen } from "./screens/MaintenancePrototypeScreen.js";')],
    good: [file("apps/web/src/router.tsx", 'import { AssetsStub } from "./screens/AssetsStub.js";')],
  },
];

describe("every rule", () => {
  it("has a case here", () => {
    expect(RULES.map((r) => r.id).sort()).toEqual(CASES.map((c) => c.id).sort());
  });

  it("has a unique id", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });
});

describe.each(CASES)("rule $id", ({ id, bad, good }) => {
  it("catches the mistake", () => {
    expect(rule(id).check(bad).length).toBeGreaterThan(0);
  });

  it("allows the paved path", () => {
    expect(rule(id).check(good)).toEqual([]);
  });
});

describe("comments", () => {
  it("never count as violations", () => {
    const documented = file(
      "apps/web/src/activities/sheet-model.ts",
      '/** `<input type="datetime-local">` values — no offset. */\n// never use type="date" here\n * type="date"',
    );
    expect(rule("H9").check([documented])).toEqual([]);
  });
});

describe("the ratchet", () => {
  const h9 = rule("H9");
  const two = file("apps/web/src/screens/X.tsx", '<Input type="date" />\n<Input type="date" />');
  const one = file("apps/web/src/screens/X.tsx", '<Input type="date" />');

  it("reports every line of a file that goes above its baseline", () => {
    expect(evaluate(h9, [two], { "apps/web/src/screens/X.tsx": 1 }).added).toHaveLength(2);
  });

  it("accepts a file at its baseline", () => {
    const result = evaluate(h9, [one], { "apps/web/src/screens/X.tsx": 1 });
    expect(result.added).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it("flags a baseline that is looser than the code, so gains get locked in", () => {
    expect(evaluate(h9, [one], { "apps/web/src/screens/X.tsx": 2 }).stale).toEqual([
      { path: "apps/web/src/screens/X.tsx", baseline: 2, actual: 1 },
    ]);
  });

  it("counts a violation in a new file as added", () => {
    const other = file("apps/web/src/screens/Y.tsx", '<Input type="date" />');
    expect(evaluate(h9, [one, other], { "apps/web/src/screens/X.tsx": 1 }).added).toHaveLength(1);
  });
});
