/**
 * Analysis context: resource index, tri-state value lookups and evidence
 * construction. Lookups never turn an expression into a value: anything that
 * is not a literal is returned as `unresolved` with its raw text.
 */

import type { Attribute, Block, Body, ExpressionValue, ParsedFile, Value } from "@/lib/hcl-parser/types";
import type { Severity } from "@/lib/security/types";
import type { TfConfidence, TfEvidence, TfFinding, TfResourceRef, TfUnresolvedCheck } from "./types";

export interface TfResource extends TfResourceRef {
  kind: "resource" | "data";
  block: Block;
}

export type Lookup<T> =
  | { state: "absent" }
  | { state: "known"; value: T; attr: Attribute }
  | { state: "unresolved"; attr: Attribute; text: string; reason: string };

export interface ListLookup {
  state: "absent" | "present" | "unresolved";
  /** Literal items. */
  known: string[];
  /** Items (or the whole value) that are expressions. */
  unresolvedText: string[];
  attr?: Attribute;
}

export interface RuleMeta {
  id: string;
  title: string;
  severity: Severity;
  description: string;
  references: string[];
}

const SECRET_ATTR = /(password|secret|private_key|access_key|api_key|auth_token|client_secret)/i;
const SECRET_VALUE = /(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g;

export function valueText(v: Value, source: string[]): string {
  switch (v.kind) {
    case "string":
      return JSON.stringify(v.value);
    case "number":
      return v.text;
    case "bool":
      return String(v.value);
    case "null":
      return "null";
    case "expression":
      return v.text;
    default: {
      const { line, endLine } = v.range;
      return line === endLine ? source[line - 1]?.trim().replace(/^[\w-]+\s*=\s*/, "") ?? v.kind : `(${v.kind} spanning lines ${line}-${endLine})`;
    }
  }
}

export function registryUrl(type: string): string {
  return `https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/${type.replace(/^aws_/, "")}`;
}

export class AnalysisContext {
  readonly resources: TfResource[] = [];
  readonly variables = new Map<string, Block>();
  readonly findings: TfFinding[] = [];
  readonly unresolved: TfUnresolvedCheck[] = [];
  /** Addresses examined by at least one rule. */
  readonly analyzed = new Set<string>();
  private readonly lines = new Map<string, string[]>();

  constructor(
    readonly files: ParsedFile[],
    sources: Record<string, string>
  ) {
    for (const [file, src] of Object.entries(sources)) this.lines.set(file, src.replace(/^﻿/, "").split(/\r?\n/));
    for (const f of files) {
      for (const b of f.body.blocks) {
        if ((b.type === "resource" || b.type === "data") && b.labels.length === 2) {
          const [type, name] = b.labels;
          const address = b.type === "data" ? `data.${type}.${name}` : `${type}.${name}`;
          this.resources.push({ kind: b.type, type, name, address, file: f.file, line: b.range.line, block: b });
        } else if (b.type === "variable" && b.labels.length === 1) {
          this.variables.set(b.labels[0], b);
        }
      }
    }
  }

  ofType(type: string, kind: "resource" | "data" = "resource"): TfResource[] {
    const list = this.resources.filter((r) => r.type === type && r.kind === kind);
    for (const r of list) this.analyzed.add(r.address);
    return list;
  }

  /* ---- lookups -------------------------------------------------------- */

  attr(body: Body, name: string): Attribute | undefined {
    return body.attributes.find((a) => a.name === name);
  }

  blocks(body: Body, type: string): Block[] {
    return body.blocks.filter((b) => b.type === type);
  }

  private unresolvedOf(attr: Attribute, v: Value, expected: string): Lookup<never> {
    const text = valueText(v, this.source(attr.range.file));
    const reason =
      v.kind === "expression"
        ? `Value is the expression \`${text}\`, which is not evaluated statically.${this.variableHint(v)}`
        : `Expected ${expected} but found ${v.kind}.`;
    return { state: "unresolved", attr, text, reason };
  }

  /** Mention a variable's literal default without treating it as the value. */
  private variableHint(v: ExpressionValue): string {
    const m = /^var\.([A-Za-z_][\w-]*)$/.exec(v.text);
    if (!m) return "";
    const def = this.variables.get(m[1]);
    const d = def && this.attr(def.body, "default");
    if (!d || d.value.kind === "expression") return ` Variable "${m[1]}" has no literal default.`;
    return ` Variable "${m[1]}" defaults to ${valueText(d.value, this.source(d.range.file))}, but tfvars or -var can override it.`;
  }

  bool(body: Body, name: string): Lookup<boolean> {
    const a = this.attr(body, name);
    if (!a) return { state: "absent" };
    const v = a.value;
    if (v.kind === "bool") return { state: "known", value: v.value, attr: a };
    if (v.kind === "string" && (v.value === "true" || v.value === "false")) return { state: "known", value: v.value === "true", attr: a };
    return this.unresolvedOf(a, v, "a boolean");
  }

  str(body: Body, name: string): Lookup<string> {
    const a = this.attr(body, name);
    if (!a) return { state: "absent" };
    const v = a.value;
    if (v.kind === "string") return { state: "known", value: v.value, attr: a };
    if (v.kind === "number") return { state: "known", value: v.text, attr: a };
    return this.unresolvedOf(a, v, "a string");
  }

  num(body: Body, name: string): Lookup<number> {
    const a = this.attr(body, name);
    if (!a) return { state: "absent" };
    const v = a.value;
    if (v.kind === "number") return { state: "known", value: v.value, attr: a };
    if (v.kind === "string" && /^-?\d+$/.test(v.value)) return { state: "known", value: Number(v.value), attr: a };
    return this.unresolvedOf(a, v, "a number");
  }

  list(body: Body, name: string): ListLookup {
    const a = this.attr(body, name);
    if (!a) return { state: "absent", known: [], unresolvedText: [] };
    return { ...this.listOf(a.value), attr: a };
  }

  listOf(v: Value): ListLookup {
    if (v.kind === "string") return { state: "present", known: [v.value], unresolvedText: [] };
    if (v.kind === "tuple") {
      const known: string[] = [];
      const unresolvedText: string[] = [];
      for (const item of v.items) {
        if (item.kind === "string") known.push(item.value);
        else unresolvedText.push(item.kind === "expression" ? item.text : item.kind);
      }
      return { state: unresolvedText.length ? "unresolved" : "present", known, unresolvedText };
    }
    return { state: "unresolved", known: [], unresolvedText: [v.kind === "expression" ? v.text : v.kind] };
  }

  /* ---- evidence ------------------------------------------------------- */

  source(file: string): string[] {
    return this.lines.get(file) ?? [];
  }

  snippet(file: string, line: number): string {
    const raw = (this.source(file)[line - 1] ?? "").trim();
    const m = /^([\w-]+)\s*=/.exec(raw);
    let out = m && SECRET_ATTR.test(m[1]) ? `${m[1]} = <redacted>` : raw;
    out = out.replace(SECRET_VALUE, "<redacted>");
    return out.length > 200 ? `${out.slice(0, 197)}...` : out;
  }

  evidence(attribute: string, attr: Attribute | undefined, fallback: { file: string; line: number }, value?: string): TfEvidence {
    const file = attr?.range.file ?? fallback.file;
    const line = attr?.range.line ?? fallback.line;
    const shown = value ?? (attr ? valueText(attr.value, this.source(file)) : "(not set)");
    return {
      file,
      line,
      attribute,
      value: SECRET_ATTR.test(attribute) ? "<redacted>" : shown,
      snippet: attr ? this.snippet(file, line) : `(not set in ${fallback.file}:${fallback.line} block)`,
    };
  }

  /* ---- emitters ------------------------------------------------------- */

  report(
    meta: RuleMeta,
    r: TfResource,
    at: { file: string; line: number },
    evidence: TfEvidence[],
    text: { risk: string; remediation: string; description?: string },
    opts: { severity?: Severity; confidence?: TfConfidence } = {}
  ) {
    const id = `${meta.id}:${r.address}:${at.line}`;
    if (this.findings.some((f) => f.id === id)) return;
    this.findings.push({
      id,
      ruleId: meta.id,
      title: meta.title,
      severity: opts.severity ?? meta.severity,
      description: text.description ?? meta.description,
      resource: { address: r.address, type: r.type, name: r.name, file: r.file, line: r.line },
      file: at.file,
      line: at.line,
      evidence,
      risk: text.risk,
      remediation: text.remediation,
      references: [...meta.references, registryUrl(r.type)],
      confidence: opts.confidence ?? "high",
    });
  }

  cannotDecide(meta: RuleMeta, r: TfResource, attribute: string, at: { file: string; line: number }, expression: string, message: string) {
    const id = `${meta.id}:${r.address}:${at.line}:${attribute}`;
    if (this.unresolved.some((u) => u.id === id)) return;
    this.unresolved.push({
      id,
      ruleId: meta.id,
      title: meta.title,
      resource: { address: r.address, type: r.type, name: r.name, file: r.file, line: r.line },
      file: at.file,
      line: at.line,
      attribute,
      expression,
      message,
    });
  }

  /** Convenience: record an unresolved lookup for a rule. */
  undecided(meta: RuleMeta, r: TfResource, attribute: string, l: Extract<Lookup<unknown>, { state: "unresolved" }>) {
    this.cannotDecide(meta, r, attribute, { file: l.attr.range.file, line: l.attr.range.line }, l.text, l.reason);
  }
}
