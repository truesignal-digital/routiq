import { useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AlertCircle, FileText } from "lucide-react";
import { formatMoney, localizedLabel } from "@/lib/format.js";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EntrySummary } from "@/finance/EntrySummary.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMeContext } from "@/auth/me.js";
import { commandClient } from "@/commands/instance.js";
import { createCommandIntent, type CommandIntent } from "@/commands/intent.js";
import { errorMessage } from "@/lib/error-message.js";
import {
  notifyCommandSuccess,
  notifyCommandWarnings,
} from "@/lib/notify.js";
import { useEntry } from "@/finance/useEntry.js";
import { canReverseEntry } from "@/finance/permissions.js";
import { validateReversalReason } from "@/finance/model.js";
import { z } from "zod";
import { ReversalLink } from "@/finance/ReversalLink.js";
import { reverseEntryPayload } from "@routiq/contracts";
import { ErrorBanner } from "@/components/error-banner.js";

interface ReverseDialogState {
  open: boolean;
  reason: string;
  submitting: boolean;
}

export function FinanceEntryDetailScreen() {
  const { t, i18n } = useTranslation();
  const { entryId } = useParams({ from: "/app/finance/entries/$entryId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMeContext();

  const entryQuery = useEntry(entryId);
  const [reverseDialog, setReverseDialog] = useState<ReverseDialogState>({ open: false, reason: "", submitting: false });
  const intentRef = useRef<CommandIntent<z.infer<typeof reverseEntryPayload>> | undefined>(undefined);
  const [reverseError, setReverseError] = useState<string>();

  const labelOf = (item: { labelFr: string; labelEn: string }) =>
    localizedLabel(item);

  const canReverse = canReverseEntry(me?.role, entryQuery.data?.status);


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

    intentRef.current ??= createCommandIntent<z.infer<typeof reverseEntryPayload>>(
      commandClient,
      "reverse-entry",
      1,
    );

    const result = await intentRef.current.submit(payload, {
      expectedVersion: entryQuery.data.rowVersion,
    });

    setReverseDialog((s) => ({ ...s, submitting: false }));

    if (!result.ok) {
      setReverseError(result.code);
      return;
    }

    setReverseDialog({ open: false, reason: "", submitting: false });
    notifyCommandSuccess("reversed");
    notifyCommandWarnings(result.outcome.warnings);
    await queryClient.invalidateQueries({ queryKey: ["ws"] });

    setTimeout(() => {
      void navigate({
        to: "/finance/entries/$entryId",
        params: { entryId: reversalEntryId },
      });
    }, 1500);
  };

  return (
    <PageContainer>
      <PageHeader
        title={t("finance.entries.detail.title")}
        onBack={() => void navigate({ to: "/finance/entries" })}
        backLabel={t("finance.entries.back")}
      />

      {entryQuery.isPending ? (
        <LoadingState className="mt-6" label={t("finance.entries.loading")} />
      ) : entryQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("finance.entries.loadFailed")}
          retryLabel={t("finance.entries.retry")}
          onRetry={() => void entryQuery.refetch()}
        />
      ) : entryQuery.data ? (
        <div className="mt-6 space-y-6">
          <Card>
            <CardContent>
              <EntrySummary entryId={entryId} />
            </CardContent>
          </Card>

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
                      {formatMoney(posting.amountMinor, { signDisplay: "always" })}
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
                  <ReversalLink entryId={entryQuery.data.reversesEntryId} type="reverses" />
                )}
                {entryQuery.data.reversedByEntryId && (
                  <ReversalLink entryId={entryQuery.data.reversedByEntryId} type="reversedBy" />
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
              onReasonChange={(reason) => setReverseDialog((s) => ({ ...s, reason }))}
              onCancel={() => setReverseDialog({ open: false, reason: "", submitting: false })}
              onSubmit={handleReverseSubmit}
            />
          )}
        </div>
      ) : (
        <EmptyState
          className="mt-6"
          icon={<FileText className="size-7" aria-hidden />}
          message={t("finance.entries.detail.notFound")}
        />
      )}
    </PageContainer>
  );
}

function ReverseDialog({
  isOpen,
  reason,
  submitting,
  error,
  onReasonChange,
  onCancel,
  onSubmit,
}: {
  isOpen: boolean;
  reason: string;
  submitting: boolean;
  error: string | undefined;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();

  if (!isOpen) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("finance.entries.reversal.title")}</DialogTitle>
        </DialogHeader>

        {error && (
          <ErrorBanner code={error} />
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="reason">{t("finance.entries.reversal.reasonLabel")}</Label>
          <Textarea id="reason" placeholder={t("finance.entries.reversal.reasonPlaceholder")} value={reason} onChange={(e) => onReasonChange(e.target.value)} />
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button
                variant="outline"
                className="min-h-11 flex-1 sm:flex-none"
              />
            }
          >
            {t("finance.entries.reversal.cancel")}
          </DialogClose>
          <Button
            className="min-h-11 flex-1 sm:flex-none"
            disabled={!validateReversalReason(reason) || submitting}
            onClick={() => void onSubmit()}
          >
            {submitting ? t("finance.entries.reversal.submitting") : t("finance.entries.reversal.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
