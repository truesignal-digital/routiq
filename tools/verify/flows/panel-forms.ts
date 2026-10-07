import type { DriveScript } from "../browser.js";

/**
 * #296: forms that record or create a fact open in the side panel, with the
 * list behind as context; closing with typed data asks a Decision dialog;
 * decisions keep the centred dialog. Read-only: every form is dismissed.
 * Run: pnpm verify drive flow:panel-forms --role director --lang en
 */
const flow: DriveScript = async ({ page, t, nav, shot, quiet }) => {
  const panel = () => page.locator('[data-slot="sheet-content"]').last();
  const settle = async () => {
    await quiet();
    await page.waitForTimeout(400);
  };

  await nav("/maintenance");
  await page.getByRole("button", { name: t("Signaler un problème", "Report a problem") }).first().click();
  await panel().waitFor();
  await settle();
  await shot("report-problem-panel", {
    caption: "From Maintenance, Report a problem opens in the side panel, the queue stays behind it",
    highlight: panel(),
  });

  await panel().getByRole("textbox").first().fill("Brakes squeal on the left front wheel");
  await page.keyboard.press("Escape");
  const ask = page.getByRole("dialog", { name: t("Abandonner ce formulaire ?", "Discard this form?") });
  await ask.waitFor();
  await settle();
  await shot("discard-asks", {
    caption: "Closing with typed data asks first; the dismiss button says Keep editing",
    highlight: ask,
  });
  await page.getByRole("button", { name: t("Continuer la saisie", "Keep editing") }).click();
  await ask.waitFor({ state: "detached" });
  await page.getByRole("button", { name: t("Annuler", "Cancel") }).last().click();
  await page.getByRole("button", { name: t("Abandonner", "Discard"), exact: true }).click();
  await panel().waitFor({ state: "detached" });

  await nav("/finance/record");
  await panel().waitFor();
  await settle();
  await shot("record-over-entries", {
    caption: "/finance/record is Entries with the record panel open over it",
    highlight: panel(),
  });
  await page.getByRole("button", { name: t("Annuler", "Cancel") }).last().click();
  await page.waitForURL((url) => url.pathname === "/finance/entries");
  await settle();
  await shot("closed-lands-on-entries", { caption: "Closing the panel lands on Entries" });

  await nav("/more/branches");
  await page.getByRole("button", { name: t("Créer une agence", "Create a branch") }).first().click();
  await panel().waitFor();
  await settle();
  await shot("add-branch-panel", {
    caption: "Create a branch opens in the panel over the branch list, submit last",
    highlight: panel(),
  });
  await page.keyboard.press("Escape");
  await panel().waitFor({ state: "detached" });

  await nav("/more/users");
  await page.getByRole("button", { name: t("Ajouter un utilisateur", "Add a user") }).first().click();
  await panel().waitFor();
  await settle();
  await shot("add-user-panel", { caption: "Add a user opens in the panel too", highlight: panel() });
  await page.keyboard.press("Escape");
  await panel().waitFor({ state: "detached" });

  await nav("/more/persons");
  // A person belongs to a branch: on "All my branches" the list asks for one first.
  await page.getByRole("combobox").filter({ hasText: t("Choisir une agence", "Choose a branch") }).first().click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: t("Ajouter une personne", "Add a person") }).first().click();
  await panel().waitFor();
  await settle();
  await shot("register-person-panel", { caption: "Add a person opens in the panel over Personnel", highlight: panel() });
};

export default flow;
