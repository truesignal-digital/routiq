import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import type {
  ActivityDetail,
  closeActivityPayload,
  reopenActivityPayload,
  substituteAssetPayload,
} from "@routiq/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "@/components/error-banner.js";
import { assetDisplayName } from "../assets/model.js";
import { useAssets } from "../assets/useAssets.js";
import { useMeContext } from "../auth/me.js";
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { notifyCommandSuccess } from "../lib/notify.js";
import { canRecordActivities, canReopenActivity } from "./permissions.js";

type ClosePayload = z.infer<typeof closeActivityPayload>;
type ReopenPayload = z.infer<typeof reopenActivityPayload>;
type SubstitutePayload = z.infer<typeof substituteAssetPayload>;
type Segment = ActivityDetail["segments"][number];

/**
 * A `datetime-local` input yields a wall clock with no zone, and every activity
 * command requires `z.iso.datetime({ offset: true })`. Stamping the offset here
 * keeps the ambiguity out of the payload: 18:30 in Douala stays 18:30+01:00.
 */
export function toOffsetIso(local: string, offsetMinutes: number): string {
  const [datePart = "", timePart = "00:00"] = local.split("T");
  const [hours = "00", minutes = "00", seconds = "00"] = timePart.split(":");
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const offsetRest = String(absolute % 60).padStart(2, "0");
  return `${datePart}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRest}`;
}

/** Minutes east of UTC for the browser's own zone at that wall clock. */
export function localOffsetMinutes(local: string): number {
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? 0 : -parsed.getTimezoneOffset();
}

function localToIso(local: string): string {
  return toOffsetIso(local, localOffsetMinutes(local));
}

/** Every activity write moves the same detail and list reads; one prefix covers both. */
function useActivityCommit() {
  const queryClient = useQueryClient();
  const session = useActiveSession();

  return async (successKey: string, warnings: readonly string[]) => {
    notifyCommandSuccess("activities", successKey, warnings);
    await queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "activities"],
    });
  };
}

type Panel = "none" | "close" | "reopen" | "substitute";

export function ActivityActions({
  activity,
  client = commandClient,
}: {
  activity: ActivityDetail;
  client?: CommandClient;
}) {
  const { t } = useTranslation();
  const me = useMeContext();
  const [panel, setPanel] = useState<Panel>("none");

  const canRecord = canRecordActivities(me?.role, me?.enabledModules);
  const canReopen = canReopenActivity(me?.role, me?.enabledModules);
  const openSegments = activity.segments.filter(
    (segment) => segment.endedAt === null,
  );

  const showClose = activity.status === "OPEN" && canRecord;
  const showSubstitute = showClose && openSegments.length > 0;
  const showReopen = activity.status === "CLOSED" && canReopen;
  if (!showClose && !showReopen && !showSubstitute) return null;

  const dismiss = () => setPanel("none");

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {showClose && (
          <Button className="min-h-9" onClick={() => setPanel("close")}>
            {t("activities.actions.close")}
          </Button>
        )}
        {showSubstitute && (
          <Button
            variant="outline"
            className="min-h-9"
            onClick={() => setPanel("substitute")}
          >
            {t("activities.actions.substitute")}
          </Button>
        )}
        {showReopen && (
          <Button
            variant="outline"
            className="min-h-9"
            onClick={() => setPanel("reopen")}
          >
            {t("activities.actions.reopen")}
          </Button>
        )}
      </div>

      {panel === "close" && (
        <CloseDialog activity={activity} client={client} onDismiss={dismiss} />
      )}
      {panel === "reopen" && (
        <ReopenDialog activity={activity} client={client} onDismiss={dismiss} />
      )}
      {panel === "substitute" && (
        <SubstituteDialog
          activity={activity}
          segments={openSegments}
          client={client}
          onDismiss={dismiss}
        />
      )}
    </>
  );
}

