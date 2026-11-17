/**
 * Deterministic parser for the HCL native-syntax subset used by Terraform
 * resource configurations. It builds a structural tree (blocks, attributes,
 * literals, tuples, objects) and keeps every other expression as raw source
 * text. It never evaluates expressions and never throws: problems become
 * diagnostics with file/line/column.
 *
 * Supported subset and limitations: docs/architecture/adr/0001-terraform-hcl-parser.md
 */

import type {
  Attribute,
  Block,
  Body,
  DiagnosticCode,
  ExpressionForm,
  ExpressionValue,
  ObjectEntry,
  ParseDiagnostic,
  ParsedFile,
  SourceRange,
  Value,
} from "./types";

export const MAX_FILE_BYTES = 1024 * 1024;

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_-]/;
const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const HEREDOC_OPEN = /^<<(-?)([A-Za-z_][A-Za-z0-9_]*)\r?\n/;
const REFERENCE_FORM = /^[A-Za-z_][\w-]*(\.[A-Za-z_*][\w-]*|\[[^\]\n]*\])+$/;
const REFERENCES =
  /\b(?:var|local|module)\.[A-Za-z_][\w-]*|\bdata\.[a-z][a-z0-9_]*\.[A-Za-z_][\w-]*|\b[a-z][a-z0-9]*_[a-z0-9_]+\.[A-Za-z_][\w-]*/g;

class Parser {
  readonly diagnostics: ParseDiagnostic[] = [];
  private readonly lineStarts: number[];
  pos = 0;

  constructor(
    readonly src: string,
    readonly file: string
  ) {
    this.lineStarts = [0];
    for (let i = 0; i < src.length; i++) if (src[i] === "\n") this.lineStarts.push(i + 1);
  }

  /* ---- positions & diagnostics -------------------------------------- */

