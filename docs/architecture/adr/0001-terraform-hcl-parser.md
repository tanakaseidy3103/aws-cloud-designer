# ADR 0001 — In-house parser for the Terraform HCL subset

- **Status:** Accepted
- **Date:** 2026-11-17
- **Scope:** `lib/hcl-parser/`, `lib/security/terraform/`

## Context

The Security Intelligence module must analyze **Terraform configurations** — not only designs drawn in
the editor — and report every finding with the exact file and line that caused it. Constraints:

1. Runs locally and in CI with **no AWS credentials** and no AWS API calls.
2. Deterministic: the same files always produce the same report.
3. Must never invent values: an expression such as `var.public` must not be treated as `true` or `false`.
4. Must run in Node.js (Next.js API routes, CLI, tests), on Windows and Linux.
5. No heavy or unmaintained dependencies.

## Decision

Write a small recursive-descent parser for the subset of HCL native syntax used by resource
configurations. It builds a **structural** tree and does **not** evaluate expressions:

| Supported | Representation |
|---|---|
| Blocks with any number of labels (quoted or identifier), nested blocks, one-line blocks, `dynamic` blocks | `Block { type, labels, body, range }` |
| Attributes | `Attribute { name, value, range }` |
| Quoted strings with escapes `\n \r \t \" \\ \uNNNN \UNNNNNNNN`, `$${` and `%%{` | `string` (decoded) |
| Strings / heredocs with `${…}` or `%{…}` | `expression` (form `template`, raw text) |
| Heredocs `<<EOF` and `<<-EOF` (indent stripped) | `string` or `expression` |
| Numbers, `true`, `false`, `null` | literals |
| Tuples `[…]` with newlines, comments and trailing commas | `tuple` |
| Objects `{…}` with `=` or `:`, identifier / quoted / `(expr)` keys | `object` |
| Function calls `name(args)` | `expression` (form `function`) with parsed `call.args` |
| References, operators, conditionals, `for` expressions, splats, indexes | `expression` (raw text + extracted references) |
| Comments `#`, `//`, `/* */`; CRLF; UTF-8 BOM | skipped |

Every node carries `file`, `line`, `column`, `endLine`, `endColumn`.

Invalid or unsupported input never throws and is never silently ignored. It produces a diagnostic
(`unterminated-string`, `unterminated-heredoc`, `unterminated-comment`, `unbalanced-brackets`,
`missing-value`, `missing-brace`, `unexpected-token`, `invalid-label`, `duplicate-attribute`,
`trailing-content`, `unsupported-file`, `file-too-large`). The parser recovers at the next line and
keeps going, and the security report is then marked **incomplete**.

The analyzer uses **tri-state lookups** (known literal / absent / unresolved):

- *known* values decide a rule;
- *absent* values decide a rule only where the AWS provider default is documented and the finding says so
  (e.g. `storage_encrypted` defaults to `false`);
- *unresolved* values produce an **unresolved check** that records the raw expression. A literal variable
  default may be mentioned as a hint, never used as the value. A report with unresolved checks or parse
  errors cannot be `clean`.

Resource types without rules, and `module` blocks, are listed as **not analyzed**. They are never counted
as passing.

## Alternatives considered

| Option | Why not chosen |
|---|---|
| **`terraform show -json` on a plan** | Needs `terraform plan`, which needs provider credentials and reads real account state. That breaks constraint 1 and is out of scope until Phase 2 (read-only plan with explicit opt-in). Planned as a *complementary* input later, because plans resolve variables. |
| **`terraform validate -json` / `terraform console`** | Validate checks schema validity but exposes no attribute values. Console needs an initialized workspace and evaluates expressions, which we explicitly do not want. |
| **`@cdktf/hcl2json` (WASM build of HashiCorp's hcl2json)** | Faithful parser, but packaged as part of the CDKTF toolchain rather than as a standalone, independently maintained library (verify its maintenance status before adopting it). Its JSON output is a value tree without source positions, so findings could not cite lines. Expressions come back as `${…}` strings that are easy to confuse with literals. It weakens constraints 3 and 5. |
| **Go `hashicorp/hcl` via a sidecar binary** | Exact parser with full position info, but adds a Go toolchain or a prebuilt binary per OS to a TypeScript project, plus process management. Too much operational weight for Phase 1. Revisit if the subset proves insufficient. |
| **Checkov / tfsec / Trivy** | Mature scanners, but Python/Go binaries with their own rule sets. Useful as an **additional** CI gate (planned for Phase 2), not as the platform's source of truth: we need our own evidence model, unresolved-check semantics and integration with the designer. |
| **Regex scanning** | Cannot handle nesting, multi-line values, heredocs or comments reliably, and produces false positives and negatives. |

## Consequences

**Positive**
- Zero runtime dependencies. Pure TypeScript usable in the browser, API routes and CLI.
- Exact file/line evidence for every finding, down to the element inside `jsonencode` objects.
- No evaluation, so no fabricated values. Undecidable checks are explicit.
- Verified against real Terraform: the analyzer fixtures pass `terraform fmt -check` and `validate`, and
  the parser reads all 14 `terraform validate`-clean generated configurations with zero diagnostics.

**Limitations (known and tested where possible)**
- **No evaluation:** variables, locals, `count`, `for_each`, conditionals and functions other than
  `jsonencode` argument inspection are not resolved. Such values are reported as unresolved checks.
- **No module loading:** `module` blocks are listed as not analyzed; their sources are not read.
- **`dynamic` blocks** are not expanded (reported as unresolved for the affected rules).
- **Multi-line expressions without brackets** (for example a conditional split across lines) are
  rejected with a diagnostic. Real HCL rejects most of these too, but HCL accepts newlines inside
  brackets around binary operators (`[a +\n b]`), which this parser reports as an error.
- **Template directives** (`%{ if }`) are preserved as raw template expressions, not interpreted.
- **Terraform JSON syntax (`.tf.json`)** is rejected with `unsupported-file`.
- **Cross-resource matching** (e.g. which bucket a public access block covers) works for direct
  references (`aws_s3_bucket.x.id`) and identical literal names. Anything else is reported as unresolved.
- **Bucket policies with conditions** on a public principal are not flagged (conditions such as
  `aws:SourceVpce` can legitimately restrict access). This is a deliberate scope decision.

**Risks and mitigations**

| Risk | Mitigation |
|---|---|
| Parser divergence from real HCL → wrong tree | Corpus test on all generated configurations; fixtures validated by the real `terraform` binary in CI; diagnostics instead of guesses. |
| Rule misses a variant (e.g. a new resource type for SG rules) | The "not analyzed" list makes gaps visible; rule tests use exact lines; new variants need a fixture first. |
| Reliance on provider defaults that change | Each default-based finding states the assumption in its evidence (`(not set, defaults to false)`). |
| Infinite loop on hostile input | Progress guards in the body loop and in error recovery; a "never throws / always terminates" test over malformed samples. |
| Secrets in evidence | Snippets of attributes named like passwords, secrets or keys, and AWS key / private-key patterns, are redacted. A test asserts that a password literal never reaches the JSON report. |
