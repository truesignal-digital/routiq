import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DateField, DateTimeField } from "@/components/date-field";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import type { z } from "zod";
import type {
  ActivityDetail,
  closeActivityPayload,
  LegEndpoint,
  recordMovementLegPayload,
  reopenActivityPayload,
  substituteAssetPayload,
} from "@routiq/contracts";
import {
  CommandForm,
  useCommandSubmission,
  type CommandFormProps,
} from "@/components/command-form.js";
import { Button } from "@/components/ui/button";
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
import { assetDisplayName } from "../assets/display.js";
import { useAssets } from "../assets/useAssets.js";
import { useMeContext } from "../auth/me.js";
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { notifyCommandSuccess } from "../lib/notify.js";
import { ALL_BRANCHES } from "../shell/branch-context.js";
import { canCloseActivity, canRecordActivities, canReopenActivity } from "./permissions.js";
import { localToIso, wholeNumber } from "./local-time.js";
import { PlaceEndpointField } from "./PlaceEndpointField.js";
import { ReadingForm, type ReadingAssetChoice } from "./ReadingForm.js";
import { RecordEntryForm } from "../finance/RecordEntryForm.js";
import { LOAD_STATES } from "./sheet/form.js";

export { localOffsetMinutes, toOffsetIso } from "./local-time.js";

type ClosePayload = z.infer<typeof closeActivityPayload>;
type ReopenPayload = z.infer<typeof reopenActivityPayload>;
type SubstitutePayload = z.infer<typeof substituteAssetPayload>;
type LegPayload = z.infer<typeof recordMovementLegPayload>;
type Segment = ActivityDetail["segments"][number];

/** Every activity write moves the same detail and list reads; one prefix covers both. */
function useActivityCommit() {
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "activities"],
    });

  return {
    commit: async (successKey: string, warnings: readonly string[]) => {
      notifyCommandSuccess("activities", successKey, warnings);
      await invalidate();
    },
    invalidate,
  };
}

/**
 * The trip's own forms: the activities wording on the shared form shell,
 * with a conflict refreshing the trip before the form closes. Facts (a leg, a
 * substitute) open in the side panel; decisions (close, reopen) in a dialog.
 */
function ActivityForm({
  surface,
  onDismiss,
  onReload,
  ...props
}: Omit<
  CommandFormProps,
  "surface" | "title" | "onReload"
> & {
  surface: "sheet" | "dialog";
  title: string;
  onReload: () => Promise<unknown>;
  children: ReactNode;
}) {
  return (
    <CommandForm
      {...props}
      surface={surface}
      onReload={async () => {
        await onReload();
        onDismiss();
      }}
      onDismiss={onDismiss}
    />
  );
}

type Panel =
  | "none"
  | "close"
  | "reopen"
  | "substitute"
  | "leg"
  | "reading"
  | "expense";

type AssetChoice = ReadingAssetChoice;

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

function endpointFilled(endpoint: LegEndpoint | undefined): boolean {
  if (endpoint === undefined) return false;
  return (endpoint.kind === "place" ? endpoint.name : endpoint.text).trim() !== "";
}

export function ActivityActions({
  activity,
  client = commandClient,
}: {
  activity: ActivityDetail;
  client?: CommandClient;
}) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const me = useMeContext();
  const [panel, setPanel] = useState<Panel>("none");

  const canRecord = canRecordActivities(me?.role, me?.enabledModules);
  const canReopen = canReopenActivity(me?.role, me?.enabledModules);
  const openSegments = activity.segments.filter(
    (segment) => segment.endedAt === null,
  );

  const showClose =
    activity.status === "OPEN" && canCloseActivity(me, me?.enabledModules, activity);
  const showSubstitute = showClose && openSegments.length > 0;
  const showReopen = activity.status === "CLOSED" && canReopen;
  // Capture as the trip runs, not only at close-out: §6 accepts the fact when
  // and where it happens rather than making the clerk hoard it until the sheet.
  const showCapture = activity.status === "OPEN" && canRecord;
  const assets = assetChoices(activity);
  if (!showClose && !showReopen && !showSubstitute && !showCapture) return null;

  const dismiss = () => setPanel("none");

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {showClose && (
          <Button onClick={() => setPanel("close")}>
            {label("close-activity")}
          </Button>
        )}
        {showCapture && (
          <Button
            variant="outline"
            onClick={() => setPanel("leg")}
          >
            {label("record-movement-leg")}
          </Button>
        )}
        {showCapture && assets.length > 0 && (
          <Button
            variant="outline"
            onClick={() => setPanel("reading")}
          >
            {label("record-meter-reading")}
          </Button>
        )}
        {showCapture && assets.length > 0 && (
          <Button
            variant="outline"
            onClick={() => setPanel("expense")}
          >
            {label("record-expense")}
          </Button>
        )}
        {showSubstitute && (
          <Button
            variant="outline"
            onClick={() => setPanel("substitute")}
          >
            {label("substitute-asset")}
          </Button>
        )}
        {showReopen && (
          <Button
            variant="outline"
            onClick={() => setPanel("reopen")}
          >
            {label("reopen-activity")}
          </Button>
        )}
      </div>

      {panel === "close" && (
        <CloseTripDialog activity={activity} client={client} onDismiss={dismiss} />
      )}
      {panel === "reopen" && (
        <ReopenTripDialog activity={activity} client={client} onDismiss={dismiss} />
      )}
      {panel === "substitute" && (
        <SubstituteForm
          activity={activity}
          segments={openSegments}
          client={client}
          onDismiss={dismiss}
        />
      )}
      {panel === "leg" && (
        <LegForm
          activity={activity}
          segments={openSegments}
          client={client}
          onDismiss={dismiss}
        />
      )}
      {panel === "reading" && (
        <ReadingForm
          surface="sheet"
          assets={assets}
          activityId={activity.id}
          client={client}
          onDismiss={dismiss}
        />
      )}
      {panel === "expense" && (
        <TripExpenseForm
          activity={activity}
          assets={assets}
          running={openSegments}
          client={client}
          onDismiss={dismiss}
        />
      )}
    </>
  );
}

