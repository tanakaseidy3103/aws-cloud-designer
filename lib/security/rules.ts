/**
 * Deterministic security rules.
 *
 * Every rule reads only the normalized InfraModel and emits findings whose
 * evidence is the exact configuration value that triggered it. Rules never
 * guess: when a risk depends on facts outside the design, the finding says so
 * and lowers its confidence instead of inflating severity.
 *
 * Control references use AWS Security Hub "Foundational Security Best
 * Practices" (FSBP) control IDs.
 */

import type { IngressRule } from "@/types";
import type { AnyInfraResource, InfraModel, InfraResource } from "@/lib/infra/model";
import { isFrontedByCloudFront, needsVpc, resourcesOfType, sourcesOf, targetsOf } from "@/lib/infra/model";
import { isInternetCidr, RDS_ENGINE_PORT, ruleCoversPort } from "@/lib/infra/config";
import { tfAddress } from "@/lib/infra/addresses";
import type { Confidence, FindingResource, SecurityCategory, SecurityFinding, Severity } from "./types";

export interface RuleContext {
  model: InfraModel;
  emit: (finding: SecurityFinding) => void;
}

export interface SecurityRule {
  id: string;
  title: string;
  category: SecurityCategory;
  run: (ctx: RuleContext) => void;
}

function res(r: AnyInfraResource, terraformAddress: string): FindingResource {
  return { id: r.id, type: r.type, label: r.label, terraformAddress };
}

interface FindingInput {
  rule: SecurityRule;
  resource: FindingResource;
  discriminator?: string;
  severity: Severity;
  confidence: Confidence;
  evidence: SecurityFinding["evidence"];
  risk: string;
  remediation: string;
  configReference: string;
  references: string[];
}

function finding(i: FindingInput): SecurityFinding {
  return {
    id: [i.rule.id, i.resource.id, i.discriminator].filter(Boolean).join(":"),
    ruleId: i.rule.id,
    title: i.rule.title,
    severity: i.severity,
    category: i.rule.category,
    resource: i.resource,
    evidence: i.evidence,
    risk: i.risk,
    remediation: i.remediation,
    configReference: i.configReference,
    confidence: i.confidence,
    references: i.references,
  };
}

function describeRule(rule: IngressRule): string {
  const ports = rule.protocol === "-1" ? "all traffic" : `${rule.protocol} ${rule.fromPort === rule.toPort ? rule.fromPort : `${rule.fromPort}-${rule.toPort}`}`;
  return `${ports} from ${rule.cidr}`;
}

function internetRules(rules: IngressRule[]): { rule: IngressRule; index: number }[] {
  return rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => isInternetCidr(rule.cidr));
}

function isAllPorts(rule: IngressRule): boolean {
  return rule.protocol === "-1" || (rule.fromPort <= 0 && rule.toPort >= 65535);
}

/** Instance is reachable from the internet only if it has a public IP. */
function ec2IsPublic(r: InfraResource<"ec2">): boolean {
  return r.config.subnetTier === "public";
}

/* ======================================================================== */
/* Network                                                                  */
/* ======================================================================== */