function CloseDialog({
  activity,
  client,
  onDismiss,
}: {
  activity: ActivityDetail;
  client: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const commit = useActivityCommit();
  const [endedAt, setEndedAt] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useRef<CommandIntent<ClosePayload> | undefined>(undefined);

  // MISSING_ACTUAL_DATES is one of the two hard blocks; asking here beats a
  // round trip that comes back ACTIVITY_CLOSE_BLOCKED.
  const endedAtRequired = activity.endedAt === null;
  const ready = !submitting && (!endedAtRequired || endedAt !== "");

  async function submit() {
    if (!ready) return;
    setError(undefined);
    setSubmitting(true);

    const trimmedNote = note.trim();
    const payload: ClosePayload = {
      activityId: activity.id,
      ...(endedAt === "" ? {} : { endedAt: localToIso(endedAt) }),
      ...(trimmedNote === "" ? {} : { note: trimmedNote }),
    };

    intent.current ??= createCommandIntent<ClosePayload>(
      client,
      "close-activity",
      1,
    );
    const result = await intent.current.submit(payload, {
      expectedVersion: activity.rowVersion,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.code);
      return;
    }
    await commit("closed", result.outcome.warnings);
    onDismiss();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("activities.actions.closeTitle")}</DialogTitle>
          <DialogDescription>
            {t("activities.actions.closeHint")}
          </DialogDescription>
        </DialogHeader>

        {error !== undefined && <ErrorBanner code={error} />}

        <div className="flex flex-col gap-2">
          <Label htmlFor="activity-close-ended-at">
            {endedAtRequired
              ? t("activities.actions.endedAt")
              : t("activities.actions.endedAtOptional")}
          </Label>
          <Input
            id="activity-close-ended-at"
            type="datetime-local"
            value={endedAt}
            onChange={(event) => setEndedAt(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="activity-close-note">
            {t("activities.actions.note")}
          </Label>
          <Textarea
            id="activity-close-note"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11 flex-1 sm:flex-none"
            onClick={onDismiss}
          >
            {t("activities.actions.cancel")}
          </Button>
          <Button
            className="min-h-11 flex-1 sm:flex-none"
            disabled={!ready}
            onClick={() => void submit()}
          >
            {submitting
              ? t("activities.actions.submitting")
              : t("activities.actions.closeSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({
  activity,
  client,
  onDismiss,
}: {
  activity: ActivityDetail;
  client: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const commit = useActivityCommit();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useRef<CommandIntent<ReopenPayload> | undefined>(undefined);

  // §5.1 realizes reopen's approval as a restricted role plus a reason on the
  // audit trail; an empty reason would make the trail worthless.
  const trimmedReason = reason.trim();
  const ready =
    !submitting && trimmedReason.length >= 1 && trimmedReason.length <= 300;

  async function submit() {
    if (!ready) return;
    setError(undefined);
    setSubmitting(true);

    intent.current ??= createCommandIntent<ReopenPayload>(
      client,
      "reopen-activity",
      1,
    );
    const result = await intent.current.submit(
      { activityId: activity.id, reason: trimmedReason },
      { expectedVersion: activity.rowVersion },
    );
    setSubmitting(false);

    if (!result.ok) {
      setError(result.code);
      return;
    }
    await commit("reopened", result.outcome.warnings);
    onDismiss();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("activities.actions.reopenTitle")}</DialogTitle>
          <DialogDescription>
            {t("activities.actions.reopenHint")}
          </DialogDescription>
        </DialogHeader>

        {error !== undefined && <ErrorBanner code={error} />}

        <div className="flex flex-col gap-2">
          <Label htmlFor="activity-reopen-reason">
            {t("activities.actions.reason")}
          </Label>
          <Textarea
            id="activity-reopen-reason"
            maxLength={300}
            placeholder={t("activities.actions.reasonPlaceholder")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11 flex-1 sm:flex-none"
            onClick={onDismiss}
          >
            {t("activities.actions.cancel")}
          </Button>
          <Button
            className="min-h-11 flex-1 sm:flex-none"
            disabled={!ready}
            onClick={() => void submit()}
          >
            {submitting
              ? t("activities.actions.submitting")
              : t("activities.actions.reopenSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The whole fleet, drained page by page. Stopping at the first keyset page would
 * hide the very truck that came to the rescue; pilot fleets are tens of rows.
 */
function useAssetOptions(
  excludeAssetId: string | undefined,
): Array<{ value: string; label: string }> {
  const { t } = useTranslation();
  const assetsQuery = useAssets();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = assetsQuery;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return useMemo(
    () =>
      (assetsQuery.data?.pages.flatMap((page) => page.items) ?? [])
        .filter((asset) => asset.id !== excludeAssetId)
        .map((asset) => {
          const name = assetDisplayName(asset);
          return {
            value: asset.id,
            label:
              name === asset.assetCode
                ? asset.assetCode
                : t("activities.actions.assetOption", {
                    code: asset.assetCode,
                    name,
                  }),
          };
        }),
    [assetsQuery.data, excludeAssetId, t],
  );
}

function readingValue(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function SubstituteDialog({
  activity,
  segments,
  client,
  onDismiss,
}: {
  activity: ActivityDetail;
  segments: readonly Segment[];
  client: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const commit = useActivityCommit();

  // One handover, one set of identities: generated on open so a retry replays
  // the same envelope instead of opening a second segment.
  const [ids] = useState(() => ({
    newSegmentId: crypto.randomUUID(),
    outgoingReadingId: crypto.randomUUID(),
    incomingReadingId: crypto.randomUUID(),
  }));
  const [outgoingSegmentId, setOutgoingSegmentId] = useState(
    segments[0]?.id ?? "",
  );
  const [substituteAssetId, setSubstituteAssetId] = useState("");
  const [handoverAt, setHandoverAt] = useState("");
  const [outgoingRaw, setOutgoingRaw] = useState("");
  const [incomingRaw, setIncomingRaw] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useRef<CommandIntent<SubstitutePayload> | undefined>(undefined);

  const outgoing = segments.find((segment) => segment.id === outgoingSegmentId);
  const assetOptions = useAssetOptions(outgoing?.assetId);

  const outgoingReadingValue = readingValue(outgoingRaw);
  const incomingReadingValue = readingValue(incomingRaw);
  const readingsUsable =
    (outgoingRaw.trim() === "" || outgoingReadingValue !== undefined) &&
    (incomingRaw.trim() === "" || incomingReadingValue !== undefined);
  const ready =
    !submitting &&
    outgoing !== undefined &&
    substituteAssetId !== "" &&
    handoverAt !== "" &&
    readingsUsable;

  async function submit() {
    if (!ready || outgoing === undefined) return;
    setError(undefined);
    setSubmitting(true);

    const handoverIso = localToIso(handoverAt);
    const trimmedReason = reason.trim();
    const payload: SubstitutePayload = {
      activityId: activity.id,
      outgoingSegmentId: outgoing.id,
      newSegmentId: ids.newSegmentId,
      substituteAssetId,
      handoverAt: handoverIso,
      ...(outgoingReadingValue === undefined
        ? {}
        : {
            outgoingReading: {
              readingId: ids.outgoingReadingId,
              readingType: "ODOMETER" as const,
              value: outgoingReadingValue,
              observedAt: handoverIso,
            },
          }),
      ...(incomingReadingValue === undefined
        ? {}
        : {
            incomingReading: {
              readingId: ids.incomingReadingId,
              readingType: "ODOMETER" as const,
              value: incomingReadingValue,
              observedAt: handoverIso,
            },
          }),
      ...(trimmedReason === "" ? {} : { reason: trimmedReason }),
    };

    intent.current ??= createCommandIntent<SubstitutePayload>(
      client,
      "substitute-asset",
      1,
    );
    // The row this command mutates is the outgoing SEGMENT, so its version —
    // not the activity's — is what the server checks.
    const result = await intent.current.submit(payload, {
      expectedVersion: outgoing.rowVersion,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.code);
      return;
    }
    await commit("substituted", result.outcome.warnings);
    onDismiss();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("activities.actions.substituteTitle")}</DialogTitle>
          <DialogDescription>
            {t("activities.actions.substituteHint")}
          </DialogDescription>
        </DialogHeader>

        {error !== undefined && <ErrorBanner code={error} />}

        <div className="flex flex-col gap-2">
          <Label>{t("activities.actions.outgoing")}</Label>
          <Select
            value={outgoingSegmentId || null}
            onValueChange={(value) => {
              setOutgoingSegmentId(value ?? "");
              setSubstituteAssetId("");
            }}
          >
            <SelectTrigger
              className="w-full"
              aria-label={t("activities.actions.outgoing")}
            >
              <SelectValue placeholder={t("activities.actions.choose")} />
            </SelectTrigger>
            <SelectContent>
              {segments.map((segment) => (
                <SelectItem key={segment.id} value={segment.id}>
                  {t("activities.actions.segmentOption", {
                    code: segment.assetCode,
                    role: t(`activities.roles.${segment.role}`),
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("activities.actions.incoming")}</Label>
          <Select
            value={substituteAssetId || null}
            onValueChange={(value) => setSubstituteAssetId(value ?? "")}
          >
            <SelectTrigger
              className="w-full"
              aria-label={t("activities.actions.incoming")}
            >
              <SelectValue placeholder={t("activities.actions.choose")} />
            </SelectTrigger>
            <SelectContent>
              {assetOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="activity-substitute-handover">
            {t("activities.actions.handoverAt")}
          </Label>
          <Input
            id="activity-substitute-handover"
            type="datetime-local"
            value={handoverAt}
            onChange={(event) => setHandoverAt(event.target.value)}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="activity-substitute-outgoing-reading">
              {t("activities.actions.outgoingReading")}
            </Label>
            <Input
              id="activity-substitute-outgoing-reading"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={outgoingRaw}
              onChange={(event) => setOutgoingRaw(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="activity-substitute-incoming-reading">
              {t("activities.actions.incomingReading")}
            </Label>
            <Input
              id="activity-substitute-incoming-reading"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={incomingRaw}
              onChange={(event) => setIncomingRaw(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="activity-substitute-reason">
            {t("activities.actions.substituteReason")}
          </Label>
          <Textarea
            id="activity-substitute-reason"
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11 flex-1 sm:flex-none"
            onClick={onDismiss}
          >
            {t("activities.actions.cancel")}
          </Button>
          <Button
            className="min-h-11 flex-1 sm:flex-none"
            disabled={!ready}
            onClick={() => void submit()}
          >
            {submitting
              ? t("activities.actions.submitting")
              : t("activities.actions.substituteSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
