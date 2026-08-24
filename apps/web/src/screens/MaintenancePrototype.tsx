/**
 * PROTOTYPE — THROWAWAY. Do not ship, do not extend, do not import from here.
 *
 * Question (#31): what does the maintenance surface look like inside the ROUTIQ
 * shell? Three structurally different variants of one "Maintenance" section,
 * switchable via `?variant=` on /prototype/maintenance (floating bottom bar,
 * ← / → keys). Fixture data only — no queries, no mutations; the story mirrors
 * the transports-ngwa demo workspace so density is honest.
 *
 *   A — "File de travail": queue-first, mirrors the Finances section (tabs,
 *       tables, an approvals-style pending list).
 *   B — "Tableau atelier": a workshop board — signalements inbox on the left,
 *       work orders as status columns.
 *   C — "Par camion": asset-centered — one card per truck carrying its
 *       availability, open issues and active work orders.
 */
import { useEffect } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Plus,
  Truck,
  Wrench,
} from "lucide-react";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { StatusBadge } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/* ------------------------------------------------------------------ fixtures */

interface FixtureIssue {
  number: string;
  asset: string;
  category: string;
  description: string;
  safetyCritical: boolean;
  reportedAt: string;
  workOrders: number;
}

interface FixtureWorkOrder {
  number: string;
  asset: string;
  description: string;
  status: "SUBMITTED" | "APPROVED" | "COMPLETION_SUBMITTED" | "COMPLETED";
  expectedMinor: number;
  postedMinor: number;
  openedAt: string;
  issueNumber?: string;
  safetyCritical?: boolean;
}

const ISSUES: FixtureIssue[] = [
  {
    number: "DLA-2026-00001",
    asset: "VH003",
    category: "Freins",
    description: "Freins qui grincent, pédale molle en charge.",
    safetyCritical: true,
    reportedAt: "20/08",
    workOrders: 1,
  },
  {
    number: "DLA-2026-00002",
    asset: "VH001",
    category: "Pneus",
    description: "Usure irrégulière avant gauche.",
    safetyCritical: false,
    reportedAt: "22/08",
    workOrders: 0,
  },
];

const WORK_ORDERS: FixtureWorkOrder[] = [
  {
    number: "DLA-2026-00014",
    asset: "TR001",
    description: "Graissage essieux + freins remorque (préventif)",
    status: "SUBMITTED",
    expectedMinor: 150_000,
    postedMinor: 0,
    openedAt: "23/08",
  },
  {
    number: "DLA-2026-00012",
    asset: "VH003",
    description: "Remplacement plaquettes + purge du circuit",
    status: "APPROVED",
    expectedMinor: 85_000,
    postedMinor: 60_000,
    openedAt: "21/08",
    issueNumber: "DLA-2026-00001",
    safetyCritical: true,
  },
  {
    number: "DLA-2026-00009",
    asset: "VH001",
    description: "Réparation boîte de vitesses",
    status: "COMPLETION_SUBMITTED",
    expectedMinor: 80_000,
    postedMinor: 180_000,
    openedAt: "12/08",
  },
  {
    number: "DLA-2026-00003",
    asset: "VH001",
    description: "Rotation des pneus",
    status: "COMPLETED",
    expectedMinor: 45_000,
    postedMinor: 45_000,
    openedAt: "05/08",
  },
];

const WO_BADGE: Record<
  FixtureWorkOrder["status"],
  { label: string; tone: "neutral" | "success" | "warning" | "info" | "danger" }
> = {
  SUBMITTED: { label: "Soumis", tone: "info" },
  APPROVED: { label: "En cours", tone: "neutral" },
  COMPLETION_SUBMITTED: { label: "Clôture à valider", tone: "warning" },
  COMPLETED: { label: "Clôturé", tone: "success" },
};

function money(minor: number): string {
  return formatMoney(minor);
}

function SafetyChip() {
  return (
    <StatusBadge tone="danger" icon={AlertTriangle}>
      Immobilisé
    </StatusBadge>
  );
}

/* ------------------------------------------------------- variant A: queue */

