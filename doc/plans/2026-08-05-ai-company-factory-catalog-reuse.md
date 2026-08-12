# AI Company Factory: Companies Catalog, Reuse, and Governed Provisioning

> **Runtime update (2026-08-11):** Imported agents are normalized to the
> `claude_local` adapter with `deepseek-v4-flash` (supersedes the earlier
> `codex_local` + `gpt-5.6-luna` normalization described below), still paused,
> with no credentials and no agent/Skill creation permission.

**Status:** implementation complete; governed rollout ready  
**Owner:** Board / Company Factory  
**Scope:** turn the existing Factory request → proposal → approval → provision kernel into the first usable slice of the user's broader “AI Company Factory” objective.

## 1. Correct product boundary

The existing Company Factory Phase 1 is a **governed internal Dev Agency provisioner**. It is not the final product.

The target product accepts a business request in Board Chat and then, without ungoverned side effects:

1. interprets the requested business capability;
2. evaluates reusable companies, teams, and proven templates;
3. proposes reuse, composition, or a new company/team;
4. configures agents, Skills, model/runtime defaults, workspace and permissions;
5. creates a reviewable work graph after native approval;
6. records outcomes, QA evidence, retrospective knowledge, and template performance;
7. reuses that evidence for later similar requests.

## 2. Upstream catalog finding

`paperclipai/companies` packages use the same high-level portable shape that
Paperclip exports: `COMPANY.md`, `agents/*/AGENTS.md`, `skills/*/SKILL.md`,
and optional `.paperclip.yaml` extension metadata. The current GitHub importer
already knows this shape, but its GitHub file collector only selected lowercase
`.md` paths. The upstream catalog conventionally uses uppercase `AGENTS.md` and
`SKILL.md`, so a GitHub preview lost all agents and Skills even though local
parsing supports them.

### Initial import policy

| Class | Initial treatment | Why |
| --- | --- | --- |
| `default` | Baseline only | Role defaults rather than a separate company import. |
| GStack, Superpowers, AgentSys Engineering | Direct, curated engineering templates | Small focused orgs with clear delivery/QA loops. |
| Aeon Intelligence, ClawTeam Research Lab | Direct, research/intelligence templates | Small focused orgs; review generated research before external action. |
| RedOak Review, Trail of Bits Security | Review-only templates | Strong quality/security capability; no automatic external/security side effects. |
| Product Compass, MiniMax, TACHES | Curated role/team imports | Useful domain capability but should be selected by request fit. |
| Agency Agents, Fullstack Forge, K-Dense, Donchitos | Catalog-only initially | Large organizations require role-level selection, capability policies, and resource review before import. |

## 3. Delivery sequence

### Slice A — make upstream packages honestly importable

- [x] Make GitHub portability file selection case-insensitive for Markdown paths.
- [x] Add a regression test using an upstream-style `AGENTS.md` / `SKILL.md` package.
- [x] Confirm a live **preview only** of curated upstream templates shows agents,
  Skills and extension-provided environment inputs. No import occurs in this step.

### Slice B — Company Template Catalog and fit assessment

- [x] Add a versioned built-in catalog of curated source templates, categories,
  risk mode, source URL, and expected size.
- [x] Add a company-scoped catalog/assessment API that returns explicit matching
  evidence, existing-company reuse candidates, and a safe recommended action.
- [x] Keep matching deterministic and explainable until an approved model-backed
  evaluator is introduced; never claim an LLM judgement occurred when it did not.
- [x] Surface the catalog and assessment in Factory UI before proposal/apply.

### Slice C — governed template application

- [x] Extend Factory proposals to select either the existing Codex Dev Agency
  kernel or a curated catalog template.
- [x] For catalog templates, use the existing Paperclip portability importer only
  after the same native approval interaction; import into a new company or an
  explicitly selected existing company.
