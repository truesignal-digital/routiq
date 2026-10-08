import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import { z } from "zod";
import type { CreateBranchPayload } from "@routiq/contracts";
import { Button } from "@/components/ui/button";
import {
  FormPanel,
  FormPanelCancel,
  FormPanelFooter,
  FormPanelHeader,
} from "@/components/command-form.js";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/error-banner.js";
import { notifyCommandSuccess } from "@/lib/notify.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { BRANCH_TIMEZONES, DEFAULT_BRANCH_TIMEZONE } from "./timezones.js";
import {
  BRANCH_NAME_MAX_LENGTH,
  branchNameProblem,
  isValidBranchCode,
} from "./validation.js";
import { useInvalidateBranches } from "./useBranches.js";

interface CreateBranchValues {
  code: string;
  name: string;
  timezone: string;
}

const EMPTY: CreateBranchValues = {
  code: "",
  name: "",
  timezone: DEFAULT_BRANCH_TIMEZONE,
};


/**
 * Opening a branch, as one command. The id is minted here rather than by the
 * server: every record UUID in ROUTIQ is client-generatable so the same form can
 * be filled offline and replayed (§6), and a retry of this dialog replays the
 * same envelope instead of opening a second branch.
 */
export function CreateBranchDialog({
  open,
  onOpenChange,
  onCreated,
  client = commandClient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  client?: CommandClient;
}) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const invalidateBranches = useInvalidateBranches();
  const [branchId, setBranchId] = useState(() => crypto.randomUUID());
  const [errorCode, setErrorCode] = useState<string>();
  const intent = useRef<CommandIntent<CreateBranchPayload> | undefined>(undefined);

  const formSchema = useMemo(
    () =>
      z.object({
        code: z
          .string()
          .trim()
          .toUpperCase()
          .refine(isValidBranchCode, t("branches.form.codeInvalid")),
        name: z.string().superRefine((value, ctx) => {
          const problem = branchNameProblem(value);
          if (problem === undefined) return;
          ctx.addIssue({
            code: "custom",
            message:
              problem === "tooLong"
                ? t("branches.form.nameTooLong", { max: BRANCH_NAME_MAX_LENGTH })
                : t("form.errors.required"),
          });
        }),
        timezone: z.string().min(1, t("form.errors.required")),
      }),
    [t],
  );

  const form = useForm<CreateBranchValues>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: EMPTY,
  });

  // Each opening creates a different branch: fresh id, empty fields.
  useEffect(() => {
    if (!open) return;
    setBranchId(crypto.randomUUID());
    setErrorCode(undefined);
    intent.current = undefined;
    form.reset(EMPTY);
  }, [open, form]);

  async function onSubmit(values: CreateBranchValues) {
    setErrorCode(undefined);
    intent.current ??= createCommandIntent<CreateBranchPayload>(client, "create-branch", 1);

    const result = await intent.current.submit({
      branchId,
      code: values.code.trim().toUpperCase(),
      name: values.name.trim(),
      timezone: values.timezone,
    });

    if (!result.ok) {
      // A taken code is about one field, so it is answered on that field rather
      // than as a banner the admin has to translate into an edit.
      if (result.code === "DUPLICATE_BRANCH_CODE") {
        form.setError("code", { message: t("errors.DUPLICATE_BRANCH_CODE") });
        return;
      }
      if (result.code === "DUPLICATE_BRANCH_NAME") {
        form.setError("name", { message: t("errors.DUPLICATE_BRANCH_NAME") });
        return;
      }
      setErrorCode(result.code);
      return;
    }

    notifyCommandSuccess("branches", "created", result.outcome.warnings, {
      values: { name: values.name.trim() },
    });
    await invalidateBranches();
    form.reset(EMPTY);
    onCreated();
    onOpenChange(false);
  }

  return (
    <FormPanel open={open} onClose={() => onOpenChange(false)}>
        <FormPanelHeader
          title={label("create-branch")}
          description={t("branches.add.description")}
        />

        <Form {...form}>
          <form
            className="flex flex-1 flex-col"
            onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
          >
            <div className="flex flex-col gap-4 p-4">
            {errorCode && <ErrorBanner code={errorCode} />}

            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("branches.form.code")}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      maxLength={8}
                      className="font-mono uppercase"
                      {...field}
                      onChange={(event) =>
                        field.onChange(event.target.value.toUpperCase())
                      }
                    />
                  </FormControl>
                  <FormDescription>{t("branches.form.codeHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("branches.form.name")}</FormLabel>
                  <FormControl>
                    <Input type="text" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("branches.form.timezone")}</FormLabel>
                  <Select
                    value={field.value || null}
                    onValueChange={(value) => field.onChange(value ?? "")}
                  >
                    <FormControl>
                      <SelectTrigger
                        className="w-full"
                        aria-label={t("branches.form.timezone")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {BRANCH_TIMEZONES.map((zone) => (
                        <SelectItem key={zone} value={zone}>
                          {zone}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            </div>

            <FormPanelFooter>
              <FormPanelCancel onDismiss={() => onOpenChange(false)}>
                {t("branches.form.cancel")}
              </FormPanelCancel>
              <Button
                type="submit"
                className="flex-1 sm:flex-none"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting
                  ? label("create-branch", "submitting")
                  : label("create-branch", "submit")}
              </Button>
            </FormPanelFooter>
          </form>
        </Form>
    </FormPanel>
  );
}
