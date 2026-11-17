/**
 * Deterministic Terraform security rules (TF-*).
 *
 * Contract for every rule:
 *  - A finding is emitted only from literal configuration (or a documented
 *    provider default when an attribute is absent — stated in the evidence).
 *  - If the deciding value is an expression, the rule records an unresolved
 *    check instead. It never assumes the secure outcome.
 */

import type { Block, Body } from "@/lib/hcl-parser/types";
import type { AnalysisContext, Lookup, RuleMeta, TfResource } from "./context";
import { bucketPolicies, identityPolicies, type PolicyField } from "./policies";

export interface TfRule {
  meta: RuleMeta;
  run: (ctx: AnalysisContext) => void;
}

const FSBP = (id: string) => `AWS Security Hub FSBP control ${id}`;

/* ======================================================================== */
/* Helpers                                                                  */
/* ======================================================================== */

/** Companion resources (e.g. aws_s3_bucket_versioning) that target `bucket`. */
function companions(ctx: AnalysisContext, bucket: TfResource, type: string): { matched: TfResource[]; ambiguous: TfResource[] } {
  const bucketName = ctx.str(bucket.block.body, "bucket");
  const matched: TfResource[] = [];
  const ambiguous: TfResource[] = [];
  for (const c of ctx.ofType(type)) {
    const a = ctx.attr(c.block.body, "bucket");
    if (!a) continue;
    const v = a.value;
    if (v.kind === "expression") {
      if (v.references.includes(`aws_s3_bucket.${bucket.name}`)) matched.push(c);
      else if (!v.references.some((ref) => ref.startsWith("aws_s3_bucket."))) ambiguous.push(c);
    } else if (v.kind === "string" && bucketName.state === "known" && v.value === bucketName.value) {
      matched.push(c);
    } else if (v.kind === "string" && bucketName.state !== "known") {
      ambiguous.push(c);
    }
  }
  return { matched, ambiguous };
}

const at = (r: TfResource, a?: { range: { file: string; line: number } }) => ({ file: a?.range.file ?? r.file, line: a?.range.line ?? r.line });

/* ======================================================================== */
/* S3                                                                       */
/* ======================================================================== */

const PUBLIC_ACLS = new Set(["public-read", "public-read-write", "authenticated-read"]);

export const s3PublicAcl: TfRule = {
  meta: {
    id: "TF-S3-001",
    title: "S3 bucket ACL grants public access",
    severity: "critical",
    description: "A canned ACL makes bucket contents readable (or writable) by anyone.",
    references: [FSBP("S3.2"), FSBP("S3.3")],
  },
  run(ctx) {
    const check = (r: TfResource, body: Body, path: string) => {
      const acl = ctx.str(body, "acl");
      if (acl.state === "unresolved") return ctx.undecided(this.meta, r, path, acl);
      if (acl.state === "known" && PUBLIC_ACLS.has(acl.value)) {
        ctx.report(this.meta, r, at(r, acl.attr), [ctx.evidence(path, acl.attr, r)], {
          risk: `The "${acl.value}" ACL exposes objects to ${acl.value === "authenticated-read" ? "every AWS account holder" : "the entire internet"}${acl.value === "public-read-write" ? " and lets anyone upload or overwrite objects" : ""}.`,
          remediation: 'Remove the ACL (use "private" or omit it), set object_ownership = "BucketOwnerEnforced" to disable ACLs, and serve public content through CloudFront with Origin Access Control.',
        });
      }
    };
    for (const r of ctx.ofType("aws_s3_bucket")) check(r, r.block.body, "acl");
    for (const r of ctx.ofType("aws_s3_bucket_acl")) check(r, r.block.body, "acl");
  },
};

const PAB_FLAGS = ["block_public_acls", "block_public_policy", "ignore_public_acls", "restrict_public_buckets"] as const;

/** Account-wide public access block with all four flags literally true. */
function accountBlocksPublicAccess(ctx: AnalysisContext): boolean {
  return ctx.ofType("aws_s3_account_public_access_block").some((r) =>
    PAB_FLAGS.every((f) => {
      const l = ctx.bool(r.block.body, f);
      return l.state === "known" && l.value;
    })
  );
}

export const s3MissingPublicAccessBlock: TfRule = {
  meta: {
    id: "TF-S3-002",
    title: "S3 bucket has no public access block",
    severity: "high",
    description: "No aws_s3_bucket_public_access_block (or account-wide block) protects this bucket.",
    references: [FSBP("S3.8"), FSBP("S3.1")],
  },
  run(ctx) {
    if (accountBlocksPublicAccess(ctx)) return;
    for (const b of ctx.ofType("aws_s3_bucket")) {
      const { matched, ambiguous } = companions(ctx, b, "aws_s3_bucket_public_access_block");
      if (matched.length) continue;
      if (ambiguous.length) {
        const c = ambiguous[0];
        const a = ctx.attr(c.block.body, "bucket")!;
        ctx.cannotDecide(this.meta, b, "aws_s3_bucket_public_access_block.bucket", at(c, a), a.value.kind === "expression" ? a.value.text : JSON.stringify((a.value as { value?: unknown }).value), `${c.address} targets a bucket that cannot be matched statically; it may or may not cover ${b.address}.`);
        continue;
      }
      ctx.report(this.meta, b, at(b), [ctx.evidence("aws_s3_bucket_public_access_block", undefined, b)], {
        risk: "Nothing prevents a later bucket policy or object ACL from making this bucket public. Most S3 data exposures come from such later changes.",
        remediation: `Add aws_s3_bucket_public_access_block with bucket = aws_s3_bucket.${b.name}.id and all four flags set to true (or an account-wide aws_s3_account_public_access_block).`,
      });
    }
  },
};

