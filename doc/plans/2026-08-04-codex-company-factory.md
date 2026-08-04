# Codex-first Company Factory: Master Implementation Plan

**Date:** 2026-08-04
**Status:** Active foundation plan
**Owner:** Board / Codex
**Scope:** Extend Paperclip from a multi-company control plane into a governed factory that can intake a business request, reuse or create organizations, staff them with agents and skills, execute project DAGs, preserve organization memory, and deliver reviewable work.

## 1. Product outcome

The operator gives a natural-language request in Board Chat, for example:

> Build a pet-products cross-border ecommerce MVP: research a product, create a landing page, listing copy and short-video plans.

The system must return a **reviewable project proposal** before it acts:

- structured goal, deliverables, constraints, deadline and risk class;
- reuse/extend/create recommendation for companies, teams and agents;
- proposed capabilities, skills, tools, workspaces and execution DAG;
- required human approvals for external side effects;
- created work, artifacts, memory entries and final acceptance evidence.

After approval, the factory creates or reuses the required Paperclip resources and drives governed execution. The initial product is intentionally **human-on-the-loop**, not uncontrolled autonomous external action.

## 2. Non-goals and constraints

- **Token budgets are deferred by operator request.** Existing Paperclip cost observations remain visible, but budget caps, cost allocation and ROI automation are not Phase 1 acceptance gates.
- Human approval remains mandatory for destructive actions, purchases/payments, paid advertising, external publishing, production changes, legal/compliance declarations, credential export and irreversible account changes.
- Hardware automation is advisory only in the initial release: PRDs, BOM research, firmware prototypes, supplier comparisons and test plans are allowed; final manufacturing, certification, procurement, PCB release and safety claims require human approval.
- Each durable entity and memory record must stay company-scoped; project and company isolation must be enforced server-side.

## 3. System architecture

```text
Board Chat / Operator Console
  -> Intake Router (Codex)
  -> Portfolio & Capacity Planner (Codex)
  -> Company Factory Planner + governed approval
  -> Paperclip control plane
       companies / agents / teams / skills / issues / goals / approvals / artifacts
  -> Execution runtime
       Codex primary | Claude / Hermes / HTTP workers only when a template needs them
  -> Memory Hub Plugin
       project / company / skill / global reviewed memory
  -> Connector Hub
       GitHub, filesystem, browser, media, commerce and future external integrations
```

### Codex-first policy

Codex is the default runtime for the Board/Meta Orchestrator, project manager, technical lead, software developer, QA, automation and documentation roles. A team template may select another adapter only when it has a concrete advantage (for example an approved media pipeline or an existing Hermes workflow). Agent identity is always defined as:

```text
role + reporting line + managed instructions + skill selection + permissions + workspace + runtime adapter
```

## 4. Core capabilities

### 4.1 Intake Router

Convert board-chat requests into a versioned `FactoryRequest` containing:

- business goal, domains, deliverables and Definition of Done;
- requested schedule and constraints;
- risk and data-sensitivity classification;
- required tools/connectors;
- ambiguity/questions that must be resolved before planning.

It must never create an organization directly. It produces a proposal and an auditable rationale.

### 4.2 Portfolio, capacity and organization planner

Evaluate the request against existing Paperclip companies, teams, agents, skills, projects, active work and approved templates. It emits one of:

1. `reuse_existing_company`
2. `extend_existing_company`
3. `create_project_team`
4. `create_new_company`
5. `needs_human_decision`

The deterministic scoring inputs are domain fit, skill coverage, available capacity, data/brand isolation, required permissions/tools, risk class and historical delivery evidence. The plan must name reuse candidates and explain why they did or did not qualify.

### 4.3 Company Factory

Apply only an approved plan. It provisions companies/projects, reporting lines, Codex-first agents, managed instructions, role skill bindings, goals, issue DAGs, workspace bindings and approval policies through Paperclip APIs/services. Every mutation must generate activity records and be idempotent by `factoryRequestId`.

### 4.4 Skill Registry

Model reusable capability packs as versioned company skills with:

