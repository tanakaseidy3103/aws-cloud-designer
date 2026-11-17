/**
 * Normalizes IAM policy documents written in three Terraform styles:
 *  1. data "aws_iam_policy_document" statement blocks
 *  2. jsonencode({...}) object expressions
 *  3. literal JSON strings / heredocs
 * Anything else (references, templates, file()) is reported as unresolved.
 */

import type { Value } from "@/lib/hcl-parser/types";
import type { AnalysisContext, TfResource } from "./context";

/** Policy value tree with source lines. */
type PNode =
  | { kind: "str"; value: string; line: number }
  | { kind: "list"; items: PNode[]; line: number }
  | { kind: "obj"; entries: Map<string, PNode>; line: number }
  | { kind: "unknown"; text: string; line: number };

export interface PolicyField {
  known: { value: string; line: number }[];
  unresolved: string[];
  line: number;
  present: boolean;
}

export interface PolicyStatement {
  /** Literal effect, or null when unresolved. */
  effect: string | null;
  effectText: string;
  line: number;
  actions: PolicyField;
  notActions: PolicyField;
  resources: PolicyField;
  /** "*" principal (public) — true, false, or null when unresolved. */
  publicPrincipal: boolean | null;
  hasCondition: boolean;
}

export interface PolicySource {
  resource: TfResource;
  attribute: string;
  line: number;
  file: string;
  statements: PolicyStatement[];
  /** Set when the document itself could not be read. */
  unresolved?: { text: string; reason: string };
}

const emptyField = (line: number): PolicyField => ({ known: [], unresolved: [], line, present: false });

function fromHcl(v: Value): PNode {
  const line = v.range.line;
  switch (v.kind) {
    case "string":
      return { kind: "str", value: v.value, line };
    case "tuple":
      return { kind: "list", items: v.items.map(fromHcl), line };
    case "object":
      return { kind: "obj", entries: new Map(v.entries.filter((e) => !e.keyIsExpression).map((e) => [e.key, fromHcl(e.value)])), line };
    case "expression":
      return { kind: "unknown", text: v.text, line };
    default:
      return { kind: "unknown", text: v.kind === "null" ? "null" : String((v as { value?: unknown }).value), line };
  }
}

function fromJson(j: unknown, line: number): PNode {
  if (typeof j === "string") return { kind: "str", value: j, line };
  if (Array.isArray(j)) return { kind: "list", items: j.map((x) => fromJson(x, line)), line };
  if (j && typeof j === "object") return { kind: "obj", entries: new Map(Object.entries(j).map(([k, x]) => [k, fromJson(x, line)])), line };
  return { kind: "unknown", text: JSON.stringify(j), line };
}

function field(n: PNode | undefined, fallbackLine: number): PolicyField {
  if (!n) return emptyField(fallbackLine);
  const items = n.kind === "list" ? n.items : [n];
  const out: PolicyField = { known: [], unresolved: [], line: n.line, present: true };
  for (const i of items) {
    if (i.kind === "str") out.known.push({ value: i.value, line: i.line });
    else out.unresolved.push(i.kind === "unknown" ? i.text : i.kind);
  }
  return out;
}

function isPublicPrincipal(n: PNode | undefined): boolean | null {
  if (!n) return false;
  if (n.kind === "str") return n.value === "*";
  if (n.kind === "unknown") return null;
  if (n.kind === "list") {
    const r = n.items.map(isPublicPrincipal);
    return r.includes(true) ? true : r.includes(null) ? null : false;
  }
  const aws = n.entries.get("AWS");
  return aws ? isPublicPrincipal(aws) : false;
}

function statementsFromDoc(doc: PNode): PolicyStatement[] | string {
  if (doc.kind !== "obj") return "Policy document is not an object.";
  const st = doc.entries.get("Statement");
  if (!st) return [];
  if (st.kind === "unknown") return `Statement is the expression \`${st.text}\`.`;
  const list = st.kind === "list" ? st.items : [st];
  return list.map((s) => {
    if (s.kind !== "obj") {
      return { effect: null, effectText: s.kind === "unknown" ? s.text : s.kind, line: s.line, actions: emptyField(s.line), notActions: emptyField(s.line), resources: emptyField(s.line), publicPrincipal: null, hasCondition: false };
    }
    const effect = s.entries.get("Effect");
    return {
      effect: effect?.kind === "str" ? effect.value : null,
      effectText: effect?.kind === "unknown" ? effect.text : effect?.kind === "str" ? effect.value : "(not set)",
      line: s.line,
      actions: field(s.entries.get("Action"), s.line),
      notActions: field(s.entries.get("NotAction"), s.line),
      resources: field(s.entries.get("Resource"), s.line),
      publicPrincipal: isPublicPrincipal(s.entries.get("Principal")),
      hasCondition: s.entries.has("Condition"),
    };
  });
}