function VariantA() {
  return (
    <PageContainer>
      <PageHeader
        title="Maintenance"
        actions={
          <>
            <Button variant="outline">
              <Wrench data-slot="icon" /> Nouvel ordre de travail
            </Button>
            <Button>
              <Plus data-slot="icon" /> Signaler une panne
            </Button>
          </>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Camions immobilisés", "1", "danger"],
          ["Signalements ouverts", "2", null],
          ["OT en cours", "1", null],
          ["Décisions en attente", "2", "warning"],
        ].map(([label, value, tone]) => (
          <Card key={label}>
            <CardContent className="pt-4">
              <p className="text-xs uppercase text-muted-foreground">{label}</p>
              <p
                className={cn(
                  "font-mono text-2xl font-semibold",
                  tone === "danger" && "text-destructive",
                  tone === "warning" && "text-warning-foreground",
                )}
              >
                {value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-5 inline-flex items-center gap-1 rounded-lg bg-muted p-1 text-sm">
        <span className="rounded-md bg-background px-3 py-1 font-medium shadow-sm">
          Signalements <span className="ml-1 rounded bg-foreground/10 px-1.5">2</span>
        </span>
        <span className="px-3 py-1 text-muted-foreground">Ordres de travail</span>
        <span className="px-3 py-1 text-muted-foreground">Décisions</span>
      </div>

      <Card className="mt-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>N° de signalement</TableHead>
              <TableHead>Camion</TableHead>
              <TableHead>Catégorie</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Sécurité</TableHead>
              <TableHead>Signalé le</TableHead>
              <TableHead>OT</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ISSUES.map((issue) => (
              <TableRow key={issue.number}>
                <TableCell className="font-mono">{issue.number}</TableCell>
                <TableCell className="font-mono">{issue.asset}</TableCell>
                <TableCell>{issue.category}</TableCell>
                <TableCell className="max-w-56 truncate text-muted-foreground">
                  {issue.description}
                </TableCell>
                <TableCell>{issue.safetyCritical ? <SafetyChip /> : "—"}</TableCell>
                <TableCell>{issue.reportedAt}</TableCell>
                <TableCell>{issue.workOrders}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline">
                    Créer un OT
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <h2 className="mt-8 text-lg font-semibold">Décisions en attente</h2>
      <p className="text-sm text-muted-foreground">
        Autorisations de dépense et clôtures au-dessus du seuil — même mécanique que
        les approbations financières.
      </p>
      <Card className="mt-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>N° d'OT</TableHead>
              <TableHead>Camion</TableHead>
              <TableHead>Décision</TableHead>
              <TableHead className="text-right">Prévu</TableHead>
              <TableHead className="text-right">Imputé</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {WORK_ORDERS.filter((wo) =>
              ["SUBMITTED", "COMPLETION_SUBMITTED"].includes(wo.status),
            ).map((wo) => (
              <TableRow key={wo.number}>
                <TableCell className="font-mono">{wo.number}</TableCell>
                <TableCell className="font-mono">{wo.asset}</TableCell>
                <TableCell>
                  <StatusBadge tone={WO_BADGE[wo.status].tone}>
                    {wo.status === "SUBMITTED"
                      ? "Autorisation de dépense"
                      : "Clôture à valider"}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {money(wo.expectedMinor)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono",
                    wo.postedMinor > wo.expectedMinor && "font-semibold text-destructive",
                  )}
                >
                  {money(wo.postedMinor)}
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button size="sm">Approuver</Button>
                  <Button size="sm" variant="outline">
                    Rejeter
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </PageContainer>
  );
}

/* ------------------------------------------------------- variant B: board */

function WorkOrderCard({ wo }: { wo: FixtureWorkOrder }) {
  const over = wo.postedMinor > wo.expectedMinor;
  const ratio = Math.min(1, wo.expectedMinor === 0 ? 1 : wo.postedMinor / wo.expectedMinor);
  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="whitespace-nowrap font-mono text-xs">{wo.number}</span>
          <span className="font-mono text-sm font-semibold">{wo.asset}</span>
        </div>
        <p className="text-sm">{wo.description}</p>
        {wo.safetyCritical && <SafetyChip />}
        <div className="h-1.5 overflow-hidden rounded bg-muted">
          <div
            className={cn("h-full", over ? "bg-destructive" : "bg-foreground/60")}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p className="flex justify-between gap-2">
            <span>Imputé</span>
            <span
              className={cn(
                "whitespace-nowrap font-mono",
                over && "font-semibold text-destructive",
              )}
            >
              {money(wo.postedMinor)}
            </span>
          </p>
          <p className="flex justify-between gap-2">
            <span>Prévu</span>
            <span className="whitespace-nowrap font-mono">{money(wo.expectedMinor)}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function VariantB() {
  const columns: Array<[string, FixtureWorkOrder["status"], string]> = [
    ["Soumis", "SUBMITTED", "Autorisation de dépense attendue"],
    ["En cours", "APPROVED", "Coûts imputables"],
    ["Clôture à valider", "COMPLETION_SUBMITTED", "Total réel sous revue"],
  ];
  return (
    <PageContainer>
      <PageHeader
        title="Atelier"
        actions={
          <Button>
            <Plus data-slot="icon" /> Signaler une panne
          </Button>
        }
      />
      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase text-muted-foreground">
            <ClipboardList className="size-4" /> Signalements à trier
          </h2>
          <div className="mt-2 space-y-2">
            {ISSUES.map((issue) => (
              <Card key={issue.number}>
                <CardContent className="space-y-1.5 pt-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm">{issue.asset}</span>
                    <span className="text-xs text-muted-foreground">{issue.reportedAt}</span>
                  </div>
                  <p className="text-sm">
                    {issue.category} — {issue.description}
                  </p>
                  {issue.safetyCritical && <SafetyChip />}
                  <div className="flex gap-2 pt-1">
                    {issue.workOrders === 0 ? (
                      <>
                        <Button size="sm" variant="outline">
                          Créer un OT
                        </Button>
                        <Button size="sm" variant="ghost">
                          Résoudre
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        OT en cours ({issue.workOrders})
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {columns.map(([title, status, hint]) => {
            const items = WORK_ORDERS.filter((wo) => wo.status === status);
            return (
              <div key={status} className="rounded-xl bg-muted/40 p-3">
                <p className="flex items-center justify-between text-sm font-semibold">
                  {title}
                  <span className="rounded bg-foreground/10 px-1.5 font-mono text-xs">
                    {items.length}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{hint}</p>
                <div className="mt-3 space-y-3">
                  {items.map((wo) => (
                    <WorkOrderCard key={wo.number} wo={wo} />
                  ))}
                  {items.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">Vide</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Separator className="my-5" />
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4" /> Clôturés ce mois : DLA-2026-00003 (VH001,{" "}
        {money(45_000)}) · Remises en service : 1
      </p>
    </PageContainer>
  );
}

/* ------------------------------------------------- variant C: per-asset */

interface FixtureAsset {
  code: string;
  klass: string;
  unavailable: boolean;
  issues: FixtureIssue[];
  workOrders: FixtureWorkOrder[];
}

const ASSETS: FixtureAsset[] = [
  {
    code: "VH003",
    klass: "Camion",
    unavailable: true,
    issues: [ISSUES[0]!],
    workOrders: WORK_ORDERS.filter((wo) => wo.asset === "VH003"),
  },
  {
    code: "VH001",
    klass: "Camion",
    unavailable: false,
    issues: [ISSUES[1]!],
    workOrders: WORK_ORDERS.filter(
      (wo) => wo.asset === "VH001" && wo.status !== "COMPLETED",
    ),
  },
  {
    code: "TR001",
    klass: "Remorque",
    unavailable: false,
    issues: [],
    workOrders: WORK_ORDERS.filter((wo) => wo.asset === "TR001"),
  },
];

function VariantC() {
  return (
    <PageContainer>
      <PageHeader
        title="Maintenance par camion"
        actions={
          <Button>
            <Plus data-slot="icon" /> Signaler une panne
          </Button>
        }
      />

      <Card className="mt-4 border-destructive/40 bg-destructive/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <p className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4 text-destructive" />
            <span>
              <span className="font-semibold">1 camion immobilisé</span> — VH003 depuis le
              20/08 (Freins, sécurité). La remise en service est une décision séparée.
            </span>
          </p>
          <Button size="sm" variant="outline">
            Remettre en service…
          </Button>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ASSETS.map((asset) => (
          <Card key={asset.code}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Truck className="size-4" />
                  <span className="font-mono">{asset.code}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {asset.klass}
                  </span>
                </span>
                {asset.unavailable ? (
                  <SafetyChip />
                ) : (
                  <StatusBadge tone="success">Disponible</StatusBadge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  Signalements ouverts
                </p>
                {asset.issues.length === 0 ? (
                  <p className="text-muted-foreground">Aucun</p>
                ) : (
                  asset.issues.map((issue) => (
                    <p key={issue.number} className="flex items-center justify-between">
                      <span>
                        {issue.category} — {issue.description}
                      </span>
                    </p>
                  ))
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  Ordres de travail
                </p>
                {asset.workOrders.length === 0 ? (
                  <p className="text-muted-foreground">Aucun</p>
                ) : (
                  asset.workOrders.map((wo) => (
                    <p key={wo.number} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        <span className="font-mono text-xs">{wo.number}</span>{" "}
                        {wo.description}
                      </span>
                      <StatusBadge tone={WO_BADGE[wo.status].tone}>
                        {WO_BADGE[wo.status].label}
                      </StatusBadge>
                    </p>
                  ))
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline">
                  Signaler
                </Button>
                <Button size="sm" variant="outline">
                  Nouvel OT
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}

/* ----------------------------------------------------------- switcher */

const VARIANTS = [
  ["A", "File de travail", VariantA],
  ["B", "Tableau atelier", VariantB],
  ["C", "Par camion", VariantC],
] as const;

type VariantKey = (typeof VARIANTS)[number][0];

export function MaintenancePrototype() {
  const search = useSearch({ from: "/app/prototype/maintenance" });
  const navigate = useNavigate({ from: "/prototype/maintenance" });
  const current: VariantKey = search.variant ?? "A";
  const index = VARIANTS.findIndex(([key]) => key === current);
  const entry = VARIANTS[index === -1 ? 0 : index]!;
  const Component = entry[2];

  const go = (delta: number) => {
    const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length]!;
    void navigate({ search: { variant: next[0] }, replace: true });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <Component />
      {!import.meta.env.PROD && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-3 py-1.5 text-background shadow-lg">
          <button type="button" onClick={() => go(-1)} aria-label="Variante précédente">
            <ArrowLeft className="size-4" />
          </button>
          <span className="min-w-40 text-center text-sm font-medium">
            {entry[0]} — {entry[1]}
          </span>
          <button type="button" onClick={() => go(1)} aria-label="Variante suivante">
            <ArrowRight className="size-4" />
          </button>
        </div>
      )}
    </>
  );
}
