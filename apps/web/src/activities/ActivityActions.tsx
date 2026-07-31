import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import type {
  ActivityDetail,
  closeActivityPayload,
  LegEndpoint,
  recordExpensePayload,
  recordMeterReadingPayload,
  recordMovementLegPayload,
  reopenActivityPayload,
  substituteAssetPayload,
} from "@routiq/contracts";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/money-input.js";
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
import { assetDisplayName } from "../assets/display.js";
import { useAssets } from "../assets/useAssets.js";
import { useMeContext } from "../auth/me.js";
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { useCategories } from "../documents/useCategories.js";
import { parseMoneyXaf } from "../finance/model.js";
import { localizedLabel } from "../lib/format.js";
import { notifyCommandSuccess } from "../lib/notify.js";
import { canRecordActivities, canReopenActivity } from "./permissions.js";
import { PlaceEndpointField } from "./PlaceEndpointField.js";
import { LOAD_STATES, PAYMENT_METHODS, READING_TYPES } from "./sheet/form.js";

type ClosePayload = z.infer<typeof closeActivityPayload>;
type ReopenPayload = z.infer<typeof reopenActivityPayload>;
type SubstitutePayload = z.infer<typeof substituteAssetPayload>;
type LegPayload = z.infer<typeof recordMovementLegPayload>;
type ReadingPayload = z.infer<typeof recordMeterReadingPayload>;
type ExpensePayload = z.infer<typeof recordExpensePayload>;
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

type Panel =
  | "none"
  | "close"
  | "reopen"
  | "substitute"
  | "leg"
  | "reading"
  | "expense";

interface AssetChoice {
  assetId: string;
  assetCode: string;
}

/**
 * The trucks this job can charge to, primary first. A substitution puts two
 * segments on the same asset, so the list is deduplicated by asset, not segment.
 */
function assetChoices(activity: ActivityDetail): AssetChoice[] {
  const ordered = [...activity.segments].sort(
    (a, b) =>
      Number(b.role === "PRIMARY") - Number(a.role === "PRIMARY"),
  );
  const seen = new Set<string>();
  return ordered.flatMap((segment) => {
    if (seen.has(segment.assetId)) return [];
    seen.add(segment.assetId);
    return [{ assetId: segment.assetId, assetCode: segment.assetCode }];
  });
}

