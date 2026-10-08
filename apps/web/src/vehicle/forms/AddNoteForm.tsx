import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import { addNotePayload, NOTE_BODY_MAX } from "@routiq/contracts";
import { CommandForm, type CommandFormBack, type CommandSurface } from "@/components/command-form.js";
import { useCommandForm } from "@/components/use-command-form.js";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { PinnedAssetField } from "../../assets/PinnedAssetField.js";
import type { CommandClient } from "../../commands/instance.js";

export interface AddNoteFormProps {
  surface: CommandSurface;
  assetId: string;
  assetLabel?: string | undefined;
  client?: CommandClient | undefined;
  back?: CommandFormBack | undefined;
  /** After the note committed; the host refreshes what it shows. */
  onDone?: (() => void) | undefined;
  onDismiss: () => void;
}

/**
 * A remark on the vehicle's history. Notes are append-only: a correction is
 * another note, so the form says so rather than offering an edit later.
 */
export function AddNoteForm({ surface, assetId, assetLabel, client, back, onDone, onDismiss }: AddNoteFormProps) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const { form, formProps } = useCommandForm(addNotePayload, "add-note", 1, {
    defaults: () => ({ noteId: crypto.randomUUID(), entityType: "asset" as const, entityId: assetId, body: "" }),
    success: { namespace: "vehicle", message: "noteAdded" },
    onDone,
    onDismiss,
    client,
  });

  return (
    <CommandForm
      surface={surface}
      title={label("add-note")}
      description={t("vehicle.forms.note.description")}
      back={back}
      informativeCodes={["ASSET_NOT_OPERATIONAL"]}
      {...formProps}
    >
      <PinnedAssetField assetId={assetId} label={assetLabel} />
      <Form {...form}>
        <FormField
          control={form.control}
          name="body"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("vehicle.forms.note.label")}</FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  maxLength={NOTE_BODY_MAX}
                  placeholder={t("vehicle.forms.note.placeholder")}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </Form>
    </CommandForm>
  );
}