function adminPortRule(id: string, port: number, name: string, fsbp: string): SecurityRule {
  const rule: SecurityRule = {
    id,
    title: `${name} (port ${port}) open to the internet`,
    category: "network",
    run: ({ model, emit }) => {
      for (const r of resourcesOfType(model, "ec2")) {
        for (const { rule: ing, index } of internetRules(r.config.ingressRules)) {
          if (isAllPorts(ing) || !ruleCoversPort(ing, port)) continue;
          const publicIp = ec2IsPublic(r);
          emit(
            finding({
              rule,
              resource: res(r, tfAddress.customIngress(r.tfName, index)),
              discriminator: String(index),
              severity: publicIp ? "high" : "medium",
              confidence: publicIp ? "high" : "medium",
              evidence: [
                { path: `config.ingressRules[${index}]`, value: ing, description: `Ingress allows ${describeRule(ing)}.` },
                { path: "config.subnetTier", value: r.config.subnetTier, description: publicIp ? "Instance has a public IP in a public subnet." : "Instance is in a private subnet (no public IP today)." },
              ],
              risk: publicIp
                ? `Anyone on the internet can attempt ${name} logins against "${r.label}". Exposed ${name} is one of the most scanned and brute-forced services.`
                : `The rule permits ${name} from any address. It is not reachable today because the instance has no public IP, but moving it to a public subnet or attaching an Elastic IP exposes it immediately.`,
              remediation: `Remove the 0.0.0.0/0 rule. Use AWS Systems Manager Session Manager (the generated instance role includes AmazonSSMManagedInstanceCore) or restrict the CIDR to a known admin range, e.g. your office /32.`,
              configReference: `Properties → ${r.label} → Ingress rules #${index + 1}`,
              references: [`AWS FSBP ${fsbp}`, "AWS FSBP EC2.19"],
            })
          );
        }
      }
    },
  };
  return rule;
}

export const sshOpenToInternet = adminPortRule("CS-NET-001", 22, "SSH", "EC2.13");
export const rdpOpenToInternet = adminPortRule("CS-NET-002", 3389, "RDP", "EC2.14");

export const allTrafficFromInternet: SecurityRule = {
  id: "CS-NET-003",
  title: "All ports open to the internet",
  category: "network",
  run: ({ model, emit }) => {
    const rule = allTrafficFromInternet;
    for (const r of model.resources) {
      if (r.type !== "ec2" && r.type !== "rds") continue;
      const exposed = r.type === "ec2" ? ec2IsPublic(r) : r.config.publiclyAccessible;
      for (const { rule: ing, index } of internetRules(r.config.ingressRules)) {
        if (!isAllPorts(ing)) continue;
        emit(
          finding({
            rule,
            resource: res(r, tfAddress.customIngress(r.tfName, index)),
            discriminator: String(index),
            severity: exposed ? "critical" : "high",
            confidence: exposed ? "high" : "medium",
            evidence: [{ path: `config.ingressRules[${index}]`, value: ing, description: `Ingress allows ${describeRule(ing)}.` }],
            risk: `Every port on "${r.label}" — including administration and database services — accepts connections from any address${exposed ? "" : " once the resource becomes publicly addressable"}.`,
            remediation: "Replace with rules for the specific ports the service needs, sourced from the security groups or CIDRs that call it.",
            configReference: `Properties → ${r.label} → Ingress rules #${index + 1}`,
            references: ["AWS FSBP EC2.18", "AWS FSBP EC2.19"],
          })
        );
      }
    }
  },
};

const DATABASE_PORTS: Record<number, string> = { 3306: "MySQL", 5432: "PostgreSQL", 1433: "SQL Server", 1521: "Oracle", 6379: "Redis", 27017: "MongoDB" };

export const databasePortFromInternet: SecurityRule = {
  id: "CS-NET-004",
  title: "Database port open to the internet",
  category: "network",
  run: ({ model, emit }) => {
    const rule = databasePortFromInternet;
    for (const r of model.resources) {
      if (r.type !== "ec2" && r.type !== "rds") continue;
      const exposed = r.type === "ec2" ? ec2IsPublic(r) : r.config.publiclyAccessible;
      for (const { rule: ing, index } of internetRules(r.config.ingressRules)) {
        if (isAllPorts(ing)) continue; // covered by CS-NET-003
        const candidatePorts = Object.keys(DATABASE_PORTS).map(Number);
        if (r.type === "rds") candidatePorts.push(RDS_ENGINE_PORT[r.config.engine]);
        const ports = [...new Set(candidatePorts)].filter((p) => ruleCoversPort(ing, p));
        if (ports.length === 0) continue;
        emit(
          finding({
            rule,
            resource: res(r, tfAddress.customIngress(r.tfName, index)),
            discriminator: String(index),
            severity: exposed ? "critical" : "high",
            confidence: exposed ? "high" : "medium",
            evidence: [
              { path: `config.ingressRules[${index}]`, value: ing, description: `Ingress allows ${describeRule(ing)} (${ports.map((p) => DATABASE_PORTS[p]).join(", ")}).` },
              ...(r.type === "rds" ? [{ path: "config.publiclyAccessible", value: r.config.publiclyAccessible, description: r.config.publiclyAccessible ? "Database has a public endpoint." : "Database endpoint is private today." }] : []),
            ],
            risk: `Database protocols on "${r.label}" accept connections from any internet address, enabling credential brute force and exploitation of engine vulnerabilities.`,
            remediation: "Delete the CIDR rule. Connect the application (EC2/Lambda) to the database on the canvas; the generator opens the port only from the application's security group.",
            configReference: `Properties → ${r.label} → Ingress rules #${index + 1}`,
            references: ["AWS FSBP EC2.19", ...(r.type === "rds" ? ["AWS FSBP RDS.2"] : [])],
          })
        );
      }
    }
  },
};

