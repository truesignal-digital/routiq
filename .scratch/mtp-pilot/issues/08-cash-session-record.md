# Cash session record type

Type: grilling
Status: open
Blocked by: 01

## Question

Is the travel agency's daily branch cash reconciliation formal enough to reference as a source document, or does MTP ship a minimal `cash_sessions` table (branch, date, opened/closed by, declared total)? Working recommendation: ship the table regardless — tiny cost, anchors ticket revenue, doubles as reconciliation surface. Confirm against Phase 0 observation of the real daily sheet.
