import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import { z } from "zod";
import { ROLES, type AddMemberPayload, type MemberBranchScope } from "@routiq/contracts";
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
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { BranchScopeField, type BranchOption } from "./BranchScopeField.js";
import { MIN_PIN_LENGTH } from "./pin.js";

interface AddMemberValues {
  displayName: string;
  username: string;
  role: string;
  pin: string;
  confirmPin: string;
}

const EMPTY: AddMemberValues = {
  displayName: "",
  username: "",
  role: "",
  pin: "",
  confirmPin: "",
};

/**
 * Hiring, as one command. The PIN is typed here and never read back: the admin
 * reads it to the new member, and after this dialog closes it exists only as a
 * hash — there is no email flow to fall back on (§6a guard 1).
 */
export function AddMemberDialog({
  open,
  onOpenChange,
  branches,
  onAdded,
  client = commandClient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: readonly BranchOption[];
  onAdded: () => void;
  client?: CommandClient;
}) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const [principalId, setPrincipalId] = useState(() => crypto.randomUUID());
  const [branchScope, setBranchScope] = useState<MemberBranchScope>("ALL");
  const [errorCode, setErrorCode] = useState<string>();
  const intent = useRef<CommandIntent<AddMemberPayload> | undefined>(undefined);

  const formSchema = useMemo(
    () =>
      z
        .object({
          displayName: z.string().trim().min(1, t("form.errors.required")).max(120),
          username: z.string().trim().min(1, t("form.errors.required")).max(80),
          role: z.string().min(1, t("form.errors.required")),
          pin: z
            .string()
            .min(MIN_PIN_LENGTH, t("users.form.pinTooShort", { min: MIN_PIN_LENGTH }))
            .max(64),
          confirmPin: z.string(),
        })
        .refine((values) => values.pin === values.confirmPin, {
          path: ["confirmPin"],
          message: t("users.form.pinMismatch"),
        }),
    [t],
  );

  const form = useForm<AddMemberValues>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: EMPTY,
  });

  // Each opening hires a different person: fresh id, and no PIN left in the
  // fields from the last one.
  useEffect(() => {
    if (!open) return;
    setPrincipalId(crypto.randomUUID());
    setBranchScope("ALL");
    setErrorCode(undefined);
    form.reset(EMPTY);
  }, [open, form]);

  async function onSubmit(values: AddMemberValues) {
    setErrorCode(undefined);
    intent.current ??= createCommandIntent<AddMemberPayload>(client, "add-member", 1);

    const result = await intent.current.submit({
      principalId,
      displayName: values.displayName.trim(),
      username: values.username.trim(),
      pin: values.pin,
      role: values.role as AddMemberPayload["role"],
      branchScope,
    });

    if (!result.ok) {
      // The username collision is about one field, so it is answered on that
      // field rather than as a banner the admin has to translate into an edit.
      if (result.code === "USERNAME_TAKEN") {
        form.setError("username", { message: t("errors.USERNAME_TAKEN") });
        return;
      }
      setErrorCode(result.code);
      return;
    }

    notifyCommandSuccess("users", "added", result.outcome.warnings, {
      values: { name: values.displayName.trim() },
    });
    // Nothing carries the PIN out of this function: the form is emptied before
    // the dialog closes, so no later render can hold it.
    form.reset(EMPTY);
    await queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "members"],
    });
    onAdded();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label("add-member")}</DialogTitle>
          <DialogDescription>{t("users.add.description")}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
          >
            {errorCode && <ErrorBanner code={errorCode} />}

            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("users.form.displayName")}</FormLabel>
                  <FormControl>
                    <Input type="text" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("users.form.username")}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      autoComplete="off"
                      autoCapitalize="none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("users.form.role")}</FormLabel>
                  <Select
                    value={field.value || null}
                    onValueChange={(value) => field.onChange(value ?? "")}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("users.form.rolePlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {t(`users.roles.${role}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <BranchScopeField
              branches={branches}
              value={branchScope}
              onChange={setBranchScope}
            />

            <FormField
              control={form.control}
              name="pin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("users.form.pin")}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("users.form.confirmPin")}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t("users.form.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting
                  ? label("add-member", "submitting")
                  : label("add-member", "submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
