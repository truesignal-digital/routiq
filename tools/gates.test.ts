import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decide, segments, type Context } from "../.claude/hooks/git-guardrails.js";
import { changesBehaviour, evidenceProblems, section } from "./pr-evidence.js";
import { citedException, handRaisedCeilings, ratchet, ruleIds, type Ceilings, type RatchetInput } from "./ratchet.js";

describe("git guardrails hook", () => {
  const bases: Record<string, string> = { "601": "develop", "602": "main", "603": "release/x" };
  const context = (branch = "chore/624-merge-gates"): Context & { views: { args: string[]; env: Record<string, string> }[] } => {
    const views: { args: string[]; env: Record<string, string> }[] = [];
    return {
      views,
      currentBranch: () => branch,
      prBase: (args, env) => {
        views.push({ args, env });
        const selector = args[0] ?? "current";
        return selector === "current" ? "develop" : bases[selector.replace(/^.*\/pull\//, "")];
      },
    };
  };
  const SHA = "0123456789abcdef0123456789abcdef01234567";

  it.each([
    "git push -u origin chore/624-merge-gates",
    "git -C ../wt push origin feat/x",
    "GH_CONFIG_DIR=~/.config/gh git push -u origin fix/x",
    "git push origin HEAD",
    "git push",
    "git branch -d merged-branch",
    "git commit -m 'never git push --force'",
    'git commit -m "docs: explain why git reset --hard is blocked"',
    "gh pr create --base develop --title 'Block git push origin develop'",
    "git restore --staged .",
    "git -c rerere.enabled=false merge origin/develop",
    "git checkout -b feat/x origin/develop",
    "git reset --soft HEAD~1",
    "git clean -n",
    "gh pr view 601 --json baseRefName",
    "gh api repos/o/r/pulls/601",
    "cat > /tmp/body.md <<'EOF'\ngit push --force origin develop\ngh pr merge 1 --admin\nEOF",
    `gh pr merge 601 --squash --match-head-commit ${SHA}`,
    `gh pr merge 601 --merge --match-head-commit=${SHA.slice(0, 12)}`,
    `GH_CONFIG_DIR=~/.config/gh gh pr merge https://github.com/o/r/pull/601 --merge --match-head-commit ${SHA}`,
    `gh pr merge --squash --match-head-commit ${SHA}`,
    `gh pr merge 601 --auto --squash --match-head-commit ${SHA}`,
    `bash -c "gh pr merge 601 --squash --match-head-commit ${SHA}"`,
    'bash -c "pnpm typecheck && git push -u origin feat/x"',
    "bash scripts/deploy.sh",
    "echo 'git push --force' > notes.txt",
    "printf 'git reset --hard' | wc -c",
    "cat <<'EOF' > /tmp/x.sh\ngit push -f origin feat/x\nEOF",
    "git config core.hooksPath",
    "git config --get core.hooksPath",
    "git config core.hooksPath .githooks",
    "gh alias list",
    "/usr/bin/git push -u origin feat/x",
  ])("allows %s", (command) => {
    expect(decide(command, context())).toBeUndefined();
  });

  it.each([
    "git push origin develop",
    "git push origin main",
    "git push origin HEAD:main",
    "git push origin feat/x:refs/heads/develop",
    "git push --force origin feat/x",
    "git push -f origin feat/x",
    "git push -uf origin feat/x",
    "git push --force-with-lease",
    "git push --force-with-lease=feat/x origin feat/x",
    "git push origin +feat/x",
    "git push --mirror origin",
    "git push --all origin",
    "git push --no-verify origin feat/x",
    "git -c core.hooksPath=/dev/null push origin feat/x",
    "git commit --no-verify -m x",
    "git push origin --delete feat/x",
    "git push -d origin feat/x",
    "git push origin :feat/x",
    "git push --prune origin",
    "git reset --hard origin/develop",
    "git reset --hard",
    "git clean -fd",
    "git clean -xdf",
    "git clean --force",
    "git branch -D feat/x",
    "git branch --delete --force feat/x",
    "git branch -df feat/x",
    "git checkout .",
    "git checkout -- .",
    "git restore .",
    "git restore --staged --worktree .",
    "pnpm lint && git push origin main",
    "cd ../wt && git push --force",
    "echo ok; git push origin develop",
    "true || git reset --hard",
    "(git push origin main)",
    "echo $(git push --force origin x)",
    "gh api -X PUT repos/o/r/pulls/601/merge -f sha=abc",
    "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
    "gh api -X DELETE repos/o/r/git/refs/heads/feat/x",
    // One level of indirection (Fable review of #674).
    `bash -c "gh pr merge 602 --merge --match-head-commit ${SHA}"`,
    'bash -c "git push origin HEAD:main"',
    "sh -c 'git push origin HEAD:main'",
    "zsh -lc 'git reset --hard'",
    'eval "git push origin HEAD:main"',
    "eval git push -f origin feat/x",
    'GH_CONFIG_DIR=/x bash -c "gh pr merge 601 --admin"',
    'bash -c "bash -c \\"git push --force\\""',
    "bash <<EOF\ngit push -f origin feat/x\nEOF",
    "sh <<'EOF'\necho hi\ngit push origin develop\nEOF",
    "cat <<'EOF' | bash\ngit clean -fd\nEOF",
    "bash <<< 'git push -f origin feat/x'",
    'echo "git push -f origin feat/x" | sh',
    "printf 'git status\\ngit reset --hard\\n' | bash",
    `gh alias set pm "pr merge" && gh pm 602 --merge --match-head-commit ${SHA}`,
    "gh alias import aliases.yml",
    "/usr/bin/git push -f origin feat/x",
    "/opt/homebrew/bin/gh pr merge 601 --admin",
    "git config core.hooksPath /dev/null",
    "git config core.hooksPath /dev/null && git push origin feat/x",
    "git config --unset core.hooksPath",
    "git config --global core.hooksPath /tmp/none",
  ])("blocks %s", (command) => {
    expect(decide(command, context())).toBeDefined();
  });

  it("blocks a bare push or a HEAD push from a protected branch", () => {
    expect(decide("git push", context("develop"))).toBeDefined();
    expect(decide("git push origin HEAD", context("main"))).toBeDefined();
    expect(decide("git push -u origin", context("develop"))).toBeDefined();
    expect(decide("git push origin 2>&1 | tail -3", context("develop"))).toBeDefined();
    expect(decide("git push origin > /tmp/push.log", context("develop"))).toBeDefined();
    expect(decide("git push -u origin feat/x > /tmp/push.log 2>&1", context("develop"))).toBeUndefined();
    expect(decide("git push", context("feat/x"))).toBeUndefined();
  });

  describe("gh pr merge (owner decision 2026-10-10: develop only, pinned head, no --admin)", () => {
    it.each([
      ["no pinned head", "gh pr merge 601 --squash", /--match-head-commit/],
      ["a pinned head with no SHA", "gh pr merge 601 --squash --match-head-commit", /--match-head-commit/],
      ["--admin", `gh pr merge 601 --admin --squash --match-head-commit ${SHA}`, /--admin/],
      ["--delete-branch", `gh pr merge 601 --squash --delete-branch --match-head-commit ${SHA}`, /Deleting remote branches/],
      ["-d", `gh pr merge 601 -s -d --match-head-commit ${SHA}`, /Deleting remote branches/],
      ["a PR into main", `gh pr merge 602 --merge --match-head-commit ${SHA}`, /main.*owner/],
      ["a PR into another branch", `gh pr merge 603 --merge --match-head-commit ${SHA}`, /only into develop/],
      ["a PR whose base can't be read", `gh pr merge 999 --merge --match-head-commit ${SHA}`, /Could not read this PR's base branch/],
      ["a merge into main via GH_CONFIG_DIR", `GH_CONFIG_DIR=~/.config/gh gh pr merge 602 --squash --match-head-commit ${SHA}`, /main/],
    ])("blocks %s", (_label, command, reason) => {
      expect(decide(command, context())).toMatch(reason);
    });

    it("asks gh for the base of the selected PR, with the repo and the inline GH_CONFIG_DIR", () => {
      const ctx = context();
      decide(`GH_CONFIG_DIR=/tmp/gh gh pr merge 601 -R o/r --squash -b "merged by the train" --match-head-commit ${SHA}`, ctx);
      expect(ctx.views).toEqual([{ args: ["601", "-R", "o/r"], env: { GH_CONFIG_DIR: "/tmp/gh" } }]);
    });

    it("does not ask gh when the merge is already refused", () => {
      const ctx = context();
      decide("gh pr merge 601 --admin", ctx);
      expect(ctx.views).toEqual([]);
    });
  });

  it("tracks cd and inline env per command", () => {
    const parsed = segments("cd /repo/wt && GH_CONFIG_DIR=/x gh pr view 1; git status");
    expect(parsed).toEqual([
      { tokens: ["gh", "pr", "view", "1"], env: { GH_CONFIG_DIR: "/x" }, cwd: "/repo/wt", pipe: false },
      { tokens: ["git", "status"], env: {}, cwd: "/repo/wt", pipe: false },
    ]);
  });

  it("runs as a Claude Code hook: exit 2 with a reason on stderr, exit 0 otherwise", () => {
    const hook = join(import.meta.dirname, "../.claude/hooks/git-guardrails.ts");
    const run = (command: string) => {
      try {
        execFileSync(process.execPath, ["--no-warnings", hook], {
          input: JSON.stringify({ cwd: import.meta.dirname, tool_input: { command } }),
          stdio: ["pipe", "pipe", "pipe"],
          encoding: "utf8",
        });
        return { status: 0, stderr: "" };
      } catch (error) {
        const failure = error as { status: number; stderr: string };
        return { status: failure.status, stderr: failure.stderr };
      }
    };
    expect(run("git status").status).toBe(0);
    const blocked = run("git push --force origin feat/x");
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/^BLOCKED by \.claude\/hooks\/git-guardrails\.ts: Force pushes/);
  });

  it("is registered for Bash in the project settings", () => {
    const settings = JSON.parse(readFileSync(join(import.meta.dirname, "../.claude/settings.json"), "utf8")) as {
      hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] };
    };
    const bash = settings.hooks.PreToolUse.find((entry) => entry.matcher === "Bash");
    expect(bash?.hooks.map((h) => h.command)).toContain('node --no-warnings "$CLAUDE_PROJECT_DIR/.claude/hooks/git-guardrails.ts"');
  });
});