export const directlyAddressableInstance: SecurityRule = {
  id: "CS-NET-005",
  title: "Instance directly addressable from the internet",
  category: "network",
  run: ({ model, emit }) => {
    const rule = directlyAddressableInstance;
    for (const r of resourcesOfType(model, "ec2")) {
      if (!ec2IsPublic(r)) continue;
      const behindAlb = sourcesOf(model, r.id, "lb-target").length > 0;
      emit(
        finding({
          rule,
          resource: res(r, tfAddress.instance(r.tfName)),
          severity: behindAlb ? "medium" : "low",
          confidence: "high",
          evidence: [{ path: "config.subnetTier", value: "public", description: "Instance launches in a public subnet with a public IPv4 address." }],
          risk: behindAlb
            ? `"${r.label}" already receives traffic through a load balancer, yet it also has its own public IP. That is a second, unfiltered path around the ALB.`
            : `"${r.label}" has a public IP; its security group is the only control between it and the internet.`,
          remediation: behindAlb
            ? "Set Subnet tier to private. The ALB reaches private instances through the VPC."
            : "Prefer a private subnet behind a load balancer. If it must be public, keep ingress to the minimum required ports.",
          configReference: `Properties → ${r.label} → Subnet tier`,
          references: ["AWS FSBP EC2.9"],
        })
      );
    }
  },
};

export const vpcFlowLogsDisabled: SecurityRule = {
  id: "CS-LOG-001",
  title: "VPC Flow Logs disabled",
  category: "logging",
  run: ({ model, emit }) => {
    if (!needsVpc(model) || model.network.enableFlowLogs) return;
    emit(
      finding({
        rule: vpcFlowLogsDisabled,
        resource: { id: "network", type: "vpc", label: "Architecture VPC", terraformAddress: tfAddress.vpc() },
        severity: "medium",
        confidence: "high",
        evidence: [{ path: "network.enableFlowLogs", value: false, description: "No aws_flow_log is generated for the VPC." }],
        risk: "Without flow logs there is no record of which addresses connected to which resources — investigating an intrusion or a misbehaving service relies on guesswork.",
        remediation: "Enable VPC Flow Logs in Network settings. The generator sends them to a CloudWatch Logs group with 30-day retention (CloudWatch ingestion is billed).",
        configReference: "Properties → Network settings → VPC Flow Logs",
        references: ["AWS FSBP EC2.6"],
      })
    );
  },
};

/* ======================================================================== */
/* Compute                                                                  */
/* ======================================================================== */

