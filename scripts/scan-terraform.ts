/**
 * CloudSentinel Terraform security scan (static, offline).
 *
 *   npm run scan:terraform -- <dir> [--out report.json] [--fail-on critical|high|medium|low|none]
 *
 * Reads only *.tf / *.tf.json files directly inside <dir> (no recursion, no
 * symlinks), never runs terraform, never contacts AWS.
 *
 * Exit codes: 0 = no findings at or above --fail-on (default: high) and the
 * report is complete; 1 = findings at or above the threshold;
 * 2 = incomplete analysis (parse errors or unresolved checks) without
 * threshold findings; 3 = usage or I/O error.
 */

import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyzeTerraform, toJsonReport } from "../lib/security/terraform/analyzer";
import { SEVERITY_ORDER, type Severity } from "../lib/security/types";

const MAX_FILES = 500;

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}`);
  console.error("usage: scan-terraform <dir> [--out report.json] [--fail-on critical|high|medium|low|none]");
  process.exit(3);
}

const args = process.argv.slice(2);
let dir: string | undefined;
let out: string | undefined;
let failOn: Severity | "none" = "high";
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--out") out = args[++i] ?? usage("--out needs a path");
  else if (a === "--fail-on") {
    const v = args[++i];
    if (!v || !["critical", "high", "medium", "low", "none"].includes(v)) usage("--fail-on must be critical, high, medium, low or none");
    failOn = v as Severity | "none";
  } else if (a.startsWith("--")) usage(`unknown option ${a}`);
  else if (!dir) dir = a;
  else usage("only one directory can be scanned");
}
if (!dir) usage();

const root = path.resolve(dir);
let stat;
try {
  stat = lstatSync(root);
} catch {
  usage(`cannot read ${dir}`);
}
if (!stat.isDirectory()) usage(`${dir} is not a directory`);

const sources: Record<string, string> = {};
const entries = readdirSync(root).filter((f) => f.endsWith(".tf") || f.endsWith(".tf.json")).sort();
if (entries.length > MAX_FILES) usage(`more than ${MAX_FILES} Terraform files`);
for (const name of entries) {
  const full = path.join(root, name);
  const s = lstatSync(full);
  if (s.isSymbolicLink() || !s.isFile()) {
    console.error(`skipping ${name}: not a regular file`);
    continue;
  }
  sources[name] = readFileSync(full, "utf8");
}

const report = analyzeTerraform(sources);
const json = toJsonReport(report);
if (out) writeFileSync(out, json, "utf8");
else process.stdout.write(json);

const s = report.summary;
console.error(
  `\n${s.files} file(s), ${s.resources} resource(s): ` +
    `${s.findings.critical} critical, ${s.findings.high} high, ${s.findings.medium} medium, ${s.findings.low} low; ` +
    `${s.unresolved} unresolved check(s), ${s.filesWithErrors} file(s) with parse errors, ${s.notAnalyzed} not analyzed. Status: ${report.status}.`
);
for (const f of report.findings) console.error(`  [${f.severity.toUpperCase()}] ${f.ruleId} ${f.file}:${f.line} ${f.resource.address} — ${f.title}`);
for (const u of report.unresolved) console.error(`  [UNRESOLVED] ${u.ruleId} ${u.file}:${u.line} ${u.resource.address}.${u.attribute} = ${u.expression}`);
for (const f of report.files) for (const d of f.diagnostics) console.error(`  [PARSE ${d.severity.toUpperCase()}] ${d.file}:${d.line}:${d.column} ${d.message}`);

const threshold = failOn === "none" ? -1 : SEVERITY_ORDER[failOn];
if (report.findings.some((f) => SEVERITY_ORDER[f.severity] <= threshold)) process.exit(1);
if (!report.complete) process.exit(2);
process.exit(0);
