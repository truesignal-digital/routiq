import { openSidebar, type DriveScript } from "../browser.js";

/**
 * The Company rows of the sidebar: branches, users (members and roles) and
 * people, each cross-checked against its read. Branches is Direction only.
 * Run: pnpm verify drive flow:settings --role director --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const openFromCompany = async (fr: string, en: string) => {
    await (await openSidebar(page)).getByRole("link", { name: t(fr, en), exact: true }).click();
    await page.getByRole("heading", { level: 1, name: t(fr, en) }).waitFor();
    await quiet();
    await shot(en.toLowerCase());
  };

  await openFromCompany("Agences", "Branches");
  const branches = await apiGet("/v1/branches");
  const codes = ((branches.body as { items?: Array<{ code: string }> }).items ?? []).map((b) => b.code);
  for (const code of codes) await page.getByRole("cell", { name: code, exact: true }).first().waitFor();
  log(`api cross-check: GET /v1/branches → ${branches.status}, ${codes.join(", ")} all shown`);

  await openFromCompany("Utilisateurs", "Users");
  const members = await apiGet("/v1/members");
  const usernames = ((members.body as { items?: Array<{ username?: string | null }> }).items ?? []).map((m) => m.username).filter(Boolean);
  log(`api cross-check: GET /v1/members → ${members.status}, ${usernames.length} members (${usernames.join(", ")})`);

  await openFromCompany("Personnel", "People");
  const persons = await apiGet("/v1/persons");
  log(`api cross-check: GET /v1/persons → ${persons.status}`);
};

export default flow;
