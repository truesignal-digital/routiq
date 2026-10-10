import { openSidebar, type DriveScript } from "../browser.js";

/**
 * A driver writes onto their own trips only (#592). Sali records an odometer
 * reading on her own open trip through the trip page; then the same reading,
 * a leg and a fuel expense sent by id onto Boris's trip are refused with
 * OWN_RECORDS_ONLY, and nothing lands on it.
 *
 * Precondition after a reseed, both through create-activity on VH001 in DLA:
 * an open trip Sali records (`--role driver`) and an open trip Boris records
 * with no crew (`--role admin`); Boris's trip id goes in OTHER_TRIP_ID.
 * Run: OTHER_TRIP_ID=<id> pnpm verify drive flow:driver-writes-own-trips --role driver --lang en --viewport 390x844 --reel
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet, expectRefusal }) => {
  const otherTripId = process.env.OTHER_TRIP_ID;
  if (otherTripId === undefined) throw new Error("OTHER_TRIP_ID is not set (see the flow's header)");

  const list = await apiGet("/v1/activities?limit=100");
  type Row = { id: string; activityNumber: string; status: string };
  const items = (list.body as { items?: Row[] }).items ?? [];
  const own = items.find((item) => item.status === "OPEN");
  if (list.status !== 200 || own === undefined) throw new Error(`GET /v1/activities → ${list.status}, no open trip of her own`);
  if (items.some((item) => item.id === otherTripId)) throw new Error("Boris's trip is in the driver's list");

  await (await openSidebar(page)).getByRole("link", { name: t("Trajets", "Trips") }).click();
  await page.getByRole("heading", { level: 1, name: t("Trajets", "Trips") }).waitFor();
  await quiet();
  await page.getByRole("button", { name: own.activityNumber, exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === `/activities/${own.id}`);
  await quiet();

  const record = page.getByRole("button", { name: t("Relever le compteur", "Record odometer"), exact: true });
  await shot("own-trip", {
    caption: `Sali opens her own open trip ${own.activityNumber}`,
    highlight: record,
  });
  await record.click();
  const form = page.getByRole("dialog", { name: t("Relever le compteur", "Record odometer") });
  const value = form.getByLabel(t("Valeur", "Value"), { exact: true });
  await value.fill("187400");
  await shot("reading-form", { caption: "She records the odometer on her own trip", highlight: value });
  await form.getByRole("button", { name: t("Enregistrer le relevé", "Record the reading"), exact: true }).click();
  const recorded = page.getByRole("main").getByText(/187[,\s\u202f\u00a0]400 km/).first();
  await recorded.waitFor();
  await quiet();
  await recorded.scrollIntoViewIfNeeded();

  const detail = await apiGet(`/v1/activities/${own.id}`);
  const readings = (detail.body as { readings?: Array<{ value: number }> }).readings ?? [];
  if (!readings.some((reading) => reading.value === 187_400)) throw new Error("the reading is not on her trip");
  await shot("reading-recorded", {
    caption: `The reading of 187,400 km is on ${own.activityNumber}`,
    highlight: recorded,
  });
  log(`own trip ${own.activityNumber}: reading recorded`);

  // The same writes, sent by id onto a trip that is not hers.
  expectRefusal({ status: 403, url: /\/v1\/commands\/(record-meter-reading|record-movement-leg|record-expense)$/ });
  // tsx names the inner functions with an `__name` helper the page lacks.
  await page.evaluate("globalThis.__name = (fn) => fn");
  const sent = await page.evaluate(async (activityId) => {
    const raw = window.localStorage.getItem("routiq.sessions.v1");
    const sessions = raw === null ? {} : (JSON.parse(raw) as { activeKey?: string; sessions?: Record<string, { token?: string }> });
    const token = sessions.activeKey === undefined ? "" : (sessions.sessions?.[sessions.activeKey]?.token ?? "");
    const send = async (name: string, payload: Record<string, unknown>) => {
      const response = await fetch(`/v1/commands/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          version: 1,
          envelope: { commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), origin: "HUMAN_UI" },
          payload,
        }),
      });
      const body = (await response.json()) as { error?: { code?: string } };
      return { name, status: response.status, code: body.error?.code ?? "none" };
    };
    const me = (await (await fetch("/v1/assets?limit=100", { headers: { authorization: `Bearer ${token}` } })).json()) as {
      items?: Array<{ id: string; assetCode: string }>;
    };
    const truck = me.items?.find((asset) => asset.assetCode === "VH001")?.id ?? "";
    return Promise.all([
      send("record-meter-reading", {
        readingId: crypto.randomUUID(),
        assetId: truck,
        readingType: "ODOMETER",
        value: 187_500,
        observedAt: new Date().toISOString(),
        activityId,
      }),
      send("record-movement-leg", {
        legId: crypto.randomUUID(),
        activityId,
        legNo: 99,
        origin: { kind: "text", text: "Douala" },
        destination: { kind: "text", text: "Edéa" },
      }),
      send("record-expense", {
        entryId: crypto.randomUUID(),
        branchCode: "DLA",
        categoryCode: "FUEL",
        economicDate: new Date().toISOString().slice(0, 10),
        amountMinor: 20_000,
        paymentMethod: "CASH",
        postings: [{ assetId: truck, activityId, amountMinor: 20_000 }],
      }),
    ]);
  }, otherTripId);
  for (const reply of sent) {
    log(`onto Boris's trip: ${reply.name} → ${reply.status} ${reply.code}`);
    if (reply.status !== 403 || reply.code !== "OWN_RECORDS_ONLY") {
      throw new Error(`${reply.name} onto another trip answered ${reply.status} ${reply.code}`);
    }
  }
  const hidden = await apiGet(`/v1/activities/${otherTripId}`);
  if (hidden.status !== 404) throw new Error(`Boris's trip answers ${hidden.status} to the driver`);

  await page.goBack();
  await page.getByRole("heading", { level: 1, name: t("Trajets", "Trips") }).waitFor();
  await quiet();
  await shot("refused", {
    caption: "A reading, a leg and fuel sent by id onto Boris's trip: all three refused, own records only",
    highlight: page.getByRole("main"),
  });
};

export default flow;