/** A `datetime-local` value for right now, in the operator's own zone. */
function nowLocal(): string {
  const now = new Date();
  const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** A `date` value for today, in the operator's own zone. */
function todayLocal(): string {
  return nowLocal().slice(0, 10);
}

function endpointFilled(endpoint: LegEndpoint | undefined): boolean {
  if (endpoint === undefined) return false;
  return (endpoint.kind === "place" ? endpoint.name : endpoint.text).trim() !== "";
}

function wholeNumber(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

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
  // Capture as the trip runs, not only at close-out: §6 accepts the fact when
  // and where it happens rather than making the clerk hoard it until the sheet.
  const showCapture = showClose;
  const assets = assetChoices(activity);
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
        {showCapture && (
          <Button
            variant="outline"
            className="min-h-9"
            onClick={() => setPanel("leg")}
          >
            {t("activities.actions.addLeg")}
          </Button>
        )}
        {showCapture && assets.length > 0 && (
          <Button
            variant="outline"
            className="min-h-9"
            onClick={() => setPanel("reading")}
          >
            {t("activities.actions.addReading")}
          </Button>
        )}
        {showCapture && assets.length > 0 && (
          <Button
            variant="outline"
            className="min-h-9"
            onClick={() => setPanel("expense")}
          >
            {t("activities.actions.addExpense")}
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
      {panel === "leg" && (
        <LegDialog
          activity={activity}
          segments={openSegments}
          client={client}
          onDismiss={dismiss}
        />
      )}
      {panel === "reading" && (
        <ReadingDialog
          activity={activity}
          assets={assets}
          client={client}
          onDismiss={dismiss}
        />
      )}
      {panel === "expense" && (
        <ExpenseDialog
          activity={activity}
          assets={assets}
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

function LegDialog({
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

  // Minted once per opening: a retry has to replay the same leg, not open a
  // second one beside it.
  const legId = useRef(crypto.randomUUID());
  const [origin, setOrigin] = useState<LegEndpoint | undefined>(undefined);
  const [destination, setDestination] = useState<LegEndpoint | undefined>(
    undefined,
  );
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? "");
  const [departedAt, setDepartedAt] = useState("");
  const [arrivedAt, setArrivedAt] = useState("");
  const [distanceRaw, setDistanceRaw] = useState("");
  const [loadState, setLoadState] = useState<(typeof LOAD_STATES)[number] | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useRef<CommandIntent<LegPayload> | undefined>(undefined);

  // legNo is unique per activity and client-assigned. Counting the rows would
  // collide the moment a leg was recorded out of order or removed, so the
  // number comes from the highest one already on the job.
  const nextLegNo =
    activity.legs.reduce((highest, leg) => Math.max(highest, leg.legNo), 0) + 1;

  const distanceKm = wholeNumber(distanceRaw);
  const distanceUsable = distanceRaw.trim() === "" || distanceKm !== undefined;
  const ready =
    !submitting &&
    endpointFilled(origin) &&
    endpointFilled(destination) &&
    distanceUsable;

  async function submit() {
    if (!ready || origin === undefined || destination === undefined) return;
    setError(undefined);
    setSubmitting(true);

    const payload: LegPayload = {
      legId: legId.current,
      activityId: activity.id,
      legNo: nextLegNo,
      origin,
      destination,
      customValues: {},
      ...(segmentId === "" ? {} : { segmentId }),
      ...(departedAt === "" ? {} : { departedAt: localToIso(departedAt) }),
      ...(arrivedAt === "" ? {} : { arrivedAt: localToIso(arrivedAt) }),
      ...(distanceKm === undefined ? {} : { distanceKm }),
      ...(loadState === "" ? {} : { loadState }),
    };

    intent.current ??= createCommandIntent<LegPayload>(
      client,
      "record-movement-leg",
      1,
    );
    const result = await intent.current.submit(payload);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.code);
      return;
    }
    await commit("legRecorded", result.outcome.warnings);
    onDismiss();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("activities.actions.addLegTitle")}</DialogTitle>
          <DialogDescription>
            {t("activities.actions.addLegHint", { legNo: nextLegNo })}
          </DialogDescription>
        </DialogHeader>

        {error !== undefined && <ErrorBanner code={error} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="activity-leg-origin">
              {t("activities.actions.legOrigin")}
            </Label>
            <PlaceEndpointField
              id="activity-leg-origin"
              label={t("activities.actions.legOrigin")}
              {...(origin === undefined ? {} : { value: origin })}
              onChange={setOrigin}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="activity-leg-destination">
              {t("activities.actions.legDestination")}
            </Label>
            <PlaceEndpointField
              id="activity-leg-destination"
              label={t("activities.actions.legDestination")}
              {...(destination === undefined ? {} : { value: destination })}
              onChange={setDestination}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="activity-leg-departed">
              {t("activities.actions.legDepartedAt")}
            </Label>
            <Input
              id="activity-leg-departed"
              type="datetime-local"
              value={departedAt}
              onChange={(event) => setDepartedAt(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="activity-leg-arrived">
              {t("activities.actions.legArrivedAt")}
            </Label>
            <Input
              id="activity-leg-arrived"
              type="datetime-local"
              value={arrivedAt}
              onChange={(event) => setArrivedAt(event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="activity-leg-distance">
              {t("activities.actions.legDistanceKm")}
            </Label>
            <Input
              id="activity-leg-distance"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={distanceRaw}
              onChange={(event) => setDistanceRaw(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("activities.actions.legLoadState")}</Label>
            <Select
              value={loadState || null}
              onValueChange={(value) =>
                setLoadState((value ?? "") as (typeof LOAD_STATES)[number] | "")
              }
            >
              <SelectTrigger
                className="w-full"
                aria-label={t("activities.actions.legLoadState")}
              >
                <SelectValue placeholder={t("activities.actions.choose")} />
              </SelectTrigger>
              <SelectContent>
                {LOAD_STATES.map((state) => (
                  <SelectItem key={state} value={state}>
                    {t(`activities.record.legs.loadStates.${state}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {segments.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label>{t("activities.actions.legSegment")}</Label>
            <Select
              value={segmentId || null}
              onValueChange={(value) => setSegmentId(value ?? "")}
            >
              <SelectTrigger
                className="w-full"
                aria-label={t("activities.actions.legSegment")}
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
        )}

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
              : t("activities.actions.addLegSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReadingDialog({
  activity,
  assets,
  client,
  onDismiss,
}: {
  activity: ActivityDetail;
  assets: readonly AssetChoice[];
  client: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const commit = useActivityCommit();

  const readingId = useRef(crypto.randomUUID());
  const [assetId, setAssetId] = useState(assets[0]?.assetId ?? "");
  const [readingType, setReadingType] =
    useState<(typeof READING_TYPES)[number]>("ODOMETER");
  const [valueRaw, setValueRaw] = useState("");
  const [observedAt, setObservedAt] = useState(() => nowLocal());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useRef<CommandIntent<ReadingPayload> | undefined>(undefined);

  const value = wholeNumber(valueRaw);
  const ready =
    !submitting && assetId !== "" && value !== undefined && observedAt !== "";

  async function submit() {
    if (!ready || value === undefined) return;
    setError(undefined);
    setSubmitting(true);

    const payload: ReadingPayload = {
      readingId: readingId.current,
      assetId,
      readingType,
      value,
      observedAt: localToIso(observedAt),
      source: "MANUAL",
      activityId: activity.id,
    };

    intent.current ??= createCommandIntent<ReadingPayload>(
      client,
      "record-meter-reading",
      1,
    );
    const result = await intent.current.submit(payload);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.code);
      return;
    }
    // A reading below the last one is a fact worth keeping and a fact worth
    // querying — the server warns rather than blocks, so the toast has to say so.
    await commit("readingRecorded", result.outcome.warnings);
    onDismiss();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("activities.actions.addReadingTitle")}</DialogTitle>
          <DialogDescription>
            {t("activities.actions.addReadingHint")}
          </DialogDescription>
        </DialogHeader>

        {error !== undefined && <ErrorBanner code={error} />}

        <div className="flex flex-col gap-2">
          <Label>{t("activities.actions.readingAsset")}</Label>
          <Select
            value={assetId || null}
            onValueChange={(value) => setAssetId(value ?? "")}
          >
            <SelectTrigger
              className="w-full"
              aria-label={t("activities.actions.readingAsset")}
            >
              <SelectValue placeholder={t("activities.actions.choose")} />
            </SelectTrigger>
            <SelectContent>
              {assets.map((asset) => (
                <SelectItem key={asset.assetId} value={asset.assetId}>
                  {asset.assetCode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>{t("activities.actions.readingType")}</Label>
            <Select
              value={readingType}
              onValueChange={(value) => {
                if (value) setReadingType(value as (typeof READING_TYPES)[number]);
              }}
            >
              <SelectTrigger
                className="w-full"
                aria-label={t("activities.actions.readingType")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {READING_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`activities.record.readings.types.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="activity-reading-value">
              {t("activities.actions.readingValue")}
            </Label>
            <Input
              id="activity-reading-value"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={valueRaw}
              onChange={(event) => setValueRaw(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="activity-reading-observed">
            {t("activities.actions.readingObservedAt")}
          </Label>
          <Input
            id="activity-reading-observed"
            type="datetime-local"
            value={observedAt}
            onChange={(event) => setObservedAt(event.target.value)}
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
              : t("activities.actions.addReadingSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseDialog({
  activity,
  assets,
  client,
  onDismiss,
}: {
  activity: ActivityDetail;
  assets: readonly AssetChoice[];
  client: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const commit = useActivityCommit();
  const categoriesQuery = useCategories("EXPENSE_CATEGORY");

  const entryId = useRef(crypto.randomUUID());
  const [categoryCode, setCategoryCode] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [economicDate, setEconomicDate] = useState(() => todayLocal());
  const [paymentMethod, setPaymentMethod] =
    useState<(typeof PAYMENT_METHODS)[number]>("CASH");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [description, setDescription] = useState("");
  const [assetId, setAssetId] = useState(assets[0]?.assetId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useRef<CommandIntent<ExpensePayload> | undefined>(undefined);

  const amountMinor = parseMoneyXaf(amountInput);
  const ready =
    !submitting &&
    categoryCode !== "" &&
    amountMinor !== null &&
    amountMinor > 0 &&
    economicDate !== "";

  async function submit() {
    if (!ready || amountMinor === null) return;
    setError(undefined);
    setSubmitting(true);

    const trimmedCounterparty = counterpartyName.trim();
    const trimmedDescription = description.trim();
    const payload: ExpensePayload = {
      entryId: entryId.current,
      branchCode: activity.branchCode,
      categoryCode,
      economicDate,
      // XAF has exponent 0: what the operator typed is already minor units.
      amountMinor,
      currency: "XAF",
      paymentMethod,
      estimateStatus: "ACTUAL",
      ...(trimmedCounterparty === ""
        ? {}
        : { counterpartyName: trimmedCounterparty }),
      ...(trimmedDescription === "" ? {} : { description: trimmedDescription }),
      postings: [
        {
          amountMinor,
          assetAttribution: "DIRECT",
          // Two dimensions on one line: the truck that spent it and the trip it
          // was spent on.
          activityId: activity.id,
          ...(assetId === "" ? {} : { assetId }),
        },
      ],
    };

    intent.current ??= createCommandIntent<ExpensePayload>(
      client,
      "record-expense",
      1,
    );
    const result = await intent.current.submit(payload);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.code);
      return;
    }
    // Above the tenant's threshold the entry lands SUBMITTED, not POSTED. That
    // is the approval rule working, so the toast reports it instead of hiding it.
    await commit(
      result.outcome.recordStatus === "SUBMITTED"
        ? "expenseSubmitted"
        : "expenseRecorded",
      result.outcome.warnings,
    );
    onDismiss();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("activities.actions.addExpenseTitle")}</DialogTitle>
          <DialogDescription>
            {t("activities.actions.addExpenseHint")}
          </DialogDescription>
        </DialogHeader>

        {error !== undefined && <ErrorBanner code={error} />}

        <div className="flex flex-col gap-2">
          <Label>{t("activities.actions.expenseCategory")}</Label>
          <Select
            value={categoryCode || null}
            onValueChange={(value) => setCategoryCode(value ?? "")}
            disabled={categoriesQuery.isPending || categoriesQuery.isError}
          >
            <SelectTrigger
              className="w-full"
              aria-label={t("activities.actions.expenseCategory")}
            >
              <SelectValue placeholder={t("activities.actions.choose")} />
            </SelectTrigger>
            <SelectContent>
              {(categoriesQuery.data ?? []).map((category) => (
                <SelectItem key={category.code} value={category.code}>
                  {localizedLabel(category)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="activity-expense-amount">
              {t("activities.actions.expenseAmount")}
            </Label>
            <MoneyInput
              id="activity-expense-amount"
              aria-label={t("activities.actions.expenseAmount")}
              value={amountInput}
              onValueChange={setAmountInput}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="activity-expense-date">
              {t("activities.actions.expenseEconomicDate")}
            </Label>
            <Input
              id="activity-expense-date"
              type="date"
              value={economicDate}
              onChange={(event) => setEconomicDate(event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>{t("activities.actions.expensePaymentMethod")}</Label>
            <Select
              value={paymentMethod}
              onValueChange={(value) => {
                if (value)
                  setPaymentMethod(value as (typeof PAYMENT_METHODS)[number]);
              }}
            >
              <SelectTrigger
                className="w-full"
                aria-label={t("activities.actions.expensePaymentMethod")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((method) => (
                  <SelectItem key={method} value={method}>
                    {t(`activities.record.entries.paymentMethods.${method}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("activities.actions.expenseAsset")}</Label>
            <Select
              value={assetId || null}
              onValueChange={(value) => setAssetId(value ?? "")}
            >
              <SelectTrigger
                className="w-full"
                aria-label={t("activities.actions.expenseAsset")}
              >
                <SelectValue placeholder={t("activities.actions.choose")} />
              </SelectTrigger>
              <SelectContent>
                {assets.map((asset) => (
                  <SelectItem key={asset.assetId} value={asset.assetId}>
                    {asset.assetCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="activity-expense-counterparty">
            {t("activities.actions.expenseCounterparty")}
          </Label>
          <Input
            id="activity-expense-counterparty"
            type="text"
            maxLength={160}
            value={counterpartyName}
            onChange={(event) => setCounterpartyName(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="activity-expense-description">
            {t("activities.actions.expenseDescription")}
          </Label>
          <Textarea
            id="activity-expense-description"
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
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
              : t("activities.actions.addExpenseSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
