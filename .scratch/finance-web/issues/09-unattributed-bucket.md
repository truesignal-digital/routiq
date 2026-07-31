# Profitability views: "Non attribué" bucket

Label: needs-triage

## What

When asset/activity profitability views are built, include a "Non attribué" line: sum of postings in DIRECT-layer categories that carry no `asset_id` (asset views) or no `activity_id` (activity views).

## Why

Postings' attribution dimensions are nullable by design (overheads). But a DIRECT-layer line without attribution silently drops out of every asset and activity P&L, understating costs — and per-asset profitability is the core product promise. Surfacing the unattributed sum keeps totals honest and lets users self-correct, per "warn, don't block" and "reports never invent values". Decided 2026-07-30 against an entry-time warning (pilot-stage: coach the two tenants instead; observe behavior before adding nudge UX).

## How

One aggregate query per view; no new UX beyond the summary line. Not scheduled — attach to the profitability-view spec when that lands.