export const s3PublicAccessBlockDisabled: TfRule = {
  meta: {
    id: "TF-S3-003",
    title: "S3 public access block setting disabled",
    severity: "high",
    description: "One or more public access block settings are false or not set (the provider default is false).",
    references: [FSBP("S3.8")],
  },
  run(ctx) {
    for (const r of ctx.ofType("aws_s3_bucket_public_access_block")) {
      const off = [];
      for (const f of PAB_FLAGS) {
        const l = ctx.bool(r.block.body, f);
        if (l.state === "unresolved") ctx.undecided(this.meta, r, f, l);
        else if (l.state === "absent" || !l.value) off.push({ f, l });
      }
      if (!off.length) continue;
      const first = off.find((o) => o.l.state === "known") ?? off[0];
      ctx.report(
        this.meta,
        r,
        at(r, first.l.state === "known" ? first.l.attr : undefined),
        off.map((o) => ctx.evidence(o.f, o.l.state === "known" ? o.l.attr : undefined, r, o.l.state === "absent" ? "(not set, defaults to false)" : undefined)),
        {
          risk: `${off.map((o) => o.f).join(", ")} ${off.length > 1 ? "are" : "is"} not enforced, so public ACLs or policies can take effect on this bucket.`,
          remediation: `Set ${off.map((o) => `${o.f} = true`).join(", ")}.`,
        }
      );
    }
  },
};

export const s3PublicBucketPolicy: TfRule = {
  meta: {
    id: "TF-S3-004",
    title: "S3 bucket policy allows anonymous access",
    severity: "critical",
    description: 'A bucket policy statement allows Principal "*" without conditions.',
    references: [FSBP("S3.2"), FSBP("S3.3")],
  },
  run(ctx) {
    const sources = [
      ...bucketPolicies(ctx),
      ...identityPolicies(ctx).filter((p) => p.resource.type === "aws_iam_policy_document"),
    ];
    for (const p of sources) {
      if (p.unresolved) {
        ctx.cannotDecide(this.meta, p.resource, p.attribute, p, p.unresolved.text, p.unresolved.reason);
        continue;
      }
      for (const s of p.statements) {
        if (s.effect !== "Allow" && s.effect !== null) continue;
        if (s.publicPrincipal === false) continue;
        if (s.effect === null || s.publicPrincipal === null) {
          ctx.cannotDecide(this.meta, p.resource, `${p.attribute}.Statement`, { file: p.file, line: s.line }, s.effect === null ? s.effectText : "Principal", "Effect or Principal is not a literal value.");
          continue;
        }
        if (s.hasCondition) continue; // conditioned public principals (e.g. aws:SourceVpce) are out of scope
        ctx.report(this.meta, p.resource, { file: p.file, line: s.line }, [
          ctx.evidence(`${p.attribute}.Statement.Principal`, undefined, { file: p.file, line: s.line }, '"*" (no Condition)'),
          ...s.actions.known.map((a) => ctx.evidence(`${p.attribute}.Statement.Action`, undefined, { file: p.file, line: a.line }, JSON.stringify(a.value))),
        ].map((e) => ({ ...e, snippet: ctx.snippet(e.file, e.line) })), {
          risk: `Anyone on the internet can perform ${s.actions.known.map((a) => a.value).join(", ") || "the listed actions"} on the bucket without credentials.`,
          remediation: "Remove the anonymous statement. Grant access to specific principals, or serve content through CloudFront with Origin Access Control and an AWS:SourceArn condition.",
        });
      }
    }
  },
};

export const s3NoEncryptionConfig: TfRule = {
  meta: {
    id: "TF-S3-005",
    title: "S3 bucket has no explicit default encryption",
    severity: "low",
    description: "No aws_s3_bucket_server_side_encryption_configuration targets this bucket.",
    references: [],
  },
  run(ctx) {
    for (const b of ctx.ofType("aws_s3_bucket")) {
      const legacy = ctx.blocks(b.block.body, "server_side_encryption_configuration");
      if (legacy.length) continue;
      const { matched, ambiguous } = companions(ctx, b, "aws_s3_bucket_server_side_encryption_configuration");
      if (matched.length) {
        for (const c of matched) {
          for (const rule of ctx.blocks(c.block.body, "rule")) {
            for (const d of ctx.blocks(rule.body, "apply_server_side_encryption_by_default")) {
              const alg = ctx.str(d.body, "sse_algorithm");
              if (alg.state === "unresolved") ctx.undecided(this.meta, c, "rule.apply_server_side_encryption_by_default.sse_algorithm", alg);
            }
          }
        }
        continue;
      }
      if (ambiguous.length) {
        const a = ctx.attr(ambiguous[0].block.body, "bucket")!;
        ctx.cannotDecide(this.meta, b, "aws_s3_bucket_server_side_encryption_configuration.bucket", at(ambiguous[0], a), a.value.kind === "expression" ? a.value.text : "(literal)", `${ambiguous[0].address} cannot be matched to ${b.address} statically.`);
        continue;
      }
      ctx.report(this.meta, b, at(b), [ctx.evidence("aws_s3_bucket_server_side_encryption_configuration", undefined, b)], {
        risk: "S3 has applied SSE-S3 to new objects by default since January 2023, so data is not stored in plaintext; but the setting is not captured in code and a customer-managed KMS key cannot be enforced.",
        remediation: `Add aws_s3_bucket_server_side_encryption_configuration for aws_s3_bucket.${b.name} with sse_algorithm = "AES256" or "aws:kms".`,
      });
    }
  },
};