  lineCol(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.lineStarts[lo] + 1 };
  }

  range(start: number, end: number): SourceRange {
    const s = this.lineCol(start);
    const e = this.lineCol(Math.max(start, end));
    return { file: this.file, line: s.line, column: s.column, endLine: e.line, endColumn: e.column };
  }

  error(code: DiagnosticCode, message: string, offset: number, severity: "error" | "warning" = "error") {
    const { line, column } = this.lineCol(Math.min(offset, this.src.length));
    // One diagnostic per code+position keeps recovery from producing noise.
    if (this.diagnostics.some((d) => d.code === code && d.line === line && d.column === column)) return;
    this.diagnostics.push({ severity, code, message, file: this.file, line, column });
  }

  /* ---- trivia ----------------------------------------------------------- */

  /** Skip spaces, tabs, CR and comments. Newlines only when `newlines`. */
  skipTrivia(newlines: boolean, limit = this.src.length) {
    while (this.pos < limit) {
      const c = this.src[this.pos];
      if (c === " " || c === "\t" || c === "\r" || (newlines && c === "\n")) {
        this.pos++;
      } else if (c === "#" || (c === "/" && this.src[this.pos + 1] === "/")) {
        while (this.pos < limit && this.src[this.pos] !== "\n") this.pos++;
      } else if (c === "/" && this.src[this.pos + 1] === "*") {
        const close = this.src.indexOf("*/", this.pos + 2);
        if (close === -1 || close >= limit) {
          this.error("unterminated-comment", "Block comment is not closed with */.", this.pos);
          this.pos = limit;
        } else {
          this.pos = close + 2;
        }
      } else {
        break;
      }
    }
  }

  /** Skip the rest of the current line, respecting brackets and strings. */
  recoverToLineEnd() {
    const end = this.scanExpressionEnd(this.pos, new Set(), this.src.length, true);
    // Always make progress, e.g. when recovery starts on a stray closing bracket.
    this.pos = end > this.pos ? end : this.pos + 1;
  }

  /* ---- lexical scanning (no interpretation) --------------------------- */

  /** Returns the offset just after the closing quote of the string at `i`. */
  skipQuoted(i: number, limit: number, report = true): number {
    const start = i;
    i++;
    while (i < limit) {
      const c = this.src[i];
      if (c === "\n") break;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') return i + 1;
      if ((c === "$" || c === "%") && this.src[i + 1] === c && this.src[i + 2] === "{") {
        i += 3; // escaped $${ or %%{
        continue;
      }
      if ((c === "$" || c === "%") && this.src[i + 1] === "{") {
        i = this.skipInterpolation(i + 2, limit);
        continue;
      }
      i++;
    }
    if (report) this.error("unterminated-string", "String is not closed before the end of the line.", start);
    return Math.min(i, limit);
  }

  /** Skip a ${ ... } body (starting after the brace) including nested strings. */
  private skipInterpolation(i: number, limit: number): number {
    let depth = 1;
    while (i < limit && depth > 0) {
      const c = this.src[i];
      if (c === '"') {
        i = this.skipQuoted(i, limit);
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    return i;
  }

  /** If a heredoc starts at `i`, return the offset after its closing marker line. */
  skipHeredoc(i: number, limit: number): number | null {
    const m = HEREDOC_OPEN.exec(this.src.slice(i, Math.min(limit, i + 200)));
    if (!m) return null;
    const marker = m[2];
    let lineStart = i + m[0].length;
    while (lineStart < limit) {
      let lineEnd = this.src.indexOf("\n", lineStart);
      if (lineEnd === -1 || lineEnd > limit) lineEnd = limit;
      if (this.src.slice(lineStart, lineEnd).replace(/\r$/, "").trim() === marker) return lineEnd;
      lineStart = lineEnd + 1;
    }
    this.error("unterminated-heredoc", `Heredoc is not closed with "${marker}".`, i);
    return limit;
  }

  /**
   * Find where the expression starting at `i` ends: a newline, comment or
   * stop character at bracket depth 0. Brackets, strings, heredocs and
   * comments are skipped as units.
   */
  scanExpressionEnd(i: number, stops: Set<string>, limit: number, quiet = false): number {
    const stack: string[] = [];
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    while (i < limit) {
      const c = this.src[i];
      if (c === '"') {
        i = this.skipQuoted(i, limit, !quiet);
        continue;
      }
      if (c === "<" && this.src[i + 1] === "<") {
        const after = this.skipHeredoc(i, limit);
        if (after !== null) {
          i = after;
          continue;
        }
      }
      if (c === "#" || (c === "/" && this.src[i + 1] === "/")) {
        if (stack.length === 0) break;
        while (i < limit && this.src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && this.src[i + 1] === "*") {
        const close = this.src.indexOf("*/", i + 2);
        i = close === -1 ? limit : close + 2;
        continue;
      }
      if (c === "\n" && stack.length === 0) break;
      if (stack.length === 0 && stops.has(c)) break;
      if (c in pairs) stack.push(pairs[c]);
      else if (c === ")" || c === "]" || c === "}") {
        if (stack.length === 0) {
          if (!quiet) this.error("unbalanced-brackets", `Unexpected "${c}".`, i);
          break;
        }
        const expected = stack.pop();
        if (expected !== c && !quiet) this.error("unbalanced-brackets", `Expected "${expected}" but found "${c}".`, i);
      }
      i++;
    }
    if (stack.length && !quiet) this.error("unbalanced-brackets", `Missing "${stack[stack.length - 1]}".`, i);
    return i;
  }

  /* ---- identifiers ------------------------------------------------------ */

  readIdentifier(): string | null {
    if (!IDENT_START.test(this.src[this.pos] ?? "")) return null;
    const start = this.pos;
    while (this.pos < this.src.length && IDENT_CHAR.test(this.src[this.pos])) this.pos++;
    return this.src.slice(start, this.pos);
  }

  /* ---- bodies ----------------------------------------------------------- */

  parseBody(closing: boolean): Body {
    const body: Body = { attributes: [], blocks: [] };
    const seen = new Set<string>();

    let lastItemStart = -1;
    while (true) {
      this.skipTrivia(true);
      if (this.pos >= this.src.length) {
        if (closing) this.error("missing-brace", 'Block is not closed with "}".', this.src.length);
        return body;
      }
      // Progress guard: an iteration that consumed nothing must not repeat.
      if (this.pos === lastItemStart) {
        this.pos++;
        continue;
      }
      lastItemStart = this.pos;
      if (this.src[this.pos] === "}") {
        if (closing) {
          this.pos++;
          return body;
        }
        this.error("unexpected-token", 'Unexpected "}".', this.pos);
        this.pos++;
        continue;
      }

      const itemStart = this.pos;
      const name = this.readIdentifier();
      if (!name) {
        const quoted = this.src[this.pos] === '"';
        this.error(
          "unexpected-token",
          quoted
            ? "Attribute and block names must be identifiers, not quoted strings."
            : `Expected an attribute or block, found "${this.src[this.pos]}".`,
          this.pos
        );
        this.recoverToLineEnd();
        continue;
      }
      this.skipTrivia(false);

      if (this.src[this.pos] === "=" && this.src[this.pos + 1] !== "=") {
        this.pos++;
        this.skipTrivia(false);
        if (this.pos >= this.src.length || this.src[this.pos] === "\n" || this.src[this.pos] === "#") {
          this.error("missing-value", `Attribute "${name}" has no value.`, itemStart);
          continue;
        }
        const value = this.parseExpression(new Set(closing ? ["}"] : []));
        this.expectLineEnd(closing);
        if (seen.has(name)) {
          this.error("duplicate-attribute", `Attribute "${name}" is defined more than once in this block.`, itemStart);
        }
        seen.add(name);
        body.attributes.push({ name, value, range: this.range(itemStart, this.pos) } satisfies Attribute);
        continue;
      }

      // Block: name label* {
      const labels: string[] = [];
      let validHeader = true;
      while (true) {
        this.skipTrivia(false);
        const c = this.src[this.pos];
        if (c === '"') {
          const end = this.skipQuoted(this.pos, this.src.length);
          const decoded = this.decodeQuoted(this.pos, end);
          if (decoded === null) {
            this.error("invalid-label", "Block labels cannot contain interpolation.", this.pos);
            validHeader = false;
          } else {
            labels.push(decoded);
          }
          this.pos = end;
        } else if (c !== undefined && IDENT_START.test(c)) {
          labels.push(this.readIdentifier()!);
        } else {
          break;
        }
      }
      if (this.src[this.pos] !== "{") {
        this.error("unexpected-token", `Expected "=" or "{" after "${name}".`, this.pos);
        this.recoverToLineEnd();
        continue;
      }
      this.pos++;
      const inner = this.parseBody(true);
      this.expectLineEnd(closing);
      if (validHeader) body.blocks.push({ type: name, labels, body: inner, range: this.range(itemStart, this.pos) } satisfies Block);
    }
  }

  private expectLineEnd(insideBlock: boolean) {
    this.skipTrivia(false);
    const c = this.src[this.pos];
    if (this.pos >= this.src.length || c === "\n" || (insideBlock && c === "}")) return;
    this.error("trailing-content", `Unexpected content "${this.src.slice(this.pos, this.pos + 20).split("\n")[0]}" after item.`, this.pos);
    this.recoverToLineEnd();
  }

  /* ---- expressions ------------------------------------------------------ */

  parseExpression(stops: Set<string>, limit = this.src.length): Value {
    this.skipTrivia(false, limit);
    const start = this.pos;
    const end = this.scanExpressionEnd(start, stops, limit);
    this.pos = end;
    let trimmedEnd = end;
    while (trimmedEnd > start && /\s/.test(this.src[trimmedEnd - 1])) trimmedEnd--;
    if (trimmedEnd === start) {
      this.error("missing-value", "Expected an expression.", start);
      return this.raw(start, start, "other");
    }
    return this.interpret(start, trimmedEnd);
  }

  private interpret(start: number, end: number): Value {
    const text = this.src.slice(start, end);
    const range = this.range(start, end);

    if (text === "true" || text === "false") return { kind: "bool", value: text === "true", range };
    if (text === "null") return { kind: "null", range };
    if (NUMBER.test(text)) return { kind: "number", value: Number(text), text, range };

    if (text[0] === '"' && this.skipQuoted(start, end, false) === end) {
      const decoded = this.decodeQuoted(start, end);
      return decoded === null ? this.raw(start, end, "template") : { kind: "string", value: decoded, range };
    }

    if (text.startsWith("<<")) {
      const after = this.skipHeredoc(start, end + 1);
      if (after !== null && after >= end) {
        const heredoc = this.decodeHeredoc(start, end);
        return heredoc === null ? this.raw(start, end, "template") : { kind: "string", value: heredoc, range };
      }
    }

    if (text[0] === "[" && this.closingOf(start, end) === end - 1) {
      if (/^\[\s*for\s/.test(text)) return this.raw(start, end, "other");
      return { kind: "tuple", items: this.parseList(start + 1, end - 1, "]"), range };
    }

    if (text[0] === "{" && this.closingOf(start, end) === end - 1) {
      if (/^\{\s*for\s/.test(text)) return this.raw(start, end, "other");
      return { kind: "object", entries: this.parseObject(start + 1, end - 1), range };
    }

    const call = /^([A-Za-z_][\w]*(?:::[\w]+)*)\(/.exec(text);
    if (call && this.closingOf(start + call[1].length, end) === end - 1) {
      const args = this.parseList(start + call[1].length + 1, end - 1, ")");
      return { ...this.raw(start, end, "function"), call: { name: call[1], args } };
    }

    if (this.hasJuxtaposedOperands(start, end)) {
      this.error("trailing-content", "Unexpected content after expression (missing operator between operands?).", start);
    }
    return this.raw(start, end, REFERENCE_FORM.test(text) ? "reference" : "other");
  }

  /**
   * Two operands side by side with no operator ("1 2", "var.a var.b") are
   * invalid HCL. Checked at bracket depth 0 with strings and groups collapsed,
   * so for-expressions and templates (inside brackets/quotes) are unaffected.
   */
  private hasJuxtaposedOperands(start: number, end: number): boolean {
    let flat = "";
    for (let i = start; i < end; i++) {
      const c = this.src[i];
      if (c === '"') {
        i = this.skipQuoted(i, end, false) - 1;
        flat += '""';
      } else if (c === "(" || c === "[" || c === "{") {
        const close = this.closingOf(i, end);
        if (close === -1) return false;
        flat += c === "(" ? "()" : c === "[" ? "[]" : "{}";
        i = close;
      } else {
        flat += c;
      }
    }
    // A function call or index directly after a name has no space: name(...) / name[...].
    return /[\w")\]}]\s+[\w"([{]/.test(flat);
  }

  private raw(start: number, end: number, form: ExpressionForm): ExpressionValue {
    const text = this.src.slice(start, end);
    const withoutStrings = text.replace(/"(?:[^"\\]|\\.)*"/g, (s) => (s.includes("${") ? s : '""'));
    const found = [...new Set(withoutStrings.match(REFERENCES) ?? [])];
    // "data.aws_x.y" also matches the bare "aws_x.y" pattern; drop those echoes.
    const dataRefs = found.filter((r) => r.startsWith("data."));
    const references = found.filter((r) => r.startsWith("data.") || !dataRefs.some((d) => d === `data.${r}`));
    return { kind: "expression", form, text, references, range: this.range(start, end) };
  }

  /** Offset of the bracket closing the one at `open`, or -1. */
  private closingOf(open: number, limit: number): number {
    const closeChar = { "(": ")", "[": "]", "{": "}" }[this.src[open] as "(" | "[" | "{"];
    if (!closeChar) return -1;
    let depth = 0;
    for (let i = open; i < limit; i++) {
      const c = this.src[i];
      if (c === '"') {
        i = this.skipQuoted(i, limit, false) - 1;
        continue;
      }
      if (c === "<" && this.src[i + 1] === "<") {
        const after = this.skipHeredoc(i, limit);
        if (after !== null) {
          i = after - 1;
          continue;
        }
      }
      if (c === "#" || (c === "/" && this.src[i + 1] === "/")) {
        while (i < limit && this.src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && this.src[i + 1] === "*") {
        const close = this.src.indexOf("*/", i + 2);
        i = close === -1 ? limit : close + 1;
        continue;
      }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0) return c === closeChar ? i : -1;
      }
    }
    return -1;
  }

  /** Comma-separated items between `start` and `end` (exclusive), newlines allowed. */
  private parseList(start: number, end: number, closer: string): Value[] {
    const items: Value[] = [];
    const saved = this.pos;
    this.pos = start;
    while (true) {
      this.skipTrivia(true, end);
      if (this.pos >= end) break;
      items.push(this.parseExpressionInCollection(new Set([",", closer]), end));
      this.skipTrivia(true, end);
      if (this.src[this.pos] === ",") this.pos++;
      else if (this.pos < end) {
        this.error("unexpected-token", `Expected "," or "${closer}" in list.`, this.pos);
        break;
      }
    }
    this.pos = saved;
    return items;
  }

  /** Like parseExpression but newlines inside a collection do not end the item early. */
  private parseExpressionInCollection(stops: Set<string>, limit: number): Value {
    this.skipTrivia(true, limit);
    const start = this.pos;
    let end = this.scanExpressionEnd(start, stops, limit);
    // Newline at depth 0 inside a list: the item continues only if the next
    // non-blank char is an operator; HCL tuples separate items with commas.
    this.pos = end;
    while (end > start && /\s/.test(this.src[end - 1])) end--;
    if (end === start) {
      this.error("missing-value", "Expected an expression.", start);
      return this.raw(start, start, "other");
    }
    return this.interpret(start, end);
  }

  private parseObject(start: number, end: number): ObjectEntry[] {
    const entries: ObjectEntry[] = [];
    const saved = this.pos;
    this.pos = start;
    while (true) {
      this.skipTrivia(true, end);
      if (this.pos >= end) break;
      const entryStart = this.pos;
      let key: string | null = null;
      let keyIsExpression = false;
      const c = this.src[this.pos];
      if (c === '"') {
        const close = this.skipQuoted(this.pos, end);
        key = this.decodeQuoted(this.pos, close);
        if (key === null) {
          key = this.src.slice(this.pos, close);
          keyIsExpression = true;
        }
        this.pos = close;
      } else if (c === "(") {
        const close = this.closingOf(this.pos, end);
        if (close === -1) {
          this.error("unbalanced-brackets", 'Missing ")" in object key.', this.pos);
          break;
        }
        key = this.src.slice(this.pos, close + 1);
        keyIsExpression = true;
        this.pos = close + 1;
      } else {
        key = this.readIdentifier();
      }
      if (key === null) {
        this.error("unexpected-token", `Expected an object key, found "${c}".`, this.pos);
        break;
      }
      this.skipTrivia(false, end);
      const sep = this.src[this.pos];
      if (sep !== "=" && sep !== ":") {
        this.error("unexpected-token", `Expected "=" or ":" after object key "${key}".`, this.pos);
        break;
      }
      this.pos++;
      const value = this.parseExpression(new Set([",", "}"]), end);
      entries.push({ key, keyIsExpression, value, range: this.range(entryStart, this.pos) });
      this.skipTrivia(false, end);
      if (this.src[this.pos] === ",") this.pos++;
    }
    this.pos = saved;
    return entries;
  }

  /* ---- string decoding -------------------------------------------------- */

  /** Decode a quoted string; returns null when it contains interpolation/directives. */
  decodeQuoted(start: number, end: number): string | null {
    let out = "";
    for (let i = start + 1; i < end - 1; i++) {
      const c = this.src[i];
      if (c === "\\") {
        const n = this.src[i + 1];
        const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };
        if (n in simple) {
          out += simple[n];
          i++;
        } else if (n === "u" && /^[0-9a-fA-F]{4}$/.test(this.src.slice(i + 2, i + 6))) {
          out += String.fromCodePoint(parseInt(this.src.slice(i + 2, i + 6), 16));
          i += 5;
        } else if (n === "U" && /^[0-9a-fA-F]{8}$/.test(this.src.slice(i + 2, i + 10))) {
          out += String.fromCodePoint(parseInt(this.src.slice(i + 2, i + 10), 16));
          i += 9;
        } else {
          this.error("invalid-escape", `Invalid escape sequence "\\${n ?? ""}".`, i);
          out += n ?? "";
          i++;
        }
        continue;
      }
      if ((c === "$" || c === "%") && this.src[i + 1] === c && this.src[i + 2] === "{") {
        out += `${c}{`;
        i += 2;
        continue;
      }
      if ((c === "$" || c === "%") && this.src[i + 1] === "{") return null;
      out += c;
    }
    return out;
  }

  private decodeHeredoc(start: number, end: number): string | null {
    const text = this.src.slice(start, end);
    const m = HEREDOC_OPEN.exec(text);
    if (!m) return null;
    const lines = text.slice(m[0].length).split("\n");
    lines.pop(); // closing marker
    let body = lines.map((l) => l.replace(/\r$/, ""));
    if (m[1] === "-") {
      const indent = Math.min(...body.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length));
      if (Number.isFinite(indent)) body = body.map((l) => l.slice(indent));
    }
    const content = body.join("\n") + (body.length ? "\n" : "");
    if (/(^|[^$])\$\{|(^|[^%])%\{/.test(content)) return null;
    return content.replace(/\$\$\{/g, "${").replace(/%%\{/g, "%{");
  }
}

/** Parse one Terraform file (native syntax). Never throws. */
export function parseHcl(source: string, file: string): ParsedFile {
  if (/\.tf\.json$/i.test(file)) {
    return {
      file,
      body: { attributes: [], blocks: [] },
      diagnostics: [{ severity: "error", code: "unsupported-file", message: "Terraform JSON syntax (.tf.json) is not supported by this parser.", file, line: 1, column: 1 }],
      ok: false,
    };
  }
  if (Buffer.byteLength(source, "utf8") > MAX_FILE_BYTES) {
    return {
      file,
      body: { attributes: [], blocks: [] },
      diagnostics: [{ severity: "error", code: "file-too-large", message: `File exceeds ${MAX_FILE_BYTES} bytes.`, file, line: 1, column: 1 }],
      ok: false,
    };
  }
  const parser = new Parser(source.replace(/^﻿/, ""), file);
  const body = parser.parseBody(false);
  const diagnostics = [...parser.diagnostics].sort((a, b) => a.line - b.line || a.column - b.column);
  return { file, body, diagnostics, ok: !diagnostics.some((d) => d.severity === "error") };
}
