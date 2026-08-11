# AI Company Factory: Safe Runtime Normalization and Reusable Execution Context

**Status:** implementation complete; live safety remediation verified  
**Owner:** Board / Company Factory  
**Scope:** complete the next governed Factory capability after catalog, import,
outcome review, and chat intake: make approved company-local learning available
to Factory-created delivery work without weakening agent execution controls.

## 1. Problem statement

The initial Dev Agency provisioning path persisted its four paused Codex agents
with `dangerouslyBypassApprovalsAndSandbox: true`. Even though heartbeats are
disabled and the agents require explicit work assignment, that default conflicts
with the Factory's approval-first boundary and differs from the safer catalog
import path.

The Factory also scores approved company-local outcomes during template
assessment, but a newly provisioned project does not yet receive a bounded,
inspectable snapshot of those outcomes in its task context. That leaves the
memory/reuse loop incomplete for actual execution.

## 2. Design

### Slice F1 — normalize every Factory-owned Codex runtime safely

- [x] New Dev Agency agents use `codex_local` and `gpt-5.6-luna`, remain paused
  with on-demand heartbeats disabled, and set
  `dangerouslyBypassApprovalsAndSandbox: false`.
- [x] Recovery/idempotent provisioning reasserts that safety value while
  preserving the managed-instructions path and existing approved model setting.
- [x] Remediate the already-provisioned Factory delivery roles through the
  normal local Board API, preserving their model, managed instructions,
  company scope, paused state, and permission restrictions.

### Slice F2 — proposal-pinned company execution context

- [x] Add a `FactoryProposal` v2 `sharedContext` snapshot containing at most
  three approved, unexpired outcomes from the **same company**.
- [x] Select entries deterministically by explicit request/outcome term overlap;
  store outcome IDs, provenance, expiry, matching terms, evidence IDs, and
  bounded outcome/retrospective excerpts. No model call is used.
- [x] Render the snapshot in the proposal/review document and inject it only
  into the Factory-created issue descriptions after native approval. It is
  read-only task context, not a permanent agent instruction or a cross-company
  lookup.
- [x] Revalidate every selected record at application time. A rejected, expired,
  or foreign-company record blocks application and requires a revised proposal,
  so a stale review cannot silently inject changed memory.

### Slice F3 — verification and UI disclosure

- [x] Add integration coverage for safe runtime defaults, same-company context
  selection, issue injection, and re-proposal on stale context.
- [x] Expose the selected reusable context in the Factory proposal UI with its
  policy and provenance; distinguish no match from an error.
- [x] Run migration checks (no migration expected), targeted integration tests,
  typecheck, build, browser E2E, live API checks, and `git diff --check`.

## 3. Non-negotiable controls

- A context snapshot is created during a reviewable proposal; it does not query
  other companies, invoke an LLM, write an outcome, start an agent, or bind a
  credential.
- Only Board-promoted, unexpired outcomes may appear. `awaiting_review`,
  rejected, expired, and catalog-import-only records never become execution
  context.
- The runtime remains paused after provisioning. Context availability never
  authorizes browser, connector, deployment, payment, publication, credential,
  or destructive actions.
- Existing Board-configured model IDs are not overwritten by recovery; the
  Factory default remains `gpt-5.6-luna` only for newly created Factory agents.

## 4. Acceptance gates

1. A new or recovered Factory delivery agent cannot carry the dangerous Codex
   bypass flag.
2. A matching QA-approved outcome appears in the immutable proposal and in each
   created Factory issue after approval, with company-local provenance.
3. A stale/expired/rejected outcome snapshot blocks application instead of
   injecting stale knowledge.
4. The live Factory service remains healthy and its paused delivery agents use
   `gpt-5.6-luna` with the bypass flag disabled.

## 5. Follow-on boundary

Content Studio, Cross-border Ecom Lite, capacity-aware reuse, and connector
manifests remain separate slices. They must consume this same safe context
contract rather than create a parallel unrestricted memory channel.
