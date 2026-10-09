import { describe, expect, it } from "vitest";
import { RULES } from "./rules.js";
import { withoutComments } from "./sql.js";

const s1 = RULES.find((rule) => rule.id === "S1");
if (s1 === undefined) throw new Error("no rule S1");

const at = (content: string, path = "apps/api/src/reads/x.ts") =>
  s1.check([{ path, content }]).map((violation) => violation.line);

describe("S1 sql-from-bound-values", () => {
  it.each([
    ["sql.raw over an interpolated template", "await tx.execute(sql.raw(`select * from assets where id = '${id}'`));"],
    ["sql.raw over concatenation", 'await tx.execute(sql.raw("select * from assets where id = \'" + id + "\'"));'],
    ["sql.raw over a variable", "await tx.execute(sql.raw(statement));"],
    ["sql.raw over a call", "await tx.execute(sql.raw(buildWhere(filters)));"],
    ["sql.raw inside a template", "await tx.execute(sql`select * from assets order by ${sql.raw(sort)}`);"],
    ["sql.raw over lines", "await tx.execute(\n  sql\n    .raw(\n      `delete from x where id = ${id}`,\n    ),\n);"],
    ["sql imported under another name", 'import { sql as q } from "drizzle-orm";\nawait tx.execute(q.raw(text));'],
    ["sql.raw taken off as a function", "const run = sql.raw;\nawait tx.execute(run(text));"],
    ["sql.raw destructured", "const { raw } = sql;\nawait tx.execute(raw(text));"],
    ["a StringChunk over a variable", "const chunk = new StringChunk(text);"],
    ["pg query over an interpolated template", "await pool.query(`select * from notes where body = '${body}'`);"],
    ["pg query over concatenation", 'await client.query("select * from notes where id = " + id);'],
    ["pg query over a prebuilt template", "const text = `select * from notes where id = '${id}'`;\nawait pool.query(text);"],
    [
      "pg query over a multiline prebuilt concatenation",
      'const text =\n  "select * from notes " +\n  "where id = " + id;\nawait pool.query(text, []);',
    ],
    ["pg query over a string built with +=", 'let text = "select * from notes";\ntext += ` where id = ${id}`;\nawait pool.query(text);'],
    ["pg query over joined clauses", 'await pool.query(["select * from notes", where].join(" "));'],
    ["pg query config whose text interpolates", "await pool.query({ text: `select * from notes where id = '${id}'`, values: [] });"],
    ["a request value handed over as SQL", "await pool.query(request.body.sql);"],
    ["drizzle execute over an interpolated plain string", "await db.execute(`select * from notes where id = '${id}'`);"],
    ["postgres.js unsafe over a template", "await sql.unsafe(`select * from notes where id = '${id}'`);"],
  ])("catches %s", (_label, snippet) => {
    expect(at(snippet)).toHaveLength(1);
  });

  it("points at the line the call starts on", () => {
    expect(at("const a = 1;\nawait pool.query(\n  `select ${a}`,\n);")).toEqual([2]);
  });

  it.each([
    ["a drizzle template with bound values", "await tx.execute(sql`select * from notes where id = ${id} and body = ${body}`);"],
    ["a typed drizzle template", "await tx.execute(sql<{ n: number }>`select count(*) as n from notes where id = ${id}`);"],
    ["sql.identifier for a dynamic name", "await tx.execute(sql`select * from ${sql.identifier(table)} where id = ${id}`);"],
    ["sql.raw over a literal", 'await tx.execute(sql`select 1 ${sql.raw("for update")}`);'],
    ["sql.raw over a const literal", 'const LOCK = "for update";\nawait tx.execute(sql`select 1 ${sql.raw(LOCK)}`);'],
    ["sql.join of templates", "await tx.execute(sql`update x set ${sql.join(sets, sql`, `)}`);"],
    ["pg query with bound values", 'await pool.query("select * from notes where id = $1", [id]);'],
    ["pg query over a static template", "await pool.query(`\n  select * from notes\n  where id = $1\n`, [id]);"],
    ["pg query config with bound values", 'await pool.query({ text: "select * from notes where id = $1", values: [id] });'],
    ["a name quoted by pg", "await pool.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);"],
    ["a command definition's execute", "const result = await definition.execute(tx, ctx, envelope, payload);"],
    ["a drizzle query object", "await tx.execute(statement);"],
    ["String.raw", "const pattern = String.raw`\\d+`;"],
    ["an image library's raw()", "const pixel = await sharp(bytes).raw().toBuffer();"],
    ["a raw field on a row", "const value = row.raw;"],
    ["a doc comment", "/**\n * Never sql.raw(`... ${id}`): bind it.\n */\nconst x = 1;"],
    ["a line comment", "// pool.query(`select ${id}`) would be injectable\nconst x = 1;"],
    ["a URL in a string", 'const url = "http://x/"; await pool.query("select 1");'],
  ])("allows %s", (_label, snippet) => {
    expect(at(snippet)).toEqual([]);
  });

  it("ignores test files", () => {
    expect(at("await ctx.db.execute(sql.raw(migrationSql));", "apps/api/src/db/x.test.ts")).toEqual([]);
  });

  it("reads past regex literals that contain quotes or slashes", () => {
    expect(at("const quote = /[\"'`]/;\nawait pool.query(`select ${id}`);")).toEqual([2]);
    expect(at("const path = /^\\/v1\\//;\nawait pool.query(`select ${id}`);")).toEqual([2]);
  });
});

describe("withoutComments", () => {
  it("keeps offsets and line breaks", () => {
    const code = "a; // one\n/* two\nthree */ b;";
    const stripped = withoutComments(code);
    expect(stripped).toHaveLength(code.length);
    expect(stripped.split("\n")).toHaveLength(3);
    expect(stripped).not.toMatch(/one|two|three/);
  });
});
