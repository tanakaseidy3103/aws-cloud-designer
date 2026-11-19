# Security Review

Baseline: commit `1f323d7` (original `main`). Scope: application code, the `/api/upload` route,
the Terraform generator, configuration files and git history. Severity: Critical / High / Medium / Low.

Every "Fixed" entry below points to code and a test in this repository. "Open" means not fixed.

## Summary

| ID | Severity | Area | Title | Status |
|---|---|---|---|---|
| SR-01 | Critical | Generated IaC | Hardcoded RDS master password in every generated config | Fixed: `manage_master_user_password = true` (Secrets Manager) |
| SR-02 | High | API | Unauthenticated `/api/upload` writes arbitrary content to the operator's S3 bucket | Mitigated: size cap, PNG-only, disabled unless configured. No authentication yet (open) |
| SR-03 | High | API / S3 | Share flow returns a direct object URL, which only works if the bucket is public | Fixed: returns a presigned GET URL; the bucket can stay private |
| SR-04 | High | Generated IaC | ALB origin reachable from `0.0.0.0/0`, bypassing CloudFront | Fixed: when fronted by CloudFront, ALB ingress uses the CloudFront origin-facing prefix list |
| SR-05 | Medium | Generated IaC | No encryption at rest for RDS, EBS, S3 | Fixed: on by default; disabling it raises a finding |
| SR-06 | Medium | Generated IaC | EC2 instances allow IMDSv1 | Fixed: IMDSv2 required by default |
| SR-07 | Medium | Generated IaC | Every resource lands in the default VPC | Fixed: dedicated VPC with public and private subnets |
| SR-08 | Medium | API | Static long-lived access keys required | Fixed: default AWS credential chain; static keys optional |
| SR-09 | Medium | API | Internal AWS error messages returned to the client | Fixed: logged server-side only |
| SR-10 | Low | Generated IaC | `force_destroy = true` on S3 buckets | Fixed: `false` |
| SR-11 | Low | Generated IaC | No ALB, CloudFront or VPC flow logs | Detected as findings (CS-LOG-*); VPC flow logs generated when enabled |
| SR-12 | Low | Frontend | JSON import loads untrusted structure without validation | Fixed: imports go through `parseArchitectureDocument` |

## Details

### SR-01: Hardcoded database password (Critical)

The original generator emitted `password = "password_please_change_me_123"`. Anyone deploying it
got a known, public password, also stored in Terraform state.

**Fix:** RDS generates and rotates the master password in AWS Secrets Manager
(`manage_master_user_password = true`). No password exists in code, variables or state.
Covered by `tests/unit/terraform-generator.test.ts`.

### SR-02: Unauthenticated upload endpoint (High)

`POST /api/upload` accepted any JSON body and wrote it to S3 with no size limit, no content check
and no authentication. With the app deployed publicly, anyone could use the operator's bucket as
free storage.

**Mitigation** (`app/api/upload/route.ts`, `lib/share/upload.ts`):
- HTTP 501 unless `AWS_S3_BUCKET_NAME` is set.
- Body limit checked from `Content-Length` and again after reading.
- Only PNG is accepted: the declared media type and the 8-byte signature are both checked.
- The filename is sanitized before it is used in the object key.

Tests: `tests/unit/share-upload.test.ts`, `tests/unit/upload-route.test.ts`, with S3 mocked.

**Still open:** the platform has no user authentication or rate limiting. Do not expose this
route on the public internet with real credentials. Authentication is planned for the Auth Lab
(roadmap Phase 6).

### SR-03: Public bucket assumption (High)

The response URL was `https://<bucket>.s3.<region>.amazonaws.com/<key>`, which only works if the
bucket allows public reads: the very configuration the security engine flags as Critical.

**Fix:** the route returns a presigned GET URL. The default lifetime is 1 hour, set with
`SHARE_URL_TTL_SECONDS` and capped at 7 days.

### SR-04: Origin bypass (High)

With CloudFront → ALB, the ALB security group allowed port 80 from `0.0.0.0/0`, so clients could
skip CloudFront.

**Fix:** when an ALB is reached only through CloudFront, ingress is restricted to the
AWS-managed prefix list `com.amazonaws.global.cloudfront.origin-facing`.

**Still open:** CloudFront → ALB uses HTTP unless HTTPS is enabled on the ALB; CS-ALB-001 reports it.

### SR-05 to SR-12

See the table. Each generator default is checked by a deterministic rule in `lib/security/`
with a test, so regressions are caught by the test suite.

## Terraform static analysis

`lib/security/terraform/` analyzes any Terraform directory, not only generated code
(`npm run scan:terraform -- <dir>`). Values it cannot determine are reported as "unresolved",
never as secure. Parser design and limits: [ADR 0001](../architecture/adr/0001-terraform-hcl-parser.md).

## Repository hygiene

- Git history was reviewed for secrets: none found. `.env.example` contains placeholders only.
- `.gitignore` excludes `.env*` except `.env.example`, plus `*.tfstate*` and `.terraform/`.
- Tests that call the `terraform` binary strip every `AWS_*` environment variable and run only
  `fmt`, `init -backend=false` and `validate`. Nothing is planned or applied.

## Not yet reviewed

- Authentication and authorization of the platform itself (none exists).
- Rate limiting on API routes.
- Supply chain: dependencies are pinned by `package-lock.json`; no automated dependency
  scanning yet (planned with CI).
