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
const APPEND_ONLY_SCHEMA = file(
  "apps/api/src/db/schema.ts",
  [
    'export const notes = pgTable(\n  "notes",\n  {},\n);',
    'export const auditEvents = pgTable(\n  "audit_events",\n  {},\n);',
    'export const meterReadings = pgTable("meter_readings", {});',
    'export const financialPostings = pgTable("financial_postings", {});',
    'export const financialEntries = pgTable("financial_entries", {});',
    'export const assets = pgTable("assets", {});',
  ].join("\n"),
);
const APPEND_ONLY_INVENTORY = file(
  "apps/api/src/db/append-only.ts",
  [
    "export const APPEND_ONLY_TABLES = {",
    '  auditEvents: { update: [], delete: "never" },',
    '  notes: { update: [], delete: "never" },',
    '  meterReadings: { update: ["superseded_by_id"], delete: "never" },',
    '  financialPostings: { update: ["posting_period_id"], delete: "pending entry lines only" },',
    "} as const satisfies Record<string, unknown>;",
  ].join("\n"),
);
const APPEND_ONLY = [APPEND_ONLY_SCHEMA, APPEND_ONLY_INVENTORY];

const REGISTRY = file(
  "apps/web/registry.json",
  JSON.stringify({ items: [{ files: [{ path: "src/components/page.tsx" }] }] }),
);

/**
 * A drizzle journal, its .sql files and chained snapshots, as `drizzle-kit
 * generate` writes them, numbered from 0000 up to the given tags.
 */
function migrations(tags: string[], options: { journal?: string[]; when?: number[]; base?: boolean } = {}): SourceFile[] {
  const first = Number(tags[0]?.slice(0, 4) ?? 0);
  const earlier = Array.from({ length: first }, (_, idx) => `${String(idx).padStart(4, "0")}_earlier`);
  const all = [...earlier, ...tags];
  const entries = [...earlier, ...(options.journal ?? tags)].map((tag, idx) => ({
    idx,
    version: "7",
    when: options.when?.[idx - first] ?? 1_790_000_000_000 + idx,
    tag,
    breakpoints: true,
  }));
  const journal = file(
    `${options.base === true ? "@base/" : ""}apps/api/drizzle/meta/_journal.json`,
    JSON.stringify({ version: "7", dialect: "postgresql", entries }, null, 2),
  );
  if (options.base === true) return [journal];
  const snapshots = all.map((tag, idx) =>
    file(
      `apps/api/drizzle/meta/${tag.slice(0, 4)}_snapshot.json`,
      JSON.stringify({ id: `s${idx}`, prevId: idx === 0 ? "00000000" : `s${idx - 1}` }),
    ),
  );
  return [journal, ...all.map((tag) => file(`apps/api/drizzle/${tag}.sql`, "")), ...snapshots];
}

