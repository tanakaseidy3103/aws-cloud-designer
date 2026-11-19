# Phase 0 — Repository Audit and Git Safety

**Date:** 2026-11-17
**Scope:** working tree, branches, history, application code, tests, AWS integration, cost exposure.
**Companion document:** [`docs/PROJECT_AUDIT.md`](../PROJECT_AUDIT.md) — the detailed audit of the original
baseline (`1f323d7`), including the `terraform validate` evidence that every bundled template failed.

---

## 1. Git state at audit time

| Item | State |
|---|---|
| `main` | `1f323d7`, identical to `origin/main`. Nothing on GitHub is missing locally. |
| Remote branches | `origin/main` only. |
| `feat/phase-1-iac-security` | **18 local commits, not pushed.** Branched from `main`; `main` has no commits it lacks. |
| Untracked, in progress | `app/api/terraform/validate/route.ts`, `lib/iac/check-service.ts` (pipeline API, untested), `docs/SECURITY_REVIEW.md` (draft; claims fixes that are not implemented yet). Intentionally **not committed**. |
| Stashes | none |
| Author identity | Older commits use `eduardo@example.com`, which is not linked to a GitHub account, so they do not appear in the contribution graph. New commits use a repository-local identity. History is **not** rewritten. |

No destructive operation (reset, clean, force-push, history rewrite) has been or will be run.

## 2. Current architecture

```
Browser (Next.js 15 / React 19, single page)
 ├─ components/canvas        React Flow editor (6 node types), local state
 ├─ components/panels        Properties / cost / health tabs
 └─ components/modals        Terraform viewer, load, share
        │
        ▼  canvas nodes/edges
lib/infra/model.ts  ── normalized InfraModel (config, relationships, region, network)
 ├─ lib/validation.ts        ARCH-0xx topology & value rules
 ├─ lib/security/            CS-xxx deterministic security rules (on the model)
 └─ lib/iac/                 HCL emitter + generator + fmt/init/validate runner
        │
Server (Next.js route handlers, Node runtime)
 ├─ /api/upload              PNG → S3 PutObject (only AWS call in the codebase)
 └─ /api/terraform/validate  (untracked, in progress) pipeline API
```

## 3. Implemented features (verified)

| Feature | Evidence |
|---|---|
| Visual editor, templates, save/load, PNG/PDF/JSON export | Manual check of original features; unchanged code paths. |
| Normalized infra model, relationship rules, edge normalization | `tests/unit/infra-model.test.ts` |
| Architecture validation (ARCH-001…036) | `tests/unit/validation.test.ts` |
| Security engine on the design model (20 rules, evidence, confidence) | `tests/unit/security.test.ts` |
| Terraform generator: VPC, SGs, EC2, RDS, S3, Lambda, ALB, CloudFront | `tests/unit/terraform-generator.test.ts`; `tests/terraform/*` run the real `terraform fmt -check` + `validate` (14 configurations, all passing with Terraform 1.9.8, AWS provider 5.100.0) |
| Safe terraform runner (no plan/apply path, AWS_* stripped, no shell) | `lib/iac/pipeline.ts`; exercised by the terraform tests |
| JSON import schema validation | `tests/unit/schema.test.ts` |

## 4. Missing or incomplete (against the revised mission)

| Area | Gap |
|---|---|
| Security Intelligence | Rules analyze the **design model**, not arbitrary **Terraform HCL**. No HCL parser, no JSON report export, no UI for findings. |
| Terraform Pipeline | API not committed or tested; no timeout/concurrency/cancellation tests; no structured logs; no secret redaction; no tests proving plan/apply never run; no UI. |
| CI/CD | No GitHub Actions workflow. |
| Local Cloud Lab, OpsGraph, Auth Lab, EC2 read-only, AI assistant | Not started. |
| Docs | No `docs/{architecture,security,operations,development,cost-management}` structure, no ADRs. README still contains unsupported claims (fake demo URL, "production-ready", "ready to run"). |

## 5. Bugs and risks still present