export const s3VersioningDisabled: TfRule = {
  meta: {
    id: "TF-S3-006",
    title: "S3 bucket versioning not enabled",
    severity: "low",
    description: "Overwritten or deleted objects cannot be recovered.",
    references: [FSBP("S3.14")],
  },
  run(ctx) {
    for (const b of ctx.ofType("aws_s3_bucket")) {
      const { matched, ambiguous } = companions(ctx, b, "aws_s3_bucket_versioning");
      if (ambiguous.length && !matched.length) continue; // undecidable; reported by other S3 rules' matching
      let enabled = false;
      for (const c of matched) {
        for (const vc of ctx.blocks(c.block.body, "versioning_configuration")) {
          const st = ctx.str(vc.body, "status");
          if (st.state === "unresolved") {
            ctx.undecided(this.meta, c, "versioning_configuration.status", st);
            enabled = true; // undecided, not reported as disabled
          } else if (st.state === "known" && st.value === "Enabled") enabled = true;
        }
      }
      for (const vb of ctx.blocks(b.block.body, "versioning")) {
        const en = ctx.bool(vb.body, "enabled");
        if (en.state === "known" && en.value) enabled = true;
        if (en.state === "unresolved") {
          ctx.undecided(this.meta, b, "versioning.enabled", en);
          enabled = true;
        }
      }
      if (enabled) continue;
      ctx.report(this.meta, b, at(b), [ctx.evidence("aws_s3_bucket_versioning", undefined, b, matched.length ? "status is not \"Enabled\"" : "(not configured)")], {
        risk: "Accidental deletes, overwrites or ransomware-style encryption of objects cannot be rolled back.",
        remediation: `Add aws_s3_bucket_versioning for aws_s3_bucket.${b.name} with status = "Enabled" (plus a lifecycle rule to expire old versions).`,
      });
    }
  },
};

/* ======================================================================== */
/* Security groups                                                          */
/* ======================================================================== */

interface IngressCandidate {
  r: TfResource;
  body: Body;
  path: string;
  protocolAttr: string;
  cidrAttrs: string[];
  line: number;
}

const INTERNET = new Set(["0.0.0.0/0", "::/0"]);
const DB_PORTS: Record<number, string> = { 1433: "SQL Server", 1521: "Oracle", 3306: "MySQL", 5432: "PostgreSQL", 6379: "Redis", 9200: "Elasticsearch", 27017: "MongoDB" };

function ingressCandidates(ctx: AnalysisContext, meta: RuleMeta[]): IngressCandidate[] {
  const out: IngressCandidate[] = [];
  for (const r of ctx.ofType("aws_security_group")) {
    ctx.blocks(r.block.body, "ingress").forEach((b, i) =>
      out.push({ r, body: b.body, path: `ingress[${i}]`, protocolAttr: "protocol", cidrAttrs: ["cidr_blocks", "ipv6_cidr_blocks"], line: b.range.line })
    );
    for (const d of ctx.blocks(r.block.body, "dynamic").filter((b: Block) => b.labels[0] === "ingress")) {
      for (const m of meta) ctx.cannotDecide(m, r, 'dynamic "ingress"', { file: d.range.file, line: d.range.line }, "for_each", "Rules generated by a dynamic block depend on for_each and are not expanded statically.");
    }
    const inlineAttr = ctx.attr(r.block.body, "ingress");
    if (inlineAttr) for (const m of meta) ctx.cannotDecide(m, r, "ingress", at(r, inlineAttr), "(attribute syntax)", "Attribute-syntax ingress lists are not analyzed; use ingress blocks or separate rule resources.");
  }
  for (const r of ctx.ofType("aws_security_group_rule")) {
    const type = ctx.str(r.block.body, "type");
    if (type.state === "unresolved") {
      for (const m of meta) ctx.undecided(m, r, "type", type);
      continue;
    }
    if (type.state === "known" && type.value === "ingress") {
      out.push({ r, body: r.block.body, path: "", protocolAttr: "protocol", cidrAttrs: ["cidr_blocks", "ipv6_cidr_blocks"], line: r.line });
    }
  }
  for (const r of ctx.ofType("aws_vpc_security_group_ingress_rule")) {
    out.push({ r, body: r.block.body, path: "", protocolAttr: "ip_protocol", cidrAttrs: ["cidr_ipv4", "cidr_ipv6"], line: r.line });
  }
  return out;
}

type Exposure =
  | { kind: "all" }
  | { kind: "ports"; from: number; to: number; protocol: string }
  | { kind: "none" };

const p = (path: string, attr: string) => (path ? `${path}.${attr}` : attr);