/** Read a `policy`-style attribute value. */
function readPolicyValue(ctx: AnalysisContext, r: TfResource, attribute: string, v: Value): PolicySource {
  const base = { resource: r, attribute, line: v.range.line, file: v.range.file, statements: [] as PolicyStatement[] };
  if (v.kind === "string") {
    try {
      const st = statementsFromDoc(fromJson(JSON.parse(v.value), v.range.line));
      return typeof st === "string" ? { ...base, unresolved: { text: "(literal JSON)", reason: st } } : { ...base, statements: st };
    } catch {
      return { ...base, unresolved: { text: "(literal string)", reason: "Policy string is not valid JSON." } };
    }
  }
  if (v.kind === "expression" && v.call?.name === "jsonencode" && v.call.args.length === 1) {
    const st = statementsFromDoc(fromHcl(v.call.args[0]));
    return typeof st === "string" ? { ...base, unresolved: { text: v.text, reason: st } } : { ...base, statements: st };
  }
  if (v.kind === "expression" && /^data\.aws_iam_policy_document\.[\w-]+\.(json|minified_json)$/.test(v.text)) {
    // Analyzed at the data source itself.
    return base;
  }
  const text = v.kind === "expression" ? v.text : v.kind;
  void ctx;
  return { ...base, unresolved: { text, reason: `Policy is the expression \`${text}\`, which is not evaluated statically.` } };
}

function fromPolicyDocumentData(ctx: AnalysisContext, r: TfResource): PolicySource {
  const statements: PolicyStatement[] = ctx.blocks(r.block.body, "statement").map((s) => {
    const effect = ctx.str(s.body, "effect");
    const list = (name: string): PolicyField => {
      const l = ctx.list(s.body, name);
      const line = l.attr?.range.line ?? s.range.line;
      return { known: l.known.map((value) => ({ value, line })), unresolved: l.unresolvedText, line, present: l.state !== "absent" };
    };
    let publicPrincipal: boolean | null = false;
    for (const p of ctx.blocks(s.body, "principals")) {
      const type = ctx.str(p.body, "type");
      const ids = ctx.list(p.body, "identifiers");
      if (type.state !== "known" || ids.state === "unresolved") {
        if (publicPrincipal === false) publicPrincipal = null;
      }
      if (type.state === "known" && (type.value === "*" || type.value === "AWS") && ids.known.includes("*")) publicPrincipal = true;
    }
    return {
      effect: effect.state === "absent" ? "Allow" : effect.state === "known" ? effect.value : null,
      effectText: effect.state === "unresolved" ? effect.text : effect.state === "known" ? effect.value : "Allow (default)",
      line: s.range.line,
      actions: list("actions"),
      notActions: list("not_actions"),
      resources: list("resources"),
      publicPrincipal,
      hasCondition: ctx.blocks(s.body, "condition").length > 0,
    };
  });
  return { resource: r, attribute: "statement", line: r.line, file: r.file, statements };
}

const POLICY_ATTR_TYPES = ["aws_iam_policy", "aws_iam_role_policy", "aws_iam_user_policy", "aws_iam_group_policy"];

/** Identity policies (what principals may do). */
export function identityPolicies(ctx: AnalysisContext): PolicySource[] {
  const out: PolicySource[] = [];
  for (const r of ctx.ofType("aws_iam_policy_document", "data")) out.push(fromPolicyDocumentData(ctx, r));
  for (const type of POLICY_ATTR_TYPES) {
    for (const r of ctx.ofType(type)) {
      const a = ctx.attr(r.block.body, "policy");
      if (a) out.push(readPolicyValue(ctx, r, "policy", a.value));
    }
  }
  for (const r of ctx.ofType("aws_iam_role")) {
    for (const b of ctx.blocks(r.block.body, "inline_policy")) {
      const a = ctx.attr(b.body, "policy");
      if (a) out.push(readPolicyValue(ctx, r, "inline_policy.policy", a.value));
    }
  }
  return out;
}

/** Resource policies on buckets. */
export function bucketPolicies(ctx: AnalysisContext): PolicySource[] {
  return ctx.ofType("aws_s3_bucket_policy").flatMap((r) => {
    const a = ctx.attr(r.block.body, "policy");
    return a ? [readPolicyValue(ctx, r, "policy", a.value)] : [];
  });
}
