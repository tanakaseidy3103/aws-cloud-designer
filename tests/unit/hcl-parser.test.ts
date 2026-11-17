import { describe, expect, it } from "vitest";
import { parseHcl } from "@/lib/hcl-parser/parser";
import type { ExpressionValue, ObjectValue, TupleValue, Value } from "@/lib/hcl-parser/types";

const parse = (src: string, file = "main.tf") => parseHcl(src, file);
const attr = (src: string, name = "a") => {
  const r = parse(src);
  return { value: r.body.attributes.find((x) => x.name === name)?.value as Value, result: r };
};

describe("literals", () => {
  it("parses strings, numbers, bools and null", () => {
    const r = parse(['s = "hello"', "n = 42", "f = -1.5e3", "t = true", "x = false", "z = null"].join("\n"));
    expect(r.ok).toBe(true);
    const v = Object.fromEntries(r.body.attributes.map((a) => [a.name, a.value]));
    expect(v.s).toMatchObject({ kind: "string", value: "hello" });
    expect(v.n).toMatchObject({ kind: "number", value: 42 });
    expect(v.f).toMatchObject({ kind: "number", value: -1500 });
    expect(v.t).toMatchObject({ kind: "bool", value: true });
    expect(v.x).toMatchObject({ kind: "bool", value: false });
    expect(v.z).toMatchObject({ kind: "null" });
  });

  it("decodes escapes and template escapes", () => {
    // HCL source: a = "q\"uote\\ \n\t é \U0001F600 $${literal} %%{dir}"
    const src = 'a = "q\\"uote\\\\ \\n\\t \\u00e9 \\U0001F600 $${literal} %%{dir}"';
    const { value } = attr(src);
    expect(value).toMatchObject({ kind: "string", value: 'q"uote\\ \n\t é 😀 ${literal} %{dir}' });
  });

  it("reports invalid escapes without dropping the attribute", () => {
    const { value, result } = attr(String.raw`a = "bad \q escape"`);
    expect(value.kind).toBe("string");
    expect(result.diagnostics[0]).toMatchObject({ code: "invalid-escape", line: 1 });
    expect(result.ok).toBe(false);
  });

  it("keeps strings with interpolation as raw template expressions", () => {
    const { value } = attr('a = "${var.prefix}-bucket-${local.env == "prod" ? "p" : "d"}"');
    expect(value).toMatchObject({ kind: "expression", form: "template" });
    const e = value as ExpressionValue;
    expect(e.text).toBe('"${var.prefix}-bucket-${local.env == "prod" ? "p" : "d"}"');
    expect(e.references).toEqual(["var.prefix", "local.env"]);
  });

  it("parses heredocs, and keeps interpolated heredocs raw", () => {
    const r = parse(["a = <<-EOT", "    line one", "      indented", "    EOT", "b = <<EOF", "${var.x}", "EOF", "c = 1"].join("\n"));
    expect(r.ok).toBe(true);
    expect(r.body.attributes[0].value).toMatchObject({ kind: "string", value: "line one\n  indented\n" });
    expect(r.body.attributes[1].value).toMatchObject({ kind: "expression", form: "template" });
    expect(r.body.attributes[2]).toMatchObject({ name: "c", range: { line: 8 } });
  });
});

describe("unresolved expressions are preserved verbatim", () => {
  it.each([
    ["var.enabled", "reference", ["var.enabled"]],
    ["aws_s3_bucket.logs.id", "reference", ["aws_s3_bucket.logs"]],
    ["data.aws_iam_policy_document.p.json", "reference", ["data.aws_iam_policy_document.p"]],
    ["local.tags[\"env\"]", "reference", ["local.tags"]],
    ["var.public ? true : false", "other", ["var.public"]],
    ["!var.private", "other", ["var.private"]],
    ["aws_subnet.private[*].id", "reference", ["aws_subnet.private"]],
    ["count.index + 1", "other", []],
  ])("%s", (expr, form, refs) => {
    const { value, result } = attr(`a = ${expr}`);
    expect(result.ok).toBe(true);
    expect(value).toMatchObject({ kind: "expression", form, text: expr });
    expect((value as ExpressionValue).references).toEqual(refs);
  });

  it("parses function calls and their arguments without evaluating them", () => {
    const { value } = attr('a = jsonencode({ Version = "2012-10-17", Statement = [{ Action = "*" }] })');
    const e = value as ExpressionValue;
    expect(e.form).toBe("function");
    expect(e.call?.name).toBe("jsonencode");
    const arg = e.call!.args[0] as ObjectValue;
    expect(arg.entries.map((x) => x.key)).toEqual(["Version", "Statement"]);
    const stmt = (arg.entries[1].value as TupleValue).items[0] as ObjectValue;
    expect(stmt.entries[0].value).toMatchObject({ kind: "string", value: "*" });
  });

  it("keeps for-expressions raw", () => {
    expect(attr("a = [for s in var.list : upper(s)]").value).toMatchObject({ kind: "expression", form: "other" });
    expect(attr("a = { for k, v in var.m : k => v }").value).toMatchObject({ kind: "expression", form: "other" });
  });
});

