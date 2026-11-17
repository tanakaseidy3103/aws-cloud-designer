import { describe, expect, it } from "vitest";
import { attr, blank, block, comment, data, nameTag, obj, quote, raw, renderFile, resource } from "@/lib/iac/hcl";

describe("quote", () => {
  it("escapes quotes, backslashes, newlines and template sequences", () => {
    expect(quote('say "hi"')).toBe('"say \\"hi\\""');
    expect(quote("C:\\path")).toBe('"C:\\\\path"');
    expect(quote("a\nb")).toBe('"a\\nb"');
    expect(quote("${var.x} and %{if}")).toBe('"$${var.x} and %%{if}"');
  });
});

describe("renderFile", () => {
  it("aligns consecutive single-line attributes like terraform fmt", () => {
    const out = renderFile([
      resource("aws_instance", "web", [
        attr("ami", raw("data.aws_ami.al2023.id")),
        attr("instance_type", "t3.micro"),
        blank,
        attr("monitoring", true),
      ]),
    ]);
    expect(out).toBe(
      [
        'resource "aws_instance" "web" {',
        "  ami           = data.aws_ami.al2023.id",
        '  instance_type = "t3.micro"',
        "",
        "  monitoring = true",
        "}",
        "",
      ].join("\n")
    );
  });

  it("breaks the alignment chain at multi-line values and nested blocks", () => {
    const out = renderFile([
      resource("aws_s3_bucket", "b", [
        attr("bucket_prefix", "demo-"),
        nameTag("Demo"),
        attr("force_destroy", false),
        block("lifecycle", [], [attr("prevent_destroy", false)]),
      ]),
    ]);
    expect(out).toBe(
      [
        'resource "aws_s3_bucket" "b" {',
        '  bucket_prefix = "demo-"',
        "  tags = {",
        '    Name = "Demo"',
        "  }",
        "  force_destroy = false",
        "  lifecycle {",
        "    prevent_destroy = false",
        "  }",
        "}",
        "",
      ].join("\n")
    );
  });

  it("renders lists, empty objects, quoted keys and nulls", () => {
    const out = renderFile([
      data("aws_iam_policy_document", "p", [
        attr("actions", ["s3:GetObject", "s3:PutObject"]),
        attr("empty", obj({})),
        attr("maybe", null),
        attr("labels", obj({ "kubernetes.io/role": "x", plain: 1 })),
      ]),
    ]);
    expect(out).toContain('  actions = ["s3:GetObject", "s3:PutObject"]');
    expect(out).toContain("  empty   = {}");
    expect(out).toContain("  maybe   = null");
    expect(out).toContain('    "kubernetes.io/role" = "x"');
    expect(out).toContain('    plain                = 1');
  });

  it("renders lists of objects on multiple lines", () => {
    const out = renderFile([attr("items", [obj({ a: 1 }), obj({ b: 2 })])]);
    expect(out).toBe(["items = [", "  {", "    a = 1", "  },", "  {", "    b = 2", "  },", "]", ""].join("\n"));
  });

  it("separates top-level blocks with one blank line and attaches comments", () => {
    const out = renderFile([comment("First"), block("locals", [], [attr("a", 1)]), block("locals", [], [])], "Header");
    expect(out).toBe(["# Header", "", "# First", "locals {", "  a = 1", "}", "", "locals {}", ""].join("\n"));
  });
});