export const imdsV1Allowed: SecurityRule = {
  id: "CS-EC2-001",
  title: "Instance metadata service v1 allowed",
  category: "identity",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "ec2")) {
      if (r.config.imdsv2Required) continue;
      emit(
        finding({
          rule: imdsV1Allowed,
          resource: res(r, tfAddress.instance(r.tfName)),
          severity: ec2IsPublic(r) || sourcesOf(model, r.id, "lb-target").length > 0 ? "high" : "medium",
          confidence: "medium",
          evidence: [{ path: "config.imdsv2Required", value: false, description: "metadata_options.http_tokens = \"optional\"." }],
          risk: `An SSRF bug in any application on "${r.label}" can read the instance role's temporary credentials from 169.254.169.254 with a plain GET. IMDSv2 requires a PUT-issued session token, which blocks this class of attack.`,
          remediation: "Enable \"Require IMDSv2\". Current AWS SDKs and the AWS CLI support IMDSv2 transparently.",
          configReference: `Properties → ${r.label} → Require IMDSv2`,
          references: ["AWS FSBP EC2.8"],
        })
      );
    }
  },
};

export const ebsUnencrypted: SecurityRule = {
  id: "CS-EC2-002",
  title: "EBS root volume not encrypted",
  category: "data-protection",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "ec2")) {
      if (r.config.rootVolumeEncrypted) continue;
      emit(
        finding({
          rule: ebsUnencrypted,
          resource: res(r, tfAddress.instance(r.tfName)),
          severity: "medium",
          confidence: "high",
          evidence: [{ path: "config.rootVolumeEncrypted", value: false, description: "root_block_device.encrypted = false." }],
          risk: "Snapshots and volumes of this disk are stored unencrypted; a shared or leaked snapshot exposes all data on it.",
          remediation: "Enable root volume encryption (uses the AWS-managed aws/ebs key at no extra cost).",
          configReference: `Properties → ${r.label} → Encrypt root volume`,
          references: ["AWS FSBP EC2.3"],
        })
      );
    }
  },
};

/* ======================================================================== */
/* Database                                                                 */
/* ======================================================================== */

export const rdsPubliclyAccessible: SecurityRule = {
  id: "CS-RDS-001",
  title: "Database publicly accessible",
  category: "network",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "rds")) {
      if (!r.config.publiclyAccessible) continue;
      const openRules = internetRules(r.config.ingressRules).length > 0;
      emit(
        finding({
          rule: rdsPubliclyAccessible,
          resource: res(r, tfAddress.dbInstance(r.tfName)),
          severity: openRules ? "critical" : "high",
          confidence: "high",
          evidence: [
            { path: "config.publiclyAccessible", value: true, description: "publicly_accessible = true; the instance is placed in public subnets with a public DNS endpoint." },
            ...(openRules ? [{ path: "config.ingressRules", value: r.config.ingressRules, description: "Security group also accepts traffic from 0.0.0.0/0." }] : []),
          ],
          risk: `"${r.label}" resolves to a public IP. Its security group is the only barrier; a single permissive rule exposes the database to the internet.`,
          remediation: "Disable Publicly accessible. Applications reach the database inside the VPC; for administrator access use SSM port forwarding through an instance.",
          configReference: `Properties → ${r.label} → Publicly accessible`,
          references: ["AWS FSBP RDS.2"],
        })
      );
    }
  },
};

export const rdsUnencrypted: SecurityRule = {
  id: "CS-RDS-002",
  title: "Database storage not encrypted",
  category: "data-protection",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "rds")) {
      if (r.config.storageEncrypted) continue;
      emit(
        finding({
          rule: rdsUnencrypted,
          resource: res(r, tfAddress.dbInstance(r.tfName)),
          severity: "high",
          confidence: "high",
          evidence: [{ path: "config.storageEncrypted", value: false, description: "storage_encrypted = false." }],
          risk: "Database storage, automated backups, read replicas and snapshots are unencrypted. Encryption cannot be enabled in place later; it requires a snapshot-copy-restore migration.",
          remediation: "Enable storage encryption now, before data exists.",
          configReference: `Properties → ${r.label} → Encrypt storage`,
          references: ["AWS FSBP RDS.3"],
        })
      );
    }
  },
};