function evaluateIngress(ctx: AnalysisContext, c: IngressCandidate, rules: RuleMeta[]): { exposure: Exposure; cidrAttr?: { name: string; line: number; value: string } } {
  let open: { name: string; line: number; value: string } | undefined;
  const unresolvedCidr: { attr: string; text: string; line: number }[] = [];
  for (const name of c.cidrAttrs) {
    const l = ctx.list(c.body, name);
    if (l.state === "absent") continue;
    const hit = l.known.find((x) => INTERNET.has(x.trim()));
    if (hit && l.attr) open = { name, line: l.attr.range.line, value: hit };
    for (const t of l.unresolvedText) unresolvedCidr.push({ attr: name, text: t, line: l.attr!.range.line });
  }
  if (!open) {
    if (unresolvedCidr.length) {
      const applicable = applicableSgRules(ctx, c, rules);
      for (const u of unresolvedCidr) for (const m of applicable) ctx.cannotDecide(m, c.r, p(c.path, u.attr), { file: c.r.file, line: u.line }, u.text, "Source CIDR is not a literal; it may include 0.0.0.0/0.");
    }
    return { exposure: { kind: "none" } };
  }

  const proto = ctx.str(c.body, c.protocolAttr);
  const from = ctx.num(c.body, "from_port");
  const to = ctx.num(c.body, "to_port");
  const undecided = [
    [c.protocolAttr, proto],
    ["from_port", from],
    ["to_port", to],
  ].filter(([, l]) => (l as Lookup<unknown>).state === "unresolved") as [string, Extract<Lookup<unknown>, { state: "unresolved" }>][];
  if (undecided.length) {
    for (const [name, l] of undecided) for (const m of rules) ctx.undecided(m, c.r, p(c.path, name), l);
    return { exposure: { kind: "none" } };
  }
  const protocol = proto.state === "known" ? proto.value.toLowerCase() : "tcp";
  if (protocol === "-1" || protocol === "all") return { exposure: { kind: "all" }, cidrAttr: open };
  if (protocol !== "tcp" && protocol !== "6" && protocol !== "udp" && protocol !== "17") return { exposure: { kind: "none" } };
  const f = from.state === "known" ? from.value : 0;
  const t = to.state === "known" ? to.value : f;
  if (f <= 0 && t >= 65535) return { exposure: { kind: "all" }, cidrAttr: open };
  return { exposure: { kind: "ports", from: f, to: t, protocol }, cidrAttr: open };
}

/**
 * Which SG rules could fire for this rule's ports if its source were the
 * internet. With literal ports only the matching rules are undecided; with
 * unresolved ports every SG rule is.
 */
function applicableSgRules(ctx: AnalysisContext, c: IngressCandidate, rules: RuleMeta[]): RuleMeta[] {
  const proto = ctx.str(c.body, c.protocolAttr);
  const from = ctx.num(c.body, "from_port");
  const to = ctx.num(c.body, "to_port");
  if (proto.state === "unresolved" || from.state === "unresolved" || to.state === "unresolved") return rules;
  const protocol = proto.state === "known" ? proto.value.toLowerCase() : "tcp";
  const f = from.state === "known" ? from.value : 0;
  const t = to.state === "known" ? to.value : f;
  const byId = (id: string) => rules.filter((r) => r.id === id);
  if (protocol === "-1" || protocol === "all" || (f <= 0 && t >= 65535)) return byId("TF-SG-003");
  if (!["tcp", "6", "udp", "17"].includes(protocol)) return [];
  const tcp = protocol === "tcp" || protocol === "6";
  const covers = (port: number) => tcp && f <= port && port <= t;
  const out: RuleMeta[] = [];
  if (covers(22)) out.push(...byId("TF-SG-001"));
  if (covers(3389)) out.push(...byId("TF-SG-002"));
  if (Object.keys(DB_PORTS).map(Number).some(covers)) out.push(...byId("TF-SG-004"));
  if (!out.length && !(f === t && (f === 80 || f === 443))) out.push(...byId("TF-SG-005"));
  return out;
}

function sgEvidence(ctx: AnalysisContext, c: IngressCandidate, cidr: { name: string; line: number; value: string }) {
  const ev = [ctx.evidence(p(c.path, cidr.name), undefined, { file: c.r.file, line: cidr.line }, JSON.stringify(cidr.value))];
  ev[0].snippet = ctx.snippet(c.r.file, cidr.line);
  for (const name of ["from_port", "to_port", c.protocolAttr]) {
    const a = ctx.attr(c.body, name);
    if (a) ev.push(ctx.evidence(p(c.path, name), a, c.r));
  }
  return ev;
}

const SG_META = {
  ssh: { id: "TF-SG-001", title: "SSH (22) open to the internet", severity: "high", description: "An ingress rule allows SSH from 0.0.0.0/0 or ::/0.", references: [FSBP("EC2.13"), FSBP("EC2.19")] },
  rdp: { id: "TF-SG-002", title: "RDP (3389) open to the internet", severity: "high", description: "An ingress rule allows RDP from 0.0.0.0/0 or ::/0.", references: [FSBP("EC2.14"), FSBP("EC2.19")] },
  all: { id: "TF-SG-003", title: "All ports open to the internet", severity: "critical", description: "An ingress rule allows every protocol or the full port range from the internet.", references: [FSBP("EC2.18"), FSBP("EC2.19")] },
  db: { id: "TF-SG-004", title: "Database port open to the internet", severity: "high", description: "An ingress rule allows a database port from the internet.", references: [FSBP("EC2.19")] },
  other: { id: "TF-SG-005", title: "Non-web port open to the internet", severity: "medium", description: "An ingress rule allows ports other than 80/443 from the internet.", references: [FSBP("EC2.18")] },
} satisfies Record<string, RuleMeta>;

