# Project Audit — AWS Cloud Designer (pre-CloudSentinel baseline)

**Audit date:** 2026-11-17
**Baseline commit:** `1f323d7`
**Method:** full read of every tracked source file, `tsc --noEmit`, `next lint`, and
`terraform init` + `terraform validate` (Terraform 1.9.8, AWS provider `~> 5.0`) executed
against the generator output for every bundled template.

README claims were treated as hypotheses and checked against the implementation.

---

## 1. What the project is today

A single-page Next.js 15 / React 19 application:

| Layer | Files | What it does |
|---|---|---|
| UI shell | `app/page.tsx`, `components/canvas/ArchitectureCanvas.tsx` | One React Flow canvas holding all state (nodes, edges, modals). |
| Palette / nodes | `components/sidebar`, `components/nodes`, `components/icons` | 6 draggable AWS node types: EC2, S3, RDS, Lambda, ALB, CloudFront. |
| Properties | `components/panels/PropertiesPanel.tsx` | Edits label, description, region, instance type. Tabs for cost and "health". |
| Validation | `lib/validation.ts` | 4 graph-connectivity rules → 0–100 "health score". |
| Cost | `lib/cost-estimation.ts` | Flat per-type constants (EC2 = $10, RDS = $15, …). |
| Terraform | `lib/terraform.ts` | String templating from nodes/edges into 4 `.tf` files. |
| Persistence | `lib/storage.ts` | `localStorage` save/load, JSON import/export. |
| Export | `lib/export.ts` | PNG and PDF report (canvas screenshot + score + cost). |
| AWS | `app/api/upload/route.ts` | Uploads a PNG screenshot to an S3 bucket. |

There are **no tests**, **no CI**, and **no server-side domain logic** besides the upload route.

### Data flow

```
React Flow state (nodes/edges, in component memory)
   ├─► lib/validation.ts ─► PropertiesPanel "Health" tab, PDF report
   ├─► lib/cost-estimation.ts ─► "Estimates" tab, PDF report
   ├─► lib/terraform.ts ─► TerraformViewerModal (download only)
   ├─► lib/storage.ts ─► localStorage
   └─► html-to-image PNG ─► POST /api/upload ─► S3 PutObject
```

---

## 2. Claims vs. implementation

| README claim | Verified? | Finding |
|---|---|---|
| "Production-ready web application" | ❌ | No tests, no auth on the API, generated IaC does not validate. |
| "Syntax-valid Terraform (HCL) templates", "ready to run" | ❌ | **All 4 templates fail `terraform validate`** (see §3.1). |
| Generator builds "`depends_on`, VPC, security group settings dynamically" | ❌ | No VPC, subnet, route table or IGW is ever generated. `vpc_id = "vpc-default"` is a literal string, not an ID. No `depends_on` exists in the code. |
| CloudFront ↔ S3 "OAC configuration" | ⚠️ Partially | An OAC block is emitted *nested inside* the distribution resource, which is invalid HCL structure; no bucket policy grants CloudFront read access, so it would return 403 even if fixed. |
| EC2 → RDS port 5432 SG rule | ⚠️ | Emitted once **per edge** for the same SG pair → duplicate names and, if names were unique, a duplicate-rule error from the EC2 API. |
| "AWS Well-Architected health validation engine" | ⚠️ Overstated | 4 connectivity rules (RDS↔EC2, ALB↔EC2, CloudFront↔origin, isolated nodes). No security, reliability or network checks. |
| "Real-time cost estimator" / "Real-time Model" (PDF) | ⚠️ Overstated | Fixed constants per resource type; ignores instance type, region, storage, NAT, data transfer. The panel correctly says "mock indicators"; the PDF heading does not. |
| "S3 Cloud Share … secure backend upload … public asset URL" | ⚠️ | Works only if the bucket is public (contradicts security best practice). No auth, no size limit. Details in `SECURITY_REVIEW.md`. |
| Templates "3-Tier", "Serverless", "Static", "Microservices" | ✅ | Load correctly on the canvas. |
| Save / load / JSON import/export | ✅ | Works; JSON import has no schema validation. |
| PNG / PDF export | ✅ | Works. |

