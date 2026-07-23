# Research: WhatsApp Business Cloud API for Cameroon alerts

Type: research
Status: resolved

## Question

Can we deliver document-expiry notifications via WhatsApp to Cameroonian fleet operators, at what cost and setup burden? Needed facts: Meta WhatsApp Business Cloud API utility-message pricing for Cameroon (+237); template approval process and timelines; business verification + phone number requirements; direct Meta vs wrapper (e.g. Twilio) trade-off; any per-country restrictions. Output: facts + a recommendation feeding ticket 11.

## Answer

Researched July 2026. Meta does not publish a static Cameroon row — its rate card groups Cameroon (+237) under the "Rest of Africa" bucket, resolved via the interactive calculator at business.whatsapp.com (JS-rendered, not scrapable) or the downloadable CSV/PDF rate cards linked from Meta's pricing docs. Numbers below are cross-checked across two independent aggregators plus one individually-listed "Rest of Africa" country (Kenya) as a sanity check, not read directly off Meta's card, so treat the third decimal as approximate — re-pull the CSV before committing to a budget line.

**1. Pricing model & Cameroon/Rest-of-Africa rates**
Meta retired conversation-based (24h session) pricing on July 1, 2025 and now bills per delivered template message, by category × recipient country, updated quarterly. Service-window replies and utility templates sent inside an open 24h customer-service window are free regardless of category. ([Meta pricing docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), [Meta conversation-pricing deprecation notice](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/conversation-based-pricing))