export const rdsNoBackups: SecurityRule = {
  id: "CS-RDS-003",
  title: "Database automated backups disabled",
  category: "data-protection",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "rds")) {
      if (r.config.backupRetentionDays > 0) continue;
      emit(
        finding({
          rule: rdsNoBackups,
          resource: res(r, tfAddress.dbInstance(r.tfName)),
          severity: "medium",
          confidence: "high",
          evidence: [{ path: "config.backupRetentionDays", value: r.config.backupRetentionDays, description: "backup_retention_period = 0 disables automated backups and point-in-time recovery." }],
          risk: "Accidental deletion, corruption or ransomware cannot be recovered from.",
          remediation: "Set backup retention to at least 7 days.",
          configReference: `Properties → ${r.label} → Backup retention`,
          references: ["AWS FSBP RDS.11"],
        })
      );
    }
  },
};

export const rdsNoDeletionProtection: SecurityRule = {
  id: "CS-RDS-004",
  title: "Database deletion protection disabled",
  category: "data-protection",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "rds")) {
      if (r.config.deletionProtection) continue;
      emit(
        finding({
          rule: rdsNoDeletionProtection,
          resource: res(r, tfAddress.dbInstance(r.tfName)),
          severity: "low",
          confidence: "high",
          evidence: [{ path: "config.deletionProtection", value: false, description: "deletion_protection = false." }],
          risk: "A mistaken `terraform destroy` or console action deletes the database without an extra safeguard. Acceptable for short-lived labs.",
          remediation: "Enable deletion protection for any database holding data you need to keep.",
          configReference: `Properties → ${r.label} → Deletion protection`,
          references: ["AWS FSBP RDS.8"],
        })
      );
    }
  },
};

/* ======================================================================== */
/* Storage                                                                  */
/* ======================================================================== */

export const s3PublicAccessBlockDisabled: SecurityRule = {
  id: "CS-S3-001",
  title: "S3 Block Public Access disabled",
  category: "data-protection",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "s3")) {
      if (r.config.blockPublicAccess) continue;
      const servedByCdn = sourcesOf(model, r.id, "cdn-origin").length > 0;
      emit(
        finding({
          rule: s3PublicAccessBlockDisabled,
          resource: res(r, tfAddress.bucketPublicAccessBlock(r.tfName)),
          severity: "high",
          confidence: "medium",
          evidence: [{ path: "config.blockPublicAccess", value: false, description: "All four public access block settings are false." }],
          risk: `Nothing prevents a public bucket policy or object ACL from exposing "${r.label}". The generated policy itself is not public, so actual exposure depends on later changes — hence medium confidence.${servedByCdn ? " The bucket is served through CloudFront with Origin Access Control, so public access is not needed at all." : ""}`,
          remediation: servedByCdn
            ? "Enable Block Public Access. CloudFront OAC keeps working because it uses a service-principal bucket policy, not public access."
            : "Enable Block Public Access. To serve files publicly, put CloudFront with OAC in front of the bucket instead.",
          configReference: `Properties → ${r.label} → Block public access`,
          references: ["AWS FSBP S3.8"],
        })
      );
    }
  },
};

export const s3NoExplicitEncryption: SecurityRule = {
  id: "CS-S3-002",
  title: "S3 default encryption not configured",
  category: "data-protection",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "s3")) {
      if (r.config.encryption !== "none") continue;
      emit(
        finding({
          rule: s3NoExplicitEncryption,
          resource: res(r, tfAddress.bucket(r.tfName)),
          severity: "low",
          confidence: "high",
          evidence: [{ path: "config.encryption", value: "none", description: "No aws_s3_bucket_server_side_encryption_configuration is generated." }],
          risk: "Since January 2023 S3 encrypts new objects with SSE-S3 by default, so data is not stored in plaintext. Without an explicit configuration the setting is not captured in code and you cannot require a customer-managed KMS key.",
          remediation: "Choose AES256 (SSE-S3) or KMS encryption so the configuration is explicit and reviewable.",
          configReference: `Properties → ${r.label} → Encryption`,
          references: [],
        })
      );
    }
  },
};