function CloseTripDialog({
  activity,
  client,
  onDismiss,
}: {
  activity: ActivityDetail;
  client: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const { commit, invalidate } = useActivityCommit();
  const submission = useCommandSubmission();
  const [endedAt, setEndedAt] = useState("");
  const [note, setNote] = useState("");
  const intent = useRef<CommandIntent<ClosePayload> | undefined>(undefined);

  // MISSING_ACTUAL_DATES is one of the two hard blocks; asking here beats a
  // round trip that comes back ACTIVITY_CLOSE_BLOCKED.
  const endedAtRequired = activity.endedAt === null;
  const ready = !endedAtRequired || endedAt !== "";

  async function submit() {
    if (!ready) return;

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
    const current = intent.current;
    const result = await submission.run(() =>
      current.submit(payload, {
        expectedVersion: activity.rowVersion,
      }),
    );
    if (!result.ok) return;
    await commit("closed", result.outcome.warnings);
    onDismiss();
  }

  return (
    <ActivityForm
      surface="dialog"
      title={label("close-activity")}
      description={t("activities.actions.closeHint")}
      error={submission.error}
      command="close-activity"
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
      onReload={invalidate}
      onDismiss={onDismiss}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="activity-close-ended-at">
          {endedAtRequired
            ? t("activities.actions.endedAt")
            : t("activities.actions.endedAtOptional")}
        </Label>
        <DateTimeField
          id="activity-close-ended-at"
          value={endedAt}
          onChange={setEndedAt}
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

    </ActivityForm>
  );
}

function ReopenTripDialog({
  activity,
  client,
  onDismiss,
}: {
  activity: ActivityDetail;
  client: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const { commit, invalidate } = useActivityCommit();
  const submission = useCommandSubmission();
  const [reason, setReason] = useState("");
  const intent = useRef<CommandIntent<ReopenPayload> | undefined>(undefined);

  // §5.1 realizes reopen's approval as a restricted role plus a reason on the
  // audit trail; an empty reason would make the trail worthless.
  const trimmedReason = reason.trim();
  const ready =
    trimmedReason.length >= 1 && trimmedReason.length <= 300;

  async function submit() {
    if (!ready) return;

    intent.current ??= createCommandIntent<ReopenPayload>(
      client,
      "reopen-activity",
      1,
    );
    const current = intent.current;
    const result = await submission.run(() =>
      current.submit(
        { activityId: activity.id, reason: trimmedReason },
        { expectedVersion: activity.rowVersion },
      ),
    );
    if (!result.ok) return;
    await commit("reopened", result.outcome.warnings);
    onDismiss();
  }

  return (
    <ActivityForm
      surface="dialog"
      title={label("reopen-activity")}
      description={t("activities.actions.reopenHint")}
      error={submission.error}
      command="reopen-activity"
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
      onReload={invalidate}
      onDismiss={onDismiss}
    >
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

    </ActivityForm>
  );
}

/**
 * The whole fleet, drained page by page. Stopping at the first keyset page would
 * hide the very truck that came to the rescue; pilot fleets are tens of rows.
 * The shell's agency is excluded on purpose — the rescue most worth recording is
 * the one that came from the next branch over.
 */
function useAssetOptions(
  excludeAssetId: string | undefined,
): Array<{ value: string; label: string }> {
  const { t } = useTranslation();
  const assetsQuery = useAssets({ branchId: ALL_BRANCHES });
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

function SubstituteForm({
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
  const label = useCommandLabel();
  const { commit, invalidate } = useActivityCommit();
  const submission = useCommandSubmission();

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
  const intent = useRef<CommandIntent<SubstitutePayload> | undefined>(undefined);

  const outgoing = segments.find((segment) => segment.id === outgoingSegmentId);
  const assetOptions = useAssetOptions(outgoing?.assetId);

  const outgoingReadingValue = wholeNumber(outgoingRaw);
  const incomingReadingValue = wholeNumber(incomingRaw);
  const readingsUsable =
    (outgoingRaw.trim() === "" || outgoingReadingValue !== undefined) &&
    (incomingRaw.trim() === "" || incomingReadingValue !== undefined);
  const ready =
    outgoing !== undefined &&
    substituteAssetId !== "" &&
    handoverAt !== "" &&
    readingsUsable;

  async function submit() {
    if (!ready || outgoing === undefined) return;

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
    const current = intent.current;
    const result = await submission.run(() =>
      current.submit(payload, {
        expectedVersion: outgoing.rowVersion,
      }),
    );
    if (!result.ok) return;
    await commit("substituted", result.outcome.warnings);
    onDismiss();
  }

  return (
    <ActivityForm
      surface="sheet"
      title={label("substitute-asset")}
      description={t("activities.actions.substituteHint")}
      error={submission.error}
      command="substitute-asset"
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
      onReload={invalidate}
      onDismiss={onDismiss}
    >
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
        <DateTimeField
          id="activity-substitute-handover"
          value={handoverAt}
          onChange={setHandoverAt}
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

    </ActivityForm>
  );
}

function LegForm({
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
  const label = useCommandLabel();
  const { commit, invalidate } = useActivityCommit();
  const submission = useCommandSubmission();

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
  const intent = useRef<CommandIntent<LegPayload> | undefined>(undefined);

  // legNo is unique per activity and client-assigned. Counting the rows would
  // collide the moment a leg was recorded out of order or removed, so the
  // number comes from the highest one already on the job.
  const nextLegNo =
    activity.legs.reduce((highest, leg) => Math.max(highest, leg.legNo), 0) + 1;

  const distanceKm = wholeNumber(distanceRaw);
  const distanceUsable = distanceRaw.trim() === "" || distanceKm !== undefined;
  const ready =
    endpointFilled(origin) &&
    endpointFilled(destination) &&
    distanceUsable;

  async function submit() {
    if (!ready || origin === undefined || destination === undefined) return;

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
    const current = intent.current;
    const result = await submission.run(() => current.submit(payload));
    if (!result.ok) return;
    await commit("legRecorded", result.outcome.warnings);
    onDismiss();
  }

  return (
    <ActivityForm
      surface="sheet"
      title={label("record-movement-leg")}
      description={t("activities.actions.addLegHint", { legNo: nextLegNo })}
      error={submission.error}
      command="record-movement-leg"
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
      onReload={invalidate}
      onDismiss={onDismiss}
    >
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
          <DateTimeField
            id="activity-leg-departed"
            value={departedAt}
            onChange={setDepartedAt}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="activity-leg-arrived">
            {t("activities.actions.legArrivedAt")}
          </Label>
          <DateTimeField
            id="activity-leg-arrived"
            value={arrivedAt}
            onChange={setArrivedAt}
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

    </ActivityForm>
  );
}

/**
 * A mid-trip expense is the same form as every other expense: RecordEntryForm
 * in the side panel, its line charged to the truck and to this trip.
 */
function TripExpenseForm({
  activity,
  assets,
  running,
  client,
  onDismiss,
}: {
  activity: ActivityDetail;
  assets: readonly AssetChoice[];
  running: readonly Segment[];
  client: CommandClient;
  onDismiss: () => void;
}) {
  const { invalidate } = useActivityCommit();
  // The truck on the road spends the money: the one running segment's, or the
  // trip's only truck. Otherwise the operator picks it.
  const runningAssetId = running.length === 1 ? running[0]?.assetId : undefined;
  const only =
    assets.find((choice) => choice.assetId === runningAssetId) ??
    (assets.length === 1 ? assets[0] : undefined);

  return (
    <RecordEntryForm
      surface="sheet"
      initialDirection="EXPENSE"
      lockDirection
      {...(only === undefined ? {} : { pinnedAssetId: only.assetId, pinnedAssetLabel: only.assetCode })}
      link={{ activityId: activity.id }}
      defaultBranchCode={activity.branchCode}
      client={client}
      onRecorded={() => {
        void invalidate();
        onDismiss();
      }}
      onDismiss={onDismiss}
    />
  );
}
