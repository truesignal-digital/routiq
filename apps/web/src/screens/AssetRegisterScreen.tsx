import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  registerAssetPayload,
  templateFieldIssues,
  TEMPLATE_CODES,
  TEMPLATE_FIELDS,
} from "@routiq/contracts";
import type { z } from "zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
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
import { useAssetRegistrationReference } from "../assets/reference.js";
import { useActiveSession } from "../auth/store.js";
import { applyTemplateFieldMetadata, applyValidationMetadata } from "../commands/field-errors.js";
import { commandClient, commandStatusStore } from "../commands/instance.js";
import { createCommandIntent } from "../commands/intent.js";
import { AttachmentField } from "../artifacts/AttachmentField.js";
import { errorMessage } from "../lib/error-message.js";
import { formatXAF } from "@routiq/domain";

type FormInput = z.input<typeof registerAssetPayload>;
type FormOutput = z.output<typeof registerAssetPayload>;

const CAPACITY_UNITS = ["KG", "TONNE", "M3", "SEAT"] as const;

export function AssetRegisterScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const reference = useAssetRegistrationReference();

  const [assetId] = useState(() => crypto.randomUUID());
  const intentRef = useRef(createCommandIntent<FormOutput>(commandClient, "register-asset", 1));
  const [activeCommandId, setActiveCommandId] = useState<string>();
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [errorCode, setErrorCode] = useState<string>();

  const statuses = useSyncExternalStore(
    (onChange) => commandStatusStore.subscribe(onChange),
    () => commandStatusStore.getSnapshot(),
  );
  const submitting =
    activeCommandId !== undefined && statuses.get(activeCommandId)?.state === "submitting";

  const formSchema = useMemo(
    () =>
      registerAssetPayload.superRefine((data, ctx) => {
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
      }
      setErrorCode(result.code);
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "assets"],
    });
    void navigate({ to: "/assets" });
  }

  const labelFor = (item: { labelFr: string; labelEn: string }) =>
    i18n.resolvedLanguage === "en" ? item.labelEn : item.labelFr;

  return (
    <section className="mx-auto w-full max-w-xl px-4 py-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {t("assets.form.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">{t("assets.form.title")}</h1>

      <Form {...form}>
        <form
          className="mt-6 flex flex-col gap-5"
          onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
        >
          <FormField name="assetCode">
            <FormItem>
              <FormLabel htmlFor="assetCode">{t("assets.form.assetCode")}</FormLabel>
              <FormControl>
                <Input id="assetCode" className="min-h-11" {...form.register("assetCode")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField name="assetClassCode">
              <FormItem>
                <FormLabel htmlFor="assetClassCode">{t("assets.form.assetClass")}</FormLabel>
                <FormControl>
                  <select
                    id="assetClassCode"
                    className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    {...form.register("assetClassCode")}
                  >
                    <option value="">{t("assets.form.choose")}</option>
                    {reference.data?.assetClasses.map((c) => (
                      <option key={c.code} value={c.code}>
                        {labelFor(c)}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>

            <FormField name="branchCode">
              <FormItem>
                <FormLabel htmlFor="branchCode">{t("assets.form.branch")}</FormLabel>
                <FormControl>
                  <select
                    id="branchCode"
                    className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    {...form.register("branchCode")}
                  >
                    <option value="">{t("assets.form.choose")}</option>
                    {reference.data?.branches.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>
          </div>

          <FormField name="templateCode">
            <FormItem>
              <FormLabel htmlFor="templateCode">{t("assets.form.template")}</FormLabel>
              <FormControl>
                <select
                  id="templateCode"
                  className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  {...form.register("templateCode")}
                >
                  {TEMPLATE_CODES.map((code) => (
                    <option key={code} value={code}>
                      {t(`assets.form.templates.${code}`)}
                    </option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField name="registrationNumber">
              <FormItem>
                <FormLabel htmlFor="registrationNumber">{t("assets.form.registrationNumber")}</FormLabel>
                <FormControl>
                  <Input
                    id="registrationNumber"
                    className="min-h-11"
                    {...form.register("registrationNumber", { setValueAs: emptyToUndefined })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>
            <FormField name="modelYear">
              <FormItem>
                <FormLabel htmlFor="modelYear">{t("assets.form.modelYear")}</FormLabel>
                <FormControl>
                  <Input
                    id="modelYear"
                    className="min-h-11"
                    type="number"
                    inputMode="numeric"
                    {...form.register("modelYear", { setValueAs: emptyToNumber })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>
            <FormField name="manufacturer">
              <FormItem>
                <FormLabel htmlFor="manufacturer">{t("assets.form.manufacturer")}</FormLabel>
                <FormControl>
                  <Input
                    id="manufacturer"
                    className="min-h-11"
                    {...form.register("manufacturer", { setValueAs: emptyToUndefined })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>
            <FormField name="model">
              <FormItem>
                <FormLabel htmlFor="model">{t("assets.form.model")}</FormLabel>
                <FormControl>
                  <Input
                    id="model"
                    className="min-h-11"
                    {...form.register("model", { setValueAs: emptyToUndefined })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>
            <FormField name="chassisNumber">
              <FormItem>
                <FormLabel htmlFor="chassisNumber">{t("assets.form.chassisNumber")}</FormLabel>
                <FormControl>
                  <Input
                    id="chassisNumber"
                    className="min-h-11"
                    {...form.register("chassisNumber", { setValueAs: emptyToUndefined })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>
            <FormField name="acquisitionDate">
              <FormItem>
                <FormLabel htmlFor="acquisitionDate">{t("assets.form.acquisitionDate")}</FormLabel>
                <FormControl>
                  <Input
                    id="acquisitionDate"
                    className="min-h-11"
                    type="date"
                    {...form.register("acquisitionDate", { setValueAs: emptyToUndefined })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>
            <FormField name="acquisitionAmountMinor">
              <FormItem>
                <FormLabel htmlFor="acquisitionAmountMinor">{t("assets.form.acquisitionAmount")}</FormLabel>
                <FormControl>
                  <Input
                    id="acquisitionAmountMinor"
                    className="min-h-11"
                    type="number"
                    inputMode="numeric"
                    step="1"
                    {...form.register("acquisitionAmountMinor", { setValueAs: emptyToNumber })}
                  />
                </FormControl>
                {typeof acquisitionAmount === "number" && Number.isFinite(acquisitionAmount) ? (
                  <FormDescription>{formatXAF(acquisitionAmount)}</FormDescription>
                ) : undefined}
                <FormMessage />
              </FormItem>
            </FormField>
            <FormField name="capacityValue">
              <FormItem>
                <FormLabel htmlFor="capacityValue">{t("assets.form.capacityValue")}</FormLabel>
                <FormControl>
                  <Input
                    id="capacityValue"
                    className="min-h-11"
                    type="number"
                    inputMode="decimal"
                    {...form.register("capacityValue", { setValueAs: emptyToNumber })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>
            <FormField name="capacityUnit">
              <FormItem>
                <FormLabel htmlFor="capacityUnit">{t("assets.form.capacityUnit")}</FormLabel>
                <FormControl>
                  <select
                    id="capacityUnit"
                    className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    {...form.register("capacityUnit", { setValueAs: emptyToUndefined })}
                  >
                    <option value="">{t("assets.form.choose")}</option>
                    {CAPACITY_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {t(`assets.form.units.${unit}`)}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>
          </div>

          {templateFields.length > 0 && (
            <fieldset className="rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-medium">
                {t("assets.form.templateFields")}
              </legend>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {templateFields.map((field) => (
                  <FormField key={field.key} name={`customValues.${field.key}`}>
                    <FormItem>
                      <FormLabel htmlFor={`cv-${field.key}`}>
                        {t(`assets.form.custom.${field.key}`)}
                        {field.required === true ? " *" : ""}
                      </FormLabel>
                      <FormControl>
                        <Input
                          id={`cv-${field.key}`}
                          className="min-h-11"
                          type={field.type === "number" ? "number" : "text"}
                          inputMode={field.type === "number" ? "decimal" : undefined}
                          {...form.register(`customValues.${field.key}`, {
                            setValueAs: field.type === "number" ? emptyToNumber : emptyToUndefined,
                          })}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  </FormField>
                ))}
              </div>
            </fieldset>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("attachments.label")}</span>
            <AttachmentField onChange={setArtifactIds} />
          </div>

          {errorCode !== undefined && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {errorMessage(i18n, errorCode)}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" className="min-h-11 flex-1" disabled={submitting}>
              {submitting ? t("assets.form.submitting") : t("assets.form.submit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void navigate({ to: "/assets" })}
            >
              {t("assets.form.cancel")}
            </Button>
          </div>
        </form>
      </Form>
    </section>
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
