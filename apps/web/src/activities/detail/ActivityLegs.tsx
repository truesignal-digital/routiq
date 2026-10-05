import type { ActivityDetail } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { LegLoadBadge } from "@/activities/TripStatusBadge.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format.js";

export interface ActivityLegsProps {
  legs: ActivityDetail["legs"];
}

/**
 * A plain table, not the DataTable: legs are a fixed handful of rows off one
 * paper sheet, with nothing to sort, filter, page or select.
 */
export function ActivityLegs({ legs }: ActivityLegsProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  if (legs.length === 0) return null;

  // A column nobody filled in is a column that only adds scrolling.
  const showDeparted = legs.some((leg) => leg.departedAt !== null);
  const showArrived = legs.some((leg) => leg.arrivedAt !== null);
  const showLoad = legs.some((leg) => leg.loadState !== null);
  const showDistance = legs.some((leg) => leg.distanceKm !== null);
  const showPassengers = legs.some((leg) => leg.passengerCount !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("activities.detail.legs")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                {t("activities.detail.legsTable.number")}
              </TableHead>
              <TableHead>{t("activities.detail.legsTable.route")}</TableHead>
              {showDeparted && (
                <TableHead>{t("activities.detail.legsTable.departed")}</TableHead>
              )}
              {showArrived && (
                <TableHead>{t("activities.detail.legsTable.arrived")}</TableHead>
              )}
              {showLoad && (
                <TableHead>{t("activities.detail.legsTable.load")}</TableHead>
              )}
              {showDistance && (
                <TableHead className="text-right">
                  {t("activities.detail.legsTable.distance")}
                </TableHead>
              )}
              {showPassengers && (
                <TableHead className="text-right">
                  {t("activities.detail.legsTable.passengers")}
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {legs.map((leg) => (
              <TableRow key={leg.id}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {leg.legNo}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {leg.originName} → {leg.destinationName}
                </TableCell>
                {showDeparted && (
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {leg.departedAt === null
                      ? "—"
                      : formatDateTime(leg.departedAt, locale)}
                  </TableCell>
                )}
                {showArrived && (
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {leg.arrivedAt === null ? "—" : formatDateTime(leg.arrivedAt, locale)}
                  </TableCell>
                )}
                {showLoad && (
                  <TableCell>
                    {leg.loadState === null ? (
                      "—"
                    ) : (
                      <LegLoadBadge state={leg.loadState} />
                    )}
                  </TableCell>
                )}
                {showDistance && (
                  <TableCell className="text-right tabular-nums">
                    {leg.distanceKm === null
                      ? "—"
                      : t("activities.detail.km", { count: leg.distanceKm })}
                  </TableCell>
                )}
                {showPassengers && (
                  <TableCell className="text-right tabular-nums">
                    {leg.passengerCount ?? "—"}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