**Does the AWS integration deploy infrastructure?** No. The only AWS call in the codebase is
`S3 PutObject` of a PNG screenshot. Nothing runs Terraform; nothing creates infrastructure.

---

## 3. Bugs found

### 3.1 Terraform generator (`lib/terraform.ts`) — critical

Reproduced with `terraform validate` on generator output:

| # | Bug | Evidence | Impact |
|---|---|---|---|
| T1 | Resource names derived from `edge.id.slice(0, 8)`. React Flow edge IDs all start with `xy-edge__`, template IDs share prefixes (`e-alb-ec…`). | `Error: Duplicate resource "aws_lb_target_group_attachment" configuration … named "tg_attach_xy-edge_"` (3-tier, microservices) | Any design with ≥2 edges of the same kind is invalid. |
| T2 | `aws_cloudfront_origin_access_control` emitted **inside** `aws_cloudfront_distribution`. | `Error: Reference to undeclared resource` (serverless, static-website) | Every CloudFront→S3 design is invalid. |
| T3 | `vpc_id = "vpc-default"` literal on SGs and target groups. | Passes `validate` (string), fails at `plan/apply`: `InvalidVpcID.NotFound`. | Nothing with an SG or ALB can deploy. |
| T4 | ALB `subnets = ["subnet-0123456789abcdef0", …]` hardcoded fake IDs. | Same as above. | ALB cannot deploy. |
| T5 | ALB SG has no `vpc_id` (lands in the default VPC) while the target group uses `"vpc-default"`. | Code inspection. | Inconsistent networks even if IDs were real. |
| T6 | AMI hardcoded: `ami-0c55b159cbfafe1f0` commented as "Amazon Linux 2 in us-east-1". AMI IDs are regional; the variable `aws_region` can be anything. | Code inspection. | Breaks in any other region; AMI ages out. |
| T7 | `password = "password_please_change_me_123"` for RDS. | Code inspection. | Credential committed to every generated config and to Terraform state. |
| T8 | `engine_version = "15.4"` pinned minor version. | RDS retires minor versions. | Plan-time failure as versions are deprecated. |
| T9 | RDS has no `db_subnet_group_name` → default VPC; not linked to the SGs' VPC. | Code inspection. | Network topology does not match the diagram. |
| T10 | Lambda `filename = "lambda_function_payload.zip"` that is never generated. | `terraform plan` fails: file not found. | Every Lambda design fails. |
| T11 | All Lambdas share one role; connected RDS/S3 relationships are ignored (no VPC config, no S3 permissions). | Code inspection. | Diagram edges have no effect; a Lambda→RDS edge produces a Lambda that cannot reach the DB. |
| T12 | Resource names from `sanitize(label) + "_" + id.slice(0,4)` can start with a digit or be empty (`"_abcd"`), and two nodes can collide. | Terraform requires identifiers to start with a letter or `_`. | Invalid HCL for labels like "2nd server". |
| T13 | ALB / TG `name` built with `.slice(0, 28)` can end in `-`. | AWS rejects names ending in a hyphen. | Apply-time failure. |
| T14 | `aws_s3_bucket` uses `force_destroy = true` and a fixed bucket name. | Bucket names are global. | Name collisions; silent data loss on destroy. |
| T15 | CloudFront without origin uses fake `s3-static-website-origin.s3.amazonaws.com`. | Code inspection. | Distribution points at a bucket the user does not own. |
| T16 | ALB → CloudFront origin uses `origin_protocol_policy = "http-only"` and ALB SG allows port 80 from the whole internet → origin is directly reachable, bypassing CloudFront. | Code inspection. | Security bypass. |
| T17 | `forwarded_values` (legacy) instead of cache policies. | Deprecated by AWS. | Works, but not current practice. |
| T18 | `Environment = "production"` tag hardcoded; region default taken from `nodes[0]` only. | Mixed-region designs silently collapse to one region. | Misleading output. |
| T19 | EC2 instances have no subnet → default VPC, ALB targets across VPC boundaries. | Code inspection. | Topology mismatch. |
| T20 | Header comment embeds `architectureId` and output depends on random edge IDs → non-deterministic, non-reviewable diffs. | Code inspection. | Cannot diff/regression test. |