export const securityGroupRules: TfRule = {
  meta: SG_META.ssh,
  run(ctx) {
    const metas = Object.values(SG_META);
    for (const c of ingressCandidates(ctx, metas)) {
      const { exposure, cidrAttr } = evaluateIngress(ctx, c, metas);
      if (exposure.kind === "none" || !cidrAttr) continue;
      const loc = { file: c.r.file, line: cidrAttr.line };
      const ev = sgEvidence(ctx, c, cidrAttr);
      if (exposure.kind === "all") {
        ctx.report(SG_META.all, c.r, loc, ev, {
          risk: "Every service on the attached resources — including SSH, RDP and databases — accepts connections from any address.",
          remediation: "Replace the rule with rules for the specific ports the service needs, sourced from known CIDRs or security groups.",
        });
        continue;
      }
      const covers = (port: number) => exposure.from <= port && port <= exposure.to && exposure.protocol !== "udp" && exposure.protocol !== "17";
      let specific = false;
      if (covers(22)) {
        specific = true;
        ctx.report(SG_META.ssh, c.r, loc, ev, {
          risk: "SSH is exposed to the whole internet and will be scanned and brute-forced continuously.",
          remediation: "Remove the rule and use AWS Systems Manager Session Manager, or restrict the source to a known admin CIDR (e.g. a /32).",
        });
      }
      if (covers(3389)) {
        specific = true;
        ctx.report(SG_META.rdp, c.r, loc, ev, {
          risk: "RDP is exposed to the whole internet; it is a common ransomware entry point.",
          remediation: "Remove the rule and use Session Manager / Fleet Manager, or restrict the source to a known admin CIDR.",
        });
      }
      const dbs = Object.keys(DB_PORTS).map(Number).filter(covers);
      if (dbs.length) {
        specific = true;
        ctx.report(SG_META.db, c.r, loc, ev, {
          risk: `${dbs.map((d) => `${DB_PORTS[d]} (${d})`).join(", ")} accept connections from any address, enabling credential brute force and exploitation of engine vulnerabilities.`,
          remediation: "Allow the database port only from the application's security group (source_security_group_id / referenced_security_group_id).",
        });
      }
      // Only a single 80 or 443 port counts as "web"; a range like 80-443 exposes everything in between.
      const webOnly = exposure.from === exposure.to && (exposure.from === 80 || exposure.from === 443);
      if (!specific && !webOnly) {
        ctx.report(SG_META.other, c.r, loc, ev, {
          risk: `Ports ${exposure.from === exposure.to ? exposure.from : `${exposure.from}-${exposure.to}`}/${exposure.protocol} are reachable from any address.`,
          remediation: "Restrict the source CIDR or put the service behind a load balancer that only exposes 80/443.",
        });
      }
    }
  },
};

/* ======================================================================== */
/* RDS                                                                      */
/* ======================================================================== */

export const rdsPublic: TfRule = {
  meta: { id: "TF-RDS-001", title: "Database publicly accessible", severity: "high", description: "publicly_accessible = true gives the database a public endpoint.", references: [FSBP("RDS.2")] },
  run(ctx) {
    for (const r of [...ctx.ofType("aws_db_instance"), ...ctx.ofType("aws_rds_cluster_instance")]) {
      const l = ctx.bool(r.block.body, "publicly_accessible");
      if (l.state === "unresolved") ctx.undecided(this.meta, r, "publicly_accessible", l);
      else if (l.state === "known" && l.value) {
        ctx.report(this.meta, r, at(r, l.attr), [ctx.evidence("publicly_accessible", l.attr, r)], {
          risk: "The database endpoint resolves to a public IP; its security group is the only barrier between it and the internet.",
          remediation: "Set publicly_accessible = false and place the instance in private subnets. Administer it through SSM port forwarding.",
        });
      }
    }
  },
};

export const rdsUnencrypted: TfRule = {
  meta: { id: "TF-RDS-002", title: "Database storage not encrypted", severity: "high", description: "storage_encrypted is false or not set (the provider default is false).", references: [FSBP("RDS.3")] },
  run(ctx) {
    for (const r of [...ctx.ofType("aws_db_instance"), ...ctx.ofType("aws_rds_cluster")]) {
      const l = ctx.bool(r.block.body, "storage_encrypted");
      if (l.state === "unresolved") {
        ctx.undecided(this.meta, r, "storage_encrypted", l);
        continue;
      }
      if (l.state === "known" && l.value) continue;
      const inherits = ["replicate_source_db", "snapshot_identifier"].some((a) => ctx.attr(r.block.body, a));
      ctx.report(this.meta, r, at(r, l.state === "known" ? l.attr : undefined), [ctx.evidence("storage_encrypted", l.state === "known" ? l.attr : undefined, r, l.state === "absent" ? "(not set, defaults to false)" : undefined)], {
        risk: "Storage, automated backups, snapshots and replicas are unencrypted, and encryption cannot be turned on in place later.",
        remediation: "Set storage_encrypted = true (optionally kms_key_id) before the database holds data.",
      }, { confidence: inherits ? "medium" : "high" });
    }
  },
};

