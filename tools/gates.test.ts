import { describe, expect, it } from "vitest";
import { decide } from "../.claude/hooks/git-guardrails.js";
import { changesBehaviour, evidenceProblems, section } from "./pr-evidence.js";
import { ratchet, type RatchetInput } from "./ratchet.js";

describe("git guardrails hook", () => {
  const onFeature = () => "chore/merge-gates";
  const onDevelop = () => "develop";

  it.each([
    "git push -u origin chore/merge-gates",
    "git -C ../wt push origin feat/x",
    "git branch -d merged-branch",
    "git commit -m 'never git push --force'",
    "gh pr create --base develop",
  ])("allows %s", (command) => {
    expect(decide(command, onFeature)).toBeUndefined();
  });

  it.each([
    "git push origin develop",
    "git push origin HEAD:main",
    "git push origin feat/x:refs/heads/develop",
    "git push --force origin feat/x",
    "git push --force-with-lease",
    "git push origin +feat/x",
    "git push --no-verify origin feat/x",
    "git push origin --delete feat/x",
    "git push origin :feat/x",
    "git reset --hard origin/develop",
    "git clean -fd",
    "git branch -D feat/x",
    "git checkout .",
    "git restore .",
    "gh pr merge 60 --squash",
    "pnpm lint && git push origin main",
  ])("blocks %s", (command) => {
    expect(decide(command, onFeature)).toBeDefined();
  });

  it("blocks a bare push from a protected branch", () => {
    expect(decide("git push", onDevelop)).toBeDefined();
    expect(decide("git push", onFeature)).toBeUndefined();
  });
});

describe("pr-evidence", () => {
  const body = (video: string, found: string) =>
    `## What changed\n\nStuff\n\n## Walkthrough video\n\n<!-- hint -->\n${video}\n\n## Found while testing\n\n<!-- hint -->\n${found}\n`;
  const appChange = ["apps/web/src/screens/AssetsStub.tsx"];

  it("only asks for evidence when app code changes", () => {
    expect(changesBehaviour(["AGENTS.md", "tools/guards/rules.ts", "apps/web/src/x.test.tsx"])).toBe(false);
    expect(changesBehaviour(appChange)).toBe(true);
    expect(evidenceProblems("", ["docs/adr/0006-x.md"])).toEqual([]);
  });

  it("passes with a link and a findings list", () => {
    expect(evidenceProblems(body("https://videos.example/walkthrough.mp4", "- #61"), appChange)).toEqual([]);
    expect(evidenceProblems(body("https://videos.example/w.mp4", "none"), appChange)).toEqual([]);
  });

  it("fails on the untouched template", () => {
    expect(evidenceProblems(body("", ""), appChange)).toHaveLength(2);
  });

  it("ignores links inside the template's comments", () => {
    const commented = body("<!-- https://videos.example/old.mp4 -->", "none");
    expect(evidenceProblems(commented, appChange)).toHaveLength(1);
  });

  it("reads a section up to the next heading", () => {
    expect(section("## Walkthrough video\nhttps://a\n## Found while testing\nnone", "Found while testing")).toBe("none");
  });

  it("exempts non-code files from behavior check", () => {
    expect(changesBehaviour(["apps/api/src/commands/contract-snapshots/x.json"])).toBe(false);
    expect(changesBehaviour(["apps/web/src/i18n/locales/en.json"])).toBe(false);
    expect(changesBehaviour(["docs/reference/vehicle.md"])).toBe(false);
    expect(changesBehaviour(["apps/web/src/x.snap"])).toBe(false);
    expect(changesBehaviour(["apps/api/src/test/fixtures/data.json"])).toBe(false);
    // But actual code still counts
    expect(changesBehaviour(["apps/web/src/x.tsx"])).toBe(true);
  });

  it("allows opt-out for non-UI changes with reason", () => {
    const files = ["apps/api/src/commands/x.ts"];
    expect(evidenceProblems(body("not needed — tests only", "none"), files)).toEqual([]);
    // But requires a reason
    expect(evidenceProblems(body("not needed", "none"), files)).toHaveLength(1);
  });

  it("requires video for UI changes, opt-out not allowed", () => {
    const files = ["apps/web/src/screens/X.tsx"];
    expect(evidenceProblems(body("not needed — reason", "none"), files)).toHaveLength(1);
    expect(evidenceProblems(body("https://example.com/video.mp4", "none"), files)).toEqual([]);
  });
});

describe("ratchet", () => {
  const input = (overrides: Partial<RatchetInput>): RatchetInput => ({
    base: { H9: { "a.tsx": 2 } },
    head: { H9: { "a.tsx": 2 } },
    baseRuleIds: ["H9", "J1"],
    headRuleIds: ["H9", "J1"],
    rewritten: [],
    scratchAdded: [],
    exception: undefined,
    ...overrides,
  });

  it("holds when nothing weakens", () => {
    expect(ratchet(input({ head: { H9: { "a.tsx": 1 } } }))).toEqual({ blocking: [], excused: [] });
  });

  it("blocks a raised baseline, a new baselined file, a removed rule and rewritten machinery", () => {
    const result = ratchet(
      input({
        head: { H9: { "a.tsx": 3, "b.tsx": 1 } },
        headRuleIds: ["H9"],
        rewritten: ["tools/guards/rules.ts"],
      }),
    );
    expect(result.blocking).toHaveLength(4);
  });

  it("lets an ADR-backed exception through, but never new legacy tracker files", () => {
    const result = ratchet(
      input({ head: { H9: { "a.tsx": 3 } }, scratchAdded: [".scratch/x.md"], exception: "ADR-0007" }),
    );
    expect(result.excused).toHaveLength(1);
    expect(result.blocking).toEqual(["new file in the legacy tracker (use a GitHub issue): .scratch/x.md"]);
  });

  it("skips the baseline comparison when the base branch has no baselines yet", () => {
    expect(ratchet(input({ base: undefined, head: { H9: { "a.tsx": 9 } } })).blocking).toEqual([]);
  });
});