describe("pre-push hook", () => {
  const hook = join(import.meta.dirname, "../.githooks/pre-push");
  const push = (remoteRef: string) => {
    try {
      // PATH without pnpm: protected refs are refused before the checks run.
      execFileSync("sh", [hook, "origin", "git@example:repo.git"], {
        input: `refs/heads/x ${"1".repeat(40)} ${remoteRef} ${"0".repeat(40)}\n`,
        env: { PATH: "/usr/bin:/bin" },
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf8",
      });
      return { status: 0, stderr: "" };
    } catch (error) {
      const failure = error as { status: number; stderr: string };
      return { status: failure.status, stderr: failure.stderr };
    }
  };

  it.each(["refs/heads/main", "refs/heads/develop"])("refuses a push to %s", (ref) => {
    const result = push(ref);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/changes only through a PR/);
  });

  it("goes on to the checks for a feature branch", () => {
    expect(push("refs/heads/feat/x").stderr).toMatch(/pnpm not found/);
  });

  it("is installed by the root prepare script", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as { scripts: Record<string, string> };
    const repo = mkdtempSync(join(tmpdir(), "routiq-prepare-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("sh", ["-c", pkg.scripts.prepare ?? "false"], { cwd: repo });
    expect(execFileSync("git", ["config", "core.hooksPath"], { cwd: repo, encoding: "utf8" }).trim()).toBe(".githooks");
  });
});