export const rdsNoBackups: TfRule = {
  meta: { id: "TF-RDS-003", title: "Database automated backups disabled", severity: "medium", description: "backup_retention_period = 0 disables automated backups and point-in-time recovery.", references: [FSBP("RDS.11")] },
  run(ctx) {
    for (const r of [...ctx.ofType("aws_db_instance"), ...ctx.ofType("aws_rds_cluster")]) {
      const l = ctx.num(r.block.body, "backup_retention_period");
      if (l.state === "unresolved") ctx.undecided(this.meta, r, "backup_retention_period", l);
      else if (l.state === "known" && l.value === 0) {
        ctx.report(this.meta, r, at(r, l.attr), [ctx.evidence("backup_retention_period", l.attr, r)], {
          risk: "Deleted or corrupted data cannot be recovered.",
          remediation: "Set backup_retention_period to at least 7.",
        });
      }
    }
  },
};

export const rdsNoDeletionProtection: TfRule = {
  meta: { id: "TF-RDS-004", title: "Database deletion protection disabled", severity: "low", description: "deletion_protection is false or not set (the default is false).", references: [FSBP("RDS.8")] },
  run(ctx) {
    for (const r of [...ctx.ofType("aws_db_instance"), ...ctx.ofType("aws_rds_cluster")]) {
      const l = ctx.bool(r.block.body, "deletion_protection");
      if (l.state === "unresolved") ctx.undecided(this.meta, r, "deletion_protection", l);
      else if (l.state === "absent" || !l.value) {
        ctx.report(this.meta, r, at(r, l.state === "known" ? l.attr : undefined), [ctx.evidence("deletion_protection", l.state === "known" ? l.attr : undefined, r, l.state === "absent" ? "(not set, defaults to false)" : undefined)], {
          risk: "A mistaken destroy or console action deletes the database without an extra safeguard. Acceptable for disposable labs.",
          remediation: "Set deletion_protection = true for databases holding data you need to keep.",
        });
      }
    }
  },
};

/* ======================================================================== */
/* EC2 / EBS / EFS / network                                                */
/* ======================================================================== */

function accountImdsV2(ctx: AnalysisContext): boolean {
  return ctx.ofType("aws_ec2_instance_metadata_defaults").some((r) => {
    const l = ctx.str(r.block.body, "http_tokens");
    return l.state === "known" && l.value === "required";
  });
}

export const imdsV2: TfRule = {
  meta: { id: "TF-EC2-001", title: "IMDSv2 not enforced", severity: "medium", description: "metadata_options.http_tokens is not \"required\", so IMDSv1 may be allowed.", references: [FSBP("EC2.8")] },
  run(ctx) {
    const accountDefault = accountImdsV2(ctx);
    for (const r of [...ctx.ofType("aws_instance"), ...ctx.ofType("aws_launch_template")]) {
      const mo = ctx.blocks(r.block.body, "metadata_options")[0];
      if (!mo) {
        if (accountDefault) continue;
        ctx.report(this.meta, r, at(r), [ctx.evidence("metadata_options", undefined, r, "(not set)")], {
          risk: "Without http_tokens = \"required\" the instance may accept IMDSv1, letting an SSRF bug read the instance role's credentials. Some AMIs (e.g. Amazon Linux 2023) default to IMDSv2, which cannot be verified from this configuration.",
          remediation: 'Add metadata_options { http_tokens = "required" } (or aws_ec2_instance_metadata_defaults for the account).',
        }, { confidence: "medium" });
        continue;
      }
      const endpoint = ctx.str(mo.body, "http_endpoint");
      if (endpoint.state === "known" && endpoint.value === "disabled") continue;
      const tokens = ctx.str(mo.body, "http_tokens");
      if (tokens.state === "unresolved") ctx.undecided(this.meta, r, "metadata_options.http_tokens", tokens);
      else if (tokens.state === "absent" || tokens.value !== "required") {
        if (tokens.state === "absent" && accountDefault) continue;
        ctx.report(this.meta, r, at(r, tokens.state === "known" ? tokens.attr : mo), [ctx.evidence("metadata_options.http_tokens", tokens.state === "known" ? tokens.attr : undefined, { file: mo.range.file, line: mo.range.line }, tokens.state === "absent" ? "(not set)" : undefined)], {
          risk: "IMDSv1 allows any SSRF bug to read the instance role's temporary credentials with a single GET request.",
          remediation: 'Set http_tokens = "required".',
        }, { confidence: tokens.state === "known" ? "high" : "medium" });
      }
    }
  },
};

function ebsDefaultEncryption(ctx: AnalysisContext): boolean {
  return ctx.ofType("aws_ebs_encryption_by_default").some((r) => {
    const l = ctx.bool(r.block.body, "enabled");
    return l.state !== "unresolved" && (l.state === "absent" || l.value);
  });
}