- role intent and invocation triggers;
- SOP, templates, DoD and QA checklist;
- allowed tool/connector capabilities;
- required memory scopes and retrieval filters;
- artifact schemas;
- compatibility and trust metadata.

Initial skills:

- `codex-software-engineer`
- `codex-qa-reviewer`
- `project-manager`
- `content-writer`
- `ecom-product-researcher`
- `video-script-producer`
- `video-editor-plan`

Skills are selected explicitly through `paperclipSkillSync.desiredSkills`; availability in the company library is not execution enablement.

### 4.5 Memory Hub

Implement a company-scoped plugin/service, not free-form agent notes. It exposes:

- `memory.writeCandidate`
- `memory.search`
- `memory.inject`
- `memory.review`
- `memory.promote`
- `memory.archive`

Memory hierarchy:

| Scope | Purpose | Write policy |
|---|---|---|
| Task | temporary task context | auto-archive at close |
| Project | shared deliverable, decision and risk context | reviewed promotion |
| Company | enduring SOPs, brand rules and supplier/process knowledge | manager/reviewer approval |
| Skill | role-specific technique and checklist learning | skill owner approval |
| Global | broadly reusable, non-sensitive operational guidance | board approval |

Each record requires source agent/task, company/project IDs, tags, confidence, sensitivity, provenance, expiry/review policy and an immutable source reference. Phase 1 uses PostgreSQL structured search plus Markdown/JSON artifacts; pgvector semantic retrieval is introduced only after access filtering and evaluation cases are in place.

### 4.6 Project DAG and QA gates

The Factory converts approved deliverables into a dependency graph of Paperclip issues. Every issue has owner, DoD, artifact requirements, dependency links, memory references, reviewer/QA route and governed side-effect classification. A parent project cannot be marked complete until its required QA and artifact gates pass.

### 4.7 Connector Hub

Connectors are capability-gated plugin integrations. Initial implementation is read/assist only where possible. Publication, payment, procurement, ads, production deployment, credential movement and destructive calls require approval interactions. Connectors are never granted by an arbitrary skill without company, project and agent permission checks.

## 5. Reusable company templates

The first three templates are deliberately limited and all use Codex for technical work:

1. **Dev Agency** — PM, tech lead, developer, QA, docs; software feature delivery.
2. **Content Studio** — content lead, researcher, writer, editor, SEO; approved content plans and artifacts.
3. **Cross-border Ecom Lite** — research, competitor, listing, content, landing-page roles; produces a market/launch package but does not purchase, publish or spend externally without approval.

A later `Hardware Engineering Lite` template may produce research/design artifacts only. Video Factory is a later specialist template after its connector and artifact review path is tested.

## 6. Implementation surfaces

| Surface | Intended responsibility |
|---|---|
| `packages/plugins/company-factory` | factory plugin manifest, service contract and job definitions |
| `server/src/services/company-factory.ts` | planning, idempotency, organization provisioning and policy enforcement |
| `server/src/routes/company-factory.ts` | proposal, approval and execution API |
| `packages/db/src/schema/company-factory.ts` | requests, plans, template versions, evaluations and memory references |
| `packages/shared/src/types/company-factory.ts` | shared contracts/validators |
| `packages/plugins/memory-hub` | company/project memory service and guarded tools |
| `server/src/services/company-memory.ts` | access-filtered retrieval and promotion workflow |
| `ui/src/pages/CompanyFactory.tsx` | Board proposal and plan-review console |
| `ui/src/pages/MemoryHub.tsx` | provenance, review and scope-aware memory browsing |
| `doc/templates/` | company templates, role cards, DoD and approval policy templates |

Exact paths may be adjusted to current upstream plugin conventions after upgrade; schema/API/UI changes must remain synchronized.

## 7. Phased delivery and acceptance gates

### Phase 0 — Stabilize and upgrade

