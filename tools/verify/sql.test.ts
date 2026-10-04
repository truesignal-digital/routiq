import { describe, expect, it } from "vitest";
import { checkReadOnlySql, stripSqlNoise } from "./sql.js";

const allowed = (sql: string) => checkReadOnlySql(sql).ok;
const reason = (sql: string) => {
  const verdict = checkReadOnlySql(sql);
  return verdict.ok ? "" : verdict.reason;
};

describe("checkReadOnlySql", () => {
  it("accepts single read statements", () => {
    expect(allowed("select * from assets")).toBe(true);
    expect(allowed("SELECT count(*) FROM financial_entries;")).toBe(true);
    expect(allowed("with x as (select 1) select * from x")).toBe(true);
    expect(allowed("explain select 1")).toBe(true);
    expect(allowed("(select 1) union (select 2)")).toBe(true);
    expect(allowed("show timezone")).toBe(true);
  });

  it("ignores keywords inside strings, quoted identifiers and comments", () => {
    expect(allowed("select 'delete from assets' as note")).toBe(true);
    expect(allowed('select "update" from t')).toBe(true);
    expect(allowed("select 1 -- drop table assets")).toBe(true);
    expect(allowed("select 1 /* ; insert */")).toBe(true);
    expect(allowed("select $$; truncate x$$")).toBe(true);
    expect(allowed("select updated_at, created_by_command_id from assets")).toBe(true);
  });

  it("refuses writes and DDL", () => {
    for (const sql of [
      "delete from assets",
      "update assets set code = 'x'",
      "insert into assets values (1)",
      "drop table assets",
      "truncate assets",
      "create table t (x int)",
      "alter table assets add column x int",
      "copy assets to '/tmp/x'",
      "grant all on assets to public",
      "set default_transaction_read_only = off",
    ]) {
      expect(allowed(sql), sql).toBe(false);
    }
  });

  it("refuses writes hidden in a read statement", () => {
    expect(reason("with d as (delete from assets returning *) select * from d")).toMatch(/DELETE/);
    expect(reason("select * into backup from assets")).toMatch(/INTO/);
    expect(reason("select * from assets for update")).toMatch(/UPDATE/);
    expect(reason("explain analyze delete from assets")).toMatch(/ANALYZE|DELETE/);
  });

  it("refuses a second statement", () => {
    expect(reason("select 1; delete from assets")).toBe("one statement only");
    expect(reason("select 1; select 2")).toBe("one statement only");
  });

  it("refuses functions with side effects", () => {
    expect(reason("select set_config('default_transaction_read_only', 'off', false)")).toMatch(/set_config/);
    expect(reason("select pg_terminate_backend(1)")).toMatch(/pg_terminate_backend/);
    expect(reason("select nextval('s')")).toMatch(/nextval/);
  });

  it("refuses an empty query", () => {
    expect(reason("  ;  ")).toBe("empty query");
  });
});

describe("stripSqlNoise", () => {
  it("handles doubled quotes inside literals", () => {
    expect(stripSqlNoise("select 'it''s; delete'")).not.toContain("delete");
  });
});
