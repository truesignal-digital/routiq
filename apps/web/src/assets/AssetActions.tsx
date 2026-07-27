import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AssignAssetPayload,
  CommissionAssetPayload,
} from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isReadOnlyRole, useMeContext } from "../auth/me.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { errorMessage } from "../lib/error-message.js";
import { useAssetRegistrationReference } from "./reference.js";
import type { AssetListItem } from "./model.js";
import { ErrorBanner } from "@/components/error-banner.js";

type Panel =
  | { kind: "idle" }
  | { kind: "assign" }
  | { kind: "conflict" }
  | { kind: "approval" }
  | { kind: "error"; code: string };

export function AssetActions({
  asset,
  client = commandClient,
}: {
  asset: AssetListItem;
  client?: CommandClient;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const me = useMeContext();
  const reference = useAssetRegistrationReference();

  const [panel, setPanel] = useState<Panel>({ kind: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [assignBranch, setAssignBranch] = useState("");

  const commissionIntent = useRef<CommandIntent<CommissionAssetPayload> | undefined>(undefined);
  const assignIntent = useRef<CommandIntent<AssignAssetPayload> | undefined>(undefined);

  if (isReadOnlyRole(me?.role)) return null;

  const disposed = ["SOLD", "RETIRED", "WRITTEN_OFF"].includes(asset.lifecycleStatus);
  const canCommission = asset.lifecycleStatus === "REGISTERED";
  const canAssign = !disposed;
  if (!canCommission && !canAssign) return null;

  async function run(submit: () => Promise<Awaited<ReturnType<CommandClient["submit"]>>>) {
    setSubmitting(true);
    const result = await submit();
    setSubmitting(false);
    if (result.ok) {
      setPanel({ kind: "idle" });
      setAssignBranch("");
      await queryClient.invalidateQueries({ queryKey: ["ws"] });
      return;
    }
    if (result.code === "VERSION_CONFLICT") setPanel({ kind: "conflict" });
    else if (result.code === "APPROVAL_REQUIRED") setPanel({ kind: "approval" });
    else setPanel({ kind: "error", code: result.code });
  }

  function onCommission() {
    commissionIntent.current ??= createCommandIntent(client, "commission-asset", 1);
    void run(() =>
      commissionIntent.current!.submit(
        { assetId: asset.id },
        { expectedVersion: asset.rowVersion },
      ),
    );
  }

  function onAssign() {
    if (assignBranch === "") return;
    assignIntent.current ??= createCommandIntent(client, "assign-asset", 1);
    void run(() =>
      assignIntent.current!.submit(
        { assetId: asset.id, branchCode: assignBranch },
        { expectedVersion: asset.rowVersion },
      ),
    );
  }

  async function onReload() {
    setPanel({ kind: "idle" });
    await queryClient.invalidateQueries({ queryKey: ["ws"] });
  }

  return (
    <div className="mt-3 border-t border-foreground/10 pt-3">
      {panel.kind === "conflict" ? (
        <div role="alert" className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">{t("assets.actions.conflictTitle")}</p>
          <p className="mt-1">{t("assets.actions.conflictBody")}</p>
          <Button variant="outline" className="mt-2 min-h-9" onClick={() => void onReload()}>
            {t("assets.actions.reload")}
          </Button>
        </div>
      ) : panel.kind === "approval" ? (
        <div role="status" className="rounded-lg bg-sky-100 px-3 py-2 text-xs text-sky-900">
          <p className="font-semibold">{t("assets.actions.approvalTitle")}</p>
          <p className="mt-1">{t("assets.actions.approvalBody")}</p>
          <Button
            variant="outline"
            className="mt-2 min-h-9"
            onClick={() => setPanel({ kind: "idle" })}
          >
            {t("assets.actions.close")}
          </Button>
        </div>
      ) : panel.kind === "error" ? (
        <>
          <ErrorBanner code={panel.code} />
          <Button
            variant="outline"
            className="mt-2 min-h-9"
            onClick={() => setPanel({ kind: "idle" })}
          >
            {t("assets.actions.close")}
          </Button>
        </>
      ) : panel.kind === "assign" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={assignBranch || null}
            onValueChange={(value) => setAssignBranch(value ?? "")}
          >
            <SelectTrigger className="flex-1" size="sm" aria-label={t("assets.actions.assignTo")}>
              <SelectValue placeholder={t("assets.form.choose")} />
            </SelectTrigger>
            <SelectContent>
              {reference.data?.branches.map((b) => (
                <SelectItem key={b.code} value={b.code}>
                  {b.name} ({b.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="min-h-9" disabled={submitting || assignBranch === ""} onClick={onAssign}>
            {submitting ? t("assets.actions.working") : t("assets.actions.confirm")}
          </Button>
          <Button
            variant="outline"
            className="min-h-9"
            onClick={() => setPanel({ kind: "idle" })}
          >
            {t("assets.form.cancel")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canCommission && (
            <Button className="min-h-9" disabled={submitting} onClick={onCommission}>
              {submitting ? t("assets.actions.working") : t("assets.actions.commission")}
            </Button>
          )}
          {canAssign && (
            <Button
              variant="outline"
              className="min-h-9"
              onClick={() => setPanel({ kind: "assign" })}
            >
              {t("assets.actions.assign")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
