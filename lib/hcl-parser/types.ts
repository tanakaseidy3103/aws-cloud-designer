/**
 * Syntax tree for the HCL native-syntax subset parsed by lib/hcl-parser.
 * See docs/architecture/adr/0001-terraform-hcl-parser.md for the supported
 * subset and its limitations.
 */

export interface SourceRange {
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  endLine: number;
  endColumn: number;
}

interface ValueBase {
  range: SourceRange;
}

/** A quoted string or heredoc without interpolation, escapes decoded. */
export interface StringValue extends ValueBase {
  kind: "string";
  value: string;
}

export interface NumberValue extends ValueBase {
  kind: "number";
  value: number;
  text: string;
}

export interface BoolValue extends ValueBase {
  kind: "bool";
  value: boolean;
}

export interface NullValue extends ValueBase {
  kind: "null";
}

export interface TupleValue extends ValueBase {
  kind: "tuple";
  items: Value[];
}

export interface ObjectEntry {
  /** Literal key text; for `(expr)` keys this is the raw expression text. */
  key: string;
  keyIsExpression: boolean;
  value: Value;
  range: SourceRange;
}

export interface ObjectValue extends ValueBase {
  kind: "object";
  entries: ObjectEntry[];
}

export type ExpressionForm =
  /** A single traversal such as var.x, aws_s3_bucket.b.id, local.tags["a"]. */
  | "reference"
  /** A string or heredoc containing ${...} interpolation or %{...} directives. */
  | "template"
  /** A function call `name(args)`; args are parsed in `call`. */
  | "function"
  /** Anything else: operators, conditionals, for-expressions, splats... */
  | "other";

/**
 * An expression the parser does not evaluate. The source text is preserved
 * verbatim; it is never replaced by a guessed value.
 */
export interface ExpressionValue extends ValueBase {
  kind: "expression";
  form: ExpressionForm;
  text: string;
  /** Traversals found in the text (var.x, local.y, aws_type.name, data.t.n, module.m). */
  references: string[];
  call?: { name: string; args: Value[] };
}

export type Value = StringValue | NumberValue | BoolValue | NullValue | TupleValue | ObjectValue | ExpressionValue;

export interface Attribute {
  name: string;
  value: Value;
  range: SourceRange;
}

export interface Block {
  type: string;
  labels: string[];
  body: Body;
  range: SourceRange;
}

export interface Body {
  attributes: Attribute[];
  blocks: Block[];
}

export type DiagnosticCode =
  | "unsupported-file"
  | "file-too-large"
  | "unexpected-token"
  | "unterminated-string"
  | "unterminated-heredoc"
  | "unterminated-comment"
  | "invalid-escape"
  | "unbalanced-brackets"
  | "missing-value"
  | "missing-brace"
  | "invalid-label"
  | "duplicate-attribute"
  | "trailing-content";

export interface ParseDiagnostic {
  severity: "error" | "warning";
  code: DiagnosticCode;
  message: string;
  file: string;
  line: number;
  column: number;
}

export interface ParsedFile {
  file: string;
  body: Body;
  diagnostics: ParseDiagnostic[];
  /** True when no error diagnostics were produced. */
  ok: boolean;
}
