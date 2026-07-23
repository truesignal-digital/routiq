# On-prem storage shape: raw S3 store vs self-hosted storage-api

Type: grilling
Status: open

## Question

Surfaced by research ticket 13. When Topology B ships, does "on-prem storage" mean (a) a raw S3-compatible store (RustFS) only — requiring a dual-path resumable-upload abstraction (TUS on Supabase / S3 multipart + app-owned resume state on-prem) — or (b) Supabase's open-source storage-api service self-hosted in front of RustFS — TUS works unmodified on both sides, no dual-path code? (b) adds one service to the appliance compose but collapses the abstraction. Decision shapes the §6a guard wording and the storage interface built in MTP.