export const s3VersioningDisabled: SecurityRule = {
  id: "CS-S3-003",
  title: "S3 versioning disabled",
  category: "data-protection",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "s3")) {
      if (r.config.versioning) continue;
      emit(
        finding({
          rule: s3VersioningDisabled,
          resource: res(r, tfAddress.bucketVersioning(r.tfName)),
          severity: "low",
          confidence: "high",
          evidence: [{ path: "config.versioning", value: false, description: "Versioning is not enabled." }],
          risk: "Overwritten or deleted objects cannot be restored.",
          remediation: "Enable versioning (old versions are billed as storage; add a lifecycle rule to expire them).",
          configReference: `Properties → ${r.label} → Versioning`,
          references: ["AWS FSBP S3.14"],
        })
      );
    }
  },
};

/* ======================================================================== */
/* Identity                                                                 */
/* ======================================================================== */

const PRIVILEGE_ESCALATION = /^(iam:(\*|PassRole|CreateAccessKey|CreatePolicyVersion|AttachRolePolicy|AttachUserPolicy|PutRolePolicy|PutUserPolicy|CreateLoginProfile|UpdateAssumeRolePolicy)|sts:AssumeRole)$/;

export const overlyPermissiveIam: SecurityRule = {
  id: "CS-IAM-001",
  title: "Overly permissive IAM policy",
  category: "identity",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "lambda")) {
      const actions = r.config.extraPermissions;
      if (actions.length === 0) continue;
      const full = actions.filter((a) => a === "*");
      const serviceWildcards = actions.filter((a) => a !== "*" && a.endsWith(":*"));
      const escalation = actions.filter((a) => PRIVILEGE_ESCALATION.test(a));
      let severity: Severity = "low";
      let risk = `Actions ${actions.join(", ")} are granted on Resource "*" instead of specific ARNs.`;
      if (escalation.length || serviceWildcards.length) {
        severity = "high";
        risk = `${[...serviceWildcards, ...escalation].join(", ")} on Resource "*" lets "${r.label}" act on every resource of those services${escalation.length ? " and can be used to escalate privileges (e.g. passing a more powerful role)" : ""}.`;
      }
      if (full.length) {
        severity = "critical";
        risk = `Action "*" on Resource "*" is full administrator access. Any code execution bug in "${r.label}" compromises the entire AWS account.`;
      }
      emit(
        finding({
          rule: overlyPermissiveIam,
          resource: res(r, tfAddress.lambdaExtraPolicy(r.tfName)),
          severity,
          confidence: "high",
          evidence: [{ path: "config.extraPermissions", value: actions, description: `Inline policy grants ${actions.join(", ")} on "*".` }],
          risk,
          remediation: "Grant only the specific actions the function calls, and model access to S3 by connecting the function to the bucket — the generator then scopes permissions to that bucket's ARN.",
          configReference: `Properties → ${r.label} → Extra IAM permissions`,
          references: severity === "critical" ? ["AWS FSBP IAM.1"] : ["AWS FSBP IAM.21"],
        })
      );
    }
  },
};

/* ======================================================================== */
/* Transport & edge                                                         */
/* ======================================================================== */

export const albWithoutHttps: SecurityRule = {
  id: "CS-ALB-001",
  title: "Internet-facing load balancer without HTTPS",
  category: "transport",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "load-balancer")) {
      if (r.config.internal || r.config.httpsEnabled) continue;
      const viaCdn = isFrontedByCloudFront(model, r.id);
      emit(
        finding({
          rule: albWithoutHttps,
          resource: res(r, tfAddress.httpListener(r.tfName)),
          severity: "medium",
          confidence: "high",
          evidence: [{ path: "config.httpsEnabled", value: false, description: "Only an HTTP:80 listener is generated." }],
          risk: viaCdn
            ? "Viewers use HTTPS to CloudFront, but CloudFront → ALB traffic crosses the internet unencrypted. The ALB accepts connections only from the CloudFront origin-facing prefix list."
            : "Requests and responses — including cookies and credentials — travel in plaintext between clients and the load balancer.",
          remediation: "Enable HTTPS and supply an ACM certificate ARN for your domain. The generator then adds an HTTPS listener and redirects HTTP to HTTPS.",
          configReference: `Properties → ${r.label} → HTTPS listener`,
          references: viaCdn ? ["AWS FSBP CloudFront.9", "AWS FSBP ELB.1"] : ["AWS FSBP ELB.1"],
        })
      );
    }
  },
};

