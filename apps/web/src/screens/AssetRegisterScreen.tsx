import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  registerAssetPayload,
  templateFieldIssues,
  TEMPLATE_CODES,
  TEMPLATE_FIELDS,
} from "@asset/contracts";
import type { z } from "zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAssetRegistrationReference } from "../assets/reference.js";
import { useActiveSession } from "../auth/store.js";
import { applyTemplateFieldMetadata, applyValidationMetadata } from "../commands/field-errors.js";
import { commandClient, commandStatusStore } from "../commands/instance.js";
import { createCommandIntent } from "../commands/intent.js";
import { AttachmentField } from "../artifacts/AttachmentField.js";
import { errorMessage } from "../lib/error-message.js";
import { formatXAF } from "@asset/domain";

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

  const customFieldError = (key: string) => {
    const errors = form.formState.errors.customValues as
      | Record<string, { message?: unknown }>
      | undefined;
    const message = errors?.[key]?.message;
    return typeof message !== "string" ? undefined : (
      <p className="text-xs text-destructive">{message}</p>
    );
  };

  const fieldError = (name: keyof FormInput) => {
    const message = form.formState.errors[name]?.message;
    return typeof message !== "string" ? undefined : (
      <p className="text-xs text-destructive">{message}</p>
    );
  };

  return (
    <section className="mx-auto w-full max-w-xl px-4 py-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {t("assets.form.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">{t("assets.form.title")}</h1>

      <form
        className="mt-6 flex flex-col gap-5"
        onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="assetCode">{t("assets.form.assetCode")}</Label>
          <Input id="assetCode" className="min-h-11" {...form.register("assetCode")} />
          {fieldError("assetCode")}
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="assetClassCode">{t("assets.form.assetClass")}</Label>
            <select
              id="assetClassCode"
              className="min-h-11 rounded-md border border-input bg-transparent px-3 text-sm"
              {...form.register("assetClassCode")}
            >
              <option value="">{t("assets.form.choose")}</option>
              {reference.data?.assetClasses.map((c) => (
                <option key={c.code} value={c.code}>
                  {labelFor(c)}
                </option>
              ))}
            </select>
            {fieldError("assetClassCode")}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="branchCode">{t("assets.form.branch")}</Label>
            <select
              id="branchCode"
              className="min-h-11 rounded-md border border-input bg-transparent px-3 text-sm"
              {...form.register("branchCode")}
            >
              <option value="">{t("assets.form.choose")}</option>
              {reference.data?.branches.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
            {fieldError("branchCode")}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="templateCode">{t("assets.form.template")}</Label>
          <select
            id="templateCode"
            className="min-h-11 rounded-md border border-input bg-transparent px-3 text-sm"
            {...form.register("templateCode")}
          >
            {TEMPLATE_CODES.map((code) => (
              <option key={code} value={code}>
                {t(`assets.form.templates.${code}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="registrationNumber">{t("assets.form.registrationNumber")}</Label>
            <Input
              id="registrationNumber"
              className="min-h-11"
              {...form.register("registrationNumber", { setValueAs: emptyToUndefined })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="modelYear">{t("assets.form.modelYear")}</Label>
            <Input
              id="modelYear"
              className="min-h-11"
              type="number"
              inputMode="numeric"
              {...form.register("modelYear", { setValueAs: emptyToNumber })}
            />
            {fieldError("modelYear")}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="manufacturer">{t("assets.form.manufacturer")}</Label>
            <Input
              id="manufacturer"
              className="min-h-11"
              {...form.register("manufacturer", { setValueAs: emptyToUndefined })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="model">{t("assets.form.model")}</Label>
            <Input
              id="model"
              className="min-h-11"
              {...form.register("model", { setValueAs: emptyToUndefined })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="chassisNumber">{t("assets.form.chassisNumber")}</Label>
            <Input
              id="chassisNumber"
              className="min-h-11"
              {...form.register("chassisNumber", { setValueAs: emptyToUndefined })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="acquisitionDate">{t("assets.form.acquisitionDate")}</Label>
            <Input
              id="acquisitionDate"
              className="min-h-11"
              type="date"
              {...form.register("acquisitionDate", { setValueAs: emptyToUndefined })}
            />
            {fieldError("acquisitionDate")}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="acquisitionAmountMinor">{t("assets.form.acquisitionAmount")}</Label>
            <Input
              id="acquisitionAmountMinor"
              className="min-h-11"
              type="number"
              inputMode="numeric"
              step="1"
              {...form.register("acquisitionAmountMinor", { setValueAs: emptyToNumber })}
            />
            {typeof acquisitionAmount === "number" && Number.isFinite(acquisitionAmount) ? (
              <p className="text-xs text-muted-foreground">{formatXAF(acquisitionAmount)}</p>
            ) : undefined}
            {fieldError("acquisitionAmountMinor")}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="capacityValue">{t("assets.form.capacityValue")}</Label>
            <Input
              id="capacityValue"
              className="min-h-11"
              type="number"
              inputMode="decimal"
              {...form.register("capacityValue", { setValueAs: emptyToNumber })}
            />
            {fieldError("capacityValue")}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="capacityUnit">{t("assets.form.capacityUnit")}</Label>
            <select
              id="capacityUnit"
              className="min-h-11 rounded-md border border-input bg-transparent px-3 text-sm"
              {...form.register("capacityUnit", { setValueAs: emptyToUndefined })}
            >
              <option value="">{t("assets.form.choose")}</option>
              {CAPACITY_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {t(`assets.form.units.${unit}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {templateFields.length > 0 && (
          <fieldset className="rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-medium">
              {t("assets.form.templateFields")}
            </legend>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {templateFields.map((field) => (
                <div key={field.key} className="flex flex-col gap-2">
                  <Label htmlFor={`cv-${field.key}`}>
                    {t(`assets.form.custom.${field.key}`)}
                    {field.required === true ? " *" : ""}
                  </Label>
                  <Input
                    id={`cv-${field.key}`}
                    className="min-h-11"
                    type={field.type === "number" ? "number" : "text"}
                    inputMode={field.type === "number" ? "decimal" : undefined}
                    {...form.register(`customValues.${field.key}`, {
                      setValueAs: field.type === "number" ? emptyToNumber : emptyToUndefined,
                    })}
                  />
                  {customFieldError(field.key)}
                </div>
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