export const ebsUnencrypted: TfRule = {
  meta: { id: "TF-EC2-002", title: "EBS volume not encrypted", severity: "medium", description: "encrypted is false or not set for an EBS volume.", references: [FSBP("EC2.3"), FSBP("EC2.7")] },
  run(ctx) {
    if (ebsDefaultEncryption(ctx)) return;
    const check = (r: TfResource, body: Body, path: string, fallback: { file: string; line: number }) => {
      const l = ctx.bool(body, "encrypted");
      if (l.state === "unresolved") return ctx.undecided(this.meta, r, path, l);
      if (l.state === "known" && l.value) return;
      if (l.state === "absent" && ctx.attr(body, "kms_key_id")) return;
      ctx.report(this.meta, r, l.state === "known" ? at(r, l.attr) : fallback, [ctx.evidence(path, l.state === "known" ? l.attr : undefined, fallback, l.state === "absent" ? "(not set)" : undefined)], {
        risk: "Volume data and its snapshots are unencrypted unless EBS encryption by default is enabled for the account and region, which this configuration does not show.",
        remediation: "Set encrypted = true, or manage aws_ebs_encryption_by_default { enabled = true } for the account.",
      }, { confidence: l.state === "known" ? "high" : "medium" });
    };
    for (const r of ctx.ofType("aws_instance")) {
      for (const b of ctx.blocks(r.block.body, "root_block_device")) check(r, b.body, "root_block_device.encrypted", { file: b.range.file, line: b.range.line });
      ctx.blocks(r.block.body, "ebs_block_device").forEach((b, i) => check(r, b.body, `ebs_block_device[${i}].encrypted`, { file: b.range.file, line: b.range.line }));
      if (!ctx.blocks(r.block.body, "root_block_device").length) check(r, { attributes: [], blocks: [] }, "root_block_device.encrypted", at(r));
    }
    for (const r of ctx.ofType("aws_ebs_volume")) check(r, r.block.body, "encrypted", at(r));
  },
};

export const ec2PublicIp: TfRule = {
  meta: { id: "TF-EC2-003", title: "Instance gets a public IPv4 address", severity: "low", description: "associate_public_ip_address = true.", references: [FSBP("EC2.9")] },
  run(ctx) {
    for (const r of ctx.ofType("aws_instance")) {
      const l = ctx.bool(r.block.body, "associate_public_ip_address");
      if (l.state === "unresolved") ctx.undecided(this.meta, r, "associate_public_ip_address", l);
      else if (l.state === "known" && l.value) {
        ctx.report(this.meta, r, at(r, l.attr), [ctx.evidence("associate_public_ip_address", l.attr, r)], {
          risk: "The instance is directly addressable from the internet; its security group is the only control.",
          remediation: "Place the instance in a private subnet behind a load balancer, or use Session Manager instead of a public IP for administration.",
        });
      }
    }
  },
};

export const efsUnencrypted: TfRule = {
  meta: { id: "TF-EFS-001", title: "EFS file system not encrypted", severity: "medium", description: "encrypted is false or not set (the default is false).", references: [FSBP("EFS.1")] },
  run(ctx) {
    for (const r of ctx.ofType("aws_efs_file_system")) {
      const l = ctx.bool(r.block.body, "encrypted");
      if (l.state === "unresolved") ctx.undecided(this.meta, r, "encrypted", l);
      else if (l.state === "absent" || !l.value) {
        ctx.report(this.meta, r, at(r, l.state === "known" ? l.attr : undefined), [ctx.evidence("encrypted", l.state === "known" ? l.attr : undefined, r, l.state === "absent" ? "(not set, defaults to false)" : undefined)], {
          risk: "File data at rest is unencrypted; encryption cannot be enabled on an existing file system.",
          remediation: "Set encrypted = true when creating the file system.",
        });
      }
    }
  },
};

export const subnetAutoPublicIp: TfRule = {
  meta: { id: "TF-NET-001", title: "Subnet assigns public IPs automatically", severity: "low", description: "map_public_ip_on_launch = true.", references: [FSBP("EC2.15")] },
  run(ctx) {
    for (const r of ctx.ofType("aws_subnet")) {
      const l = ctx.bool(r.block.body, "map_public_ip_on_launch");
      if (l.state === "unresolved") ctx.undecided(this.meta, r, "map_public_ip_on_launch", l);
      else if (l.state === "known" && l.value) {
        ctx.report(this.meta, r, at(r, l.attr), [ctx.evidence("map_public_ip_on_launch", l.attr, r)], {
          risk: "Every instance launched here becomes internet-addressable by default, even if it was not meant to be.",
          remediation: "Set map_public_ip_on_launch = false and request public IPs explicitly only where needed.",
        });
      }
    }
  },
};

/* ======================================================================== */
/* IAM                                                                      */
/* ======================================================================== */

const IAM_META = {
  full: { id: "TF-IAM-001", title: 'IAM policy allows Action "*"', severity: "critical", description: 'An Allow statement grants every action ("*").', references: [FSBP("IAM.1")] },
  service: { id: "TF-IAM-002", title: "IAM policy allows a service-wide wildcard", severity: "high", description: 'An Allow statement grants "service:*".', references: [FSBP("IAM.21")] },
  notAction: { id: "TF-IAM-003", title: "IAM policy uses Allow with NotAction", severity: "high", description: "Allow + NotAction grants everything except the listed actions.", references: [FSBP("IAM.21")] },
  admin: { id: "TF-IAM-004", title: "AdministratorAccess policy attached", severity: "critical", description: "The AWS-managed AdministratorAccess policy is attached.", references: [FSBP("IAM.1")] },
} satisfies Record<string, RuleMeta>;

function resourcesText(f: PolicyField): string {
  return f.known.map((x) => x.value).concat(f.unresolved).join(", ") || "(none)";
}

