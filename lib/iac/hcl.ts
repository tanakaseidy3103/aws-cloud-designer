/**
 * Minimal HCL emitter that produces `terraform fmt`-stable output.
 *
 * Alignment follows hclwrite's rules: consecutive single-line attributes in a
 * body form a chain whose `=` signs are aligned. A blank line, a comment, a
 * nested block, or an attribute whose value opens a multi-line bracket ends
 * the chain.
 */

export interface RawExpr {
  readonly raw: string;
}

export interface HclObject {
  readonly entries: readonly (readonly [string, HclValue])[];
}

export type HclValue = string | number | boolean | null | RawExpr | HclObject | readonly HclValue[];

export interface Attr {
  readonly kind: "attr";
  readonly key: string;
  readonly value: HclValue;
}

export interface Block {
  readonly kind: "block";
  readonly type: string;
  readonly labels: readonly string[];
  readonly body: readonly BodyItem[];
}

export interface Comment {
  readonly kind: "comment";
  readonly text: string;
}

export interface Blank {
  readonly kind: "blank";
}

export type BodyItem = Attr | Block | Comment | Blank;

/* ---- Constructors --------------------------------------------------- */

export const raw = (expr: string): RawExpr => ({ raw: expr });
export const obj = (entries: Record<string, HclValue> | readonly (readonly [string, HclValue])[]): HclObject => ({
  entries: Array.isArray(entries) ? entries : Object.entries(entries as Record<string, HclValue>),
});
export const attr = (key: string, value: HclValue): Attr => ({ kind: "attr", key, value });
export const block = (type: string, labels: readonly string[], body: readonly (BodyItem | null | false | undefined)[]): Block => ({
  kind: "block",
  type,
  labels,
  body: body.filter(Boolean) as BodyItem[],
});
export const comment = (text: string): Comment => ({ kind: "comment", text });
export const blank: Blank = { kind: "blank" };

export const resource = (type: string, name: string, body: readonly (BodyItem | null | false | undefined)[]) =>
  block("resource", [type, name], body);
export const data = (type: string, name: string, body: readonly (BodyItem | null | false | undefined)[]) =>
  block("data", [type, name], body);

/** Standard `tags = { Name = ... }` attribute. */
export const nameTag = (name: HclValue): Attr => attr("tags", obj({ Name: name }));

/* ---- Rendering ------------------------------------------------------ */

const INDENT = "  ";

/** Escape a string for an HCL quoted template literal. */
export function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\$\{/g, () => "$${")
    .replace(/%\{/g, "%%{");
  return `"${escaped}"`;
}

function isRaw(v: HclValue): v is RawExpr {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "raw" in v;
}

function isObject(v: HclValue): v is HclObject {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "entries" in v;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function renderKey(key: string): string {
  return IDENT.test(key) ? key : quote(key);
}

/** True when the value renders on a single line. */
function isInline(v: HclValue): boolean {
  if (isObject(v)) return v.entries.length === 0;
  if (Array.isArray(v)) return v.every((x) => !isObject(x) && !Array.isArray(x));
  return true;
}

function renderInline(v: HclValue): string {
  if (v === null) return "null";
  if (typeof v === "string") return quote(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isRaw(v)) return v.raw;
  if (isObject(v)) return "{}";
  return `[${(v as readonly HclValue[]).map(renderInline).join(", ")}]`;
}

/** Render a multi-line value starting after `key = `. Returns lines (first has no indent). */
function renderMultiline(v: HclValue, depth: number): string[] {
  const pad = INDENT.repeat(depth);
  if (isObject(v)) {
    const lines = ["{"];
    lines.push(...renderEntries(v.entries.map(([k, val]) => ({ key: renderKey(k), value: val })), depth + 1));
    lines.push(`${pad}}`);
    return lines;
  }
  if (Array.isArray(v)) {
    const lines = ["["];
    for (const item of v as readonly HclValue[]) {
      if (isInline(item)) {
        lines.push(`${pad}${INDENT}${renderInline(item)},`);
      } else {
        const sub = renderMultiline(item, depth + 1);
        lines.push(`${pad}${INDENT}${sub[0]}`, ...sub.slice(1, -1), `${sub[sub.length - 1]},`);
      }
    }
    lines.push(`${pad}]`);
    return lines;
  }
  return [renderInline(v)];
}

/** Render key/value lines with hclwrite-style alignment. */
function renderEntries(entries: { key: string; value: HclValue }[], depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const out: string[] = [];
  let chain: { key: string; value: string }[] = [];

  const flush = () => {
    const width = Math.max(0, ...chain.map((c) => c.key.length));
    for (const c of chain) out.push(`${pad}${c.key.padEnd(width)} = ${c.value}`);
    chain = [];
  };

  for (const e of entries) {
    if (isInline(e.value)) {
      chain.push({ key: e.key, value: renderInline(e.value) });
    } else {
      flush();
      const lines = renderMultiline(e.value, depth);
      out.push(`${pad}${e.key} = ${lines[0]}`, ...lines.slice(1));
    }
  }
  flush();
  return out;
}

function renderBody(items: readonly BodyItem[], depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const out: string[] = [];
  let attrs: { key: string; value: HclValue }[] = [];

  const flushAttrs = () => {
    if (attrs.length) out.push(...renderEntries(attrs, depth));
    attrs = [];
  };

  for (const item of items) {
    if (item.kind === "attr") {
      if (!isInline(item.value)) {
        // A multi-line value ends the alignment chain.
        flushAttrs();
        out.push(...renderEntries([{ key: renderKey(item.key), value: item.value }], depth));
      } else {
        attrs.push({ key: renderKey(item.key), value: item.value });
      }
      continue;
    }
    flushAttrs();
    if (item.kind === "blank") out.push("");
    else if (item.kind === "comment") out.push(...item.text.split("\n").map((l) => `${pad}# ${l}`.trimEnd()));
    else out.push(...renderBlock(item, depth));
  }
  flushAttrs();

  // Collapse duplicate blank lines and trim leading/trailing blanks.
  const collapsed: string[] = [];
  for (const line of out) {
    if (line === "" && (collapsed.length === 0 || collapsed[collapsed.length - 1] === "")) continue;
    collapsed.push(line);
  }
  while (collapsed[collapsed.length - 1] === "") collapsed.pop();
  return collapsed;
}

function renderBlock(b: Block, depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const header = [b.type, ...b.labels.map(quote)].join(" ");
  if (b.body.length === 0) return [`${pad}${header} {}`];
  return [`${pad}${header} {`, ...renderBody(b.body, depth + 1), `${pad}}`];
}

/** Render a whole file: top-level items separated by single blank lines. */
export function renderFile(items: readonly (BodyItem | null | false | undefined)[], header?: string): string {
  const parts: string[] = [];
  if (header) parts.push(header.split("\n").map((l) => `# ${l}`.trimEnd()).join("\n"));
  let pendingComments: string[] = [];
  for (const item of items.filter(Boolean) as BodyItem[]) {
    if (item.kind === "blank") continue;
    if (item.kind === "comment") {
      pendingComments.push(...item.text.split("\n").map((l) => `# ${l}`.trimEnd()));
      continue;
    }
    const rendered = item.kind === "block" ? renderBlock(item, 0) : renderEntries([{ key: item.key, value: item.value }], 0);
    parts.push([...pendingComments, ...rendered].join("\n"));
    pendingComments = [];
  }
  if (pendingComments.length) parts.push(pendingComments.join("\n"));
  return parts.join("\n\n") + "\n";
}
