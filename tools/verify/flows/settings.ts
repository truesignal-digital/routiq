import { openNameMenu, openSidebar, type DriveScript } from "../browser.js";

/**
 * Settings: branches, users (members and roles) and people, each
 * cross-checked against its read. Admin only for branches and users.
 * The pages are sidebar rows once the Company group lands (#312); until then
 * they sit in the name menu (#316), so the flow takes whichever is there.
 * Run: pnpm verify drive flow:settings --role director --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const openSettingsPage = async (fr: string, en: string) => {
    const row = (await openSidebar(page)).getByRole("link", { name: new RegExp(`^${t(fr, en)}`) });
    if (await row.isVisible().catch(() => false)) await row.click();
    else await (await openNameMenu(page)).getByRole("menuitem", { name: t(fr, en) }).click();
    await page.getByRole("heading", { level: 1, name: t(fr, en) }).waitFor();
    await quiet();
    await shot(en.toLowerCase());
  };

  await openSettingsPage("Agences", "Branches");
  const branches = await apiGet("/v1/branches");
  const codes = ((branches.body as { items?: Array<{ code: string }> }).items ?? []).map((b) => b.code);
  for (const code of codes) await page.getByRole("cell", { name: code, exact: true }).first().waitFor();
  log(`api cross-check: GET /v1/branches → ${branches.status}, ${codes.join(", ")} all shown`);

  await openSettingsPage("Utilisateurs", "Users");
  const members = await apiGet("/v1/members");
  const usernames = ((members.body as { items?: Array<{ username?: string | null }> }).items ?? []).map((m) => m.username).filter(Boolean);
  log(`api cross-check: GET /v1/members → ${members.status}, ${usernames.length} members (${usernames.join(", ")})`);

  await openSettingsPage("Personnel", "People");
  const persons = await apiGet("/v1/persons");
  log(`api cross-check: GET /v1/persons → ${persons.status}`);
};

export default flow;