"Rest of Africa" rates (USD, per delivered message), as reported by two independent trackers in July 2026:
- Utility: **$0.0040–$0.0046**
- Authentication: **$0.0040–$0.0080** (Kenya, individually listed, prices at $0.0040 utility / $0.0080 auth / $0.0225 marketing — consistent with the "Rest of Africa" bucket)
- Marketing: **$0.0225–$0.0259**
([SleekFlow rate table](https://sleekflow.io/blog/whatsapp-business-price), [Gallabox pricing docs](https://docs.gallabox.com/pricing-and-billing-modules/new-per-message-pricing), [Ominiflow country pricing](https://ominiflow.com/whatsapp-api-pricing-by-country))

Document-expiry reminders and approval alerts are **utility** category (transactional, tied to an existing document/asset record) — the cheap bucket, not marketing.

**2. Template approval process & timelines**
Templates go through Meta's automated review first; most utility/authentication templates clear in minutes to a few hours. Templates flagged for manual review (more common for marketing, financial, or health-adjacent copy) can take 24–48h. Practical guidance: submit templates ≥24h before you need them live; plain utility copy ("Your [document] for [asset] expires on [date]") is low-risk and typically fast. ([AiSensy approval guide](https://m.aisensy.com/blog/whatsapp-template-approval-process/), general 2026 trackers)

**3. Business verification + phone number requirements**
- A dedicated phone number is required — it must not already be active on personal WhatsApp/WhatsApp Business app, and once attached to a WhatsApp Business Account (WABA) it can't be used in the consumer app anymore.
- **Unverified** Meta Business accounts (no completed Meta Business Verification) are capped at **250 conversations/messages per 24h** and cannot send OTP/authentication templates at all. This is enough for a 2-company, ~50-document pilot but leaves no headroom.
- Completing Meta Business Verification (legal business docs) unlocks Tier 1 (1,000/24h), with faster subsequent tier advancement (Meta now re-evaluates every 6h in 2026, was 24–48h). Verification itself typically clears in a few business days if documents are clean; mismatched/incomplete docs are the main source of delay.
- Billing requires an international Visa/Mastercard on the Meta Business account (no Amex) — a real setup item for a Cameroon-registered entity without an internationally-billable card; a BSP wrapper can absorb this since the BSP becomes the payer of record.
([Meta phone number docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers), [Chatarmin/Sanuker 2026 tier trackers], [BoldDesk payment method docs](https://support.bolddesk.com/kb/article/18142/how-to-add-a-payment-method-in-whatsapp-cloud-api-integration))

**4. Direct Meta Cloud API vs BSP wrapper (Twilio, 360dialog, etc.)**
- **Direct Meta Cloud API**: no markup on Meta's per-message rate, no monthly platform fee, but you own webhook infra, template submission/management, embedded signup flow, and the international-card billing requirement yourself. Cheapest at pilot volume; more integration work.
- **Twilio**: pay-as-you-go, +$0.005/message platform fee plus a $0.001 failed-message fee on top of Meta's rate. No monthly minimum — reasonable for a small pilot, simple to stand up.
- **360dialog**: flat subscription (~€49/month entry tier) with Meta's rate passed through at no per-message markup — cheaper than Twilio only once volume is high (thousands/day); overkill for a 2-company pilot on pure cost, but its embedded-signup flow and template tooling reduce setup burden.
([EZContact BSP comparison](https://ezcontact.ai/en/blog/whatsapp-api-pricing-comparison-meta-twilio-360dialog-ezcontact/), [Kommunicate Twilio vs 360dialog](https://www.kommunicate.io/blog/twilio-vs-360dialog-a-comparison/))

**5. Cameroon-specific gotchas**
- Cameroon is not on Meta's restricted-country list (Cuba, Iran, North Korea, Syria, Crimea/Donetsk/Luhansk, Turkey, Kosovo) — sending to +237 numbers is fully supported, and WhatsApp has a large existing user base in Cameroon.
- Cameroon's May 2026 IMEI/device-registration enforcement (MTN/Orange/Camtel blocking uncleared handsets) governs *handsets* joining local mobile networks — it does not affect the WABA sender number, which is typically a virtual/landline number verified by voice or SMS OTP and does not need to be a Cameroon SIM at all. Flagging it only because it surfaced in research; it is not expected to block this integration. ([Tech With Africa](https://www.techwithafrica.com/2026/05/25/cameroon-orders-telcos-to-block-unregistered-mobile-devices/))
- No Cameroon-specific carrier throttling or delivery-restriction found in this pass; general African-market advice (e.g. Arkesel's guide) flags Ghana/Nigeria/South-Africa data-protection-law consent requirements but nothing Cameroon-specific turned up.

**Pilot cost estimate** (2 companies, ~50 documents, 4 reminders/expiry + ~10 approval alerts/day, all utility category):
- Expiry reminders: 50 × 4 = 200 messages per expiry cycle
- Approval alerts: 10/day × 30 = 300 messages/month
- Total ≈ 500 utility messages/month × $0.004–$0.0046 = **$2.00–$2.30/month in Meta message fees**
- Add Twilio markup if used: 500 × $0.005 = **+$2.50/month** (total ≈ $4.50–$4.80/month)
- Add 360dialog if used: **+~$53/month flat** regardless of volume (total ≈ $55/month) — not worth it at this scale on cost grounds alone
- Verdict: **message cost is a rounding error at pilot scale under any provider.** The real cost is calendar time (business verification, dedicated number, template approval) and integration effort, not per-message fees.

**Recommendation for ticket 11**: Message-level cost does not justify holding WhatsApp back — even the most expensive wrapper option is ~$55/month for the pilot. The gating factor is setup lead time: Meta Business Verification (days, gated on clean legal docs) and sourcing a dedicated number + internationally-billable card are calendar-time items outside engineering's control, not build effort. This supports ticket 11's working position as-is: ship in-app notifications for MTP, but start Meta Business Verification and phone-number registration now, in parallel with MTP build, via a BSP with embedded signup (Twilio for lowest setup friction at this volume, or direct Cloud API if the team wants to avoid the $0.005/message markup and is comfortable owning webhook/template plumbing). If verification and template approval clear before MTP code-freeze, WhatsApp utility reminders can ship inside the MTP window; if not, fall back to the in-app-only plan and flip WhatsApp on as the first post-MTP fast-follow — don't let it block the MTP ship date.
