import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { CreateBranchPayload } from "@routiq/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { BRANCH_TIMEZONES, DEFAULT_BRANCH_TIMEZONE } from "./timezones.js";
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

const CODE_PATTERN = /^[A-Z0-9]{2,8}$/;

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
          .regex(CODE_PATTERN, t("branches.form.codeInvalid")),
        name: z.string().trim().min(1, t("form.errors.required")).max(120),
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
      setErrorCode(result.code);
      return;
    }

    await invalidateBranches();
    form.reset(EMPTY);
    onCreated();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("branches.add.title")}</DialogTitle>
          <DialogDescription>{t("branches.add.description")}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
          >
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
                      className="min-h-11 font-mono uppercase"
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
                    <Input type="text" className="min-h-11" {...field} />
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
                        className="min-h-11 w-full"
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

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => onOpenChange(false)}
              >
                {t("branches.form.cancel")}
              </Button>
              <Button
                type="submit"
                className="min-h-11"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting
                  ? t("branches.form.submitting")
                  : t("branches.add.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
