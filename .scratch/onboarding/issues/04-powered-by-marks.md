# 04 — "Powered by" marks on outbound artifacts

Status: needs-triage

## What

- PDF/printed reports: tenant logo top, discreet footer "Généré par <brand>" + URL.
- CSV exports: brand header line.
- Login screen: small "powered by" mark.
- fr-CM default, en switchable; no sentence concatenation (i18n rule).

## Why

Reports circulate to insurers, owners, banks, partners — the exact audience partners want to reach. Marketing rides existing artifacts, zero extra distribution work.

## Notes

- Non-removable at standard tier; white-label removal reserved as a future paid tier. No code for tiering now — just never promise removability.
- Lands whenever report rendering lands; do not build report/PDF rendering early just for the footer.