export const iamWildcards: TfRule = {
  meta: IAM_META.full,
  run(ctx) {
    for (const src of identityPolicies(ctx)) {
      if (src.unresolved) {
        for (const m of [IAM_META.full, IAM_META.service, IAM_META.notAction]) ctx.cannotDecide(m, src.resource, src.attribute, src, src.unresolved.text, src.unresolved.reason);
        continue;
      }
      for (const s of src.statements) {
        if (s.effect !== null && s.effect !== "Allow") continue;
        const wildcardActions = s.actions.known.filter((a) => a.value === "*" || a.value.endsWith(":*"));
        if (s.effect === null) {
          if (wildcardActions.length || s.notActions.present) ctx.cannotDecide(IAM_META.full, src.resource, `${src.attribute}.Effect`, { file: src.file, line: s.line }, s.effectText, "Effect is not a literal; the wildcard statement may be an Allow.");
          continue;
        }
        for (const u of s.actions.unresolved) ctx.cannotDecide(IAM_META.full, src.resource, `${src.attribute}.Action`, { file: src.file, line: s.actions.line }, u, "Action is not a literal; it may be a wildcard.");
        const ev = (a: { value: string; line: number }) => ({
          ...ctx.evidence(`${src.attribute}.Action`, undefined, { file: src.file, line: a.line }, JSON.stringify(a.value)),
          snippet: ctx.snippet(src.file, a.line),
        });
        const full = wildcardActions.find((a) => a.value === "*");
        if (full) {
          ctx.report(IAM_META.full, src.resource, { file: src.file, line: full.line }, [ev(full)], {
            risk: `Action "*" on ${resourcesText(s.resources)} is full administrator access: any compromise of a principal using this policy compromises the account.`,
            remediation: "List only the actions the workload calls, scoped to specific resource ARNs.",
          }, { severity: s.resources.known.some((x) => x.value === "*") || !s.resources.present ? "critical" : "high" });
        }
        for (const a of wildcardActions.filter((x) => x.value !== "*")) {
          ctx.report(IAM_META.service, src.resource, { file: src.file, line: a.line }, [ev(a)], {
            risk: `"${a.value}" grants every current and future action of the service on ${resourcesText(s.resources)}${a.value.startsWith("iam:") || a.value.startsWith("sts:") ? ", which allows privilege escalation" : ""}.`,
            remediation: `Replace "${a.value}" with the specific actions required.`,
          });
        }
        if (s.notActions.present) {
          ctx.report(IAM_META.notAction, src.resource, { file: src.file, line: s.notActions.line }, [{ ...ctx.evidence(`${src.attribute}.NotAction`, undefined, { file: src.file, line: s.notActions.line }, s.notActions.known.map((x) => x.value).join(", ")), snippet: ctx.snippet(src.file, s.notActions.line) }], {
            risk: "Allow with NotAction grants every action not listed — including ones added to AWS in the future.",
            remediation: "Rewrite the statement as an explicit Allow list of actions.",
          });
        }
      }
    }
  },
};

const ATTACHMENT_TYPES = ["aws_iam_role_policy_attachment", "aws_iam_user_policy_attachment", "aws_iam_group_policy_attachment", "aws_iam_policy_attachment"];
const ADMIN_ARN = /:iam::aws:policy\/AdministratorAccess"?$/;

export const iamAdminAttachment: TfRule = {
  meta: IAM_META.admin,
  run(ctx) {
    for (const type of ATTACHMENT_TYPES) {
      for (const r of ctx.ofType(type)) {
        const a = ctx.attr(r.block.body, "policy_arn");
        if (!a) continue;
        const v = a.value;
        // The managed-policy suffix is literal even in "arn:${partition}:..." templates.
        const text = v.kind === "string" ? v.value : v.kind === "expression" ? v.text : "";
        if (ADMIN_ARN.test(text)) {
          ctx.report(this.meta, r, at(r, a), [ctx.evidence("policy_arn", a, r)], {
            risk: "Principals with AdministratorAccess can do anything in the account, including disabling logging and creating new credentials.",
            remediation: "Attach a least-privilege customer-managed policy instead.",
          });
        } else if (v.kind === "expression" && v.form !== "template") {
          ctx.cannotDecide(this.meta, r, "policy_arn", at(r, a), v.text, `policy_arn is the expression \`${v.text}\`; it may reference AdministratorAccess.`);
        }
      }
    }
  },
};

export const TERRAFORM_RULES: readonly TfRule[] = [
  s3PublicAcl,
  s3MissingPublicAccessBlock,
  s3PublicAccessBlockDisabled,
  s3PublicBucketPolicy,
  s3NoEncryptionConfig,
  s3VersioningDisabled,
  securityGroupRules,
  rdsPublic,
  rdsUnencrypted,
  rdsNoBackups,
  rdsNoDeletionProtection,
  imdsV2,
  ebsUnencrypted,
  ec2PublicIp,
  efsUnencrypted,
  subnetAutoPublicIp,
  iamWildcards,
  iamAdminAttachment,
];

/** Every rule id the analyzer can emit (SG and IAM rules emit several). */
export const TERRAFORM_RULE_IDS = [
  "TF-S3-001", "TF-S3-002", "TF-S3-003", "TF-S3-004", "TF-S3-005", "TF-S3-006",
  "TF-SG-001", "TF-SG-002", "TF-SG-003", "TF-SG-004", "TF-SG-005",
  "TF-RDS-001", "TF-RDS-002", "TF-RDS-003", "TF-RDS-004",
  "TF-EC2-001", "TF-EC2-002", "TF-EC2-003", "TF-EFS-001", "TF-NET-001",
  "TF-IAM-001", "TF-IAM-002", "TF-IAM-003", "TF-IAM-004",
] as const;
