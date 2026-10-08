import type { SourceFile, Violation } from "./scan.js";

/**
 * S1. SQL text built from strings. A drizzle `sql` template binds every
 * `${value}` as a parameter and `sql.identifier()` quotes a name, so both are
 * safe. What is not: text handed to something that runs it verbatim.
 *
 * - `.raw(x)` (drizzle `sql.raw`, under any alias) and `new StringChunk(x)`,
 *   unless `x` is a plain string literal or a const holding one. A reference
 *   to `.raw` that is not called (`const run = sql.raw`, `{ raw } = sql`)
 *   counts too, so the alias cannot hide the call.
 * - `.query(x)`, `.execute(x)` and `.unsafe(x)` (pg, drizzle, postgres.js)
 *   when `x`, or the `text` of a pg config object, is a template literal with
 *   `${}`, a string joined with `+` or `.join()`, a const or let built that
 *   way, or reads `request.body`/`query`/`params`/`headers`. A `${}` wrapped in
 *   `escapeIdentifier()`/`escapeLiteral()` (pg's quoting) is allowed.
 *
 * Limits: a string passed in as a function parameter, or a query method
 * pulled off its client (`const q = pool.query.bind(pool)`), is not traced;
 * the rule reads one file's text, not types. Comments never count. One
 * violation per line.
 */