describe("pr-evidence", () => {
  const body = (video: string, found: string) =>
    `## What changed\n\nStuff\n\n## Walkthrough video\n\n<!-- hint -->\n${video}\n\n## Found while testing\n\n<!-- hint -->\n${found}\n`;
  const webChange = ["apps/web/src/screens/AssetsStub.tsx"];
  const apiChange = ["apps/api/src/commands/x.ts"];

  it("only asks for evidence when app code changes", () => {
    expect(changesBehaviour(["AGENTS.md", "tools/guards/rules.ts", "apps/web/src/x.test.tsx"])).toBe(false);
    expect(changesBehaviour(webChange)).toBe(true);
    expect(changesBehaviour(apiChange)).toBe(true);
    expect(evidenceProblems("", ["docs/adr/0006-x.md"])).toEqual([]);
  });

  it("exempts tests, fixtures, snapshots and data files", () => {
    expect(changesBehaviour(["apps/api/src/commands/contract-snapshots/x.json"])).toBe(false);
    expect(changesBehaviour(["apps/web/src/i18n/locales/en.json"])).toBe(false);
    expect(changesBehaviour(["apps/web/src/x.snap"])).toBe(false);
    expect(changesBehaviour(["apps/web/src/__snapshots__/x.tsx"])).toBe(false);
    expect(changesBehaviour(["apps/api/src/test/fixtures/data.ts"])).toBe(false);
    expect(changesBehaviour(["apps/api/src/test/global-setup.ts"])).toBe(false);
    expect(changesBehaviour(["apps/web/src/test-setup.ts"])).toBe(false);
    expect(changesBehaviour(["apps/web/vite.config.ts", "packages/contracts/src/x.ts"])).toBe(false);
  });

  it.each([
    ["a video link", body("https://videos.example/walkthrough.mp4", "- #61")],
    ["a link and none", body("Reel: https://videos.example/w.mp4", "none")],
    ["not recorded (reason)", body("Walkthrough video: not recorded (tooling/CI only, nothing visible in the UI).", "none")],
    ["not recorded, because", body("Walkthrough video: not recorded, because this PR changes tooling only.", "none")],
    ["not recorded. Reason", body("Walkthrough video: not recorded. The change only shows when the clocks differ.", "none")],
    ["bold label", body("**Walkthrough video:** not recorded (perf only)", "none")],
    ["section starting not recorded", body("Not recorded (API only; the API tests cover it).", "none")],
    ["inline lines without headings (#633)", "## What changed\n\nx\n\nWalkthrough video: not recorded (perf, verify evidence instead)\n\nFound while testing: none\n"],
  ])("accepts %s", (_label, text) => {
    expect(evidenceProblems(text, webChange)).toEqual([]);
    expect(evidenceProblems(text, apiChange)).toEqual([]);
  });

  it.each([
    ["the untouched template", body("", ""), 2],
    ["a link only inside the template's comment", body("<!-- https://videos.example/old.mp4 -->", "none"), 1],
    ["not recorded without a reason", body("Walkthrough video: not recorded", "none"), 1],
    ["not recorded with empty parentheses", body("Walkthrough video: not recorded ()", "none"), 1],
    ["an http (not https) link", body("http://videos.example/w.mp4", "none"), 1],
    ["no found-while-testing list", body("https://videos.example/w.mp4", ""), 1],
    ["no sections at all", "Fixes #12", 2],
  ])("rejects %s", (_label, text, count) => {
    expect(evidenceProblems(text, webChange)).toHaveLength(count);
  });

  it("reads a section up to the next heading", () => {
    expect(section("## Walkthrough video\nhttps://a\n## Found while testing\nnone", "Found while testing")).toBe("none");
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
    ceilings: [],
    exception: undefined,
    ...overrides,
  });
  const metricsBase: Ceilings = {
    "web.all-js-gzip": { ceiling: 1000, raises: [{ from: 900, to: 1000, reason: "#1 earlier" }] },
    "web.entry-js-gzip": { ceiling: 500 },
  };

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
    expect(result.blocking).toEqual([
      "baseline raised: [H9] a.tsx 2 → 3",
      "baseline raised: [H9] b.tsx 0 → 1",
      "rule removed: J1",
      "guard machinery rewritten: tools/guards/rules.ts",
    ]);
  });

  it("passes a metrics raise made with pnpm metrics raise --reason", () => {
    const head: Ceilings = {
      ...metricsBase,
      "web.all-js-gzip": {
        ceiling: 1200,
        raises: [...(metricsBase["web.all-js-gzip"]?.raises ?? []), { from: 1000, to: 1200, reason: "#624 the reason" }],
      },
    };
    expect(ratchet(input({ ceilings: [{ path: "tools/metrics/ceilings.json", base: metricsBase, head }] }))).toEqual({ blocking: [], excused: [] });
  });

  it("passes two raises of one metric in one PR, a perf raise, a tighten and a new metric", () => {
    const head: Ceilings = {
      "web.all-js-gzip": {
        ceiling: 1300,
        raises: [
          ...(metricsBase["web.all-js-gzip"]?.raises ?? []),
          { from: 1000, to: 1200, reason: "#1" },
          { from: 1200, to: 1300, reason: "#2" },
        ],
      },
      "web.entry-js-gzip": { ceiling: 450 },
      "web.new-metric": { ceiling: 99 },
    };
    const perfBase: Ceilings = { "/.requests": { ceiling: 6 } };
    const perfHead: Ceilings = { "/.requests": { ceiling: 7, raises: [{ from: 6, to: 7, reason: "#600 members read" }] } };
    const result = ratchet(
      input({
        ceilings: [
          { path: "tools/metrics/ceilings.json", base: metricsBase, head },
          { path: "tools/perf/ceilings.json", base: perfBase, head: perfHead },
        ],
      }),
    );
    expect(result).toEqual({ blocking: [], excused: [] });
  });

  it("blocks a ceiling edited by hand: no new record, a record that ends elsewhere, or an empty reason", () => {
    expect(handRaisedCeilings("m.json", metricsBase, { ...metricsBase, "web.entry-js-gzip": { ceiling: 600 } })).toEqual([
      "ceiling raised without a raise record: m.json web.entry-js-gzip 500 → 600",
    ]);
    expect(
      handRaisedCeilings("m.json", metricsBase, { ...metricsBase, "web.entry-js-gzip": { ceiling: 600, raises: [{ from: 500, to: 550, reason: "x" }] } }),
    ).toHaveLength(1);
    expect(
      handRaisedCeilings("m.json", metricsBase, { ...metricsBase, "web.entry-js-gzip": { ceiling: 600, raises: [{ from: 500, to: 600, reason: " " }] } }),
    ).toHaveLength(1);
    expect(handRaisedCeilings("m.json", undefined, { x: { ceiling: 9 } })).toEqual([]);
  });

  it("lets an ADR-backed exception through, but never new legacy tracker files", () => {
    const result = ratchet(
      input({ head: { H9: { "a.tsx": 3 } }, scratchAdded: [".scratch/x.md"], exception: "ADR-0007" }),
    );
    expect(result.excused).toEqual(["baseline raised: [H9] a.tsx 2 → 3"]);
    expect(result.blocking).toEqual(["new file in the legacy tracker (use a GitHub issue): .scratch/x.md"]);
  });

  it("accepts a Trust-Exception trailer only when its ADR exists", () => {
    const adrs = ["0007-why-the-rule-was-wrong.md", "README.md"];
    expect(citedException("Relax H9\n\nTrust-Exception: ADR-0007\n", adrs)).toBe("ADR-0007");
    expect(citedException("Relax H9\n\nTrust-Exception: ADR-0099\n", adrs)).toBeUndefined();
    expect(citedException("Mentions Trust-Exception: ADR-0007 mid-line", adrs)).toBeUndefined();
  });

  it("reads rule ids from rules.ts", () => {
    expect(ruleIds('{ id: "H9", x }, { id: "DS-1" }')).toEqual(["H9", "DS-1"]);
    expect(ruleIds(undefined)).toEqual([]);
  });

  it("passes a new rule that starts with grandfathered baselines, but not new files under an existing rule", () => {
    const result = ratchet(
      input({
        head: { H9: { "a.tsx": 2, "c.tsx": 1 }, B1: { "x.ts": 3, "y.ts": 1 } },
        headRuleIds: ["H9", "J1", "B1"],
      }),
    );
    expect(result.blocking).toEqual(["baseline raised: [H9] c.tsx 0 → 1"]);
  });

  it("still blocks baselines for a rule that existed on base with no baselined files", () => {
    expect(ratchet(input({ head: { H9: { "a.tsx": 2 }, J1: { "z.ts": 1 } } })).blocking).toEqual(["baseline raised: [J1] z.ts 0 → 1"]);
  });

  it("skips the baseline comparison when the base branch has no baselines yet", () => {
    expect(ratchet(input({ base: undefined, head: { H9: { "a.tsx": 9 } } })).blocking).toEqual([]);
  });
});