- [x] Preserve local deployment configuration and existing UI customization (manual DB backup plus source/config/storage snapshot).
- [x] Upgrade the repository to the verified upstream `master` revision `2ab797dcbed0031c45c7335a0f497fea2a20bd9a`.
- [x] Rebuild static UI, apply migrations, restart, and verify health/API/company data/skills/Chinese UI.
- [x] Pause the repeatedly failing Claude timer agent; its provider returned 403 insufficient-balance and 503 availability errors.
- [x] Establish `AI Company Factory` as the isolated primary company with Codex Company Architect, then require Board approval for all future hires. Historical companies remain preserved and unmodified.
- [x] Harden `runChildProcess` against delayed-stdin `EPIPE` so a short-lived adapter process cannot terminate the Paperclip control plane.
- [x] Validate the Codex CLI environment; use Codex internal `workspace-write` sandbox because this host denies Bubblewrap user-namespace setup.

### Phase 1 — Codex-first single-company MVP

- [x] Create the governed `AI Company Factory` company, Codex Company Architect (on-demand only), Company Factory Foundation project, and `AIC-1` implementation issue.
- [ ] Add `FactoryRequest` and proposal lifecycle.
- [ ] Board Chat creates a structured intake proposal using a Codex Board/Meta Orchestrator.
- [ ] Add Dev Agency template with Codex PM, engineer, QA and documentation roles.
- [ ] Provision one project DAG only after an approval interaction.
- [ ] Apply explicit company skills and managed instructions to provisioned agents.
- [ ] Produce artifacts and QA acceptance evidence through normal Paperclip work-product flows.

**Exit gate:** one approved software project is created from Board Chat and reaches a reviewed, reproducible deliverable without manual resource wiring.

### Phase 2 — Memory Hub and template reuse

- [ ] Add scoped candidate memory records and source provenance.
- [ ] Inject project/company context before a factory-created agent runs.
- [ ] Add reviewer promotion and expiry policies.
- [ ] Add Content Studio and Cross-border Ecom Lite templates.
- [ ] Add reuse-versus-create planner with explainable scores.

**Exit gate:** a second project demonstrably reuses approved company/skill/project memory without crossing company boundaries.

### Phase 3 — Multi-company factory

- [ ] Add capacity planner and organization recommendation logic.
- [ ] Support new team/new company creation after approval.
- [ ] Add governed connector permission manifests and side-effect approval policies.
- [ ] Add portfolio dashboard showing active companies, projects, work, quality and memory health.

**Exit gate:** an operator can approve a multi-domain request, and the system creates/reuses the correct companies/teams with an auditable reason and governed execution graph.

### Phase 4 — Specialist runtimes and evaluation

- [ ] Introduce approved media, commerce and hardware-assist adapters/connectors.
- [ ] Add replay/evaluation suites for routing, memory retrieval, safety gates and template outcomes.
- [ ] Add optional cost/budget policies when the operator elects to enable them.

## 8. Security and governance invariants

- No factory mutation before a persisted plan and approval interaction.
- No cross-company memory retrieval or artifact access without server-side authorization.
- No external side effect from a heartbeat-only timer without an explicit approval policy and actor authorization.
- No automatic grant of filesystem, browser, credential, payment or publishing capability from natural-language requests.
- Every factory decision, skill injection, memory promotion, delegation and approval outcome emits activity/audit evidence.
- Failure storms must trip an agent-level circuit breaker or pause/review queue rather than repeatedly invoke a permanently failing runtime.

## 9. Operational metrics (non-budget)

Track the following from the first MVP:

- request-to-approved-plan latency;
- proposal reuse accuracy and human override rate;
- issue completion and QA acceptance rate;
- failed heartbeat rate and automatic suppression events;
- skill selection/use and artifact completion rate;
- memory retrieval precision, promotion rejection and stale-memory rate;
- external action approvals, denials and audit completeness.

## 10. Immediate next actions

1. Keep the updated local UI customization and this plan committed on the foundation branch.
2. Implement `AIC-1` through the small vertical slice: request -> proposal -> approval -> Codex Dev Agency project -> QA artifact.
3. Do not enable a timer heartbeat for the Codex architect; wake only from assigned approved work.
4. Introduce Memory Hub only after the request/proposal/approval seam is tested.