### 3.2 Architecture validation (`lib/validation.ts`)

- Only checks connectivity, not **relationship validity**. Any edge is accepted, e.g. `S3 → RDS`, `CloudFront → EC2`, `RDS → RDS`, self-loops, duplicate edges.
- Edges are treated as undirected for some checks and directed for the generator (`load-balancer → ec2` only), so a reversed edge passes validation but generates no target attachment.
- Lambda as an ALB target and Lambda → RDS are valid AWS patterns but are not modeled.
- No network checks at all (there is no network model).
- Health score is a subtraction of arbitrary constants with no rationale shown.

### 3.3 Other

- `lib/constants.ts` exposes `FUTURE_FEATURES` flags all `false`, but the features they describe (Terraform, cost) are enabled — dead code.
- `types/architecture.ts` has unused "future-ready" types (`CollaborationSession`, `S3SyncPayload`).
- `lib/storage.ts` exports `uploadToS3` / `downloadFromS3` stubs that always throw; unused.
- JSON import trusts arbitrary file content (`setNodes(data.nodes)`) — malformed files can crash the canvas.
- `next lint` is deprecated in Next.js 15.5 and removed in 16.
- No `typecheck` or `test` npm scripts.

---

## 4. Technical debt summary

1. **Domain logic is coupled to React Flow types.** Validation and Terraform consume `Node<AwsNodeData>` directly; there is no normalized infrastructure model, so every engine re-derives relationships differently.
2. **No network model.** VPC, subnets, routing, and security groups are absent from the data model, so neither validation nor generation can reason about public/private exposure.
3. **No resource configuration.** Nodes only carry `label`, `description`, `region`, `instanceType`; security-relevant attributes (encryption, public access, ingress) cannot be expressed or checked.
4. **String-concatenated HCL** with no formatting or validation step.
5. **Zero automated tests.**

---

## 5. Prioritized engineering plan

| Priority | Work | Phase |
|---|---|---|
| P0 | Normalized infrastructure model with explicit network (VPC, public/private subnets, IGW, NAT, SGs, IAM roles) and per-resource security configuration. | 1 |
| P0 | Rewrite Terraform generator on top of the model: valid, deterministic, no secrets, no hardcoded IDs/AMIs. | 1 |
| P0 | Relationship rules + architecture validation (unsupported edges, reversed edges, mixed regions, topology). | 1 |
| P0 | Deterministic security rule engine with evidence-bearing findings. | 1 |
| P0 | Unit tests + `terraform validate` integration tests + CI. | 1 |
| P1 | Terraform pipeline API: `fmt` → `validate` → security scan, with clear "not installed" handling. | 1 |
| P1 | Harden `/api/upload` (size limit, content check, private bucket + presigned URLs). | 1 |
| P2 | Visual VPC/subnet containers on the canvas; JSON import schema validation. | 2 |
| P2 | `terraform plan` with read-only credentials, plan diff UI, human approval gate, Checkov. | 2 |
| P2 | Region-aware cost estimation from public price data. | 2 |
| P3 | OpsGraph local lab (Docker Compose + OpenTelemetry) and incident correlation. | 3 |
| P3 | Authentication Lab (Cognito / API Gateway / Lambda / DynamoDB). | 4 |
| P3 | AI assistant (Ollama, grounded on platform data, validated output). | 5 |

Phase 1 is described in `ROADMAP.md`.
