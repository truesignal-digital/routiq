import { useTranslation } from "react-i18next";
import { InfoPopover } from "@/components/info-popover.js";
import { ToDoList } from "@/components/overview/to-do-list.js";
import { ErrorState } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { todoItem } from "./attention-words.js";
import { useTodo } from "./useFleetAttention.js";

/**
 * Dashboard › To do: every row the server ranked, safety first, then money,
 * each with its one button. It counts the caller's whole Branch Scope, so the
 * shell's branch never narrows it (CONTEXT.md, Ambient Branch); the scope stays
 * on screen because a branch picked in the header would otherwise suggest it.
 * The tab already names the page and counts the rows, so the card has no title.
 */
export function DashboardTodoTab() {
  const { t, i18n } = useTranslation();
  const todo = useTodo();
  const data = todo.data;
  return (
    <Card data-slot="dashboard-todo">
      <CardContent className="flex flex-col gap-1">
        <p data-slot="dashboard-todo-scope" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {t("dashboard.todo.scopeShort")}
          <InfoPopover label={t("dashboard.todo.scopeLabel")}>{t("dashboard.todo.scope")}</InfoPopover>
        </p>
        {todo.isError ? (
          <ErrorState
            message={t("dashboard.todo.loadFailed")}
            retryLabel={t("home.retry")}
            onRetry={() => void todo.refetch()}
          />
        ) : data === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <ToDoList
              items={data.rows.map((row) => todoItem(row, t, i18n.resolvedLanguage))}
              empty={t("dashboard.todo.empty")}
              limit={Number.POSITIVE_INFINITY}
            />
            {data.totalCount > data.rows.length && (
              <p data-slot="dashboard-todo-more" className="pt-3 text-xs text-muted-foreground">
                {t("dashboard.todo.more", { shown: data.rows.length, count: data.totalCount })}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
