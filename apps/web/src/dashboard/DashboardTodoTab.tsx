import { useTranslation } from "react-i18next";
import { ToDoList } from "@/components/overview/to-do-list.js";
import { ErrorState } from "@/components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { todoItem } from "./attention-words.js";
import { useTodo } from "./useFleetAttention.js";

/**
 * Dashboard › To do: every row the server ranked, safety first, then money,
 * each with its one button. It counts the caller's whole Branch Scope, so the
 * shell's branch never narrows it (CONTEXT.md, Ambient Branch).
 */
export function DashboardTodoTab() {
  const { t, i18n } = useTranslation();
  const todo = useTodo();
  const data = todo.data;
  return (
    <Card data-slot="dashboard-todo">
      <CardHeader>
        <CardTitle>{t("dashboard.todo.title")}</CardTitle>
        <CardDescription>{t("dashboard.todo.description")}</CardDescription>
      </CardHeader>
      <CardContent>
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