export function unsafeSqlConstruction(file: SourceFile): Violation[] {
  const code = withoutComments(file.content);
  const found: number[] = [];

  const sqlNames = new Set(["sql"]);
  for (const imported of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']drizzle-orm["']/g)) {
    const alias = /\bsql\s+as\s+(\w+)/.exec(imported[1] ?? "")?.[1];
    if (alias !== undefined) sqlNames.add(alias);
  }

  for (const match of code.matchAll(/(\w+)?\s*\.\s*raw\b(\s*\()?/g)) {
    if (match[1] === "String") continue;
    if (match[2] === undefined) {
      if (match[1] !== undefined && sqlNames.has(match[1])) found.push(match.index);
      continue;
    }
    const argument = firstArgument(code, match.index + match[0].length);
    if (argument !== "" && !isLiteral(argument, code)) found.push(match.index);
  }
  for (const match of code.matchAll(/\{[^{}]*\braw\b[^{}]*\}\s*=\s*(\w+)/g)) {
    if (sqlNames.has(match[1] ?? "")) found.push(match.index);
  }
  for (const match of code.matchAll(/new\s+StringChunk\s*\(/g)) {
    if (!isLiteral(firstArgument(code, match.index + match[0].length), code)) found.push(match.index);
  }
  for (const match of code.matchAll(/\.\s*(query|execute|unsafe)\s*\(/g)) {
    const argument = firstArgument(code, match.index + match[0].length);
    if (isDynamicText(queryText(argument), code, sqlNames)) found.push(match.index);
  }

  const lines = new Set(found.map((index) => file.content.slice(0, index).split("\n").length));
  return [...lines]
    .sort((a, b) => a - b)
    .map((line) => ({ path: file.path, line, text: (file.content.split("\n")[line - 1] ?? "").trim() }));
}

const STRING = /^(['"])(?:\\.|(?!\1)[^\\\n])*\1$/;
const PLAIN_TEMPLATE = /^`(?:\\.|[^`\\$]|\$(?!\{))*`$/;
const REQUEST = /\b(?:req|request)\s*\.\s*(?:body|query|params|headers)\b/;

/** A string literal, a template without `${}`, or a const in this file assigned one. */
function isLiteral(argument: string, code: string): boolean {
  if (STRING.test(argument) || PLAIN_TEMPLATE.test(argument)) return true;
  if (!/^\w+$/.test(argument)) return false;
  const value = assignedValue(code, argument, "const");
  return value !== undefined && (STRING.test(value) || PLAIN_TEMPLATE.test(value));
}

function isDynamicText(argument: string, code: string, sqlNames: ReadonlySet<string>): boolean {
  const tag = /^(\w+)(?:<[^`]*>)?`/.exec(argument)?.[1];
  if (argument === "" || (tag !== undefined && sqlNames.has(tag))) return false;
  if (REQUEST.test(argument)) return true;
  if (argument.startsWith("`")) return hasRawInterpolation(argument);
  if (/['"`]\s*\+|\+\s*['"`]|\.join\s*\(/.test(argument)) return true;
  if (/^\w+$/.test(argument)) {
    const value = assignedValue(code, argument, "const|let|var");
    const appended = new RegExp(`\\b${argument}\\s*\\+=`).test(code);
    return appended || (value !== undefined && value !== argument && isDynamicText(value, code, sqlNames));
  }
  return false;
}

/** pg's `{ text, values }` form: the text is what runs verbatim. */
function queryText(argument: string): string {
  if (!argument.startsWith("{")) return argument;
  const text = /\btext\s*:\s*/.exec(argument);
  if (text === null) return /^\{\s*text\s*[,}]/.test(argument) ? "text" : "";
  return firstArgument(argument, text.index + text[0].length);
}

function hasRawInterpolation(template: string): boolean {
  let index = template.indexOf("${");
  while (index !== -1) {
    const expression = firstArgument(template, index + 2, "}");
    if (!/^(?:[\w.]+\.)?escape(?:Identifier|Literal)\s*\(/.test(expression)) return true;
    index = template.indexOf("${", index + 2 + expression.length);
  }
  return false;
}

function assignedValue(code: string, name: string, kinds: string): string | undefined {
  const declaration = new RegExp(`\\b(?:${kinds})\\s+${name}\\s*(?::[^=]+)?=\\s*`).exec(code);
  if (declaration === null) return undefined;
  return firstArgument(code, declaration.index + declaration[0].length, ";");
}

/**
 * The source text from `start` to the first top-level `end`, or `,` unless
 * `end` is `;`, stepping over nested brackets, strings and templates. Trimmed.
 */
export function firstArgument(code: string, start: number, end = ")"): string {
  let depth = 0;
  let index = start;
  while (index < code.length) {
    const char = code[index] ?? "";
    if (char === "'" || char === '"' || char === "`") {
      index = skipString(code, index);
      continue;
    }
    if (depth === 0 && (char === end || (char === "," && end !== ";"))) break;
    if ("([{".includes(char)) depth++;
    if (")]}".includes(char)) depth--;
    if (depth < 0) break;
    index++;
  }
  return code.slice(start, index).trim();
}

/** Index just past the string or template opening at `start`, with `${}` nesting followed. */
function skipString(code: string, start: number): number {
  const quote = code[start];
  let index = start + 1;
  while (index < code.length) {
    const char = code[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    if (quote !== "`" && char === "\n") return index;
    if (quote === "`" && char === "$" && code[index + 1] === "{") {
      index += 2;
      let depth = 1;
      while (index < code.length && depth > 0) {
        const inner = code[index] ?? "";
        if (inner === "'" || inner === '"' || inner === "`") {
          index = skipString(code, index);
          continue;
        }
        if (inner === "{") depth++;
        if (inner === "}") depth--;
        index++;
      }
      continue;
    }
    index++;
  }
  return index;
}

/**
 * Comments replaced by spaces, line breaks kept so offsets and line numbers
 * still match. Strings, templates and regex literals are stepped over, so a
 * `//` inside a URL or a pattern stays code.
 */
export function withoutComments(content: string): string {
  let out = "";
  let index = 0;
  let previous = "";
  while (index < content.length) {
    const char = content[index] ?? "";
    const next = content[index + 1];
    if (char === "/" && next === "/") {
      const close = content.indexOf("\n", index);
      const stop = close === -1 ? content.length : close;
      out += " ".repeat(stop - index);
      index = stop;
      continue;
    }
    if (char === "/" && next === "*") {
      const close = content.indexOf("*/", index + 2);
      const stop = close === -1 ? content.length : close + 2;
      out += content.slice(index, stop).replace(/[^\n]/g, " ");
      index = stop;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const stop = skipString(content, index);
      out += content.slice(index, stop);
      index = stop;
      previous = char;
      continue;
    }
    if (char === "/" && (previous === "" || "(,=:[!&|?{};+-*%<>~^".includes(previous) || /\breturn\s*$/.test(out))) {
      const stop = skipRegex(content, index);
      out += content.slice(index, stop);
      index = stop;
      previous = "/";
      continue;
    }
    out += char;
    if (!/\s/.test(char)) previous = char;
    index++;
  }
  return out;
}

function skipRegex(content: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < content.length) {
    const char = content[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "\n") return index;
    if (char === "[") inClass = true;
    if (char === "]") inClass = false;
    if (char === "/" && !inClass) return index + 1;
    index++;
  }
  return index;
}
