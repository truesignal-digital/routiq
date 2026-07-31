import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AssetLifecycleStatus,
  AssignAssetPayload,
  CommissionAssetPayload,
  ModuleCode,
  Role,
} from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/error-banner.js";
import { useMeContext } from "../auth/me.js";
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { notifyCommandSuccess } from "../lib/notify.js";
import { canManageAssets } from "./permissions.js";
import { useAssetRegistrationReference } from "./reference.js";

export type AssetActionKey = "commission" | "assign";

/** The fields an action needs, so a list row and a detail page both qualify. */
export interface AssetActionTarget {
  id: string;
  lifecycleStatus: AssetLifecycleStatus;
  rowVersion: number;
}

/** Lifecycle status is not availability, but a disposed asset takes no new records (§3.4). */
const DISPOSED: readonly AssetLifecycleStatus[] = [
  "SOLD",
  "RETIRED",
  "WRITTEN_OFF",
];

/**
 * Which actions an asset offers. One answer for the row menu and for the detail
 * screen, so the two can never disagree about what may be done to an asset.
 */
export function assetActions(
  asset: AssetActionTarget,
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): AssetActionKey[] {
  if (!canManageAssets(role, enabledModules)) return [];
  if (DISPOSED.includes(asset.lifecycleStatus)) return [];
  return asset.lifecycleStatus === "REGISTERED"
    ? ["commission", "assign"]
    : ["assign"];
}

/** How a submitted action ended, when it did not simply commit. */
type Outcome =
  | { kind: "form" }
  | { kind: "conflict" }
  | { kind: "approval" }
  | { kind: "error"; code: string };

/**
 * One asset command, asked for and answered in place. A conflict or a pending
 * approval replaces the form instead of firing a toast: both are answers about
 * this asset that the operator has to read before the dialog goes away.
 */
export function AssetActionDialog({
  asset,
  action,
  client = commandClient,
  onDismiss,
}: {
  asset: AssetActionTarget;
  action: AssetActionKey;
  client?: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const reference = useAssetRegistrationReference();

  const [outcome, setOutcome] = useState<Outcome>({ kind: "form" });
  const [submitting, setSubmitting] = useState(false);
  const [branchCode, setBranchCode] = useState("");
  const commissionIntent = useRef<
    CommandIntent<CommissionAssetPayload> | undefined
  >(undefined);
  const assignIntent = useRef<CommandIntent<AssignAssetPayload> | undefined>(
    undefined,
  );

  const invalidateAssets = () =>
    queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "assets"],
    });

  const ready = !submitting && (action === "commission" || branchCode !== "");

  async function submit() {
    if (!ready) return;
    setSubmitting(true);

    // Both commands check the version of the row as it was rendered, so a stale
    // card can never overwrite someone else's change.
    let result;
    if (action === "commission") {
      commissionIntent.current ??= createCommandIntent(
        client,
        "commission-asset",
        1,
      );
      result = await commissionIntent.current.submit(
        { assetId: asset.id },
        { expectedVersion: asset.rowVersion },
      );
    } else {
      assignIntent.current ??= createCommandIntent(client, "assign-asset", 1);
      result = await assignIntent.current.submit(
        { assetId: asset.id, branchCode },
        { expectedVersion: asset.rowVersion },
      );
    }

    setSubmitting(false);

    if (result.ok) {
      notifyCommandSuccess(
        "assets",
        action === "commission" ? "commissioned" : "assigned",
        result.outcome.warnings,
      );
      await invalidateAssets();
      onDismiss();
      return;
    }

    if (result.code === "VERSION_CONFLICT") setOutcome({ kind: "conflict" });
    else if (result.code === "APPROVAL_REQUIRED") setOutcome({ kind: "approval" });
    else setOutcome({ kind: "error", code: result.code });
  }

  async function reload() {
    await invalidateAssets();
    onDismiss();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`assets.actions.${action}`)}</DialogTitle>
          <DialogDescription>
            {t(`assets.actions.${action}Hint`)}
          </DialogDescription>
        </DialogHeader>

        {outcome.kind === "conflict" ? (
          <>
            <div
              role="alert"
              className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
            >
              <p className="font-semibold">{t("assets.actions.conflictTitle")}</p>
              <p className="mt-1">{t("assets.actions.conflictBody")}</p>
            </div>
            <DialogFooter>
              <Button className="min-h-11" onClick={() => void reload()}>
                {t("assets.actions.reload")}
              </Button>
            </DialogFooter>
          </>
        ) : outcome.kind === "approval" ? (
          <>
            <div
              role="status"
              className="rounded-lg bg-info/10 px-3 py-2 text-sm text-info-foreground"
            >
              <p className="font-semibold">{t("assets.actions.approvalTitle")}</p>
              <p className="mt-1">{t("assets.actions.approvalBody")}</p>
            </div>
            <DialogFooter>
              <Button className="min-h-11" onClick={onDismiss}>
                {t("assets.actions.close")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {outcome.kind === "error" && <ErrorBanner code={outcome.code} />}

            {action === "assign" && (
              <div className="flex flex-col gap-2">
                <Label>{t("assets.actions.assignTo")}</Label>
                <Select
                  value={branchCode || null}
                  onValueChange={(value) => setBranchCode(value ?? "")}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={t("assets.actions.assignTo")}
                  >
                    <SelectValue placeholder={t("assets.form.choose")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(reference.data?.branches ?? []).map((branch) => (
                      <SelectItem key={branch.code} value={branch.code}>
                        {branch.name} ({branch.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                className="min-h-11 flex-1 sm:flex-none"
                onClick={onDismiss}
              >
                {t("assets.form.cancel")}
              </Button>
              <Button
                className="min-h-11 flex-1 sm:flex-none"
                disabled={!ready}
                onClick={() => void submit()}
              >
                {submitting
                  ? t("assets.actions.working")
                  : t("assets.actions.confirm")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The same actions as a button row, for the asset's own page. The list reaches
 * them through its row menu instead; both open the dialog above.
 */
export function AssetActions({
  asset,
  client = commandClient,
}: {
  asset: AssetActionTarget;
  client?: CommandClient;
}) {
  const { t } = useTranslation();
  const me = useMeContext();
  const [open, setOpen] = useState<AssetActionKey>();

  // role-config: acting on an asset is a manager's call; viewer roles and
  // disposed assets are offered nothing at all.
  const actions = assetActions(asset, me?.role, me?.enabledModules);
  if (actions.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            variant={action === "commission" ? "default" : "outline"}
            className="min-h-9"
            onClick={() => setOpen(action)}
          >
            {t(`assets.actions.${action}`)}
          </Button>
        ))}
      </div>

      {open !== undefined && (
        <AssetActionDialog
          asset={asset}
          action={open}
          client={client}
          onDismiss={() => setOpen(undefined)}
        />
      )}
    </>
  );
}
