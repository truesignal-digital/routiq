import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AssetLifecycleStatus,
  AssignAssetPayload,
  CommissionAssetPayload,
  ModuleCode,
  Role,
} from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import {
  CommandForm,
  useCommandSubmission,
  type CommandFormBack,
  type CommandSurface,
} from "@/components/command-form.js";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMeContext } from "../auth/me.js";
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { useCommandLabel, type CommandLabelRef } from "../commands/labels.js";
import { notifyCommandSuccess } from "../lib/notify.js";
import { canCommissionAsset, canTransferAsset } from "./permissions.js";
import { useAssetRegistrationReference } from "../reference/asset-registration.js";

/**
 * `assign` moves the vehicle to another branch; `custodian` names who answers
 * for it. Both are `assign-asset` — one form per question, so a custodian
 * change never shows a branch picker.
 */
export type AssetActionKey = "commission" | "assign" | "custodian";

/** The command each action sends, whose words name it on every surface. */
export const ASSET_ACTION_COMMANDS: Record<AssetActionKey, CommandLabelRef> = {
  commission: "commission-asset",
  assign: "assign-asset",
  custodian: { command: "assign-asset", intent: "custodian" },
};

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
  if (DISPOSED.includes(asset.lifecycleStatus)) return [];
  // role-config: each action follows its command's default rules, so a role the
  // server would refuse is never offered the button.
  const actions: AssetActionKey[] = [];
  if (asset.lifecycleStatus === "REGISTERED" && canCommissionAsset(role, enabledModules)) {
    actions.push("commission");
  }
  if (canTransferAsset(role, enabledModules)) actions.push("assign");
  return actions;
}

/**
 * The custodian picker arrives with its candidates read. Until then the assign
 * form takes it as a slot: the host renders the field and hands over what it
 * adds to `assign-asset`, so the command stays one call either way.
 */
export interface CustodianSlot {
  field: ReactNode;
  /** Undefined until something is chosen. */
  value: Pick<AssignAssetPayload, "custodianMembershipId"> | undefined;
}

export interface AssetActionFormProps {
  surface: CommandSurface;
  asset: AssetActionTarget;
  action: AssetActionKey;
  client?: CommandClient | undefined;
  back?: CommandFormBack | undefined;
  custodian?: CustodianSlot | undefined;
  /** After the command committed and the asset reads were refreshed. */
  onDone?: (() => void) | undefined;
  onDismiss: () => void;
}

/**
 * One asset command, asked for and answered in place. A conflict or a pending
 * approval replaces the form instead of firing a toast: both are answers about
 * this asset that the operator has to read before the form goes away.
 */
export function AssetActionForm({
  surface,
  asset,
  action,
  client = commandClient,
  back,
  custodian,
  onDone,
  onDismiss,
}: AssetActionFormProps) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const reference = useAssetRegistrationReference();
  const submission = useCommandSubmission();

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

  const custodianValue = custodian?.value;
  const ready =
    action === "commission" ||
    (action === "assign" && branchCode !== "") ||
    custodianValue !== undefined;

  async function submit() {
    if (!ready) return;

    // Both commands check the version of the row as it was rendered, so a stale
    // card can never overwrite someone else's change.
    const result = await submission.run(() => {
      if (action === "commission") {
        commissionIntent.current ??= createCommandIntent(
          client,
          "commission-asset",
          1,
        );
        return commissionIntent.current.submit(
          { assetId: asset.id },
          { expectedVersion: asset.rowVersion },
        );
      }
      assignIntent.current ??= createCommandIntent(client, "assign-asset", 1);
      return assignIntent.current.submit(
        {
          assetId: asset.id,
          ...(branchCode === "" ? {} : { branchCode }),
          ...custodianValue,
        },
        { expectedVersion: asset.rowVersion },
      );
    });

    if (!result.ok) return;
    notifyCommandSuccess(
      "assets",
      action === "commission"
        ? "commissioned"
        : action === "custodian"
          ? "custodianChanged"
          : "assigned",
      result.outcome.warnings,
    );
    await invalidateAssets();
    onDone?.();
    onDismiss();
  }

  async function reload() {
    await invalidateAssets();
    onDismiss();
  }

  return (
    <CommandForm
      surface={surface}
      title={label(ASSET_ACTION_COMMANDS[action])}
      description={t(`assets.actions.${action}Hint`)}
      back={back}
      error={submission.error}
      conflict={{
        title: t("assets.actions.conflictTitle"),
        body: t("assets.actions.conflictBody"),
      }}
      approval={{
        title: t("assets.actions.approvalTitle"),
        body: t("assets.actions.approvalBody"),
      }}
      onReload={reload}
      command={ASSET_ACTION_COMMANDS[action]}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
      onDismiss={onDismiss}
    >
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
      {action !== "commission" && custodian?.field}
    </CommandForm>
  );
}

/** The asset list opens the form above in the side panel: it records a fact. */
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
  return (
    <AssetActionForm
      surface="sheet"
      asset={asset}
      action={action}
      client={client}
      onDismiss={onDismiss}
    />
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
  const label = useCommandLabel();
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
            onClick={() => setOpen(action)}
          >
            {label(ASSET_ACTION_COMMANDS[action])}
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
