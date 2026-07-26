import { useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMeContext } from "../auth/me.js";
import { commandClient } from "../commands/instance.js";
import { createCommandIntent } from "../commands/intent.js";
import { errorMessage } from "../lib/error-message.js";
import { useEntry } from "../finance/useEntry.js";
import { canReverseEntry } from "../finance/permissions.js";
import { validateReversalReason } from "../finance/model.js";
import { z } from "zod";
import { reverseEntryPayload } from "@routiq/contracts";

interface ReverseDialogState {
  open: boolean;
  reason: string;
  submitting: boolean;
  success?: boolean;
}

export function FinanceEntryDetailScreen() {
  const { t, i18n } = useTranslation();
  const { entryId } = useParams({ from: "/app/finance/entries/$entryId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMeContext();

  const entryQuery = useEntry(entryId);
  const [reverseDialog, setReverseDialog] = useState<ReverseDialogState>({ open: false, reason: "", submitting: false });
  const intentRef = useRef<any>(undefined);
  const [reverseError, setReverseError] = useState<string>();

  const labelOf = (item: { labelFr: string; labelEn: string }) =>
    i18n.resolvedLanguage === "en" ? item.labelEn : item.labelFr;

  const canReverse = canReverseEntry(me?.role, entryQuery.data?.status);

  const formatAmount = (minor: number) => {
    return new Intl.NumberFormat("fr-CM", {
      style: "decimal",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      signDisplay: "always",
    }).format(minor);
  };

  const handleReverseSubmit = async () => {
    if (!entryQuery.data || !validateReversalReason(reverseDialog.reason)) return;

    setReverseError(undefined);
    setReverseDialog((s) => ({ ...s, submitting: true }));

    const reversalEntryId = crypto.randomUUID();
    const payload = {
      reversalEntryId,
      originalEntryId: entryQuery.data.id,
      reason: reverseDialog.reason,
    };

    if (!intentRef.current) {
      intentRef.current = createCommandIntent<z.infer<typeof reverseEntryPayload>>(
        commandClient,
        "reverse-entry",
        1,
      );
    }

    const result = await intentRef.current.submit(payload, {
      expectedVersion: entryQuery.data.rowVersion,
    });

    setReverseDialog((s) => ({ ...s, submitting: false }));

    if (!result.ok) {
      setReverseError(result.code);
      return;
    }

    setReverseDialog((s) => ({ ...s, success: true }));
    await queryClient.invalidateQueries({ queryKey: ["ws"] });

    setTimeout(() => {
      void navigate({
        to: "/finance/entries/$entryId",
        params: { entryId: reversalEntryId },
      });
    }, 1500);
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6">
      <button
        type="button"
        className="flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground"
        onClick={() => void navigate({ to: "/finance/entries" })}
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("finance.entries.back")}
      </button>
      <h1 className="mt-2 text-2xl font-semibold">{t("finance.entries.detail.title")}</h1>

      {entryQuery.isPending ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("finance.entries.loading")}</p>
      ) : entryQuery.isError ? (
        <div role="alert" className="mt-6 flex flex-col gap-3">
          <p className="text-sm text-destructive">{t("finance.entries.loadFailed")}</p>
          <Button
            variant="outline"
            className="min-h-11 self-start"
            onClick={() => void entryQuery.refetch()}
          >
            {t("finance.entries.retry")}
          </Button>
        </div>
      ) : entryQuery.data ? (
        <div className="mt-6 space-y-6">
          <div className="rounded-xl border border-border bg-card p-4">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("finance.entries.detail.entryNumber")}
                </dt>
                <dd className="mt-1 font-mono">{entryQuery.data.entryNumber}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("finance.entries.detail.status")}
                </dt>
                <dd className="mt-1">
                  {t(`finance.entries.status.${entryQuery.data.status}`)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("finance.entries.detail.category")}
                </dt>
                <dd className="mt-1">{labelOf(entryQuery.data.category)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("finance.entries.detail.amount")}
                </dt>
                <dd className="mt-1 font-mono text-lg font-semibold">
                  {formatAmount(entryQuery.data.amountMinor)} {entryQuery.data.currency}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("finance.entries.detail.date")}
                </dt>
                <dd className="mt-1">{entryQuery.data.economicDate}</dd>
              </div>
              {entryQuery.data.postedAt && (
                <div>
                  <dt className="text-xs font-semibold uppercase text-muted-foreground">
                    {t("finance.entries.detail.postingDate")}
                  </dt>
                  <dd className="mt-1">
                    {new Date(entryQuery.data.postedAt).toLocaleDateString()}
                  </dd>
                </div>
              )}
              {entryQuery.data.counterpartyName && (
                <div>
                  <dt className="text-xs font-semibold uppercase text-muted-foreground">
                    {t("finance.entries.detail.counterparty")}
                  </dt>
                  <dd className="mt-1">{entryQuery.data.counterpartyName}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("finance.entries.detail.paymentMethod")}
                </dt>
                <dd className="mt-1">{entryQuery.data.paymentMethod}</dd>
              </div>
              {entryQuery.data.description && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase text-muted-foreground">
                    {t("finance.entries.detail.description")}
                  </dt>
                  <dd className="mt-1">{entryQuery.data.description}</dd>
                </div>
              )}
              {entryQuery.data.paymentReference && (
                <div>
                  <dt className="text-xs font-semibold uppercase text-muted-foreground">
                    {t("finance.entries.detail.paymentReference")}
                  </dt>
                  <dd className="mt-1 font-mono text-sm">{entryQuery.data.paymentReference}</dd>
                </div>
              )}
              {entryQuery.data.sourceReference && (
                <div>
                  <dt className="text-xs font-semibold uppercase text-muted-foreground">
                    {t("finance.entries.detail.sourceReference")}
                  </dt>
                  <dd className="mt-1 font-mono text-sm">{entryQuery.data.sourceReference}</dd>
                </div>
              )}
              {entryQuery.data.rejectedReason && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase text-muted-foreground">
                    {t("finance.entries.detail.rejectedReason")}
                  </dt>
                  <dd className="mt-1">{entryQuery.data.rejectedReason}</dd>
                </div>
              )}
            </dl>
          </div>

          {entryQuery.data.postings.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-4 font-semibold">{t("finance.entries.detail.postings")}</h2>
              <div className="space-y-2">
                {entryQuery.data.postings.map((posting) => (
                  <div key={posting.lineNo} className="flex items-center justify-between border-t border-border/50 py-2 text-sm first:border-t-0 first:pt-0">
                    <div className="flex flex-col">
                      <span className="font-medium">{labelOf(posting.category)}</span>
                      {posting.assetCode && (
                        <span className="text-xs text-muted-foreground">{posting.assetCode}</span>
                      )}
                    </div>
                    <span className="font-mono font-semibold">
                      {formatAmount(posting.amountMinor)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(entryQuery.data.reversesEntryId || entryQuery.data.reversedByEntryId) && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 font-semibold">{t("finance.entries.detail.reversalChain")}</h2>
              <div className="space-y-2">
                {entryQuery.data.reversesEntryId && (
                  <button
                    type="button"
                    onClick={() =>
                      void navigate({
                        to: "/finance/entries/$entryId",
                        params: { entryId: entryQuery.data.reversesEntryId! },
                      })
                    }
                    className="block text-left text-sm text-blue-600 hover:underline"
                  >
                    {t("finance.entries.detail.reversesEntry")} {entryQuery.data.reversesEntryId}
                  </button>
                )}
                {entryQuery.data.reversedByEntryId && (
                  <button
                    type="button"
                    onClick={() =>
                      void navigate({
                        to: "/finance/entries/$entryId",
                        params: { entryId: entryQuery.data.reversedByEntryId! },
                      })
                    }
                    className="block text-left text-sm text-blue-600 hover:underline"
                  >
                    {t("finance.entries.detail.reversedByEntry")} {entryQuery.data.reversedByEntryId}
                  </button>
                )}
              </div>
            </div>
          )}

          {canReverse && (
            <Button
              onClick={() => setReverseDialog((s) => ({ ...s, open: true }))}
              className="min-h-11 w-full"
            >
              {t("finance.entries.detail.reverseAction")}
            </Button>
          )}

          {reverseDialog.open && (
            <ReverseDialog
              isOpen={reverseDialog.open}
              reason={reverseDialog.reason}
              submitting={reverseDialog.submitting}
              error={reverseError}
              success={reverseDialog.success}
              onReasonChange={(reason) => setReverseDialog((s) => ({ ...s, reason }))}
              onCancel={() => setReverseDialog({ open: false, reason: "", submitting: false })}
              onSubmit={handleReverseSubmit}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}

function ReverseDialog({
  isOpen,
  reason,
  submitting,
  error,
  success,
  onReasonChange,
  onCancel,
  onSubmit,
}: {
  isOpen: boolean;
  reason: string;
  submitting: boolean;
  error: string | undefined;
  success: boolean | undefined;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();

  if (!isOpen) return null;

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="w-full max-w-sm rounded-xl bg-white p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-6 text-green-600" aria-hidden />
            <div>
              <h2 className="font-semibold text-green-900">
                {t("finance.entries.reversal.success")}
              </h2>
              <p className="mt-1 text-sm text-green-800">
                {t("finance.entries.reversal.successDesc")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-xl bg-white p-6">
        <h2 className="text-lg font-semibold">{t("finance.entries.reversal.title")}</h2>

        {error && (
          <div role="alert" className="mt-4 flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
            <p>{errorMessage(i18n, error)}</p>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <Label htmlFor="reason">{t("finance.entries.reversal.reasonLabel")}</Label>
          <textarea
            id="reason"
            placeholder={t("finance.entries.reversal.reasonPlaceholder")}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            className="min-h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            required
          />
        </div>

        <div className="mt-6 flex gap-2">
          <Button
            variant="outline"
            className="min-h-11 flex-1"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            className="min-h-11 flex-1"
            disabled={!validateReversalReason(reason) || submitting}
            onClick={() => void onSubmit()}
          >
            {submitting ? t("finance.entries.reversal.submitting") : t("finance.entries.reversal.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