| ID | Risk | Severity |
|---|---|---|
| R1 | `/api/upload` is unauthenticated, has no size limit, no content check, returns a URL that only works if the bucket is public, requires static access keys, and leaks AWS error details. | High |
| R2 | Cost figures are flat placeholders ($10/EC2, …). Now labelled as such in the PDF, but still shown as a dollar total in the panel. | Medium |
| R3 | The UI does not yet surface security findings, so users only see the old "health" view. | Medium |
| R4 | Generated Terraform *can* create billable resources (ALB, RDS, NAT if enabled) if a user applies it manually. Nothing is applied by the platform. | Info / documented |
| R5 | Terraform integration tests take about 40 s per configuration on Windows (provider copy). They run sequentially on Windows because of a provider-install race. | Low (dev UX) |

## 6. Test status at audit time

- `npm run typecheck`: 0 errors
- `npm run lint`: 0 problems
- `npx vitest run --project unit`: **154 passed** (9 files)
- `npm run build`: succeeds
- `npm run test:terraform` (with `TERRAFORM_BIN` set): 14 configurations pass `fmt -check` + `validate`
  (last full run on this branch; re-run before merge)

## 7. Cost risks in the current AWS integration

| Path | Can it cost money? | Notes |
|---|---|---|
| `/api/upload` → S3 PutObject | **Yes**, small: S3 storage + PUT requests in the operator's account. Unauthenticated, so anyone who can reach a deployed instance can add objects. | Mitigation planned (R1). Disabled unless `AWS_S3_BUCKET_NAME` and credentials are set. |
| Terraform generation | No. Text only. | |
| Terraform validation | No. `init -backend=false` + `validate` never contact AWS APIs; AWS_* env vars are stripped. Downloads providers from the public registry. | |
| Applying generated Terraform manually | **Yes.** ALB (hourly), RDS (hourly), NAT Gateway (hourly, off by default), CloudWatch Logs, CloudFront requests. | Platform never applies. Cost notes must be shown before any future deployment step. |
| Existing EC2 instance | No integration exists yet. | Phase 7 will be read-only and opt-in. |

## 8. Branch plan

```
main ─────────────────────────────── (stable; changes only with explicit approval)
  └─ develop ─────────────────────── integration branch (created from main)
       ├─ feat/phase-1-iac-security   existing 18 commits: model, validation, security engine,
       │                              generator, templates. Merged with --no-ff after verification.
       ├─ feature/security-intelligence   Phase 1 (HCL analyzer, JSON report, UI)
       ├─ feature/terraform-pipeline       Phase 2 (pipeline API, safeguards, tests)
       ├─ feature/ci-cd                    Phase 3
       ├─ feature/local-cloud-lab          Phase 4
       ├─ feature/opsgraph                 Phase 5
       ├─ feature/cloud-authentication     Phase 6
       ├─ feature/aws-readonly-integration Phase 7
       ├─ feature/ai-assistant             Phase 8
       └─ docs/platform-documentation      Phase 9
```

The existing branch keeps its name: renaming would change nothing technically, and the history is preserved as-is.
Branches are created when their phase starts, not in advance.

## 9. Commit milestones (next phases)

Phase 1: Terraform HCL resource extraction → HCL rule definitions → per-rule tests → JSON report export →
findings UI → upload route hardening (security).
Phase 2: commit and test the pipeline service → timeout and cancellation → concurrency lock tests →
structured logs and redaction → "plan/apply never executed" tests → pipeline UI.
Phase 3: CI workflow (typecheck, lint, unit, build) → Terraform fmt/validate job → security regression job.

## 10. Prioritized plan

1. **P0** Merge verified work into `develop`. Keep the in-progress pipeline files out of history until they are tested.
2. **P0** Phase 1: HCL-level security analyzer with evidence from Terraform source, JSON report, and UI.
3. **P0** Fix R1 (upload route).
4. **P1** Phase 2: pipeline API with safeguards and tests.
5. **P1** Phase 3: CI.
6. **P2** Phases 4–8, each on its own branch.
7. **P2** Phase 9: honest README rewrite, docs tree, ADRs.
