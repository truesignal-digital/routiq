import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";
import { DateField } from "@/components/date-field";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  registerAssetPayload,
  templateFieldIssues,
  type AssetIdentityField,
  TEMPLATE_CODES,
  TEMPLATE_FIELDS,
} from "@routiq/contracts";
import { z } from "zod";
import { useForm, type ControllerRenderProps, type FieldPath } from "react-hook-form";
import { formatMoney, localizedLabel } from "@/lib/format";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useCommandLabel } from "@/commands/labels.js";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAssetRegistrationReference } from "@/assets/reference";
import {
  useCreatedElsewhereNotice,
  useFollowShellBranch,
} from "@/shell/branch-scope.js";
import { useActiveSession } from "@/auth/store";
import { useMeContext } from "@/auth/me.js";
import { applyTemplateFieldMetadata, applyValidationMetadata } from "@/commands/field-errors";
import { commandClient, commandStatusStore } from "@/commands/instance";
import { createCommandIntent } from "@/commands/intent";
import { FileUpload } from "@/components/ui/file-upload";
import { notifyCommandSuccess } from "@/lib/notify.js";
import { ErrorBanner } from "@/components/error-banner.js";
import { IDENTITY_MAX_LENGTH, identityMessage } from "@/assets/identity.js";

/**
 * The plate and chassis number are held to the contract's rule in the Details
 * edit's words (`identityMessage`), not the payload schema's generic length
 * message: same rule, same sentence on both forms (#122). Checked on the field
 * itself so the message shows before the required fields are filled.
 */
function identityField(field: AssetIdentityField, t: TFunction) {
  return z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      const message = identityMessage(field, value ?? "", t);
      if (message !== undefined) ctx.addIssue({ code: "custom", message });
    })
    .transform((value) => (value === undefined || value.trim() === "" ? undefined : value.trim()));
}

function registerAssetForm(t: TFunction) {
  return registerAssetPayload.extend({
    registrationNumber: identityField("registrationNumber", t),
    chassisNumber: identityField("chassisNumber", t),
  });
}

type FormInput = z.input<ReturnType<typeof registerAssetForm>>;
type FormOutput = z.output<ReturnType<typeof registerAssetForm>>;

const CAPACITY_UNITS = ["KG", "TONNE", "M3", "SEAT"] as const;

