import { ChartColumn, Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** Every chart has a table view (insights.html, chart rules): one button that swaps the two. */
export function ChartViewToggle({
  view,
  onChange,
}: {
  view: "chart" | "table";
  onChange: (view: "chart" | "table") => void;
}) {
  const { t } = useTranslation();
  const next = view === "chart" ? "table" : "chart";
  return (
    <div className="flex justify-end">
      <Button
        type="button"
        variant="ghost"
        size="desktop-sm"
        data-slot="chart-view-toggle"
        onClick={() => onChange(next)}
      >
        {next === "table" ? <Table2 aria-hidden /> : <ChartColumn aria-hidden />}
        {t(next === "table" ? "dashboard.chart.table" : "dashboard.chart.chart")}
      </Button>
    </div>
  );
}