- [x] Normalize unconfigured imported adapters to `codex_local` +
  `gpt-5.6-luna`, keep agents paused, bind no credentials automatically, and
  preserve every importer warning in the proposal and audit trail.

#### Slice C implementation design

- A request persists an explicit template selection: the existing Factory kernel,
  or a catalog template applied into either a new company or the current company.
  Cross-company targets remain out of scope until access delegation is modeled.
- Proposal generation performs one read-only `agent_safe` importer preview. It
  accepts only `direct` and `review_only` catalog entries, refuses required
  environment inputs and imported permission grants, and records a deterministic
  digest of the selected source files. A changed source must be re-proposed
  before the Board can apply it.
- Application uses the portability importer with company/project/task/routine
  import disabled, skills and agents enabled, `rename` collision behavior, no
  secret values, and every selected agent explicitly overridden to a paused
  `codex_local` `gpt-5.6-luna` configuration. Post-import permission defaults
  are reset to no agent/Skill creation.
- The Factory request and its review issue remain the native approval/audit
  record. Import result ids and every warning are stored in the applied manifest
  and activity log; neither path activates agents or authorizes external work.

### Slice D — memory and learning loop

- [x] Define scoped company/project/template outcome records.
- [x] Promote QA-approved artifacts and retrospectives only through a review
  policy; forbid cross-company retrieval without authorization.
- [x] Feed approved outcome evidence into reuse scoring, with provenance,
  expiry, and a human-overridable explanation.

#### Slice D implementation design

- A Factory outcome is a company-scoped record tied to one applied Factory
  request, its project (when present), a template id (when present), same-company
  work-product evidence, a retrospective, approval state, and optional expiry.
- A Board can submit an outcome only after the Factory QA task is done. Submission
  creates a native review issue and confirmation interaction; promotion requires
  that interaction to be accepted. Catalog-only imports have no synthetic QA
  outcome and cannot be promoted as delivery evidence.
- Read APIs are constrained to one company and can be used by that company’s
  agents and projects. There is no cross-company search, export, or implicit
  retrieval path in this slice.
- Reuse assessment consumes only accepted, unexpired records from the current
  company. Matching is deterministic keyword overlap and returns record ids,
  titles, scores, source provenance, and expiry in the explanation.

### Slice E — chat-first governed intake

- [x] Add a company-scoped natural-language Factory intake endpoint that turns
  one business brief into a transparent normalized request and safe reuse
  assessment without creating anything.
- [x] Add a chat-style Board Factory intake card that prefills the reviewable
  request form and only suggests a catalog import when the catalog policy
  allows it.
- [x] Clearly disclose deterministic interpretation, abstain from cross-company
  attachment/role-composition automation, and retain the native approval gate
  for every mutation.

## 4. Non-negotiable controls

- Catalog refresh and preview are read-only.
- Import, new-company creation, Agent activation, credential binding, external
  connector access, payment, publication, browser actions, and deployment all
  remain explicit approval-controlled actions.
- Imported templates cannot silently receive host secrets or a permissive
  external-action policy.
- Large source templates are role-selectable; they are not blindly imported.
- A failed or incomplete import must leave an inspectable warning/error record
  and cannot be represented as a successful reusable company.

## 5. Acceptance gates for the current implementation pass

1. [x] A GitHub preview of a curated upstream company exposes its agents and Skills
   rather than silently dropping uppercase Markdown paths.
2. [x] The first catalog assessment returns a ranked, evidence-backed reuse/new
   recommendation with no hidden mutation.
3. [x] All source changes have unit coverage, typecheck/build evidence, and browser
   coverage for the new Board UI.
4. [x] Source and browser acceptance tests prove catalog import only happens after
   a native accepted interaction. Live read-only intake and preview checks leave
   Factory request count unchanged before approval.

## 6. Immediate next action

Operate the Factory through its native approval records, then add an explicit
authorization/delegation model before enabling arbitrary cross-company reuse or
automatic role composition.