export function AssetRegisterScreen() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const reference = useAssetRegistrationReference();

  const [assetId] = useState(() => crypto.randomUUID());
  const intentRef = useRef(createCommandIntent<FormOutput>(commandClient, "register-asset", 2));
  const [activeCommandId, setActiveCommandId] = useState<string>();
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [errorCode, setErrorCode] = useState<string>();
  const me = useMeContext();

  const statuses = useSyncExternalStore(
    (onChange) => commandStatusStore.subscribe(onChange),
    () => commandStatusStore.getSnapshot(),
  );
  const submitting =
    activeCommandId !== undefined && statuses.get(activeCommandId)?.state === "submitting";

  const formSchema = useMemo(
    () =>
      registerAssetForm(t).superRefine((data, ctx) => {
        for (const issue of templateFieldIssues(data.templateCode, data.customValues)) {
          ctx.addIssue({
            code: "custom",
            path: ["customValues", issue.key],
            message: t(`assets.form.fieldErrors.${issue.kind}`),
          });
        }
      }),
    [t],
  );

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      assetId,
      assetCode: "",
      assetClassCode: "",
      templateCode: "TRUCKING",
      branchCode: "",
      customValues: {},
    },
  });
  const templateCode = form.watch("templateCode");
  const acquisitionAmount = form.watch("acquisitionAmountMinor");
  const branchCode = form.watch("branchCode");

  const branches = reference.data?.branches ?? [];
  useFollowShellBranch(branches, branchCode, (code) =>
    form.setValue("branchCode", code),
  );
  // The assets list this navigates to is narrowed by the shell, so an asset
  // registered into another agency would land off screen unannounced.
  const createdElsewhereNotice = useCreatedElsewhereNotice();

  /**
   * ADR-0004: a workspace runs the presets it enabled. Undefined means /v1/me
   * has not answered, in which case offering all of them matches today's
   * behaviour and the server stays the enforcement point.
   */
  const enabledPresets = me?.enabledPresets;
  const templateChoices = enabledPresets ?? [...TEMPLATE_CODES];
  useEffect(() => {
    // Also corrects the default when /v1/me lands after the form mounts.
    const [sole] = templateChoices;
    if (sole !== undefined && !templateChoices.includes(templateCode)) {
      form.setValue("templateCode", sole);
    }
  }, [templateChoices, templateCode, form]);
  const templateFields = useMemo(() => TEMPLATE_FIELDS[templateCode] ?? [], [templateCode]);

  async function onSubmit(values: FormOutput) {
    setErrorCode(undefined);
    const options = artifactIds.length > 0 ? { sourceArtifactIds: artifactIds } : {};
    setActiveCommandId(intentRef.current.current(values, options).envelope.commandId);
    const result = await intentRef.current.submit(values, options);
    if (!result.ok) {
      const setFieldError = (field: string, message: string) =>
        form.setError(field as Parameters<typeof form.setError>[0], { type: "server", message });
      if (result.code === "TEMPLATE_FIELD_INVALID") {
        applyTemplateFieldMetadata(result.metadata, t, setFieldError);
      } else if (result.code === "VALIDATION_FAILED") {
        applyValidationMetadata(result.metadata, t, setFieldError);
      } else if (result.code === "DUPLICATE_ASSET_CODE") {
        setFieldError("assetCode", t("errors.DUPLICATE_ASSET_CODE"));
      } else if (result.code === "DUPLICATE_REGISTRATION_NUMBER") {
        setFieldError("registrationNumber", t("errors.DUPLICATE_REGISTRATION_NUMBER"));
      }
      setErrorCode(result.code);
      return;
    }
    notifyCommandSuccess(
      "assets",
      "registered",
      result.outcome.warnings,
      createdElsewhereNotice({ branchCode: values.branchCode }) ?? {},
    );
    await queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "assets"],
    });
    void navigate({ to: "/assets" });
  }

  const labelFor = (item: { labelFr: string; labelEn: string }) =>
    localizedLabel(item);

  return (
    <PageContainer width="narrow">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {t("assets.form.eyebrow")}
      </p>
      <PageHeader className="mt-1" title={label("register-asset")} />

      <Form {...form}>
        <form
          className="mt-6 flex flex-col gap-5"
          onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
        >
          <FormField
            control={form.control}
            name="assetCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("assets.form.assetCode")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="assetClassCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.assetClass")}</FormLabel>
                  <FormControl>
                    <Select value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("assets.form.choose")} />
                      </SelectTrigger>
                      <SelectContent>
                        {reference.data?.assetClasses.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {labelFor(c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="branchCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.branch")}</FormLabel>
                  <FormControl>
                    <Select value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")}>
                      <SelectTrigger className="w-full">
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
                    </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* A single-preset workspace has nothing to choose: the effect above
              keeps the field on the one preset it runs (ADR-0004). */}
          {templateChoices.length > 1 && (
            <FormField
              control={form.control}
              name="templateCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.template")}</FormLabel>
                  <FormControl>
                    <Select value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("assets.form.choose")} />
                      </SelectTrigger>
                      <SelectContent>
                        {templateChoices.map((code) => (
                          <SelectItem key={code} value={code}>
                            {t(`assets.form.templates.${code}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}


          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="registrationNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.registrationNumber")}</FormLabel>
                  <FormControl>
                    <Input
                      maxLength={IDENTITY_MAX_LENGTH.registrationNumber}
                      {...textFieldProps(field)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="modelYear"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.modelYear")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      {...numberFieldProps(field)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="manufacturer"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.manufacturer")}</FormLabel>
                  <FormControl>
                    <Input {...textFieldProps(field)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="model"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.model")}</FormLabel>
                  <FormControl>
                    <Input {...textFieldProps(field)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="chassisNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.chassisNumber")}</FormLabel>
                  <FormControl>
                    <Input {...textFieldProps(field)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="acquisitionDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.acquisitionDate")}</FormLabel>
                  <FormControl>
                    <DateField
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={String(toControlValue(field.value))}
                      onChange={(next) => field.onChange(emptyToUndefined(next))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="acquisitionAmountMinor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.acquisitionAmount")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      {...numberFieldProps(field)}
                    />
                  </FormControl>
                  {typeof acquisitionAmount === "number" && Number.isFinite(acquisitionAmount) ? (
                    <FormDescription>{formatMoney(acquisitionAmount)}</FormDescription>
                  ) : undefined}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="capacityValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.capacityValue")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="decimal"
                      {...numberFieldProps(field)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="capacityUnit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.capacityUnit")}</FormLabel>
                  <FormControl>
                    <Select value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("assets.form.choose")} />
                      </SelectTrigger>
                      <SelectContent>
                        {CAPACITY_UNITS.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {t(`assets.form.units.${unit}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {templateFields.length > 0 && (
            <fieldset className="rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-medium">
                {t("assets.form.templateFields")}
              </legend>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {templateFields.map((templateField) => (
                  <FormField
                    key={templateField.key}
                    control={form.control}
                    name={`customValues.${templateField.key}`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t(`assets.form.custom.${templateField.key}`)}
                          {templateField.required === true ? " *" : ""}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type={templateField.type === "number" ? "number" : "text"}
                            inputMode={templateField.type === "number" ? "decimal" : undefined}
                            {...(templateField.type === "number"
                              ? numberFieldProps(field)
                              : textFieldProps(field))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            </fieldset>
          )}

          <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("finance.record.evidenceLabel")}</span>
          <FileUpload onChange={setArtifactIds} accept="image/jpeg,image/png,image/webp,application/pdf" />
        </div>

          {errorCode !== undefined && (
            <ErrorBanner code={errorCode} />
          )}

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void navigate({ to: "/assets" })}
            >
              {t("assets.form.cancel")}
            </Button>
            <Button type="submit" className="flex-1" disabled={submitting}>
              {label("register-asset", submitting ? "submitting" : "submit")}
            </Button>
          </div>
        </form>
      </Form>
    </PageContainer>
  );
}

function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

function emptyToNumber(value: unknown): unknown {
  if (value === "" || value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
}

// The payload schema wants `undefined` (not "") for unset optionals and real
// numbers for numeric fields, so the controller stores the coerced value while
// the control keeps rendering the raw text.
type OptionalField<TName extends FieldPath<FormInput>> = ControllerRenderProps<
  FormInput,
  TName
>;

function toControlValue(value: unknown): string | number {
  return typeof value === "string" || typeof value === "number" ? value : "";
}

function textFieldProps<TName extends FieldPath<FormInput>>(
  field: OptionalField<TName>,
) {
  return {
    name: field.name,
    ref: field.ref,
    onBlur: field.onBlur,
    value: toControlValue(field.value),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      field.onChange(emptyToUndefined(event.target.value)),
  };
}

function numberFieldProps<TName extends FieldPath<FormInput>>(
  field: OptionalField<TName>,
) {
  return {
    name: field.name,
    ref: field.ref,
    onBlur: field.onBlur,
    value: toControlValue(field.value),
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      field.onChange(emptyToNumber(event.target.value)),
  };
}