export const albAccessLogsMissing: SecurityRule = {
  id: "CS-LOG-002",
  title: "Load balancer access logs not configured",
  category: "logging",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "load-balancer")) {
      emit(
        finding({
          rule: albAccessLogsMissing,
          resource: res(r, tfAddress.loadBalancer(r.tfName)),
          severity: "low",
          confidence: "high",
          evidence: [{ path: "aws_lb.access_logs", value: null, description: "No access_logs block is generated (CloudSentinel does not generate ALB log buckets yet)." }],
          risk: "There is no per-request record (client IP, path, status, latency) for incident investigation.",
          remediation: "Create a log bucket with the ELB log-delivery bucket policy for your region and add an access_logs block to the aws_lb resource.",
          configReference: "Not configurable in CloudSentinel yet (roadmap Phase 2)",
          references: ["AWS FSBP ELB.5"],
        })
      );
    }
  },
};

export const cloudFrontAllowsHttp: SecurityRule = {
  id: "CS-CF-001",
  title: "CloudFront serves viewers over plain HTTP",
  category: "transport",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "cloudfront")) {
      if (r.config.viewerProtocolPolicy !== "allow-all") continue;
      emit(
        finding({
          rule: cloudFrontAllowsHttp,
          resource: res(r, tfAddress.distribution(r.tfName)),
          severity: "medium",
          confidence: "high",
          evidence: [{ path: "config.viewerProtocolPolicy", value: "allow-all", description: "default_cache_behavior.viewer_protocol_policy = \"allow-all\"." }],
          risk: "Viewers can load content over HTTP, where it can be read or modified in transit.",
          remediation: "Use redirect-to-https (default) or https-only.",
          configReference: `Properties → ${r.label} → Viewer protocol policy`,
          references: ["AWS FSBP CloudFront.3"],
        })
      );
    }
  },
};

export const cloudFrontLoggingMissing: SecurityRule = {
  id: "CS-LOG-003",
  title: "CloudFront access logging not configured",
  category: "logging",
  run: ({ model, emit }) => {
    for (const r of resourcesOfType(model, "cloudfront")) {
      if (targetsOf(model, r.id, "cdn-origin").length === 0) continue; // not generated
      emit(
        finding({
          rule: cloudFrontLoggingMissing,
          resource: res(r, tfAddress.distribution(r.tfName)),
          severity: "low",
          confidence: "high",
          evidence: [{ path: "aws_cloudfront_distribution.logging_config", value: null, description: "No logging configuration is generated (not supported by CloudSentinel yet)." }],
          risk: "Viewer requests are not recorded, limiting abuse and incident analysis.",
          remediation: "Configure CloudFront standard logging to an S3 bucket or real-time logs to Kinesis.",
          configReference: "Not configurable in CloudSentinel yet (roadmap Phase 2)",
          references: ["AWS FSBP CloudFront.5"],
        })
      );
    }
  },
};

export const ALL_RULES: readonly SecurityRule[] = [
  sshOpenToInternet,
  rdpOpenToInternet,
  allTrafficFromInternet,
  databasePortFromInternet,
  directlyAddressableInstance,
  vpcFlowLogsDisabled,
  imdsV1Allowed,
  ebsUnencrypted,
  rdsPubliclyAccessible,
  rdsUnencrypted,
  rdsNoBackups,
  rdsNoDeletionProtection,
  s3PublicAccessBlockDisabled,
  s3NoExplicitEncryption,
  s3VersioningDisabled,
  overlyPermissiveIam,
  albWithoutHttps,
  albAccessLogsMissing,
  cloudFrontAllowsHttp,
  cloudFrontLoggingMissing,
];