const BEFORE_0032 = ["0030_tenant_fk_gaps", "0031_postings_balance"];

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
    id: "A27",
    bad: [
      ...APPEND_ONLY,
      file("apps/api/src/commands/add-note.ts", "await tx.update(notes).set({ body }).where(eq(notes.id, id));"),
    ],
    good: [
      ...APPEND_ONLY,
      file("apps/api/src/commands/add-note.ts", "await tx.insert(notes).values(row);"),
      file("apps/api/src/commands/entry-decisions.ts", "await tx.update(financialPostings).set({ postingPeriodId });"),
      file("apps/api/src/commands/update-pending-entry.ts", "await tx.delete(financialPostings).where(pending);"),
      file("apps/api/src/commands/activity-legs.ts", "await tx.update(meterReadings).set({ supersededById });"),
      file("apps/api/src/commands/reverse-entry.ts", "await tx.update(financialEntries).set({ status });"),
      file("apps/api/scripts/seed-demo.ts", "await owner.delete(schema.notes).where(inWorkspace);"),
      file("apps/api/src/commands/add-note.test.ts", "await tx.update(notes).set({ body: 'x' });"),
    ],
  },
  {
    id: "A18",
    bad: [
      file("apps/api/src/commands/x.test.ts", 'const res = await fetch("/v1/commands", { method: "POST" });'),
      // Multi-line POST caller: method on preceding line, url on this line
      file("apps/api/src/commands/approvals.test.ts", 'method: "POST",\n      url: "/v1/commands",'),
    ],
    good: [
      file("apps/api/src/commands/x.test.ts", 'url: "/v1/commands/register-asset",'),
      // Bare string in a list (define-read.ts pattern)
      file("apps/api/src/reads/define-read.ts", '  "/v1/commands",'),
      // GET registration
      file("apps/api/src/server.ts", 'app.get("/v1/commands", async (request) => {'),
      // GET read with method on preceding line (documents.test.ts pattern)
      file("apps/api/src/reads/documents.test.ts", 'method: "GET",\n      url: "/v1/commands",'),
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
    id: "H17",
    bad: [
      file("apps/web/src/vehicle/forms/LogFuelForm.tsx", "export function LogFuelForm() {}"),
      file("apps/web/src/vehicle/forms/LogFuelForm.test.tsx", 'import { render } from "@testing-library/react";'),
      file("apps/web/src/members/AddMemberDialog.tsx", "export function AddMemberDialog() {}"),
      file("apps/web/src/finance/EntryDecisionForms.tsx", "export function RejectEntryForm() {}"),
    ],
    good: [
      file("apps/web/src/vehicle/forms/AddNoteForm.tsx", "export function AddNoteForm() {}"),
      file("apps/web/src/vehicle/forms/AddNoteForm.test.tsx", 'import { describeCommandForm } from "../../test/form-harness.js";'),
      file("apps/web/src/components/command-form.tsx", "export function CommandForm() {}"),
      file("apps/web/src/vehicle/forms/useFormDraft.ts", ""),
    ],
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
    good: [
      file("apps/web/src/screens/X.tsx", "<DateRangePicker {...field} />"),
      file("apps/web/src/screens/Y.tsx", "<DateField {...field} />\n<DateTimeField value={when} onChange={setWhen} />"),
    ],
  },
  {
    id: "H13",
    bad: [file("apps/web/src/screens/X.tsx", '<Button variant="outline" className="h-9">')],
    good: [
      file("apps/web/src/screens/X.tsx", '<Button variant="outline" className="desktop:h-9">'),
      file("apps/web/src/components/ui/button.tsx", '<ButtonPrimitive className="h-8" />'),
    ],
  },
  {
    id: "H12",
    bad: [file("apps/api/src/reads/x.ts", "const day = now.toISOString().slice(0, 10);")],
    good: [file("apps/api/src/reads/business-date.ts", "return shifted.toISOString().slice(0, 10);")],
  },
  {
    id: "H14",
    // The four entry-status maps that disagreed before #177, one per shape.
    bad: [
      file("apps/web/src/finance/FinanceStatusBadge.tsx", "const STATUS_TONES: Record<FinanceEntryStatus, StatusBadgeTone> = {"),
      file("apps/web/src/vehicle/panel/shared.tsx", 'const ENTRY_TONE = { POSTED: "neutral", SUBMITTED: "warning" } as const;'),
      file("apps/web/src/maintenance/WorkOrderSheet.tsx", "<StatusBadge tone={ENTRY_STATUS_TONES[line.entryStatus]}>"),
      file("apps/web/src/activities/detail/ActivityMoney.tsx", 'const tones: Record<Entry["status"], "success" | "warning"> = {'),
      file("apps/web/src/activities/activityColumns.tsx", '<StatusBadge tone={status === "OPEN" ? "info" : "neutral"}>'),
      file("apps/web/src/vehicle/tabs/DocumentsTab.tsx", 'tone={state === "expired" ? "danger" : "neutral"}'),
    ],
    good: [
      file("apps/web/src/finance/EntryStatusBadge.tsx", "const ENTRY_STATUS_TONES: Record<EntryStatus, StatusTone> = {"),
      file("apps/web/src/documents/DocumentStatusBadge.tsx", 'tone={state === "expired" ? "danger" : "neutral"}'),
      file("apps/web/src/finance/EntryStatusBadge.test.tsx", 'const tones: Record<EntryStatus, string> = { POSTED: "success" };'),
      file("apps/web/src/activities/activityColumns.tsx", "<TripStatusBadge trip={row.original} />"),
      file("apps/web/src/components/metric-strip.tsx", "const TONE_VALUE: Record<MetricTone, string> = {"),
      file("apps/web/src/vehicle/tabs/HistoryTab.tsx", "export const EVENT_TONE_CLASS: Record<EventTone, string> = {"),
    ],
  },
  {
    id: "H19",
    // Thirty lines printed a bare "—" for a missing plate, counterparty or cost (#306).
    bad: [
      file("apps/web/src/assets/assetColumns.tsx", '{row.original.registrationNumber ?? "—"}'),
      file("apps/web/src/maintenance/columns.tsx", '<span className="text-muted-foreground">—</span>'),
      file("apps/web/src/vehicle/tabs/TripsTab.tsx", "time: trip.startedAt === null ? '—' : formatDateTime(trip.startedAt, locale),"),
      // Home's KPI error state, as Prettier wrapped it: the dash alone on its line.
      file(
        "apps/web/src/dashboard/SectionCards.tsx",
        'return (\n    <div className="font-mono text-2xl tabular-nums text-muted-foreground">\n      —\n    </div>\n  );',
      ),
      file("apps/web/src/screens/X.tsx", "<span>\n  —\n</span>"),
    ],
    good: [
      file("apps/web/src/assets/assetColumns.tsx", "{row.original.registrationNumber ?? <NotRecorded />}"),
      file("apps/web/src/components/metric-strip.tsx", '<span role="img" aria-label={t("common.readFailed")}>—</span>'),
      file("apps/web/src/assets/assetColumns.test.tsx", 'expect(cell.textContent).not.toBe("—");'),
      file("apps/web/src/finance/EntrySummary.tsx", '{t("finance.entry.title", { number })} — {name}'),
      file("apps/web/src/finance/EntrySummary.tsx", "<span>\n  {number} — {name}\n</span>"),
    ],
  },
  {
    id: "H15",
    bad: [
      file(
        "apps/web/src/i18n/locales/fr.json",
        JSON.stringify({ maintenance: { actions: { cancelWorkOrder: "Annuler l'ordre de travail", newSubmit: "Créer" } } }, null, 2),
      ),
      file("apps/web/src/i18n/presets/trucking.en.json", JSON.stringify({ assets: { form: { submit: "Register truck" } } }, null, 2)),
    ],
    good: [
      file(
        "apps/web/src/i18n/locales/fr.json",
        JSON.stringify({ commands: { "create-work-order": { label: "Créer un ordre de travail", submit: "Créer l'ordre de travail" } } }, null, 2),
      ),
      file("apps/web/src/screens/X.tsx", 'const submit = t("commands.create-work-order.submit");'),
    ],
  },
  {
    id: "H16",
    // One fuel expense read "+FCFA 86,000" in Finance and "−FCFA 86,000" on its trip.
    bad: [
      file("apps/web/src/finance/entryColumns.tsx", 'formatMoney(minor, { signDisplay: "always" })'),
      file("apps/web/src/components/money-input.tsx", 'new Intl.NumberFormat("fr-CM", { style: "decimal" })'),
      file("apps/web/src/screens/AssetRegisterScreen.tsx", "<FormDescription>{formatXAF(amount)}</FormDescription>"),
    ],
    good: [
      file("apps/web/src/lib/format.ts", 'new Intl.NumberFormat(locale, { signDisplay: "exceptZero" })'),
      file("apps/web/src/finance/entryColumns.tsx", 'formatMoney(minor, { sign: { context: "ledger", direction } })'),
      file("packages/domain/src/money.ts", "export function formatXAF(minor: MoneyMinor) {}"),
    ],
  },
  {
    id: "H18",
    // From Maintenance, Report a problem was a centred dialog; from the truck, a panel.
    bad: [
      file("apps/web/src/maintenance/MaintenanceDialogs.tsx", 'export function ReportIssueDialog(props: DialogHost) {\n  return <ReportIssueForm surface="dialog" {...props} />;\n}'),
      file("apps/web/src/screens/FinanceEntryDetailScreen.tsx", '<RecordEntryForm\n  surface="dialog"\n  editing={entry}\n/>'),
      file("apps/web/src/activities/ActivityActions.tsx", 'function LegForm() {\n  const common = { surface: "dialog" as const };\n}'),
    ],
    good: [
      file("apps/web/src/maintenance/MaintenanceDialogs.tsx", 'export function ReportIssueDialog(props: DialogHost) {\n  return <ReportIssueForm surface="sheet" {...props} />;\n}'),
      file("apps/web/src/screens/FinanceApprovalsScreen.tsx", '<RejectEntryForm\n  surface="dialog"\n  entry={entry}\n/>'),
      file("apps/web/src/activities/ActivityActions.tsx", 'function CloseTripDialog() {\n  return <ActivityForm\n    surface="dialog"\n  />;\n}'),
      file("apps/web/src/components/command-form.tsx", '| { surface: "dialog" | "sheet" | "panel"; title: ReactNode }'),
    ],
  },
  {
    id: "DS-1",
    // An amount was monospace in Finance and proportional on the vehicle (#310).
    bad: [
      file("apps/web/src/finance/entryColumns.tsx", '<span className="text-right font-mono font-semibold">{amount}</span>'),
      file("apps/web/src/components/ui/chart.tsx", '<span className="font-mono font-medium tabular-nums">'),
      file("apps/web/src/components/metric-strip.tsx", 'className="font-[family-name:var(--font-mono)] text-2xl"'),
      file("apps/web/src/screens/X.css", ".plate { font-family: ui-monospace, monospace; }"),
    ],
    good: [
      file("apps/web/src/finance/entryColumns.tsx", '<span className="text-right font-semibold tabular-nums">{amount}</span>'),
      file("apps/web/src/finance/entryColumns.test.tsx", 'expect(cell.className).not.toContain("font-mono");'),
      // A chart curve type is not a font.
      file("apps/web/src/dashboard/ChartAreaInteractive.tsx", '<Area type="monotone" dataKey="cost" />'),
    ],
  },
  {
    id: "DS-2",
    bad: [
      file("apps/web/src/vehicle/tabs/MoneyTab.tsx", '<path fill="#3072c7" d={d} />'),
      file("apps/web/src/screens/X.tsx", '<div className="bg-[#192c45] text-white" />'),
      file("apps/web/src/dashboard/Chart.tsx", 'const stroke = "rgb(48 114 199)";'),
      file("apps/web/src/dashboard/Chart.tsx", "style={{ color: 'oklch(0.55 0.15 256)' }}"),
      file("apps/web/src/screens/X.css", ".x { color: hsl(210 50% 40%); }"),
    ],
    good: [
      file("apps/web/src/vehicle/tabs/MoneyTab.tsx", '<path className="fill-primary" d={d} />'),
      file("apps/web/src/dashboard/Chart.tsx", 'const stroke = "var(--color-chart-1)";'),
      // Issue references are not colours, in comments or out of them.
      file("apps/web/src/shell/AppShell.tsx", "  min-content width widens the whole page (#450). */}\nconst why = \"see #422\";"),
      // shadcn's chart selects recharts' own default strokes to restyle them.
      file("apps/web/src/components/ui/chart.tsx", "\"[&_.recharts-dot[stroke='#fff']]:stroke-transparent\""),
      // The token files: styles.css, and the meta theme-color mirror that cannot read CSS.
      file("apps/web/src/styles.css", ":root { --background: oklch(1 0 0); }"),
      file("apps/web/src/lib/theme.ts", 'light: "#ffffff",'),
      // The logo's masks cut holes in pure black and white: geometry, not colour.
      file("apps/web/src/components/brand/routiq-logo.tsx", '<rect width="100" height="100" fill="#fff" />'),
    ],
  },
  {
    id: "DS-4",
    bad: [
      file("apps/web/src/finance/EntrySummary.tsx", '<dt className="text-xs font-semibold uppercase text-muted-foreground">'),
      file("apps/web/src/finance/EntryStatusBadge.tsx", '<Badge className="uppercase tracking-wide">{label}</Badge>'),
      file("apps/web/src/screens/X.css", ".eyebrow { text-transform: uppercase; }"),
      // The overview tile labels rendered "WAITING YOUR APPROVAL" beside sentence-case Home cards.
      file("apps/web/src/components/metric-strip.tsx", '<dt className="text-xs font-medium tracking-wide uppercase">'),
      file("apps/web/src/vehicle/header/IdentityStrip.tsx", "<span style={{ textTransform: \"uppercase\" }}>{plate}</span>"),
      file("apps/web/src/screens/X.css", ".label { font-variant: small-caps; }"),
    ],
    good: [
      file("apps/web/src/finance/EntrySummary.tsx", '<dt className="text-xs font-medium text-muted-foreground">'),
      file("apps/web/src/finance/EntryStatusBadge.test.tsx", 'expect(badge.className).not.toContain("uppercase");'),
      // A code the user types is capitalised in the value, not by CSS.
      file("apps/web/src/branches/CreateBranchDialog.tsx", "field.onChange(event.target.value.toUpperCase())"),
      // The wordmark sets the product name in wide caps; it is the logo, not a label.
      file("apps/web/src/components/brand/routiq-logo.tsx", 'className={cn("tracking-[0.16em] uppercase", className)}'),
    ],
  },
  {
    id: "J1",
    bad: [file("apps/web/src/x.ts", "const ability = rules as any;")],
    good: [file("apps/web/src/x.test.ts", "const payload = good as any;"), file("apps/web/src/x.ts", "const count: number = 1;")],
  },
  {
    id: "M1",
    // #117 and #123 each took 0032 after #111 had; a merge that keeps both, or
    // a renumber that keeps the older `when`, must fail.
    bad: [
      ...migrations([...BEFORE_0032, "0032_work_order_cost_outcome"], {
        journal: [...BEFORE_0032, "0032_work_order_cost_outcome", "0032_edit_pending_entry"],
      }),
      file("apps/api/drizzle/0032_edit_pending_entry.sql", ""),
    ],
    good: migrations([...BEFORE_0032, "0032_work_order_cost_outcome", "0033_edit_pending_entry"]),
  },
  {
    id: "M2",
    bad: [
      ...migrations([...BEFORE_0032, "0032_edit_pending_entry"]),
      ...migrations([...BEFORE_0032, "0032_work_order_cost_outcome"], { base: true }),
    ],
    good: [
      ...migrations([...BEFORE_0032, "0032_work_order_cost_outcome", "0033_edit_pending_entry"]),
      ...migrations([...BEFORE_0032, "0032_work_order_cost_outcome"], { base: true }),
    ],
  },
  {
    id: "T1",
    bad: [
      file(
        "apps/api/src/commands/member-command-defaults.test.ts",
        'ctx = await createTestApp();\nconst BACKFILL = new URL("../../drizzle/0020_member_command_defaults.sql", import.meta.url);',
      ),
      file("apps/api/src/db/migration-replay.test.ts", "const path = new URL(`../../drizzle/${name}.sql`, import.meta.url);"),
    ],
    good: [
      file(
        "apps/api/src/commands/member-command-defaults.test.ts",
        'ctx = await createTestApp({ isolated: true });\nconst BACKFILL = new URL("../../drizzle/0020_member_command_defaults.sql", import.meta.url);',
      ),
      file("apps/api/src/db/finance-upgrade.test.ts", 'await adminPool.query(`create database "${name}"`);\nconst sql = "0010_finance.sql";'),
    ],
  },
  {
    id: "W1",
    bad: [file("apps/web/src/finance/ApproveButton.tsx", 'await fetch(`/v1/commands/approve-entry`, { method: "POST" });')],
    good: [
      file("apps/web/src/commands/client.ts", "const response = await fetch(`/v1/commands/${submission.name}`, init);"),
      file("apps/web/src/vehicle/test/harness.tsx", 'if (p.startsWith("/v1/commands/")) {'),
    ],
  },
  {
    id: "V1",
    bad: [file("tools/verify/flows/trips.ts", 'await shot("trips-list");')],
    good: [
      file("tools/verify/flows/trips.ts", 'await shot("trips-list", { caption: "Trips list" });'),
      file("tools/verify/browser.ts", 'await shot("home");'),
    ],
  },
  {
    id: "D1",
    bad: [
      file("apps/api/src/reads/dashboard.ts", "const [workspace] = await tx.select({ timezone: workspaces.timezone }).from(workspaces);"),
      file("apps/api/src/commands/periods.ts", "sql`select ${workspaces.timezone} from ${workspaces}`"),
    ],
    good: [
      file("apps/api/src/reads/workspace-day.ts", "const [workspace] = await tx.select({ timezone: workspaces.timezone }).from(workspaces);"),
      file("apps/api/src/reads/dashboard.ts", "const timezone = await workspaceTimezone(tx, auth.workspaceId);"),
      file("apps/api/src/reads/branches.ts", "timezone: branches.timezone,"),
      file("apps/api/src/reads/dashboard.test.ts", "await ctx.db.update(workspaces).set({ timezone: \"Asia/Tokyo\" }); expect(workspaces.timezone).toBeDefined();"),
    ],
  },
  {
    id: "P1",
    bad: [file("apps/web/src/router.tsx", 'import { MaintenancePrototypeScreen } from "./screens/MaintenancePrototypeScreen.js";')],
    good: [file("apps/web/src/router.tsx", 'import { AssetsStub } from "./screens/AssetsStub.js";')],
  },
  {
    id: "S1",
    bad: [
      file("apps/api/src/reads/assets.ts", "await tx.execute(sql.raw(`select * from assets where asset_code = '${code}'`));"),
      file("apps/api/scripts/x.ts", 'await pool.query("select * from notes where body like \'%" + request.query.q + "%\'");'),
    ],
    good: [
      file("apps/api/src/reads/assets.ts", "await tx.execute(sql`select * from assets where asset_code = ${code}`);"),
      file("apps/api/scripts/x.ts", 'await pool.query("select * from notes where id = $1", [id]);'),
      file("apps/api/src/reads/x.test.ts", "await ctx.db.execute(sql.raw(migrationSql));"),
    ],
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

describe.each(CASES.filter((c) => c.id.startsWith("DS-")))("design rule $id", ({ id, bad }) => {
  it.each(bad.map((source) => [source.content, source]))("catches %s on its own", (_, source) => {
    expect(rule(id).check([source]).length).toBeGreaterThan(0);
  });
});

describe("A27 append-only tables", () => {
  const a27 = rule("A27");
  const at = (content: string, path = "apps/api/src/commands/x.ts") =>
    a27.check([...APPEND_ONLY, file(path, content)]).map((v) => v.line);

  it.each([
    ["a note edit", "await tx.update(notes).set({ body });"],
    ["a note delete", "await tx.delete(notes).where(eq(notes.id, id));"],
    ["an audit delete through the schema namespace", "await tx.delete(schema.auditEvents);"],
    ["an aliased import", 'import { notes as remarks } from "../db/schema.js";\nawait tx.update(remarks).set({ body });'],
    ["a call split over lines", "await tx\n  .update(\n    notes\n  )\n  .set({ body });"],
    ["raw SQL", "await tx.execute(sql`UPDATE notes SET body = ${body} WHERE id = ${id}`);"],
    ["raw SQL with a quoted, schema-qualified name", 'await client.query(\'delete from public."audit_events" where id = $1\', [id]);'],
    ["raw SQL over lines", "await tx.execute(sql`\n  delete\n  from audit_events\n`);"],
    ["truncate", "await tx.execute(sql.raw('truncate table notes'));"],
    ["an interpolated table", "await tx.execute(sql`update ${notes} set body = ${body}`);"],
    ["a meter reading delete, whose only sanctioned write is the supersede link", "await tx.delete(meterReadings);"],
    ["a posting delete outside the pending-entry path", "await tx.delete(financialPostings);"],
  ])("catches %s", (_label, snippet) => {
    expect(at(snippet)).toHaveLength(1);
  });

  it("points at the line the call starts on", () => {
    expect(at("const a = 1;\nawait tx\n  .update(notes)\n  .set({ body });")).toEqual([3]);
  });

  it.each([
    ["an insert", "await tx.insert(notes).values(row);"],
    ["a read", "await tx.select().from(auditEvents).where(eq(auditEvents.id, id));"],
    ["a mutable table", "await tx.update(financialEntries).set({ status });"],
    ["a table whose name only starts the same", "await tx.update(notesDraft).set({ body });"],
    ["a doc comment", "/**\n * Never `update notes`: a correction is another note.\n */\nconst x = 1;"],
    ["a line comment", "// tx.delete(auditEvents) would be refused by the grant\nconst x = 1;"],
    ["a Map delete by id", "seen.delete(noteId);"],
  ])("allows %s", (_label, snippet) => {
    expect(at(snippet)).toEqual([]);
  });

  it("ignores test files and code outside the API", () => {
    expect(at("await tx.update(notes).set({ body });", "apps/api/src/commands/add-note.test.ts")).toEqual([]);
    expect(at("await tx.update(notes).set({ body });", "apps/web/src/notes/x.ts")).toEqual([]);
  });

  it("fails when the inventory is missing, so the guard cannot be switched off by deleting it", () => {
    expect(a27.check([APPEND_ONLY_SCHEMA])).toEqual([
      expect.objectContaining({ path: "apps/api/src/db/append-only.ts" }),
    ]);
  });

  it("fails when the inventory names a table schema.ts does not have", () => {
    const stale = file("apps/api/src/db/append-only.ts", 'export const APPEND_ONLY_TABLES = {\n  remarks: { update: [], delete: "never" },\n} as const;');
    expect(a27.check([APPEND_ONLY_SCHEMA, stale])).toEqual([
      expect.objectContaining({ text: "not a schema.ts table: remarks" }),
    ]);
  });
});

describe("H13 touch targets", () => {
  const h13 = rule("H13");
  const at = (content: string) => h13.check([file("apps/web/src/screens/X.tsx", content)]).length;

  it.each([
    '<Button size="sm">',
    '<Button variant="ghost" size="icon-sm" aria-label={label} />',
    '<SelectTrigger size="sm" className="w-20">',
    '<Input className="h-9 w-full" />',
    '<Button\n  variant="outline"\n  className="h-8"\n  onClick={() => open()}\n>',
    '<button type="button" className="min-h-9 rounded-full border">',
    '<button\n  className={cn(\n    "inline-flex h-8 items-center",\n    active && "bg-muted",\n  )}\n>',
    '<summary className="min-h-9 cursor-pointer">',
    '<a href="/x" className="flex size-8 items-center">',
    '<Button className="h-10 sm:h-9">',
  ])("catches %s", (snippet) => {
    expect(at(snippet)).toBe(1);
  });

  it.each([
    "<Button>",
    '<Button size="desktop-sm">',
    '<Button className="desktop:h-9" onClick={() => go()}>',
    '<Input className="pl-8 desktop:h-9" />',
    '<Skeleton className="h-8 w-full" />',
    '<Card size="sm">',
    '<SidebarMenuButton size="lg">',
    '<span className="grid size-8 place-items-center">',
    '<Button className="md:h-9">',
    '<Button onClick={() => setOpen(true)}>Open</Button>\n<div className="h-8" />',
  ])("allows %s", (snippet) => {
    expect(at(snippet)).toBe(0);
  });
});

describe("migration numbering", () => {
  const m1 = rule("M1");
  const texts = (files: SourceFile[]) => m1.check(files).map((v) => v.text);

  it("names both files that share a number", () => {
    const files = [
      ...migrations([...BEFORE_0032, "0032_work_order_cost_outcome"]),
      file("apps/api/drizzle/0032_update_asset_details_command_defaults.sql", ""),
    ];
    expect(texts(files)).toEqual([
      "migration number 0032 is used by 0032_work_order_cost_outcome, 0032_update_asset_details_command_defaults",
      "migration number 0032 is used by 0032_work_order_cost_outcome, 0032_update_asset_details_command_defaults",
      "0032_update_asset_details_command_defaults has no entry in meta/_journal.json",
    ]);
  });

  it("catches a renumbered migration that kept its older `when`", () => {
    const files = migrations([...BEFORE_0032, "0032_work_order_cost_outcome", "0033_edit_pending_entry"], {
      when: [1_790_000_000_030, 1_790_000_000_031, 1_790_000_000_034, 1_790_000_000_033],
    });
    expect(texts(files)).toEqual([
      "0033_edit_pending_entry has when 1790000000033, not later than 0032_work_order_cost_outcome (1790000000034)",
    ]);
  });

  it("catches a snapshot left behind by a renumber", () => {
    const files = [
      ...migrations([...BEFORE_0032, "0032_work_order_cost_outcome"]),
      file("apps/api/drizzle/meta/0033_snapshot.json", JSON.stringify({ id: "s99", prevId: "s31" })),
    ];
    expect(texts(files)).toEqual([
      "snapshot 0033 has no journal entry",
      "prevId s31 is not the previous snapshot's id s32",
    ]);
  });

  it("lets a branch that is merely behind develop pass M2", () => {
    const files = [
      ...migrations(BEFORE_0032),
      ...migrations([...BEFORE_0032, "0032_work_order_cost_outcome"], { base: true }),
    ];
    expect(rule("M2").check(files)).toEqual([]);
  });
});

describe("native date inputs", () => {
  it.each([
    '<Input type={"date"} />',
    "<Input type={'datetime-local'} />",
    "<Input type={`datetime-local`} />",
    '<input type = "date" />',
  ])("catches %s", (line) => {
    expect(rule("H9").check([file("apps/web/src/screens/X.tsx", line)])).toHaveLength(1);
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
