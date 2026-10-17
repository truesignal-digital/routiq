import type { DriveScript } from "../browser.js";
import { openSidebar } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-adds-member",
  actor: { role: "admin", person: "The Administrateur (chef d'agence)" },
  arrangeAs: "admin",
  goal: "give a driver already on the Personnel list a login for Douala, with the right role",
  trigger: "A driver starts using ROUTIQ on their own phone",
  frequency: "A few times a month",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen:
    "GET /v1/members lists the new login ACTIVE as a Driver scoped to Douala only, and GET /v1/persons shows Jean Ngwa linked to it",
  firstGlance: {
    purpose: "Who can sign in, with which role and branches",
    state: "Every member is active; each row names its role and branches",
    nextAction: "Add a user",
  },
  budgets: {
    // Intent: one form gives the access (open, role, branch, submit), then the
    // person is linked to it. The current app needs a second panel on People.
    taps: 6,
    seconds: 30,
    wordsPerScreen: 300,
    foldWordsPerScreen: 200,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/** Typing isn't a tap, so the form's size is budgeted here: name, username, role, branches, PIN, PIN again. */
const FIELDS_BUDGET = 6;

const PERSON = "Jean Ngwa";

/**
 * Users → Add a user (Driver, Douala only) → People → Jean Ngwa → Link login.
 * Mutates the slot; reset with `pnpm verify up --reseed` between runs.
 * Run: pnpm verify drive journey:admin-adds-member --role admin --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, nav, quiet, log, apiGet } = ctx;
  assertStartedAs(ctx, journey);
  const username = `jngwa${Date.now().toString(36).slice(-4)}`;

  const douala = ((await apiGet("/v1/branches")).body as { items: { id: string; code: string; name: string }[] }).items.find(
    (branch) => branch.code === "DLA",
  );
  if (douala === undefined) throw new Error("no DLA branch in the seed");

  await nav("/more/users");
  await page.getByRole("heading", { level: 1, name: t("Utilisateurs", "Users") }).waitFor({ timeout: 60_000 });
  const run = journeyRunner(ctx, journey);
  await run.screen("users", "Users: who can sign in, with which role and branches");

  await run.tap(page.getByRole("button", { name: t("Ajouter un utilisateur", "Add a user"), exact: true }));
  const form = page.getByRole("dialog", { name: t("Ajouter un utilisateur", "Add a user") });
  await form.waitFor();
  await form.getByLabel(t("Nom complet", "Full name")).fill(PERSON);
  await form.getByLabel(t("Identifiant de connexion", "Login username")).fill(username);
  await run.tap(form.getByRole("combobox"));
  await run.tap(page.getByRole("option", { name: t("Chauffeur", "Driver"), exact: true }));
  // Unticking "All branches" leaves the first branch ticked: tick Douala, then untick that one.
  await run.tap(form.getByRole("checkbox", { name: t("Toutes les agences", "All branches") }));
  const ticked = form.getByRole("checkbox", { checked: true });
  const first = (await ticked.first().locator("xpath=..").innerText()).trim();
  await run.tap(form.getByRole("checkbox", { name: douala.name, exact: true }));
  if (first !== douala.name) await run.tap(form.getByRole("checkbox", { name: first, exact: true }));
  const pins = form.locator("input[type=password]");
  await pins.nth(0).fill("246810");
  await pins.nth(1).fill("246810");
  const fields = await form.locator("input[type=text]:visible, input[type=password]:visible, [role=combobox]:visible, fieldset:visible").count();
  log(`add-member form: ${fields} fields (budget ${FIELDS_BUDGET})`);
  await run.screen("add-member", "The Add a user panel, filled for a Douala driver");

  await run.tap(form.getByRole("button", { name: t("Ajouter l'utilisateur", "Add user"), exact: true }));
  await form.waitFor({ state: "detached" });
  await page.getByRole("row").filter({ hasText: username }).waitFor();
  await run.screen("users-added", "The new login in the list, with its role and branch");

  await run.tap((await openSidebar(page)).getByRole("link", { name: t("Personnel", "People"), exact: true }));
  await page.getByRole("heading", { level: 1, name: t("Personnel", "People") }).waitFor();
  const row = page.getByRole("row").filter({ hasText: PERSON }).first();
  await row.waitFor();
  await run.screen("persons", "People: Jean Ngwa has no login yet");

  await run.tap(row.getByRole("button", { name: t("Actions", "Actions") }));
  await run.tap(page.getByRole("menuitem", { name: t("Lier un identifiant", "Link login") }));
  const panel = page.getByRole("dialog", { name: t("Lier un identifiant", "Link login") });
  await panel.waitFor();
  await quiet();
  await run.tap(panel.getByText(new RegExp(`\\(${username}\\)`)));
  await run.screen("link-login", "Link login, with the new login picked");

  await run.tap(panel.getByRole("button", { name: t("Lier l'identifiant", "Link login"), exact: true }));
  await panel.waitFor({ state: "detached" });
  await row.getByText(username).waitFor();
  await run.screen("linked", "Jean Ngwa's row names the login");

  const members = (await apiGet("/v1/members")).body as {
    items: { principalId: string; username: string | null; role: string; status: string; branchScope: "ALL" | string[] }[];
  };
  const added = members.items.find((member) => member.username === username);
  if (added === undefined || added.role !== "DRIVER" || added.status !== "ACTIVE") {
    throw new Error(`GET /v1/members: ${username} is ${JSON.stringify(added)}`);
  }
  if (added.branchScope === "ALL" || added.branchScope.join() !== douala.id) {
    throw new Error(`GET /v1/members: ${username} scope ${JSON.stringify(added.branchScope)}, not Douala only`);
  }
  const persons = (await apiGet(`/v1/persons?search=${encodeURIComponent(PERSON)}`)).body as {
    items: { displayName: string; loginPrincipalId: string | null }[];
  };
  if (persons.items.find((person) => person.displayName === PERSON)?.loginPrincipalId !== added.principalId) {
    throw new Error(`GET /v1/persons: ${PERSON} is not linked to ${username}`);
  }
  log(`api cross-check: ${username} ACTIVE DRIVER, Douala only; ${PERSON} linked`);
  if (fields > FIELDS_BUDGET) throw new Error(`add-member form has ${fields} fields, budget ${FIELDS_BUDGET}`);
  run.finish();
};

export default drive;
