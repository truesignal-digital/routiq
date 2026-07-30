import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import type { registerPersonPayload } from "@routiq/contracts";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
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
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";

type RegisterPersonPayload = z.infer<typeof registerPersonPayload>;

const PERSON_ROLES = [
  "DRIVER",
  "CONDUCTOR",
  "ASSISTANT",
  "RELIEF",
  "MECHANIC",
  "CLERK",
  "OTHER",
] as const;

export interface RegisterPersonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The branch the new person belongs to; the dialog never asks for it. */
  branchCode: string;
  /** Fires with the client-minted id so the caller can select what it created. */
  onRegistered: (personId: string) => void;
  client?: CommandClient;
}

interface RegisterPersonValues {
  displayName: string;
  defaultRole: string;
  phone: string;
}

/**
 * Registering a driver mid-sheet, without losing the sheet. §3.1 makes Person a
 * command rather than a resolve-by-name because compensation attributes money
 * to an id — a typo must not silently split one worker's pay across two rows.
 */
export function RegisterPersonDialog({
  open,
  onOpenChange,
  branchCode,
  onRegistered,
  client = commandClient,
}: RegisterPersonDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const [personId, setPersonId] = useState(() => crypto.randomUUID());
  const [errorCode, setErrorCode] = useState<string>();
  const intent = useRef<CommandIntent<RegisterPersonPayload> | undefined>(undefined);

  const formSchema = useMemo(
    () =>
      z.object({
        displayName: z.string().trim().min(1, t("form.errors.required")).max(120),
        defaultRole: z.string(),
        phone: z.string().max(40),
      }),
    [t],
  );

  const form = useForm<RegisterPersonValues>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: { displayName: "", defaultRole: "", phone: "" },
  });

  // Each opening captures a different person, so it starts from a clean form
  // and a fresh id rather than replaying the last one.
  useEffect(() => {
    if (!open) return;
    setPersonId(crypto.randomUUID());
    setErrorCode(undefined);
    form.reset({ displayName: "", defaultRole: "", phone: "" });
  }, [open, form]);

  async function onSubmit(values: RegisterPersonValues) {
    setErrorCode(undefined);
    intent.current ??= createCommandIntent<RegisterPersonPayload>(
      client,
      "register-person",
      1,
    );

    const phone = values.phone.trim();
    const payload: RegisterPersonPayload = {
      personId,
      displayName: values.displayName.trim(),
      branchCode,
      ...(phone === "" ? {} : { phone }),
      ...(values.defaultRole === ""
        ? {}
        : { defaultRole: values.defaultRole as RegisterPersonPayload["defaultRole"] }),
    };

    const result = await intent.current.submit(payload);
    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "persons"],
    });
    onRegistered(personId);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("activities.registerPerson.title")}</DialogTitle>
          <DialogDescription>
            {t("activities.registerPerson.description")}
          </DialogDescription>
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
                  <FormLabel>{t("activities.registerPerson.nameLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      className="min-h-11"
                      placeholder={t("activities.registerPerson.namePlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultRole"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("activities.registerPerson.roleLabel")}</FormLabel>
                  <Select
                    value={field.value || null}
                    onValueChange={(value) => field.onChange(value ?? "")}
                  >
                    <FormControl>
                      <SelectTrigger className="min-h-11 w-full">
                        <SelectValue
                          placeholder={t("activities.registerPerson.rolePlaceholder")}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PERSON_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {t(`persons.roles.${role}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("activities.registerPerson.phoneLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      className="min-h-11"
                      placeholder={t("activities.registerPerson.phonePlaceholder")}
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
                className="min-h-11"
                onClick={() => onOpenChange(false)}
              >
                {t("activities.registerPerson.cancel")}
              </Button>
              <Button
                type="submit"
                className="min-h-11"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting
                  ? t("activities.registerPerson.submitting")
                  : t("activities.registerPerson.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
