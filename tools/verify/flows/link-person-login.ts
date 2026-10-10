import type { DriveContext, DriveScript } from "../browser.js";

/**
 * A person gets their login (#569). As an Administrator (`--role admin`):
 * People shows a Login column; the row menu on a person without one offers
 * Link login; the panel lists the logins that are free; after linking, the
 * row names the login and offers Change login and Unlink login. Ends with an
 * API cross-check. Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:link-person-login --role admin --lang en --reel
 */
const PERSON = "Jean Ngwa";

/** Lets the screencast paint what just opened before a shot holds the frame. */
const settle = (ctx: DriveContext) => ctx.page.waitForTimeout(700);

type PersonItem = { id: string; displayName: string; loginPrincipalId: string | null };

const flow: DriveScript = async (ctx) => {
  const { page, t, shot, quiet, nav, log, apiGet } = ctx;
  await nav("/more/persons");
  await page.getByRole("heading", { level: 1, name: t("Personnel", "People") }).waitFor();
  await quiet();
  const row = page.getByRole("row").filter({ hasText: PERSON });
  await row.waitFor();
  await settle(ctx);
  await shot("people", {
    caption: "People now has a Login column: Jean Ngwa has no login yet",
    highlight: row,
  });

  await row.getByRole("button", { name: t("Actions", "Actions") }).click();
  await page.getByRole("menuitem", { name: t("Lier un identifiant", "Link login") }).click();
  const panel = page.getByRole("dialog", { name: t("Lier un identifiant", "Link login") });
  await panel.waitFor();
  await quiet();
  const choice = panel.getByText(/\(sali\)/);
  await choice.click();
  await settle(ctx);
  await shot("link-panel", {
    caption: "Link login lists the logins no one holds yet; pick Sali's",
    highlight: panel,
  });

  await panel.getByRole("button", { name: t("Lier l'identifiant", "Link login") }).click();
  await page.getByText(t("Identifiant lié", "Login linked")).first().waitFor();
  await quiet();
  await settle(ctx);
  await shot("linked", {
    caption: "The row names the login: trips planned for Jean Ngwa now show for that login",
    highlight: row,
  });

  await row.getByRole("button", { name: t("Actions", "Actions") }).click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  await settle(ctx);
  await shot("row-menu", {
    caption: "A linked person offers Change login and Unlink login; each keeps the old link in the history",
    highlight: menu,
  });
  await page.keyboard.press("Escape");

  const persons = await apiGet("/v1/persons");
  const person = ((persons.body as { items?: PersonItem[] }).items ?? []).find((p) => p.displayName === PERSON);
  if (person?.loginPrincipalId == null) throw new Error(`${PERSON} has no login after linking`);
  log(`api cross-check: ${PERSON} loginPrincipalId=${person.loginPrincipalId.slice(0, 8)}`);
};

export default flow;
