import { openSidebar, type DriveContext, type DriveScript } from "../browser.js";

/**
 * Direction's notes in the vehicle To-do (#98), on VH001 (Douala).
 *
 * As Direction (default): write a note on VH001 → it shows in Now → To do,
 * waiting on the team. As anyone else on the vehicle (`--role driver`, after
 * the Direction run on the same slot): the note is in the To do with its own
 * style → Mark as seen → it leaves the To do and the note says "Seen by". Each
 * ends with an API cross-check. Mutates the slot; reset with
 * `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:direction-note --role director --lang en
 *      pnpm verify drive flow:direction-note --role driver --lang en
 */
const BODY = "Why is this repair so expensive? Call me before paying the garage.";

/** Lets the screencast paint what just opened before a shot holds the frame. */
const settle = (ctx: DriveContext) => ctx.page.waitForTimeout(700);

type Item = { code: string; subject: { id: string }; params: { description?: string } };

async function openVehicle(ctx: DriveContext): Promise<string> {
  const { page, t, quiet } = ctx;
  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH001/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH001" }).waitFor();
  await quiet();
  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (assetId === undefined) throw new Error(`no asset id in ${page.url()}`);
  return assetId;
}

async function directionNotes(ctx: DriveContext, assetId: string): Promise<Item[]> {
  const response = await ctx.apiGet(`/v1/assets/${assetId}/attention`);
  if (response.status !== 200) throw new Error(`attention → ${response.status}`);
  return ((response.body as { items?: Item[] }).items ?? []).filter(
    (item) => item.code === "DIRECTION_NOTE" && item.params.description === BODY,
  );
}

function todoCard(ctx: DriveContext) {
  return ctx.page
    .locator("[data-slot=card]")
    .filter({ has: ctx.page.getByRole("heading", { level: 2, name: new RegExp(`^${ctx.t("À faire", "To do")}`) }) });
}

async function asDirection(ctx: DriveContext): Promise<void> {
  const { page, t, shot, quiet, log } = ctx;
  const assetId = await openVehicle(ctx);

  // "More actions" in the header on a desktop, "More" in the phone's quick bar.
  await page
    .getByRole("button", { name: new RegExp(`^(${t("Plus d'actions", "More actions")}|${t("Plus", "More")})$`) })
    .first()
    .click();
  await page.getByRole("button", { name: new RegExp(`^${t("Ajouter une note", "Add note")}`) }).first().click();
  const form = page.getByRole("dialog", { name: t("Ajouter une note", "Add note") });
  await form.waitFor();
  await form.getByRole("textbox").fill(BODY);
  await settle(ctx);
  await shot("direction-writes", {
    caption: "Direction leaves a note on the truck",
    highlight: form.getByRole("textbox"),
  });
  await form.getByRole("button", { name: t("Ajouter la note", "Add the note") }).click();
  await page.getByText(t("Note ajoutée", "Note added")).first().waitFor();
  await quiet();

  const card = todoCard(ctx);
  const missing = () => {
    throw new Error("the note from Direction is not in the To do");
  };
  const waiting = card.getByRole("button", { name: new RegExp(`^${t("En attente des autres", "Waiting on others")}`) });
  await waiting.waitFor({ timeout: 5_000 }).catch(missing);
  await waiting.click();
  await card.getByText(BODY).first().waitFor({ timeout: 5_000 }).catch(missing);
  await settle(ctx);
  await shot("waits-on-team", {
    caption: "Her own note waits in the To do for the team to see it",
    highlight: card,
  });

  const notes = await directionNotes(ctx, assetId);
  if (notes.length !== 1) throw new Error(`expected 1 open Direction note, got ${notes.length}`);
  log(`api cross-check: Direction note ${notes[0]!.subject.id.slice(0, 8)} open on VH001 ${assetId}`);
}

async function asTeam(ctx: DriveContext): Promise<void> {
  const { page, t, shot, quiet, log } = ctx;
  const assetId = await openVehicle(ctx);
  const [note] = await directionNotes(ctx, assetId);
  if (note === undefined) throw new Error("run the Direction flow first: no open Direction note on VH001");

  const card = todoCard(ctx);
  const title = card.getByRole("button", { name: BODY });
  await title.waitFor();
  const row = card.locator("li").filter({ hasText: BODY });
  await settle(ctx);
  await shot("todo-note", {
    caption: "The note from Direction is in the To do, styled apart, with its author and date",
    highlight: row,
  });

  await row.getByRole("button", { name: t("Marquer comme vu", "Mark as seen") }).click();
  const form = page.getByRole("dialog", { name: t("Marquer comme vu", "Mark as seen") });
  await form.waitFor();
  await settle(ctx);
  await shot("mark-seen", {
    caption: "Mark as seen tells Direction the note was read",
    highlight: form.getByText(t("Indique à la Direction", "Tells the Director"), { exact: false }),
  });
  await form.getByRole("button", { name: t("Marquer comme vu", "Mark as seen") }).click();
  await page.getByText(t("Marquée comme vue", "Marked as seen")).first().waitFor();
  await quiet();
  for (let i = 0; i < 3 && (await page.getByRole("dialog").count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await card.getByRole("button", { name: BODY }).waitFor({ state: "detached" });
  await settle(ctx);
  await shot("todo-cleared", {
    caption: "The note has left the To do",
    highlight: card,
  });

  await page
    .getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") })
    .getByRole("tab", { name: new RegExp(`^${t("Historique", "History")}`) })
    .click();
  await page.waitForURL((url) => url.pathname.endsWith("/history"));
  await quiet();
  const seenEvent = page.locator("li").filter({ hasText: t("Note marquée comme vue", "Note marked as seen") }).first();
  await seenEvent.waitFor();
  await settle(ctx);
  await shot("history", {
    caption: "History records who marked it as seen",
    highlight: seenEvent,
  });
  await seenEvent.getByRole("button", { name: t("Ouvrir", "Open"), exact: true }).click();
  const panel = page.getByRole("dialog").first();
  const seen = panel.getByText(new RegExp(`^${t("Vu par", "Seen by")} `));
  await seen.waitFor();
  await settle(ctx);
  await shot("seen-by", {
    caption: "The note stays on the record and says who saw it, and when",
    highlight: seen,
  });

  const after = await directionNotes(ctx, assetId);
  const detail = await ctx.apiGet(`/v1/notes/${note.subject.id}`);
  const acknowledgement = (detail.body as { acknowledgement?: { by?: { displayName?: string } } | null }).acknowledgement;
  if (after.length !== 0 || !acknowledgement) {
    throw new Error(`still open: ${after.length}; acknowledgement ${JSON.stringify(acknowledgement)}`);
  }
  log(`api cross-check: note ${note.subject.id.slice(0, 8)} seen by ${acknowledgement.by?.displayName ?? "?"}, To do clear`);
}

const flow: DriveScript = async (ctx) => {
  if (ctx.account.role === "DIRECTOR") await asDirection(ctx);
  else await asTeam(ctx);
};

export default flow;
