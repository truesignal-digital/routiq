import { useRef, useState } from "react";
import { DateTimeField } from "@/components/date-field";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import type { recordMeterReadingPayload } from "@routiq/contracts";
import {
  CommandForm,
  useCommandSubmission,
  type CommandFormBack,
  type CommandSurface,
} from "@/components/command-form.js";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PinnedAssetField } from "../assets/PinnedAssetField.js";
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { notifyCommandSuccess } from "../lib/notify.js";
import { localToIso, nowLocal, wholeNumber } from "./local-time.js";
import { READING_TYPES } from "./sheet/form.js";

type ReadingPayload = z.infer<typeof recordMeterReadingPayload>;
type ReadingType = (typeof READING_TYPES)[number];

/** One asset a trip's reading may be taken on. */
export interface ReadingAssetChoice {
  assetId: string;
  assetCode: string;
}

/** The meter's last known value, shown so a typo stands out before it is sent. */
export interface LastReading {
  readingType: ReadingType;
  value: number;
}

/**
 * Which asset the reading is on: one of a trip's trucks, chosen in the form,
 * or the one vehicle the form was opened from.
 */
export type ReadingTarget =
  | { assets: readonly ReadingAssetChoice[] }
  | { pinnedAssetId: string; pinnedAssetLabel?: string | undefined };

export type ReadingFormProps = ReadingTarget & {
  surface: CommandSurface;
  /** The trip the reading belongs to; a standalone reading has none. */
  activityId?: string | undefined;
  lastReading?: LastReading | undefined;
  client?: CommandClient | undefined;
  back?: CommandFormBack | undefined;
  onDone?: (() => void) | undefined;
  onDismiss: () => void;
};

/**
 * A manual meter reading, during a trip or on its own. A reading stays as it
 * was captured: one below the last is kept and flagged, never refused.
 */
export function ReadingForm(props: ReadingFormProps) {
  const { surface, activityId, lastReading, back, onDone, onDismiss } = props;
  const client = props.client ?? commandClient;
  const pinnedAssetId = "pinnedAssetId" in props ? props.pinnedAssetId : undefined;
  const choices = "assets" in props ? props.assets : [];

  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const submission = useCommandSubmission();

  const readingId = useRef(crypto.randomUUID());
  const [chosenAssetId, setAssetId] = useState(choices[0]?.assetId ?? "");
  const [readingType, setReadingType] = useState<ReadingType>(
    lastReading?.readingType ?? "ODOMETER",
  );
  const [valueRaw, setValueRaw] = useState("");
  const [observedAt, setObservedAt] = useState(() => nowLocal());
  const intent = useRef<CommandIntent<ReadingPayload> | undefined>(undefined);

  const assetId = pinnedAssetId ?? chosenAssetId;
  const value = wholeNumber(valueRaw);
  const ready = assetId !== "" && value !== undefined && observedAt !== "";

  // Every activity read, and — for a vehicle's own reading — that vehicle's
  // detail, whose last reading just moved.
  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "activities"],
    });
    if (pinnedAssetId !== undefined) {
      await queryClient.invalidateQueries({
        queryKey: ["ws", session?.workspaceSlug, "asset", pinnedAssetId],
      });
    }
  };

  async function submit() {
    if (!ready || value === undefined) return;
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<ReadingPayload>(
        client,
        "record-meter-reading",
        1,
      );
      return intent.current.submit({
        readingId: readingId.current,
        assetId,
        readingType,
        value,
        observedAt: localToIso(observedAt),
        source: "MANUAL",
        ...(activityId === undefined ? {} : { activityId }),
      });
    });
    if (!result.ok) return;
    // A reading below the last one is a fact worth keeping and a fact worth
    // querying — the server warns rather than blocks, so the toast has to say so.
    notifyCommandSuccess("activities", "readingRecorded", result.outcome.warnings);
    await invalidate();
    onDone?.();
    onDismiss();
  }

  return (
    <CommandForm
      surface={surface}
      title={t("activities.actions.addReadingTitle")}
      description={t("activities.actions.addReadingHint")}
      back={back}
      error={submission.error}
      submitLabel={t("activities.actions.addReadingSubmit")}
      submittingLabel={t("activities.actions.submitting")}
      cancelLabel={t("activities.actions.cancel")}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
      onDismiss={onDismiss}
    >
      {pinnedAssetId !== undefined ? (
        <PinnedAssetField
          assetId={pinnedAssetId}
          label={"pinnedAssetLabel" in props ? props.pinnedAssetLabel : undefined}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <Label>{t("activities.actions.readingAsset")}</Label>
          <Select
            value={chosenAssetId || null}
            onValueChange={(next) => setAssetId(next ?? "")}
          >
            <SelectTrigger
              className="w-full"
              aria-label={t("activities.actions.readingAsset")}
            >
              <SelectValue placeholder={t("activities.actions.choose")} />
            </SelectTrigger>
            <SelectContent>
              {choices.map((asset) => (
                <SelectItem key={asset.assetId} value={asset.assetId}>
                  {asset.assetCode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>{t("activities.actions.readingType")}</Label>
          <Select
            value={readingType}
            onValueChange={(next) => {
              if (next) setReadingType(next as ReadingType);
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
            aria-describedby={
              lastReading === undefined ? undefined : "activity-reading-last"
            }
            value={valueRaw}
            onChange={(event) => setValueRaw(event.target.value)}
          />
          {lastReading !== undefined && (
            <p id="activity-reading-last" className="text-xs text-muted-foreground">
              {t("vehicle.forms.lastReading", {
                readingType: lastReading.readingType,
                value: lastReading.value,
              })}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="activity-reading-observed">
          {t("activities.actions.readingObservedAt")}
        </Label>
        <DateTimeField
          id="activity-reading-observed"
          value={observedAt}
          onChange={setObservedAt}
        />
      </div>
    </CommandForm>
  );
}
