import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TEMPLATE_FIELDS, type TemplateCode } from "@routiq/contracts";
import { Card } from "@/components/ui/card";
import { formatDate, formatDateTime, formatMoney, localizedLabel } from "@/lib/format.js";
import { useVehicle } from "../context.js";
import { recordReference } from "../model.js";
import { LinkButton } from "../parts.js";
import { makeAndModel } from "./IdentityStrip.js";

type Row = readonly [string, ReactNode];

/** Everything the header leaves out, in three columns: right now, the vehicle, its specifications. */
export function DetailsCard() {
  const { t, i18n } = useTranslation();
  const { asset, gates, panel } = useVehicle();
  const locale = i18n.language;
  const notRecorded = t("vehicle.details.notRecorded");
  const availability = asset.availability;
  const reading = asset.lastReading;

  const now: Row[] = [
    [
      t("vehicle.details.availability"),
      availability.state === "GROUNDED" ? (
        <>
          {t("vehicle.details.groundedSince", { date: formatDateTime(availability.since, locale) })}
          {" · "}
          <LinkButton onClick={() => panel.openRecord({ kind: "issue", id: availability.issue.id })}>
            {recordReference(availability.issue.id)}
          </LinkButton>
        </>
      ) : availability.state === "AVAILABLE" ? (
        availability.since === null ? (
          t("vehicle.details.available")
        ) : (
          t("vehicle.details.availableSince", { date: formatDateTime(availability.since, locale) })
        )
      ) : (
        t("vehicle.details.notAssessed")
      ),
    ],
    [
      t("vehicle.details.lifecycle"),
      asset.commissionedAt === null
        ? t(`assets.status.${asset.lifecycleStatus}`)
        : t("vehicle.details.lifecycleSince", {
            status: t(`assets.status.${asset.lifecycleStatus}`),
            date: formatDate(asset.commissionedAt, locale),
          }),
    ],
    [t("vehicle.details.homeBranch"), t("vehicle.details.homeBranchValue", { branch: asset.branch.name })],
    [
      t("vehicle.details.custodian"),
      asset.custodian === null ? (
        t("vehicle.details.nobodyAssigned")
      ) : (
        <>
          {asset.custodian.since === null
            ? asset.custodian.displayName
            : t("vehicle.details.custodianSince", {
                name: asset.custodian.displayName,
                date: formatDate(asset.custodian.since, locale),
              })}
          {!asset.custodian.active && (
            <span className="block text-xs font-normal text-muted-foreground">
              {t("vehicle.details.custodianInactive")}
            </span>
          )}
        </>
      ),
    ],
    [t("vehicle.details.reportedLocation"), t("vehicle.details.reportedLocationNone")],
  ];
  if (gates.trips) {
    now.push([
      t("vehicle.details.odometer"),
      reading === null ? (
        t("vehicle.facts.noReading")
      ) : (
        <>
          <LinkButton onClick={() => panel.openRecord({ kind: "readings" })}>
            {t("vehicle.facts.readingValue", { readingType: reading.readingType, value: reading.value })}
          </LinkButton>
          <span className="block text-xs font-normal text-muted-foreground">
            {t("vehicle.details.readingMeta", {
              date: formatDateTime(reading.observedAt, locale),
              source: t(`vehicle.readings.source.${reading.source}`),
              by: reading.recordedBy.displayName ?? t("history.actor.unknown"),
            })}
          </span>
        </>
      ),
    ]);
  }

  const vehicle: Row[] = [
    [t("vehicle.details.fleetCode"), asset.assetCode],
    [t("vehicle.details.plate"), asset.registrationNumber ?? notRecorded],
    [t("vehicle.details.makeModel"), makeAndModel(asset) || notRecorded],
    [t("vehicle.details.year"), asset.modelYear === null ? notRecorded : String(asset.modelYear)],
    [t("vehicle.details.class"), localizedLabel(asset.category, locale)],
    [t("vehicle.details.chassis"), <span className="break-all">{asset.chassisNumber ?? notRecorded}</span>],
    [
      t("vehicle.details.acquired"),
      asset.acquisitionDate === null
        ? notRecorded
        : // Money is shown only to those who read the books.
          gates.money && asset.acquisitionAmountMinor !== null
          ? t("vehicle.details.acquiredWithAmount", {
              date: formatDate(asset.acquisitionDate, locale),
              amount: formatMoney(asset.acquisitionAmountMinor, { currency: asset.currency, locale }),
            })
          : formatDate(asset.acquisitionDate, locale),
    ],
  ];

  const fields = TEMPLATE_FIELDS[asset.templateCode as TemplateCode] ?? [];
  const specifications: Row[] = fields.map((field) => {
    const value = asset.customValues[field.key];
    return [
      t(`assets.form.custom.${field.key}`),
      value === undefined || value === null || value === "" ? notRecorded : String(value),
    ];
  });

  return (
    <Card className="gap-0 py-0">
      <div className="grid divide-y md:grid-cols-[1.25fr_1fr_0.8fr] md:divide-x md:divide-y-0">
        <DetailsColumn title={t("vehicle.details.rightNow")} rows={now} />
        <DetailsColumn title={t("vehicle.details.vehicle")} rows={vehicle} />
        <DetailsColumn title={t("vehicle.details.specifications")} rows={specifications} />
      </div>
    </Card>
  );
}

function DetailsColumn({ title, rows }: { title: string; rows: readonly Row[] }) {
  const { t } = useTranslation();
  return (
    <section className="p-4">
      <h2 className="mb-2.5 text-xs font-medium text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("vehicle.details.noSpecifications")}</p>
      ) : (
        <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 font-medium">{value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </section>
  );
}
