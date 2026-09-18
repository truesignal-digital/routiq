# Vehicle workspace v1 — implementation contract

This reference defines the next internal-fleet slice. **The workspace and the additions marked Planned below are not implemented by this document.** Existing behavior is identified separately. Delivery and review belong to [#43](https://github.com/truesignal-digital/routiq/issues/43) and [#44](https://github.com/truesignal-digital/routiq/issues/44).

## Product boundary

The first customer is a company managing its own vehicles in Cameroon. The first useful outcome is explainable recorded operating spend: a manager can open a vehicle, see what was recorded, inspect the source and approval history, and act through existing permissions. Do not require trip revenue, passenger counts or freight jobs to obtain value.

The vehicle workspace is a view over existing records and commands, not a replacement asset schema, second ledger or new workflow engine. Company/branch overviews and cross-vehicle approval queues remain global. The workspace is their record-specific destination.

Preserve TRUCKING and PASSENGER_TRANSPORT. Use the existing shadcn Base UI/base-nova components and French/English catalogs. In the internal-fleet experience, the user-facing words are Vehicles / Véhicules; internal Asset identifiers and API routes do not need a wholesale rename.

This direction curates the owner's customer choice, the September 4 product/code review, and the team's branch/vehicle-workspace discussion. Broader research is distilled in [Internal-fleet product scope](../concepts/internal-fleet-product-scope.md). Research suggestions about payments, temporary authority and maintenance are not accepted v1 capabilities merely because they appeared in a mock-up.

## Header: source and meaning

| Visible field | Existing source | V1 behavior / required addition |
| --- | --- | --- |
| Fleet code | `assets.assetCode` | Required stable identifier; retain even when a plate exists. |
| Plate | `registrationNumber` | Optional; show “Not recorded,” not the fleet code masquerading as a plate. |
| Make / model | `manufacturer`, `model` | Optional readable description; no fabricated model or image. |
| Vehicle category | `assetClassCode` and category labels | Reuse existing classifications. No new per-customer entity model. |
| Home branch | `assets.branchId` and branch read | Administrative home, **not** physical location. Existing transfers remain governed by `assign-asset`. |
| Lifecycle | `lifecycleStatus` | Display existing status; do not treat IN_SERVICE as proof of readiness. |
| Current custodian | `custodianMembershipId` exists in storage and assignment command | **Planned:** add a nullable, tenant-checked custodian summary to the authorized detail read. Label Custodian, not Driver or Manager. Until exposed, show “Not available.” No assignment-history model is added here. |
| Availability | No complete integrated availability read on this baseline | Show “Not assessed.” Do not derive “Available” from absence of a work order or from lifecycle alone. Maintenance integration is separate. |
| Reported location | No authoritative last-location contract on this baseline | Show “No report.” Do not substitute home branch, a trip destination, or a browser GPS guess. Location reporting later needs observed time and source. |

Keep chassis number, year, acquisition data and other specifications in a details section, not a crowded header. Unknown, not recorded and unavailable-to-the-reader are distinct states. None grants extra authority. The header must not expose another tenant's member or a person outside the authorized record context.

## Initial sections and actions

Stable sections: **Overview, Money, Documents, History**. Preserve selected section, period and list filters in shareable navigation. Keep the vehicle identity visible. Do not show unimplemented Maintenance, Assignments, Fuel analytics or Payments tabs as working features.

- Overview: header, clearly named period spend and actionable records that actually exist. Missing data is explicit.
- Money: posted operating expense, pending review separately, category breakdown, contributing entries, evidence/history links and permitted expense/review/correction actions.
- Documents: reuse existing vehicle document records, renewal and supersession commands. A renewal creates a new version; do not replace old evidence.
- History: authorized records and audit events, paginated on demand. Never a separate editable “timeline ledger.”

Phone: compact identity and section selector, readable record cards, full-screen capture. Desktop: line tabs, table and contextual drawer with full-detail escape. Load section records on demand rather than fetching every module on arrival. A long form must not lose a draft when a drawer closes or a route changes; #45 owns durable capture/recovery.

Hide actions the actor cannot perform. An executive can inspect but cannot record, approve, reverse, lock or reopen periods. The UI uses current membership/module context; server authorization remains decisive. Command capabilities do not implicitly define read permission. Do not import the entire identity-capabilities candidate just to obtain a read gate (#47).

## Money: precise meanings

| Label | Definition |
| --- | --- |
| Posted operating expense | Sum **signed vehicle-attributed postings** for EXPENSE entries in POSTED or REVERSED state, in the selected posting period and currency, within the actor's tenant/branch scope. Includes the original and its negative reversal. It is not total ownership cost, cash paid or company profit. |
| Awaiting review | SUBMITTED expense postings attributed to this vehicle. With a month selector, use the entry's economic month and label that basis explicitly: these entries have no posting period yet. Do not add this amount to posted spend. |
| Rejected | Visible in a separate record filter/history, never included in posted or pending totals. |
| Evidence missing | An actionable entry lacks the required linked source evidence under its applicable policy. Distinguish not supplied, unverified, verified and unavailable; an uploaded file alone is not verification. Do not infer receipt presence from free text or a payment reference. |
| Recorded payment method/reference | The supplied method/reference on the entry. It does not prove payment, settlement or reconciliation. Those workflows remain #46. |

XAF has exponent zero: 150,000 XAF is stored as 150,000 minor units. No division by 100. Calendar economic dates remain the same day across viewer time zones; posting/audit timestamps are instants. A late posting retains its economic date and shows the actual posting period. Do not silently make an economic-month chart and a posting-period card appear to have the same basis.

The company total uses the entry's complete signed postings; the vehicle total uses **only its matching posting lines**. For a 100,000 XAF entry allocated 60,000 to vehicle A and 40,000 to B, show 60,000 on A, not 100,000. Detail may show the complete entry with both allocations clearly labelled. Never repeat the complete entry amount for each vehicle.

Zero means “no qualifying recorded postings,” not free operation or complete records. An incomplete capture history cannot support a claim of savings, growth, profit, theft or idle capacity. Cost/km, fuel efficiency, budget variance, utilization and ownership cost are deferred until their inputs, coverage and denominators are specified.

## Worked scenario using existing authority

Fixture: one company, Douala branch, vehicle VEH-001, September open. A scoped FIELD_SUBMITTER records a 150,000 XAF repair with one posting attributed to VEH-001, a receipt and economic date September 4. Under the existing default 100,000 XAF auto-post threshold for that role, this is submitted for review. Thresholds are configuration, not a new universal company policy.

1. Recording the expense creates one entry. Exact retry with the same command identity returns the same result; it does not create a second charge. The vehicle shows 150,000 awaiting review and 0 posted for this example.
2. A FINANCE_APPROVER with the required branch scope reviews the entry/evidence and approves through the existing command. Pending becomes 0; posted expense becomes 150,000. Approval is not payment.
3. The executive opens the vehicle's 150,000 figure, sees the matching posting and original entry, and opens history/evidence without write controls. The company/branch, vehicle and period remain consistent through navigation.
4. Finance identifies a duplicate and reverses the posted entry with a reason and current record version. The original stays in history as REVERSED; a second POSTED entry carries -150,000. In the same open period the pair nets to 0. The receipt remains attached to its original record; it is not deleted or silently reassigned.
5. If the original period is locked, the existing late-posting/reversal rules use the current calendar month in the workspace timezone. If that month is also locked, refuse with PERIOD_LOCKED; do not search for an arbitrary open month. Otherwise show the negative amount there, not a rewritten closed-period total. Explain the link back to the original.

No destination-branch operating authority, cashier role, custody transfer, payment execution or maintenance release is introduced by this scenario.

## Planned contracts and migrations — before UI implementation

1. **Internal-fleet preset:** add `INTERNAL_FLEET` to the existing enabled-preset model, registration/provisioning validation and localized vocabulary. Its starter pack uses applicable existing vehicle/expense/document categories and existing approval rules; it requires no transport activity or revenue. Preserve existing preset bindings and grandfathering semantics. Do not relabel transport tenants or enable a new preset merely to change a sidebar word. No generic preset engine.
2. **Vehicle detail:** extend the current asset-detail response with a nullable custodian summary sourced from the existing membership reference. Do not add driver, permanent manager, last location or availability columns to simulate missing domains. Keep unknown location/availability explicit until their own commands and policies exist.
3. **Vehicle money read:** add a focused period-aware read alongside asset detail (proposed `GET /v1/assets/:assetId/finance?periodCode=YYYY-MM`), with currency, date basis, signed posted expense and separately labelled pending/evidence measures. Reuse ledger predicates; never filter or total just the client-loaded page. The existing detail's `finance` field is lifetime data and must not be relabelled as a selected-period total.
4. **Contributing records:** reuse the financial entry list and its vehicle/period/direction/ledger filters, adding vehicle-attributed amounts where needed. Include the original entry identity and complete-entry amount separately. Keep pagination, branch intersection and selected filters intact.
5. **Evidence read:** expose minimal linked artifact metadata via an authorized entry read and request private download access only after tenant **and financial record branch** authorization. Do not expose a workspace-only artifact URL as a branch authorization shortcut. Preserve command-to-artifact provenance, reversal links and verification state; no public receipt bucket.

No new stored balance, monthly total, vehicle ledger, availability flag or location field is required for the first Money slice. Preset catalog/backfill changes, if needed, use an additive migration or audited provisioning commands after checking actual constraints. Allocate migration numbers from the current integration baseline with #47's owner; never reserve a number here or copy another branch's migrations. Current custodian storage exists, so a read addition alone needs no new column.

## Required tests for #44

- Real commands/read scenario above, with exact XAF and same-/later-period reversal totals. Exercise double submission and stale-version refusal.
- Multi-line allocation (60,000/40,000), shared-vehicle expense, rejected and pending exclusions, no double-counted acquisition/document/maintenance expense, and empty vs unknown coverage.
- Named date basis: calendar date in French/English across Douala/UTC/Chicago; month boundaries, locked-period late postings and pending entries without posting periods.
- Cross-company and restricted-branch list, aggregate, detail, history and attachment denial, including an asset visible in one branch whose historical expense belongs to another. Authorization must happen before data or signed URLs leave the server.
- Executive read-only from navigation and direct links; field capture and finance review use the existing command permissions and branch rules.
- Preset compatibility: old trucking/passenger records remain valid; internal fleet needs no invented trip/revenue; disabled presets are rejected; mixed-fleet vocabulary remains coherent.
- Browser phone/desktop and French/English: overview → vehicle → capture → review → total → entry/evidence → reversal → history; loading, errors, no data, recovery and return-filter preservation. No production prototype records.

See [the domain glossary](../../CONTEXT.md) and [architecture](../../ARCHITECTURE.md) for shared invariants. #46 owns new temporary authority, handovers and payments; #47 owns candidate integration and maintenance conflicts. Staging (#37), cold-start reliability (#42) and field recovery (#45) remain release gates, not reasons to delay every read-only workspace component.