describe("collections", () => {
  it("parses multi-line tuples with trailing commas and comments", () => {
    const { value, result } = attr(['a = [', '  "0.0.0.0/0", # anywhere', "  var.cidr,", "  // comment line", "]"].join("\n"));
    expect(result.ok).toBe(true);
    const t = value as TupleValue;
    expect(t.items.map((i) => i.kind)).toEqual(["string", "expression"]);
    expect(t.items[1].range.line).toBe(3);
  });

  it("parses objects with = and : separators, quoted and expression keys", () => {
    const { value, result } = attr(['a = {', '  Name = "x"', '  "aws:SourceArn": var.arn,', "  (var.k) = 1", "}"].join("\n"));
    expect(result.ok).toBe(true);
    const o = value as ObjectValue;
    expect(o.entries.map((e) => [e.key, e.keyIsExpression, e.range.line])).toEqual([
      ["Name", false, 2],
      ["aws:SourceArn", false, 3],
      ["(var.k)", true, 4],
    ]);
  });
});

describe("blocks", () => {
  const src = [
    "# leading comment",
    'resource "aws_security_group" "web" {',
    '  name = "web" // trailing',
    "  /* block",
    "     comment */",
    "  ingress {",
    "    from_port   = 22",
    '    cidr_blocks = ["0.0.0.0/0"]',
    "  }",
    "  egress { from_port = 0 }",
    "  dynamic \"ingress\" {",
    "    for_each = var.rules",
    "    content {",
    "      from_port = ingress.value.port",
    "    }",
    "  }",
    "}",
  ].join("\n");

  it("parses nested blocks, one-line blocks and dynamic blocks with line numbers", () => {
    const r = parse(src);
    expect(r.ok).toBe(true);
    const sg = r.body.blocks[0];
    expect(sg).toMatchObject({ type: "resource", labels: ["aws_security_group", "web"], range: { line: 2, endLine: 17 } });
    expect(sg.body.attributes[0]).toMatchObject({ name: "name", range: { line: 3 } });
    expect(sg.body.blocks.map((b) => [b.type, b.labels, b.range.line])).toEqual([
      ["ingress", [], 6],
      ["egress", [], 10],
      ["dynamic", ["ingress"], 11],
    ]);
    expect(sg.body.blocks[0].body.attributes[1]).toMatchObject({ name: "cidr_blocks", range: { file: "main.tf", line: 8 } });
    expect(sg.body.blocks[1].body.attributes[0]).toMatchObject({ name: "from_port", value: { value: 0 } });
    expect(sg.body.blocks[2].body.blocks[0].body.attributes[0].value).toMatchObject({ kind: "expression", text: "ingress.value.port" });
  });

  it("is deterministic", () => {
    expect(parse(src)).toEqual(parse(src));
  });

  it("handles CRLF line endings and a BOM", () => {
    const r = parse("﻿" + src.replace(/\n/g, "\r\n"));
    expect(r.ok).toBe(true);
    expect(r.body.blocks[0].body.blocks[0].body.attributes[1].range.line).toBe(8);
  });
});

describe("invalid and unsupported syntax produces explicit diagnostics", () => {
  it.each([
    ['resource "a" "b" {\n  x = 1\n', "missing-brace"],
    ['a = "unterminated\nb = 1', "unterminated-string"],
    ["a = <<EOT\nno end", "unterminated-heredoc"],
    ["/* never closed", "unterminated-comment"],
    ["a = [1, 2", "unbalanced-brackets"],
    ["a = (1]", "unbalanced-brackets"],
    ["a =\nb = 1", "missing-value"],
    ['"quoted" = 1', "unexpected-token"],
    ["resource \"x\" \"${var.n}\" {}", "invalid-label"],
    ["a = 1\na = 2", "duplicate-attribute"],
    ["a = 1 2", "trailing-content"],
    ["a = var.x ?\n  1 : 2", "unexpected-token"],
    ["resource \"x\" \"y\" = {}", "unexpected-token"],
  ])("%j → %s", (src, code) => {
    const r = parse(src);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain(code);
    for (const d of r.diagnostics) {
      expect(d.file).toBe("main.tf");
      expect(d.line).toBeGreaterThan(0);
    }
  });

  it("rejects Terraform JSON syntax explicitly", () => {
    const r = parseHcl('{"resource": {}}', "main.tf.json");
    expect(r.diagnostics[0].code).toBe("unsupported-file");
  });

  it("recovers and keeps parsing after an error", () => {
    const r = parse(['a = "ok"', "!!! garbage", 'resource "aws_s3_bucket" "b" {', '  bucket = "x"', "}"].join("\n"));
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ code: "unexpected-token", line: 2 });
    expect(r.body.blocks[0].labels).toEqual(["aws_s3_bucket", "b"]);
  });

  it("never throws on arbitrary input", () => {
    const samples = ["{", "}", "]]]", '"', "a = {{{", "<<", "resource", "a = ${", "\u0000\u0001", "a = [for"];
    for (const s of samples) expect(() => parse(s)).not.toThrow();
  });
});
