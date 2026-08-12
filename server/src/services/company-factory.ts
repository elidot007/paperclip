import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, stat } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const execFile = promisify(execFileCallback);
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companies,
  companyFactoryOutcomes,
  companyFactoryRequests,
  issues,
  issueThreadInteractions,
  issueWorkProducts,
  projects,
  projectWorkspaces,
} from "@paperclipai/db";
import {
  buildSkillMentionHref,
  type CompanySkillListItem,
  type CreateIssueThreadInteraction,
  type CreateFactoryRequest,
  type CreateFactoryOutcome,
  type FactoryAppliedResources,
  type FactoryCatalogTemplateSelection,
  type FactoryOutcomeListQuery,
  type FactoryOutcomeRecord,
  type FactoryOutcomeScoringEvidence,
  type FactoryOutcomeStatus,
  type FactoryIntakeInput,
  type FactoryIntakeResult,
  type FactoryProjectCandidate,
  type FactoryProposal,
  type FactoryRequest,
  type FactoryRequestStatus,
  type FactorySharedContext,
  type FactorySkillReference,
  type FactoryTaskKey,
  type FactoryTaskProposal,
  type FactoryTemplateAssessment,
  type FactoryTemplateAssessmentInput,
  type FactoryTemplateImportPlan,
  type CompanyTemplateCatalogEntry,
  type CompanyPortabilityFileEntry,
  type CompanyPortabilityImportRequest,
  type CompanyPortabilityPreviewRequest,
  type FactoryTeamRoleKey,
  type FactoryTeamRoleProposal,
} from "@paperclipai/shared";
import { conflict, forbidden, HttpError, notFound, unprocessable } from "../errors.js";
import { agentInstructionsService } from "./agent-instructions.js";
import { agentService } from "./agents.js";
import { companySkillService } from "./company-skills.js";
import { loadDefaultAgentInstructionsBundle } from "./default-agent-instructions.js";
import { documentService } from "./documents.js";
import { issueThreadInteractionService } from "./issue-thread-interactions.js";
import { issueService } from "./issues.js";
import { logActivity } from "./activity-log.js";
import { projectService } from "./projects.js";
import { workProductService } from "./work-products.js";
import { companyPortabilityService } from "./company-portability.js";
import {
  assessCompanyTemplateCatalog,
  listCompanyTemplateCatalog,
} from "./company-template-catalog.js";

type FactoryRequestRow = typeof companyFactoryRequests.$inferSelect;
type FactoryOutcomeRow = typeof companyFactoryOutcomes.$inferSelect;

export interface CompanyFactoryActor {
  userId: string;
  isInstanceAdmin: boolean;
}

type FactorySkillInventory = {
  baseline: FactorySkillReference[];
  taskScoped: Record<FactoryTaskKey, FactorySkillReference[]>;
};

type FactoryRoleSpec = {
  agentRole: FactoryTeamRoleProposal["role"];
  label: string;
  title: string;
  capabilities: string;
  reportsTo: FactoryTeamRoleProposal["reportsTo"];
};

const FACTORY_TEMPLATE_KEY = "codex_dev_agency" as const;
const FACTORY_CATALOG_IMPORT_TEMPLATE_KEY = "catalog_company_import" as const;
// The Factory runs claude_local against the operator's Anthropic-compatible
// endpoint (deepseek-v4-flash by default). Keep a single clear default while
// allowing an operator to override it in the service environment for a future
// governed template rollout. PAPERCLIP_FACTORY_CODEX_MODEL is accepted as a
// deprecated alias for the original codex-first default.
const FACTORY_DEFAULT_MODEL =
  process.env.PAPERCLIP_FACTORY_DEFAULT_MODEL?.trim()
  || process.env.PAPERCLIP_FACTORY_CODEX_MODEL?.trim()
  || "deepseek-v4-flash";
const APPLY_RETRY_AFTER_MS = 60_000;
const FACTORY_SHARED_CONTEXT_MAX_ENTRIES = 3;
const FACTORY_SHARED_CONTEXT_EXCERPT_LENGTH = 900;
// Bound each Factory agent run so a finished-but-hung Claude CLI process
// cannot hold a run open indefinitely. maxTurnsPerRun makes the CLI exit
// cleanly with max_turns_exhausted once the work is done (or truly stuck),
// and timeoutSec is the hard kill after SIGTERM/SIGKILL escalation.
const FACTORY_RUN_MAX_TURNS = 60;
const FACTORY_RUN_TIMEOUT_SEC = 1_200;

const FACTORY_ROLE_SPECS: Record<FactoryTeamRoleKey, FactoryRoleSpec> = {
  project_manager: {
    agentRole: "pm",
    label: "Claude PM",
    title: "Project Manager",
    capabilities: "Breaks approved work into an auditable delivery plan, maintains task dependencies, and escalates governance decisions without bypassing them.",
    reportsTo: "company_ceo",
  },
  software_engineer: {
    agentRole: "engineer",
    label: "Claude Engineer",
    title: "Software Engineer",
    capabilities: "Implements approved changes in the assigned workspace, records reproducible evidence, and does not perform external side effects without a separate approval.",
    reportsTo: "project_manager",
  },
  qa_reviewer: {
    agentRole: "qa",
    label: "Claude QA",
    title: "QA Reviewer",
    capabilities: "Independently verifies acceptance criteria and artifacts, records failures, and gates completion on reproducible QA evidence.",
    reportsTo: "project_manager",
  },
  documentation: {
    agentRole: "general",
    label: "Claude Docs",
    title: "Documentation Lead",
    capabilities: "Produces a concise, inspectable handoff from accepted artifacts and preserves the project operating context without writing cross-company memory.",
    reportsTo: "project_manager",
  },
};

const FACTORY_TASK_SPECS: Array<{
  key: FactoryTaskKey;
  title: string;
  ownerRole: FactoryTeamRoleKey;
  dependsOn: FactoryTaskKey[];
  priority: "high" | "medium";
  requiredArtifacts: string[];
  qaGate: boolean;
  definitionOfDone: string[];
}> = [
  {
    key: "plan",
    title: "Plan approved delivery",
    ownerRole: "project_manager",
    dependsOn: [],
    priority: "high",
    requiredArtifacts: ["A versioned plan document with scope, milestones, risks, and an explicit QA route."],
    qaGate: false,
    definitionOfDone: [
      "Turn the approved factory request into a bounded execution plan.",
      "Confirm that implementation, QA, and documentation tasks retain their dependency and artifact gates.",
      "Record unresolved decisions as approval interactions rather than making external changes.",
      "When the plan approval interaction is accepted, update this issue to done so downstream tasks unlock.",
    ],
  },
  {
    key: "implement",
    title: "Implement approved scope",
    ownerRole: "software_engineer",
    dependsOn: ["plan"],
    priority: "high",
    requiredArtifacts: ["An implementation work product or document with reproducible validation commands and results."],
    qaGate: false,
    definitionOfDone: [
      "Implement only the approved scope in the bound workspace.",
      "Attach or link the implementation evidence and validation results to this issue.",
      "Escalate any deployment, publishing, payment, credential, or destructive operation for Board approval.",
    ],
  },
  {
    key: "qa",
    title: "QA gate and acceptance evidence",
    ownerRole: "qa_reviewer",
    dependsOn: ["implement"],
    priority: "high",
    requiredArtifacts: ["A QA verdict document", "A reviewable QA evidence work product"],
    qaGate: true,
    definitionOfDone: [
      "Verify the implementation against the Factory request and the implementation task's Definition of Done.",
      "Record test commands, outcomes, failures, and any required remediation in a QA verdict document.",
      "Do not approve completion when required artifact evidence is missing or an external action lacks approval.",
    ],
  },
  {
    key: "document",
    title: "Publish internal handoff",
    ownerRole: "documentation",
    dependsOn: ["qa"],
    priority: "medium",
    requiredArtifacts: ["A handoff document that links the accepted implementation and QA evidence."],
    qaGate: true,
    definitionOfDone: [
      "Summarize the accepted scope, operational steps, known limitations, and linked evidence.",
      "Keep the handoff company-scoped and avoid cross-company memory writes.",
      "Do not represent the project as complete until the QA task is accepted.",
    ],
  },
];

function toFactoryRequest(row: FactoryRequestRow): FactoryRequest {
  return {
    id: row.id,
    companyId: row.companyId,
    title: row.title,
    requestMarkdown: row.requestMarkdown,
    projectName: row.projectName,
    projectDescription: row.projectDescription ?? null,
    workspaceCwd: row.workspaceCwd ?? null,
    templateSelection: (row.templateSelection as FactoryCatalogTemplateSelection | null) ?? null,
    reviewProjectId: row.reviewProjectId ?? null,
    status: row.status as FactoryRequestStatus,
    proposal: (row.proposal as FactoryProposal | null) ?? null,
    proposalRevision: row.proposalRevision,
    reviewIssueId: row.reviewIssueId ?? null,
    approvalInteractionId: row.approvalInteractionId ?? null,
    appliedProjectId: row.appliedProjectId ?? null,
    appliedResources: (row.appliedResources as FactoryAppliedResources | null) ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
    failureReason: row.failureReason ?? null,
    createdByAgentId: row.createdByAgentId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    approvedAt: row.approvedAt ?? null,
    appliedAt: row.appliedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function outcomeActiveForReuse(row: Pick<FactoryOutcomeRow, "status" | "expiresAt">, now = new Date()): boolean {
  return row.status === "approved" && (!row.expiresAt || row.expiresAt.getTime() > now.getTime());
}

function factoryContextTerms(value: string): string[] {
  const normalized = value.toLocaleLowerCase();
  const words = normalized
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length >= 2);
  const hanBigrams = (normalized.match(/[\u3400-\u9fff]+/g) ?? []).flatMap((segment) => {
    const characters = Array.from(segment);
    return Array.from({ length: Math.max(0, characters.length - 1) }, (_value, index) => characters.slice(index, index + 2).join(""));
  });
  return [...new Set([...words, ...hanBigrams])].slice(0, 160);
}

function factoryContextExcerpt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= FACTORY_SHARED_CONTEXT_EXCERPT_LENGTH) return normalized;
  return `${normalized.slice(0, FACTORY_SHARED_CONTEXT_EXCERPT_LENGTH - 1).trimEnd()}…`;
}

function buildFactorySharedContext(input: {
  companyId: string;
  request: FactoryRequest;
  outcomes: FactoryOutcomeRow[];
}): FactorySharedContext {
  const requestTerms = factoryContextTerms([
    input.request.title,
    input.request.projectName,
    input.request.requestMarkdown,
  ].join("\n"));
  const entries = input.outcomes
    .filter((outcome) => outcomeActiveForReuse(outcome) && Boolean(outcome.approvedAt))
    .map((outcome) => {
      const outcomeText = [
        outcome.title,
        outcome.outcomeMarkdown,
        outcome.retrospectiveMarkdown,
      ].join("\n").toLocaleLowerCase();
      const matchedTerms = requestTerms.filter((term) => outcomeText.includes(term)).slice(0, 8);
      return { outcome, matchedTerms };
    })
    .filter(({ matchedTerms }) => matchedTerms.length > 0)
    .sort((left, right) => (
      right.matchedTerms.length - left.matchedTerms.length
      || (right.outcome.approvedAt?.getTime() ?? 0) - (left.outcome.approvedAt?.getTime() ?? 0)
      || left.outcome.title.localeCompare(right.outcome.title)
    ))
    .slice(0, FACTORY_SHARED_CONTEXT_MAX_ENTRIES)
    .map(({ outcome, matchedTerms }) => ({
      outcomeId: outcome.id,
      sourceCompanyId: input.companyId,
      sourceFactoryRequestId: outcome.factoryRequestId,
      projectId: outcome.projectId ?? null,
      templateId: outcome.templateId ?? null,
      title: outcome.title,
      matchedTerms,
      evidenceWorkProductIds: [...new Set(outcome.evidenceWorkProductIds ?? [])],
      outcomeExcerpt: factoryContextExcerpt(outcome.outcomeMarkdown),
      retrospectiveExcerpt: factoryContextExcerpt(outcome.retrospectiveMarkdown),
      approvedAt: outcome.approvedAt!.toISOString(),
      expiresAt: outcome.expiresAt?.toISOString() ?? null,
    }));
  return {
    selectionPolicy: "approved_unexpired_same_company_term_overlap",
    generatedAt: new Date().toISOString(),
    entries,
    rationale: entries.length > 0
      ? `${entries.length} approved, unexpired outcome record(s) from the current company matched explicit request terms. Their bounded snapshot will be injected as read-only task context only after native approval.`
      : "No approved, unexpired outcome record from the current company matched explicit request terms, so no reusable execution context will be injected.",
  };
}

function toFactoryOutcome(row: FactoryOutcomeRow): FactoryOutcomeRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    factoryRequestId: row.factoryRequestId,
    projectId: row.projectId ?? null,
    templateId: row.templateId ?? null,
    title: row.title,
    outcomeMarkdown: row.outcomeMarkdown,
    retrospectiveMarkdown: row.retrospectiveMarkdown,
    evidenceWorkProductIds: [...new Set(row.evidenceWorkProductIds ?? [])],
    status: row.status as FactoryOutcomeStatus,
    activeForReuse: outcomeActiveForReuse(row),
    reviewIssueId: row.reviewIssueId ?? null,
    approvalInteractionId: row.approvalInteractionId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    approvedAt: row.approvedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeResources(value: FactoryAppliedResources | null | undefined): FactoryAppliedResources {
  return {
    projectId: value?.projectId ?? null,
    projectWorkspaceId: value?.projectWorkspaceId ?? null,
    agentIds: { ...(value?.agentIds ?? {}) },
    issueIds: { ...(value?.issueIds ?? {}) },
    artifactIds: [...new Set(value?.artifactIds ?? [])],
    importedCompanyId: value?.importedCompanyId ?? null,
    importedAgentIds: { ...(value?.importedAgentIds ?? {}) },
    templateImportWarnings: [...new Set(value?.templateImportWarnings ?? [])],
  };
}

function sourceFilesDigest(files: Record<string, CompanyPortabilityFileEntry>): string {
  const digest = createHash("sha256");
  for (const filePath of Object.keys(files).sort((left, right) => left.localeCompare(right))) {
    const file = files[filePath]!;
    digest.update(filePath);
    digest.update("\0");
    if (typeof file === "string") {
      digest.update(file);
    } else {
      digest.update(file.encoding);
      digest.update("\0");
      digest.update(file.contentType ?? "");
      digest.update("\0");
      digest.update(file.data);
    }
    digest.update("\0");
  }
  return `sha256:${digest.digest("hex")}`;
}

function catalogImportAdapterConfig(workspaceCwd: string): Record<string, unknown> {
  return {
    cwd: workspaceCwd,
    model: FACTORY_DEFAULT_MODEL,
    timeoutSec: FACTORY_RUN_TIMEOUT_SEC,
    maxTurnsPerRun: FACTORY_RUN_MAX_TURNS,
    dangerouslyBypassApprovalsAndSandbox: false,
  };
}

function uniqueSkills(skills: FactorySkillReference[]): FactorySkillReference[] {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    if (seen.has(skill.id)) return false;
    seen.add(skill.id);
    return true;
  });
}

function toSkillReference(skill: CompanySkillListItem): FactorySkillReference {
  return { id: skill.id, key: skill.key, slug: skill.slug };
}

function normalizedProjectName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function deterministicIntakeTitle(businessRequest: string): string {
  const firstMeaningfulLine = businessRequest
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[#>*\-\d.)\s]+/, ""))
    .find((line) => line.length > 0) ?? "";
  const firstSentence = firstMeaningfulLine.split(/[。！？.!?；;]/)[0]?.trim() ?? "";
  return (firstSentence || firstMeaningfulLine || "Governed Factory request").slice(0, 240);
}

function deterministicConstraintSignals(businessRequest: string): string[] {
  const normalized = businessRequest.toLocaleLowerCase();
  const markers = [
    "must", "must not", "only", "without", "budget", "deadline", "risk", "compliance",
    "必须", "禁止", "不能", "仅", "预算", "截止", "风险", "合规", "不创建", "不访问",
  ];
  return markers.filter((marker) => normalized.includes(marker));
}

function factoryAgentName(projectName: string, role: FactoryTeamRoleKey): string {
  return `${FACTORY_ROLE_SPECS[role].label} — ${projectName}`;
}

function renderSkillMentions(skills: FactorySkillReference[]): string {
  return skills
    .map((skill) => `- [/${skill.slug}](${buildSkillMentionHref(skill.id, skill.slug)})`)
    .join("\n");
}

function renderSharedContext(sharedContext: FactorySharedContext | null | undefined): string {
  if (!sharedContext) {
    return [
      "## Reusable company context",
      "- This legacy proposal has no proposal-pinned outcome context.",
    ].join("\n");
  }
  if (sharedContext.entries.length === 0) {
    return [
      "## Reusable company context (read-only)",
      `- Policy: \`${sharedContext.selectionPolicy}\`.`,
      `- ${sharedContext.rationale}`,
    ].join("\n");
  }
  return [
    "## Reusable company context (read-only)",
    `- Policy: \`${sharedContext.selectionPolicy}\`.`,
    `- ${sharedContext.rationale}`,
    "- This context is a proposal-pinned, same-company snapshot. It does not alter permanent agent instructions or authorize external actions.",
    "",
    ...sharedContext.entries.flatMap((entry) => [
      `### ${entry.title}`,
      `- Outcome: \`${entry.outcomeId}\`; source Factory request: \`${entry.sourceFactoryRequestId}\`.`,
      `- Matched terms: ${entry.matchedTerms.map((term) => `\`${term}\``).join(", ")}.`,
      `- Evidence work products: ${entry.evidenceWorkProductIds.length > 0 ? entry.evidenceWorkProductIds.map((id) => `\`${id}\``).join(", ") : "none recorded"}.`,
      `- Approved: ${entry.approvedAt}; expires: ${entry.expiresAt ?? "never"}.`,
      `- Outcome excerpt: ${entry.outcomeExcerpt || "none"}`,
      `- Retrospective excerpt: ${entry.retrospectiveExcerpt || "none"}`,
      "",
    ]),
  ].join("\n");
}

function renderProposalDocument(input: { request: FactoryRequest; proposal: FactoryProposal }): string {
  const { request, proposal } = input;
  const candidateRows = proposal.candidateProjects.length > 0
    ? proposal.candidateProjects
      .map((candidate) => `- **${candidate.name}** (${candidate.id}): ${candidate.matchReason}`)
      .join("\n")
    : "- No active company projects were available as reuse candidates.";
  const roleRows = proposal.team
    .map((role) => `- **${role.title}** — ${role.adapterType}; starts paused; reports to ${role.reportsTo ?? "Board"}.`)
    .join("\n");
  const taskRows = proposal.taskGraph
    .map((task) => {
      const dependencies = task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "none";
      return [
        `### ${task.title}`,
        `- Owner: \`${task.ownerRole}\``,
        `- Depends on: ${dependencies}`,
        "- Task Skill Manifest:",
        renderSkillMentions(task.taskScopedSkills),
        "- Required artifacts:",
        ...task.requiredArtifacts.map((artifact) => `  - ${artifact}`),
        task.qaGate ? "- This task is a QA gate for downstream work." : null,
      ].filter((line): line is string => Boolean(line)).join("\n");
    })
    .join("\n\n");

  const catalogImportSection = proposal.catalogImport
    ? [
      "## Curated company template import",
      `- Template: **${proposal.catalogImport.templateName}** (${proposal.catalogImport.importMode})`,
      `- Source: ${proposal.catalogImport.sourceUrl}`,
      `- Source snapshot: \`${proposal.catalogImport.sourceDigest}\``,
      `- Target: ${proposal.catalogImport.target.mode === "new_company" ? "create a new company" : "import into the current company"} — **${proposal.catalogImport.target.companyName}**`,
      `- Agents: ${proposal.catalogImport.selectedAgentSlugs.length > 0 ? proposal.catalogImport.selectedAgentSlugs.map((slug) => `\`${slug}\``).join(", ") : "none"}`,
      `- Skills detected: ${proposal.catalogImport.selectedSkillCount}`,
      "- Every imported agent is explicitly configured for `codex_local` + `gpt-5.6-luna`, starts paused, receives no credential values, and has agent/Skill creation disabled.",
      proposal.catalogImport.optionalEnvInputs.length > 0
        ? `- Optional environment inputs are intentionally left unbound: ${proposal.catalogImport.optionalEnvInputs.map((inputValue) => `\`${inputValue.key}\``).join(", ")}.`
        : "- No environment input is bound by this proposal.",
      proposal.catalogImport.previewWarnings.length > 0
        ? ["", "### Importer preview warnings", ...proposal.catalogImport.previewWarnings.map((warning) => `- ${warning}`)].join("\n")
        : null,
    ].filter((line): line is string => Boolean(line)).join("\n")
    : [
      "## Project binding",
      `- Project: **${proposal.project.name}**`,
      `- Action: ${proposal.project.willCreate ? "create a new project" : `reuse project ${proposal.project.id}`}`,
      `- Workspace: ${proposal.project.workspaceCwd ?? "not yet supplied"}`,
      "",
      "## Claude Dev Agency",
      roleRows,
      "",
      renderSharedContext(proposal.sharedContext),
      "",
      "## QA-gated task graph",
      taskRows,
    ].join("\n");

  return [
    `# Factory proposal: ${request.title}`,
    "",
    "## Request",
    request.requestMarkdown,
    "",
    "## Recommendation",
    `**${proposal.recommendation}** using the \`${proposal.templateKey}\` template.`,
    ...proposal.rationale.map((reason) => `- ${reason}`),
    "",
    "## Reuse candidates",
    candidateRows,
    "",
    catalogImportSection,
    "",
    "## Governance",
    "- This interaction authorizes only internal Paperclip provisioning after acceptance.",
    "- New agents are created paused and every execution issue remains in backlog; the Factory does not start a heartbeat or execute a task.",
    "- Purchases, publishing, deployment, credential movement, connector writes, destructive actions, and cross-company memory access remain blocked pending their own approval controls.",
  ].join("\n");
}

function renderReviewIssueDescription(input: { request: FactoryRequest; proposal: FactoryProposal }): string {
  const { request, proposal } = input;
  const action = proposal.catalogImport
    ? `the curated ${proposal.catalogImport.templateName} company-template import`
    : "the internal project/team/DAG provisioning step";
  return [
    "## Factory review required",
    "",
    `This issue contains a reviewable proposal for **${request.title}**.`,
    "",
    `Accept the attached request-confirmation interaction to authorize ${action}. Acceptance does not authorize external side effects or start any agent.`,
  ].join("\n");
}

function renderTemplateImportApplicationManifest(input: {
  request: FactoryRequest;
  plan: FactoryTemplateImportPlan;
  resources: FactoryAppliedResources;
}): string {
  const importedAgents = Object.entries(input.resources.importedAgentIds)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slug, id]) => `- \`${slug}\`: ${id}`);
  return [
    `# Factory template import: ${input.plan.templateName}`,
    "",
    `- Factory request: ${input.request.id}`,
    `- Source snapshot: \`${input.plan.sourceDigest}\``,
    `- Target company: ${input.resources.importedCompanyId ?? "not recorded"}`,
    `- Target mode: ${input.plan.target.mode}`,
    `- Adapter policy: every imported agent uses \`codex_local\` + \`gpt-5.6-luna\`, starts paused, and has no credential binding supplied by Factory.`,
    "",
    "## Imported agents",
    ...(importedAgents.length > 0 ? importedAgents : ["- No agent IDs were returned by the importer."]),
    "",
    "## Importer warnings",
    ...(input.resources.templateImportWarnings.length > 0
      ? input.resources.templateImportWarnings.map((warning) => `- ${warning}`)
      : ["- None"]),
  ].join("\n");
}

function renderOutcomeReviewDocument(input: {
  request: FactoryRequest;
  outcome: CreateFactoryOutcome;
  expiresAt: Date | null;
}): string {
  return [
    `# Factory outcome review: ${input.outcome.title}`,
    "",
    `- Factory request: ${input.request.id}`,
    `- Project: ${input.request.appliedProjectId ?? "none"}`,
    `- Template: ${input.request.proposal?.catalogImport?.templateId ?? "governed baseline"}`,
    `- Evidence work products: ${input.outcome.evidenceWorkProductIds.map((id) => `\`${id}\``).join(", ")}`,
    `- Reuse expiry: ${input.expiresAt?.toISOString() ?? "none"}`,
    "",
    "## Outcome",
    input.outcome.outcomeMarkdown,
    "",
    "## Retrospective",
    input.outcome.retrospectiveMarkdown,
    "",
    "## Governance",
    "- Promotion makes this evidence visible only inside the current company to its authorized agents and projects.",
    "- This review neither shares cross-company memory nor authorizes external side effects.",
  ].join("\n");
}

function renderTaskDescription(input: {
  request: FactoryRequest;
  task: FactoryTaskProposal;
  definitionOfDone: string[];
  sharedContext: FactorySharedContext | null | undefined;
}): string {
  const { request, task, definitionOfDone, sharedContext } = input;
  return [
    "## Factory request context",
    request.requestMarkdown,
    "",
    renderSharedContext(sharedContext),
    "",
    "## Definition of Done",
    ...definitionOfDone.map((item) => `- ${item}`),
    "",
    "## Required artifacts",
    ...task.requiredArtifacts.map((artifact) => `- ${artifact}`),
    "",
    "## Task Skill Manifest (run-scoped)",
    renderSkillMentions(task.taskScopedSkills),
    "",
    "## Governance constraints",
    "- Use only the skills explicitly named above for this task; do not permanently expand the role baseline.",
    "- Do not make purchases, publish externally, deploy, move credentials, or perform destructive operations without a new Board approval interaction.",
    "- Keep all artifacts and context company-scoped. Record blockers instead of bypassing controls.",
  ].join("\n");
}

function factoryAgentInstructions(input: {
  role: FactoryTeamRoleKey;
  request: FactoryRequest;
  projectName: string;
}): string {
  const spec = FACTORY_ROLE_SPECS[input.role];
  return [
    "",
    "## Company Factory assignment",
    `You are the **${spec.title}** role provisioned for **${input.projectName}** from Factory request **${input.request.id}**.`,
    "",
    "### Operating controls",
    "- You start paused. Do not self-resume, self-assign work, or create a timer/heartbeat.",
    "- Work only on an explicitly assigned Paperclip issue and follow its Task Skill Manifest. Run-scoped skill mentions do not change your permanent baseline.",
    "- Keep activity, artifacts, and context inside this company and project. You may use only approved company-local Factory outcome memory; do not read or write cross-company memory.",
    "- Do not purchase, publish, deploy, alter credentials, call external write connectors, or take destructive actions without an explicit Board approval interaction tied to the task.",
    "- Record blockers and QA evidence in Paperclip; do not bypass an approval or QA gate.",
    "- When an approval interaction you created is accepted, finish the handoff: update the issue to its completed status and post the acceptance summary, so dependent tasks can unlock.",
  ].join("\n");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 2_000);
  }
  return "Factory provisioning failed without a structured error message.";
}

export function companyFactoryService(db: Db) {
  const agentsSvc = agentService(db);
  const instructionsSvc = agentInstructionsService();
  const skillsSvc = companySkillService(db);
  const documentsSvc = documentService(db);
  const interactionsSvc = issueThreadInteractionService(db);
  const issuesSvc = issueService(db);
  const projectsSvc = projectService(db);
  const workProductsSvc = workProductService(db);
  const portability = companyPortabilityService(db);

  async function ensureCompany(companyId: string) {
    const company = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);
    if (!company) throw notFound("Company not found");
    return company;
  }

  async function getRaw(companyId: string, requestId: string): Promise<FactoryRequestRow | null> {
    return db
      .select()
      .from(companyFactoryRequests)
      .where(and(eq(companyFactoryRequests.companyId, companyId), eq(companyFactoryRequests.id, requestId)))
      .then((rows) => rows[0] ?? null);
  }

  async function getOrThrow(companyId: string, requestId: string): Promise<FactoryRequestRow> {
    const request = await getRaw(companyId, requestId);
    if (!request) throw notFound("Factory request not found");
    return request;
  }

  async function getOutcomeOrThrow(companyId: string, outcomeId: string): Promise<FactoryOutcomeRow> {
    const outcome = await db
      .select()
      .from(companyFactoryOutcomes)
      .where(and(
        eq(companyFactoryOutcomes.companyId, companyId),
        eq(companyFactoryOutcomes.id, outcomeId),
      ))
      .then((rows) => rows[0] ?? null);
    if (!outcome) throw notFound("Factory outcome not found");
    return outcome;
  }

  async function persist(
    companyId: string,
    requestId: string,
    patch: Partial<typeof companyFactoryRequests.$inferInsert>,
  ): Promise<FactoryRequestRow> {
    const updated = await db
      .update(companyFactoryRequests)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(companyFactoryRequests.companyId, companyId), eq(companyFactoryRequests.id, requestId)))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!updated) throw notFound("Factory request not found");
    return updated;
  }

  async function assertOutcomeEvidenceEligible(input: {
    companyId: string;
    request: FactoryRequest;
    evidenceWorkProductIds: string[];
  }) {
    if (input.request.status !== "applied") {
      throw conflict("Factory outcomes can be submitted only after the Factory request has been applied.");
    }
    const qaIssueId = input.request.appliedResources?.issueIds.qa ?? null;
    if (!qaIssueId) {
      throw unprocessable(
        "This Factory request has no QA-gated delivery issue. A catalog architecture import is not by itself promotable as delivery memory.",
      );
    }
    const qaIssue = await db
      .select({ id: issues.id, companyId: issues.companyId, status: issues.status })
      .from(issues)
      .where(eq(issues.id, qaIssueId))
      .then((rows) => rows[0] ?? null);
    if (!qaIssue || qaIssue.companyId !== input.companyId) {
      throw conflict("Factory QA issue is missing or no longer belongs to this company.");
    }
    if (qaIssue.status !== "done") {
      throw conflict("Factory QA must be marked done before its outcome can be submitted for memory review.");
    }
    const uniqueEvidenceIds = [...new Set(input.evidenceWorkProductIds)];
    const evidenceRows = await db
      .select({ id: issueWorkProducts.id })
      .from(issueWorkProducts)
      .where(and(
        eq(issueWorkProducts.companyId, input.companyId),
        inArray(issueWorkProducts.id, uniqueEvidenceIds),
      ));
    const foundIds = new Set(evidenceRows.map((row) => row.id));
    const missingIds = uniqueEvidenceIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw unprocessable(
        `Factory outcome evidence must reference work products in this company. Missing or inaccessible IDs: ${missingIds.join(", ")}`,
      );
    }
    return uniqueEvidenceIds;
  }

  async function resolveSkillInventory(companyId: string): Promise<FactorySkillInventory> {
    const skills = await skillsSvc.list(companyId);
    const bySlug = new Map<string, CompanySkillListItem>();
    for (const skill of skills) {
      if (!bySlug.has(skill.slug)) bySlug.set(skill.slug, skill);
    }

    const requiredSlugs = ["task-skill-router", "paperclip"];
    const missing = requiredSlugs.filter((slug) => !bySlug.has(slug));
    if (missing.length > 0) {
      throw unprocessable(
        `Factory cannot propose work until these Company Skills are available: ${missing.join(", ")}`,
      );
    }

    const required = (slug: string) => toSkillReference(bySlug.get(slug)!);
    const optional = (slug: string) => {
      const skill = bySlug.get(slug);
      return skill ? toSkillReference(skill) : null;
    };
    const router = required("task-skill-router");
    const paperclip = required("paperclip");
    const summarizeStatus = optional("summarize-status");
    const planBreakdown = optional("paperclip-converting-plans-to-tasks");
    const memoryFiles = optional("para-memory-files");
    const baseline = uniqueSkills([paperclip, ...(summarizeStatus ? [summarizeStatus] : [])]);

    return {
      baseline,
      taskScoped: {
        plan: uniqueSkills([router, paperclip, ...(planBreakdown ? [planBreakdown] : [])]),
        implement: uniqueSkills([router, paperclip]),
        qa: uniqueSkills([router, paperclip]),
        document: uniqueSkills([router, paperclip, ...(memoryFiles ? [memoryFiles] : [])]),
      },
    };
  }

  async function prepareCatalogTemplateImport(input: {
    companyId: string;
    request: FactoryRequest;
  }): Promise<{
    importPlan: FactoryTemplateImportPlan;
    importRequest: CompanyPortabilityPreviewRequest;
    workspaceCwd: string;
  }> {
    const selection = input.request.templateSelection;
    if (!selection) throw conflict("Factory request does not select a catalog template.");
    const template = listCompanyTemplateCatalog().find((entry) => entry.id === selection.templateId) ?? null;
    if (!template) throw unprocessable(`Unknown Company Factory template: ${selection.templateId}`);
    if (!template.sourceUrl) {
      throw unprocessable(`Template ${template.name} does not expose an importable source package.`);
    }
    const importMode = template.importMode;
    if (importMode !== "direct" && importMode !== "review_only") {
      throw unprocessable(
        `Template ${template.name} is ${importMode} and cannot be applied as a whole-company import. Use the governed role-composition path instead.`,
      );
    }
    if (!input.request.workspaceCwd) {
      throw unprocessable("A catalog template import requires an existing absolute local workspace path for its paused Claude agents.");
    }
    const workspaceCwd = await validateWorkspaceCwd(input.request.workspaceCwd);
    const sourceCompany = await ensureCompany(input.companyId);
    const target: CompanyPortabilityPreviewRequest["target"] = selection.target === "new_company"
      ? {
        mode: "new_company",
        newCompanyName: selection.newCompanyName?.trim() || input.request.projectName,
      }
      : {
        mode: "existing_company",
        companyId: input.companyId,
      };
    const targetCompanyName = selection.target === "new_company"
      ? (selection.newCompanyName?.trim() || input.request.projectName)
      : sourceCompany.name;
    const importRequest: CompanyPortabilityPreviewRequest = {
      source: { type: "github", url: template.sourceUrl },
      include: {
        company: false,
        agents: true,
        projects: false,
        issues: false,
        skills: true,
      },
      target,
      agents: "all",
      collisionStrategy: "rename",
    };
    const preview = await portability.previewImport(importRequest, {
      mode: "agent_safe",
      sourceCompanyId: input.companyId,
      pauseAutomations: true,
    });
    if (preview.errors.length > 0) {
      throw unprocessable(`Template ${template.name} cannot be proposed safely: ${preview.errors.join("; ")}`);
    }
    const selectedAgentSlugs = preview.plan.agentPlans
      .filter((agentPlan) => agentPlan.action !== "skip")
      .map((agentPlan) => agentPlan.slug);
    if (selectedAgentSlugs.length === 0) {
      throw unprocessable(`Template ${template.name} contains no importable agents after the safe preview.`);
    }
    const relevantEnvInputs = preview.envInputs.filter((envInput) => (
      !envInput.projectSlug
      && (!envInput.agentSlug || selectedAgentSlugs.includes(envInput.agentSlug))
    ));
    const requiredEnvInputs = relevantEnvInputs.filter((envInput) => envInput.requirement === "required");
    if (requiredEnvInputs.length > 0) {
      throw unprocessable(
        `Template ${template.name} requires environment inputs that Factory will not bind automatically: ${requiredEnvInputs.map((envInput) => envInput.key).join(", ")}.`,
      );
    }
    const agentsWithPermissionGrants = preview.manifest.agents
      .filter((agent) => selectedAgentSlugs.includes(agent.slug) && agent.permissionGrants.length > 0);
    if (agentsWithPermissionGrants.length > 0) {
      throw unprocessable(
        `Template ${template.name} requests agent permission grants for ${agentsWithPermissionGrants.map((agent) => agent.slug).join(", ")}. Review and apply that template manually instead.`,
      );
    }

    return {
      workspaceCwd,
      importRequest,
      importPlan: {
        templateId: template.id,
        templateName: template.name,
        sourceUrl: template.sourceUrl,
        importMode,
        sourceDigest: sourceFilesDigest(preview.files),
        target: {
          mode: selection.target,
          companyId: selection.target === "current_company" ? input.companyId : null,
          companyName: targetCompanyName,
        },
        selectedAgentSlugs,
        selectedSkillCount: preview.manifest.skills.length,
        previewWarnings: [...preview.warnings],
        optionalEnvInputs: relevantEnvInputs
          .filter((envInput) => envInput.requirement === "optional")
          .map((envInput) => ({
            key: envInput.key,
            description: envInput.description,
            kind: envInput.kind,
            agentSlug: envInput.agentSlug,
          })),
      },
    };
  }

  async function buildCatalogImportProposal(input: {
    companyId: string;
    request: FactoryRequest;
  }): Promise<FactoryProposal> {
    const prepared = await prepareCatalogTemplateImport(input);
    const { importPlan } = prepared;
    return {
      version: 2,
      generatedAt: new Date().toISOString(),
      templateKey: FACTORY_CATALOG_IMPORT_TEMPLATE_KEY,
      recommendation: "import_catalog_template",
      rationale: [
        `${importPlan.templateName} was selected explicitly from the curated Company Template Catalog and passed an agent-safe, read-only preview.`,
        `The proposal pins the reviewed source snapshot as ${importPlan.sourceDigest}; a changed upstream package must be re-proposed before application.`,
        `The import will ${importPlan.target.mode === "new_company" ? `create a new company named "${importPlan.target.companyName}"` : `add a renamed, non-destructive copy to the current company "${importPlan.target.companyName}"`}.`,
        `All ${importPlan.selectedAgentSlugs.length} imported agents receive an explicit Claude Local ${FACTORY_DEFAULT_MODEL} configuration, start paused, and receive no credential values or agent/Skill creation permission.`,
        importPlan.importMode === "review_only"
          ? "This is a review-only source template: native Board approval is required and no external/security side effect is authorized by this proposal."
          : "The template is a curated direct import candidate, but native Board approval and all external-action controls remain required.",
      ],
      candidateProjects: [],
      project: {
        id: null,
        name: importPlan.target.companyName,
        description: input.request.projectDescription,
        workspaceCwd: prepared.workspaceCwd,
        willCreate: false,
        workspaceWillCreate: false,
      },
      team: [],
      taskGraph: [],
      sharedContext: null,
      catalogImport: importPlan,
      approval: {
        required: true,
        mechanism: "issue_thread_interaction",
        externalSideEffectsBlocked: true,
        summary: "A Board confirmation is required before Factory uses the safe portability importer. It never binds credentials, starts agents, or authorizes external side effects.",
      },
    };
  }

  function buildProposal(input: {
    request: FactoryRequest;
    activeProjects: Awaited<ReturnType<typeof projectsSvc.list>>;
    skills: FactorySkillInventory;
    sharedContext: FactorySharedContext;
  }): FactoryProposal {
    const requestedName = normalizedProjectName(input.request.projectName);
    const exactProject = input.activeProjects.find((project) => normalizedProjectName(project.name) === requestedName) ?? null;
    const candidateProjects: FactoryProjectCandidate[] = input.activeProjects
      .map((project) => ({
        id: project.id,
        name: project.name,
        primaryWorkspaceCwd: project.primaryWorkspace?.cwd ?? null,
        matchReason: exactProject?.id === project.id
          ? "Exact normalized project-name match; reuse is preferable to duplicating work."
          : "No exact normalized project-name match; it is not selected for this request.",
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 12);

    const recommendation = exactProject ? "reuse_existing_project" : "create_project_team" as const;
    const workspaceCwd = exactProject?.primaryWorkspace?.cwd ?? input.request.workspaceCwd;
    const roles: FactoryTeamRoleProposal[] = (Object.keys(FACTORY_ROLE_SPECS) as FactoryTeamRoleKey[]).map((key) => {
      const spec = FACTORY_ROLE_SPECS[key];
      return {
        key,
        name: factoryAgentName(input.request.projectName, key),
        role: spec.agentRole,
        title: spec.title,
        reportsTo: spec.reportsTo,
        baselineSkills: input.skills.baseline,
        managedInstructions: true,
        adapterType: "claude_local",
        model: FACTORY_DEFAULT_MODEL,
        startsPaused: true,
      };
    });
    const taskGraph: FactoryTaskProposal[] = FACTORY_TASK_SPECS.map((task) => ({
      key: task.key,
      title: task.title,
      ownerRole: task.ownerRole,
      dependsOn: task.dependsOn,
      taskScopedSkills: input.skills.taskScoped[task.key],
      requiredArtifacts: task.requiredArtifacts,
      qaGate: task.qaGate,
    }));
    const rationale = [
      "The Factory request is explicitly scoped to the current Paperclip company; no company, memory, connector, or artifact boundary is crossed.",
      exactProject
        ? `Active project \"${exactProject.name}\" exactly matches the requested project name, so the proposal reuses it instead of creating a duplicate.`
        : `No active project exactly matches \"${input.request.projectName}\", so the proposal creates one Claude Dev Agency project team.`,
      "The team contains a Claude PM, engineer, QA reviewer, and documentation role with managed instructions and only a minimal persistent Paperclip baseline.",
      "Every task names run-scoped Skills in its Task Skill Manifest; provisioned agents start paused and no task is started by this proposal.",
      input.sharedContext.rationale,
      "The QA task blocks the documentation handoff, and all external side effects remain outside this approval.",
    ];

    return {
      version: 2,
      generatedAt: new Date().toISOString(),
      templateKey: FACTORY_TEMPLATE_KEY,
      recommendation,
      rationale,
      candidateProjects,
      project: {
        id: exactProject?.id ?? null,
        name: exactProject?.name ?? input.request.projectName,
        description: exactProject?.description ?? input.request.projectDescription,
        workspaceCwd,
        willCreate: !exactProject,
        workspaceWillCreate: !exactProject || !exactProject.primaryWorkspace,
      },
      team: roles,
      taskGraph,
      sharedContext: input.sharedContext,
      catalogImport: null,
      approval: {
        required: true,
        mechanism: "issue_thread_interaction",
        externalSideEffectsBlocked: true,
        summary: "A Board confirmation is required before the Factory provisions internal Paperclip resources. This confirmation never authorizes external side effects.",
      },
    };
  }

  async function validateProposalSkills(companyId: string, proposal: FactoryProposal) {
    const available = new Set((await skillsSvc.list(companyId)).map((skill) => skill.id));
    const expected = proposal.taskGraph.flatMap((task) => task.taskScopedSkills)
      .concat(proposal.team.flatMap((role) => role.baselineSkills));
    const missing = uniqueSkills(expected).filter((skill) => !available.has(skill.id));
    if (missing.length > 0) {
      throw unprocessable(
        `Factory proposal references Company Skills that are no longer available: ${missing.map((skill) => skill.slug).join(", ")}`,
      );
    }
  }

  async function validateWorkspaceCwd(workspaceCwd: string | null): Promise<string> {
    if (!workspaceCwd) {
      throw unprocessable("Factory provisioning needs an absolute workspaceCwd or a reusable project with a primary workspace.");
    }
    if (!path.isAbsolute(workspaceCwd)) {
      throw unprocessable("Factory workspaceCwd must be an absolute local path.");
    }
    let details;
    try {
      details = await stat(workspaceCwd);
    } catch {
      throw unprocessable(`Factory workspace does not exist: ${workspaceCwd}`);
    }
    if (!details.isDirectory()) {
      throw unprocessable(`Factory workspace is not a directory: ${workspaceCwd}`);
    }
    return workspaceCwd;
  }

  // A fresh Factory workspace is only a directory on disk — createWorkspace writes
  // a DB row but never initializes git. claude_local (and other git-sensitive local
  // adapters) refuse to launch from a cwd without .git metadata, so the first run on
  // a brand-new Factory workspace would fail validation before the agent could do
  // anything. Initializing an empty repo here is idempotent and unblocks first run.
  // A directory that already has its own .git is left untouched.
  // NOTE: must mirror heartbeat's hasGitMetadata semantics (direct cwd/.git probe),
  // NOT `git rev-parse` — Factory workspaces commonly live inside the company
  // workspace git repo, so an upward walk would report "inside a work tree" for a
  // directory that still has no local .git and skip the init.
  async function ensureWorkspaceIsGitRepo(workspaceCwd: string): Promise<void> {
    const hasLocalGitMetadata = await lstat(path.resolve(workspaceCwd, ".git"))
      .then((entry) => entry.isDirectory() || entry.isFile())
      .catch(() => false);
    if (hasLocalGitMetadata) return;
    // Deliberately no user.name/email: the agent run will configure its own
    // committer identity for the commits it creates.
    await execFile("git", ["init", "-q"], { cwd: workspaceCwd });
  }

  async function createOrRecoverFactoryAgent(input: {
    request: FactoryRequest;
    proposal: FactoryProposal;
    role: FactoryTeamRoleKey;
    agentId: string;
    reportsTo: string | null;
    workspaceCwd: string;
    createdByUserId: string;
  }) {
    const spec = FACTORY_ROLE_SPECS[input.role];
    let agent = await agentsSvc.getById(input.agentId);
    let created = false;
    if (!agent) {
      agent = await agentsSvc.create(input.request.companyId, {
        id: input.agentId,
        name: factoryAgentName(input.proposal.project.name, input.role),
        role: spec.agentRole,
        title: spec.title,
        reportsTo: input.reportsTo,
        capabilities: spec.capabilities,
        adapterType: "claude_local",
        adapterConfig: {
          cwd: input.workspaceCwd,
          model: FACTORY_DEFAULT_MODEL,
          timeoutSec: FACTORY_RUN_TIMEOUT_SEC,
          maxTurnsPerRun: FACTORY_RUN_MAX_TURNS,
          dangerouslyBypassApprovalsAndSandbox: false,
          paperclipSkillSync: {
            desiredSkills: uniqueSkills(input.proposal.team.find((teamRole) => teamRole.key === input.role)?.baselineSkills ?? [])
              .map((skill) => skill.key),
          },
        },
        runtimeConfig: {
          heartbeat: {
            enabled: false,
            wakeOnDemand: true,
            maxConcurrentRuns: 1,
          },
        },
        budgetMonthlyCents: 0,
        spentMonthlyCents: 0,
        status: "paused",
        pauseReason: "system",
        pausedAt: new Date(),
        lastHeartbeatAt: null,
        permissions: {
          canCreateAgents: false,
          canCreateSkills: false,
        },
        metadata: {
          factoryRequestId: input.request.id,
          factoryTemplateKey: FACTORY_TEMPLATE_KEY,
          factoryTeamRole: input.role,
          provisionedByUserId: input.createdByUserId,
        },
      });
      created = true;
    }

    if (agent.companyId !== input.request.companyId) {
      throw conflict("Factory agent ID belongs to a different company.");
    }

    const files = await loadDefaultAgentInstructionsBundle("default");
    const materialized = await instructionsSvc.materializeManagedBundle(agent, {
      ...files,
      "AGENTS.md": `${files["AGENTS.md"] ?? ""}${factoryAgentInstructions({
        role: input.role,
        request: input.request,
        projectName: input.proposal.project.name,
      })}`,
    }, {
      entryFile: "AGENTS.md",
      replaceExisting: true,
      clearLegacyPromptTemplate: true,
    });
    const updated = await agentsSvc.update(agent.id, {
      adapterConfig: {
        ...materialized.adapterConfig,
        // A recovered Factory agent may predate the safer default. Reassert
        // only this execution control while preserving managed instructions
        // and an operator-configured model selection.
        dangerouslyBypassApprovalsAndSandbox: false,
      },
    });
    if (!updated) throw notFound("Factory agent not found after instruction materialization");
    return { agent: updated, created };
  }

  /**
   * The proposal review issue is the human-facing approval record for a
   * Factory request. Once the accepted proposal has actually been applied,
   * close that record as well so the Board does not retain a misleading
   * backlog item. This reconciliation is deliberately best-effort: an
   * already-persisted application must remain successful even if a later
   * issue-status write is temporarily unavailable. A repeated idempotent
   * apply retries the reconciliation below.
   */
  async function completeReviewIssueAfterApply(input: {
    companyId: string;
    request: FactoryRequest;
    actor: CompanyFactoryActor;
  }) {
    const reviewIssueId = input.request.reviewIssueId;
    if (!reviewIssueId) return;

    try {
      const reviewIssue = await issuesSvc.getById(reviewIssueId);
      if (
        !reviewIssue
        || reviewIssue.companyId !== input.companyId
        || reviewIssue.status === "done"
        || reviewIssue.status === "cancelled"
      ) {
        return;
      }

      const completed = await issuesSvc.update(reviewIssueId, { status: "done" });
      if (!completed) return;

      await logActivity(db, {
        companyId: input.companyId,
        actorType: "user",
        actorId: input.actor.userId,
        action: "company_factory.review_issue_completed",
        entityType: "issue",
        entityId: completed.id,
        details: {
          factoryRequestId: input.request.id,
          status: completed.status,
        },
      });
    } catch {
      // Reconciliation is retried by the idempotent apply path. Do not turn
      // an already persisted Factory application into a failed request.
    }
  }

  async function claimForApply(companyId: string, requestId: string): Promise<FactoryRequestRow> {
    return db.transaction(async (tx) => {
      const lockKey = `company-factory-apply:${companyId}:${requestId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const request = await tx
        .select()
        .from(companyFactoryRequests)
        .where(and(eq(companyFactoryRequests.companyId, companyId), eq(companyFactoryRequests.id, requestId)))
        .then((rows) => rows[0] ?? null);
      if (!request) throw notFound("Factory request not found");
      if (request.status === "applied") return request;
      if (!request.proposal || !request.reviewIssueId || !request.approvalInteractionId) {
        throw conflict("Factory request must be proposed before it can be applied.");
      }
      if (request.status === "applying" && Date.now() - request.updatedAt.getTime() < APPLY_RETRY_AFTER_MS) {
        throw conflict("Factory request is already being applied. Retry after its current provisioning lease expires.");
      }

      const interaction = await tx
        .select()
        .from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.id, request.approvalInteractionId))
        .then((rows) => rows[0] ?? null);
      if (
        !interaction
        || interaction.companyId !== companyId
        || interaction.issueId !== request.reviewIssueId
        || interaction.kind !== "request_confirmation"
      ) {
        throw conflict("Factory request approval interaction is missing or no longer matches its review issue.");
      }
      if (interaction.status === "rejected") {
        const [rejected] = await tx
          .update(companyFactoryRequests)
          .set({
            status: "rejected",
            failureReason: "The Board rejected the Factory proposal.",
            updatedAt: new Date(),
          })
          .where(eq(companyFactoryRequests.id, request.id))
          .returning();
        return rejected ?? request;
      }
      if (interaction.status !== "accepted") {
        throw conflict("Factory request requires an accepted Board confirmation before provisioning.");
      }

      const proposal = request.proposal as FactoryProposal;
      const resources = normalizeResources(request.appliedResources as FactoryAppliedResources | null);
      if (!proposal.catalogImport) {
        const projectId = resources.projectId
          ?? request.appliedProjectId
          ?? proposal.project.id
          ?? randomUUID();
        resources.projectId = projectId;
        for (const role of Object.keys(FACTORY_ROLE_SPECS) as FactoryTeamRoleKey[]) {
          resources.agentIds[role] ??= randomUUID();
        }
      }

      const [claimed] = await tx
        .update(companyFactoryRequests)
        .set({
          status: "applying",
          // `appliedProjectId` is a foreign key, so a newly generated project
          // ID must remain only in the retry-safe JSON manifest until the
          // project row has actually been inserted below.
          appliedProjectId: proposal.catalogImport
            ? null
            : request.appliedProjectId ?? proposal.project.id ?? null,
          appliedResources: resources,
          approvedAt: request.approvedAt ?? new Date(),
          failureReason: null,
          updatedAt: new Date(),
        })
        .where(eq(companyFactoryRequests.id, request.id))
        .returning();
      if (!claimed) throw notFound("Factory request not found");
      return claimed;
    });
  }

  async function applyCatalogTemplateImport(input: {
    companyId: string;
    request: FactoryRequest;
    proposal: FactoryProposal;
    actor: CompanyFactoryActor;
  }): Promise<FactoryRequest> {
    const importPlan = input.proposal.catalogImport;
    if (!importPlan) throw conflict("Factory proposal is not a catalog template import.");
    const resources = normalizeResources(input.request.appliedResources);
    let importedCompanyId = resources.importedCompanyId;

    if (!importedCompanyId) {
      const prepared = await prepareCatalogTemplateImport({
        companyId: input.companyId,
        request: input.request,
      });
      if (prepared.importPlan.sourceDigest !== importPlan.sourceDigest) {
        throw conflict(
          `The reviewed ${importPlan.templateName} package changed from ${importPlan.sourceDigest} to ${prepared.importPlan.sourceDigest}. Create a revised Factory proposal before importing it.`,
        );
      }
      const adapterOverrides = Object.fromEntries(
        prepared.importPlan.selectedAgentSlugs.map((slug) => [slug, {
          adapterType: "claude_local",
          adapterConfig: catalogImportAdapterConfig(prepared.workspaceCwd),
        }]),
      );
      const importInput: CompanyPortabilityImportRequest = {
        ...prepared.importRequest,
        adapterOverrides,
        // The importer also receives this option directly below. Keeping it in
        // the persisted-shaped input makes this safety property obvious to
        // callers and protects a future route-based invocation.
        pauseAutomations: true,
      };
      const imported = await portability.importBundle(importInput, input.actor.userId, {
        mode: "agent_safe",
        sourceCompanyId: input.companyId,
        pauseAutomations: true,
      });
      importedCompanyId = imported.company.id;
      resources.importedCompanyId = importedCompanyId;
      resources.importedAgentIds = Object.fromEntries(
        imported.agents
          .filter((agent) => agent.id)
          .map((agent) => [agent.slug, agent.id!]),
      );
      resources.templateImportWarnings = [...new Set([
        ...resources.templateImportWarnings,
        ...imported.warnings,
      ])];
      await persist(input.companyId, input.request.id, {
        status: "applying",
        appliedProjectId: null,
        appliedResources: resources,
        failureReason: null,
      });
      await logActivity(db, {
        companyId: input.companyId,
        actorType: "user",
        actorId: input.actor.userId,
        action: "company_factory.template_import_provisioned",
        entityType: "company_factory_request",
        entityId: input.request.id,
        details: {
          templateId: importPlan.templateId,
          sourceDigest: importPlan.sourceDigest,
          importedCompanyId,
          importedAgentIds: resources.importedAgentIds,
          warningCount: resources.templateImportWarnings.length,
          warnings: resources.templateImportWarnings,
        },
      });
    }

    const targetCompany = await ensureCompany(importedCompanyId);
    const workspaceCwd = await validateWorkspaceCwd(input.proposal.project.workspaceCwd);
    for (const [slug, agentId] of Object.entries(resources.importedAgentIds)) {
      const importedAgent = await agentsSvc.getById(agentId);
      if (!importedAgent) {
        throw conflict(`Factory imported agent ${slug} is missing; retry only after resolving the target-company state.`);
      }
      if (importedAgent.companyId !== targetCompany.id) {
        throw conflict(`Factory imported agent ${slug} belongs to a different company.`);
      }
      const existingAdapterConfig = importedAgent.adapterConfig && typeof importedAgent.adapterConfig === "object"
        && !Array.isArray(importedAgent.adapterConfig)
        ? importedAgent.adapterConfig as Record<string, unknown>
        : {};
      const existingRuntimeConfig = importedAgent.runtimeConfig && typeof importedAgent.runtimeConfig === "object"
        && !Array.isArray(importedAgent.runtimeConfig)
        ? importedAgent.runtimeConfig as Record<string, unknown>
        : {};
      const existingHeartbeat = existingRuntimeConfig.heartbeat && typeof existingRuntimeConfig.heartbeat === "object"
        && !Array.isArray(existingRuntimeConfig.heartbeat)
        ? existingRuntimeConfig.heartbeat as Record<string, unknown>
        : {};
      const safeAdapterConfig = {
        ...existingAdapterConfig,
        ...catalogImportAdapterConfig(workspaceCwd),
      };
      delete safeAdapterConfig.env;
      const updated = await agentsSvc.update(importedAgent.id, {
        adapterType: "claude_local",
        adapterConfig: safeAdapterConfig,
        runtimeConfig: {
          ...existingRuntimeConfig,
          heartbeat: {
            ...existingHeartbeat,
            enabled: false,
            wakeOnDemand: true,
            maxConcurrentRuns: 1,
          },
        },
        status: "paused",
        pauseReason: "system",
        pausedAt: new Date(),
        permissions: {
          canCreateAgents: false,
          canCreateSkills: false,
        },
        metadata: {
          ...(importedAgent.metadata ?? {}),
          factoryRequestId: input.request.id,
          factoryTemplateKey: FACTORY_CATALOG_IMPORT_TEMPLATE_KEY,
          factoryCatalogTemplateId: importPlan.templateId,
          factorySourceDigest: importPlan.sourceDigest,
          provisionedByUserId: input.actor.userId,
        },
      });
      if (!updated) throw notFound(`Factory imported agent ${slug} disappeared during safety normalization.`);
    }

    if (!input.request.reviewIssueId) {
      throw conflict("Factory template import has no review issue for its application manifest.");
    }
    const manifestBody = renderTemplateImportApplicationManifest({
      request: input.request,
      plan: importPlan,
      resources,
    });
    const existingManifest = await documentsSvc.getIssueDocumentByKey(
      input.request.reviewIssueId,
      "factory-template-import",
    );
    await documentsSvc.upsertIssueDocument({
      issueId: input.request.reviewIssueId,
      key: "factory-template-import",
      title: `Factory template import: ${importPlan.templateName}`,
      format: "markdown",
      body: manifestBody,
      changeSummary: "Factory template import application manifest",
      baseRevisionId: existingManifest?.latestRevisionId ?? null,
      createdByUserId: input.actor.userId,
    });

    const applied = await persist(input.companyId, input.request.id, {
      status: "applied",
      appliedProjectId: null,
      appliedResources: resources,
      appliedAt: new Date(),
      failureReason: null,
    });
    await completeReviewIssueAfterApply({ companyId: input.companyId, request: input.request, actor: input.actor });
    await logActivity(db, {
      companyId: input.companyId,
      actorType: "user",
      actorId: input.actor.userId,
      action: "company_factory.template_import_applied",
      entityType: "company_factory_request",
      entityId: input.request.id,
      details: {
        templateId: importPlan.templateId,
        sourceDigest: importPlan.sourceDigest,
        importedCompanyId,
        importedAgentIds: resources.importedAgentIds,
        warningCount: resources.templateImportWarnings.length,
        warnings: resources.templateImportWarnings,
      },
    });
    return toFactoryRequest(applied);
  }

  async function listReusableOutcomeRows(companyId: string): Promise<FactoryOutcomeRow[]> {
    return db
      .select()
      .from(companyFactoryOutcomes)
      .where(and(
        eq(companyFactoryOutcomes.companyId, companyId),
        eq(companyFactoryOutcomes.status, "approved"),
      ))
      .orderBy(desc(companyFactoryOutcomes.approvedAt), desc(companyFactoryOutcomes.updatedAt));
  }

  async function assertProposalSharedContextActive(companyId: string, proposal: FactoryProposal): Promise<void> {
    const sharedContext = proposal.sharedContext;
    if (!sharedContext || sharedContext.entries.length === 0) return;
    if (
      sharedContext.selectionPolicy !== "approved_unexpired_same_company_term_overlap"
      || sharedContext.entries.length > FACTORY_SHARED_CONTEXT_MAX_ENTRIES
    ) {
      throw conflict("Factory proposal has an invalid shared-context policy; create a revised proposal.");
    }
    const outcomeIds = [...new Set(sharedContext.entries.map((entry) => entry.outcomeId))];
    if (outcomeIds.length !== sharedContext.entries.length) {
      throw conflict("Factory proposal repeats a shared-context outcome; create a revised proposal.");
    }
    const outcomes = await db
      .select()
      .from(companyFactoryOutcomes)
      .where(and(
        eq(companyFactoryOutcomes.companyId, companyId),
        inArray(companyFactoryOutcomes.id, outcomeIds),
      ));
    const outcomesById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
    for (const entry of sharedContext.entries) {
      const current = outcomesById.get(entry.outcomeId);
      if (
        entry.sourceCompanyId !== companyId
        || !current
        || current.factoryRequestId !== entry.sourceFactoryRequestId
        || (current.projectId ?? null) !== entry.projectId
        || (current.templateId ?? null) !== entry.templateId
        || !outcomeActiveForReuse(current)
        || !current.approvedAt
        || current.approvedAt.toISOString() !== entry.approvedAt
        || (current.expiresAt?.toISOString() ?? null) !== entry.expiresAt
      ) {
        throw conflict("The reviewed company execution context changed, expired, or is no longer authorized. Create a revised Factory proposal before applying it.");
      }
    }
  }

  async function assessTemplateReuse(
    companyId: string,
    input: FactoryTemplateAssessmentInput,
  ): Promise<FactoryTemplateAssessment> {
    await ensureCompany(companyId);
    const [existingCompanies, outcomeRows] = await Promise.all([
      db
        .select({
          id: companies.id,
          name: companies.name,
          description: companies.description,
        })
        .from(companies)
        .orderBy(asc(companies.name)),
      listReusableOutcomeRows(companyId),
    ]);
    const outcomeEvidence: FactoryOutcomeScoringEvidence[] = outcomeRows
      .filter((outcome) => outcomeActiveForReuse(outcome))
      .flatMap((outcome) => outcome.approvedAt ? [{
        id: outcome.id,
        templateId: outcome.templateId ?? null,
        title: outcome.title,
        outcomeMarkdown: outcome.outcomeMarkdown,
        retrospectiveMarkdown: outcome.retrospectiveMarkdown,
        approvedAt: outcome.approvedAt,
        expiresAt: outcome.expiresAt ?? null,
      }] : []);
    return assessCompanyTemplateCatalog({ request: input, existingCompanies, outcomeEvidence });
  }

  return {
    listTemplates: (): CompanyTemplateCatalogEntry[] => listCompanyTemplateCatalog(),

    assessTemplates: async (
      companyId: string,
      input: FactoryTemplateAssessmentInput,
    ): Promise<FactoryTemplateAssessment> => assessTemplateReuse(companyId, input),

    intake: async (companyId: string, input: FactoryIntakeInput): Promise<FactoryIntakeResult> => {
      const businessRequest = input.businessRequest.trim();
      const title = deterministicIntakeTitle(businessRequest);
      const projectName = input.projectName?.trim() || title;
      const assessment = await assessTemplateReuse(companyId, {
        title,
        projectName,
        requestMarkdown: businessRequest,
      });
      const recommendedTemplate = assessment.recommendation.templateId
        ? assessment.templateCandidates.find((candidate) => candidate.template.id === assessment.recommendation.templateId)?.template ?? null
        : null;
      const suggestedTemplateSelection = assessment.recommendation.action === "import_template_new_company"
        && recommendedTemplate
        && (recommendedTemplate.importMode === "direct" || recommendedTemplate.importMode === "review_only")
        ? {
          templateId: recommendedTemplate.id,
          target: "new_company" as const,
          newCompanyName: projectName,
        }
        : null;
      const existingCompanyCandidate = assessment.recommendation.existingCompanyId
        ? assessment.existingCompanyCandidates.find((candidate) => candidate.companyId === assessment.recommendation.existingCompanyId) ?? null
        : null;
      return {
        interpretedAt: new Date().toISOString(),
        deterministic: true,
        businessRequest,
        normalizedRequest: {
          title,
          projectName,
          requestMarkdown: businessRequest,
          capabilitySignals: assessment.templateCandidates[0]?.matchedSignals ?? [],
          constraintSignals: deterministicConstraintSignals(businessRequest),
          interpretationNotes: [
            "This brief was normalized with deterministic text extraction; no LLM evaluator was called.",
            "The reuse assessment is read-only and does not create a company, agent, Skill, project, task, credential binding, or external action.",
            suggestedTemplateSelection
              ? `A ${recommendedTemplate?.importMode === "review_only" ? "review-only" : "direct"} template is suggested, but native Board approval is still required before any import.`
              : "No wholesale catalog import was selected automatically; the Board can choose the governed baseline or an explicit supported template.",
          ],
        },
        assessment,
        suggestedTemplateSelection,
        reuseBoundary: {
          existingCompanyId: existingCompanyCandidate?.companyId ?? null,
          automatedAttachment: false,
          rationale: existingCompanyCandidate
            ? `${existingCompanyCandidate.name} is a read-only reuse candidate. This intake does not attach work to another company because cross-company access delegation has not been approved.`
            : "No existing company is automatically attached. Cross-company reuse always requires an explicit access-controlled flow.",
        },
        governance: {
          createsResources: false,
          requiresApprovalForProvisioning: true,
          externalSideEffectsBlocked: true,
        },
      };
    },

    listOutcomes: async (companyId: string, options: { includeInactive?: boolean } = {}) => {
      await ensureCompany(companyId);
      const outcomes = await db
        .select()
        .from(companyFactoryOutcomes)
        .where(eq(companyFactoryOutcomes.companyId, companyId))
        .orderBy(desc(companyFactoryOutcomes.updatedAt), desc(companyFactoryOutcomes.createdAt));
      const mapped = outcomes.map(toFactoryOutcome);
      return options.includeInactive ? mapped : mapped.filter((outcome) => outcome.activeForReuse);
    },

    createOutcome: async (
      companyId: string,
      requestId: string,
      input: CreateFactoryOutcome,
      actor: CompanyFactoryActor,
    ): Promise<FactoryOutcomeRecord> => {
      const request = toFactoryRequest(await getOrThrow(companyId, requestId));
      const evidenceWorkProductIds = await assertOutcomeEvidenceEligible({
        companyId,
        request,
        evidenceWorkProductIds: input.evidenceWorkProductIds,
      });
      const now = new Date();
      const expiresAt = input.expiresAt === null
        ? null
        : input.expiresAt
          ? new Date(input.expiresAt)
          : new Date(now.getTime() + 180 * 24 * 60 * 60 * 1_000);
      if (expiresAt && expiresAt.getTime() <= now.getTime()) {
        throw unprocessable("Factory outcome reuse expiry must be in the future.");
      }
      const outcomeId = randomUUID();
      const reviewIssue = await issuesSvc.create(companyId, {
        projectId: request.appliedProjectId,
        title: `Factory outcome review: ${input.title.trim()}`,
        description: [
          "## Factory outcome review required",
          "",
          `Review whether **${input.title.trim()}** should become reusable company-local Factory memory.`,
          "Only same-company QA evidence is referenced; this review cannot share memory across companies or authorize external actions.",
        ].join("\n"),
        status: "backlog",
        priority: "medium",
        createdByUserId: actor.userId,
        idempotencyKey: `factory:${request.id}:outcome:${outcomeId}:review`,
        allowDuplicate: false,
      });
      const reviewDocument = (await documentsSvc.upsertIssueDocument({
        issueId: reviewIssue.id,
        key: "factory-outcome-review",
        title: `Factory outcome review: ${input.title.trim()}`,
        format: "markdown",
        body: renderOutcomeReviewDocument({ request, outcome: input, expiresAt }),
        changeSummary: "Submitted Factory outcome for Board review",
        baseRevisionId: null,
        createdByUserId: actor.userId,
      })).document;
      if (!reviewDocument.latestRevisionId) {
        throw conflict("Factory outcome review document did not receive a revision ID.");
      }
      const interaction = await interactionsSvc.create(
        { id: reviewIssue.id, companyId },
        {
          kind: "request_confirmation",
          idempotencyKey: `factory:${request.id}:outcome:${outcomeId}:approval`,
          title: `Promote Factory outcome: ${input.title.trim()}`,
          summary: "Approve company-local reuse of this QA-backed outcome and retrospective. Cross-company sharing remains blocked.",
          continuationPolicy: "none",
          payload: {
            version: 1,
            prompt: "Approve this QA-backed Factory outcome for company-local reuse scoring?",
            acceptLabel: "Approve outcome memory",
            rejectLabel: "Reject outcome memory",
            rejectRequiresReason: true,
            allowDeclineReason: true,
            detailsMarkdown: "Approval exposes this outcome only to authorized agents and projects in the current company. It does not share data across companies or authorize external actions.",
            supersedeOnUserComment: false,
            target: {
              type: "issue_document",
              issueId: reviewIssue.id,
              documentId: reviewDocument.id,
              key: "factory-outcome-review",
              revisionId: reviewDocument.latestRevisionId,
              revisionNumber: reviewDocument.latestRevisionNumber,
              label: "Factory outcome review",
            },
          },
        },
        { userId: actor.userId },
      );
      const [created] = await db
        .insert(companyFactoryOutcomes)
        .values({
          id: outcomeId,
          companyId,
          factoryRequestId: request.id,
          projectId: request.appliedProjectId,
          templateId: request.proposal?.catalogImport?.templateId ?? request.templateSelection?.templateId ?? null,
          title: input.title.trim(),
          outcomeMarkdown: input.outcomeMarkdown.trim(),
          retrospectiveMarkdown: input.retrospectiveMarkdown.trim(),
          evidenceWorkProductIds,
          status: "awaiting_review",
          reviewIssueId: reviewIssue.id,
          approvalInteractionId: interaction.id,
          createdByUserId: actor.userId,
          expiresAt,
        })
        .returning();
      if (!created) throw conflict("Factory outcome could not be created.");
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: actor.userId,
        action: "company_factory.outcome_submitted",
        entityType: "company_factory_outcome",
        entityId: created.id,
        details: {
          factoryRequestId: request.id,
          projectId: created.projectId ?? null,
          templateId: created.templateId ?? null,
          reviewIssueId: reviewIssue.id,
          approvalInteractionId: interaction.id,
          evidenceWorkProductIds,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
      });
      return toFactoryOutcome(created);
    },

    promoteOutcome: async (
      companyId: string,
      outcomeId: string,
      actor: CompanyFactoryActor,
    ): Promise<FactoryOutcomeRecord> => {
      const outcome = await getOutcomeOrThrow(companyId, outcomeId);
      if (outcome.status === "approved") return toFactoryOutcome(outcome);
      if (outcome.status === "rejected") return toFactoryOutcome(outcome);
      if (!outcome.reviewIssueId || !outcome.approvalInteractionId) {
        throw conflict("Factory outcome has no native review interaction.");
      }
      const interaction = await db
        .select()
        .from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.id, outcome.approvalInteractionId))
        .then((rows) => rows[0] ?? null);
      if (
        !interaction
        || interaction.companyId !== companyId
        || interaction.issueId !== outcome.reviewIssueId
        || interaction.kind !== "request_confirmation"
      ) {
        throw conflict("Factory outcome review interaction is missing or no longer matches its review issue.");
      }
      if (interaction.status === "rejected") {
        const [rejected] = await db
          .update(companyFactoryOutcomes)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(eq(companyFactoryOutcomes.id, outcome.id))
          .returning();
        return toFactoryOutcome(rejected ?? outcome);
      }
      if (interaction.status !== "accepted") {
        throw conflict("Factory outcome requires an accepted Board confirmation before it can be promoted.");
      }
      if (outcome.expiresAt && outcome.expiresAt.getTime() <= Date.now()) {
        throw conflict("Factory outcome expired before Board promotion; submit a refreshed outcome review.");
      }
      const request = toFactoryRequest(await getOrThrow(companyId, outcome.factoryRequestId));
      await assertOutcomeEvidenceEligible({
        companyId,
        request,
        evidenceWorkProductIds: outcome.evidenceWorkProductIds,
      });
      const [approved] = await db
        .update(companyFactoryOutcomes)
        .set({
          status: "approved",
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(companyFactoryOutcomes.id, outcome.id))
        .returning();
      if (!approved) throw notFound("Factory outcome not found");
      try {
        const reviewIssue = await issuesSvc.getById(outcome.reviewIssueId);
        if (reviewIssue && reviewIssue.companyId === companyId && reviewIssue.status !== "done" && reviewIssue.status !== "cancelled") {
          await issuesSvc.update(outcome.reviewIssueId, { status: "done" });
        }
      } catch {
        // An already approved record remains valid if review-issue reconciliation
        // is temporarily unavailable; a later promote retry can reconcile it.
      }
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: actor.userId,
        action: "company_factory.outcome_promoted",
        entityType: "company_factory_outcome",
        entityId: approved.id,
        details: {
          factoryRequestId: approved.factoryRequestId,
          projectId: approved.projectId ?? null,
          templateId: approved.templateId ?? null,
          evidenceWorkProductIds: approved.evidenceWorkProductIds,
          expiresAt: approved.expiresAt?.toISOString() ?? null,
        },
      });
      return toFactoryOutcome(approved);
    },

    list: async (companyId: string, options: { status?: FactoryRequestStatus } = {}) => {
      const conditions = [eq(companyFactoryRequests.companyId, companyId)];
      if (options.status) conditions.push(eq(companyFactoryRequests.status, options.status));
      const rows = await db
        .select()
        .from(companyFactoryRequests)
        .where(and(...conditions))
        .orderBy(desc(companyFactoryRequests.updatedAt), desc(companyFactoryRequests.createdAt));
      return rows.map(toFactoryRequest);
    },

    get: async (companyId: string, requestId: string) => {
      const request = await getRaw(companyId, requestId);
      return request ? toFactoryRequest(request) : null;
    },

    create: async (companyId: string, input: CreateFactoryRequest, actor: CompanyFactoryActor) => {
      await ensureCompany(companyId);
      const projectName = input.projectName?.trim() || input.title.trim();
      const workspaceCwd = input.workspaceCwd?.trim() || null;
      const templateSelection: FactoryCatalogTemplateSelection | null = input.templateSelection
        ? {
          templateId: input.templateSelection.templateId.trim(),
          target: input.templateSelection.target,
          newCompanyName: input.templateSelection.target === "new_company"
            ? (input.templateSelection.newCompanyName?.trim() || null)
            : null,
        }
        : null;
      if (workspaceCwd && !path.isAbsolute(workspaceCwd)) {
        throw unprocessable("Factory workspaceCwd must be an absolute local path.");
      }
      if (templateSelection && !workspaceCwd) {
        throw unprocessable("A catalog template request requires an absolute local workspace path for its paused Claude agents.");
      }
      if (templateSelection?.target === "new_company" && !actor.isInstanceAdmin) {
        throw forbidden("Creating a company from a Factory template requires an instance administrator.");
      }
      if (input.reviewProjectId) {
        const reviewProject = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, input.reviewProjectId), eq(projects.companyId, companyId)))
          .then((rows) => rows[0] ?? null);
        if (!reviewProject) {
          throw unprocessable("reviewProjectId must belong to the same company.");
        }
      }

      const values = {
        companyId,
        title: input.title.trim(),
        requestMarkdown: input.requestMarkdown.trim(),
        projectName,
        projectDescription: input.projectDescription?.trim() || null,
        workspaceCwd,
        templateSelection,
        reviewProjectId: input.reviewProjectId ?? null,
        status: "draft",
        idempotencyKey: input.idempotencyKey?.trim() || null,
        createdByAgentId: null,
        createdByUserId: actor.userId,
      } as const;
      const created = await db
        .insert(companyFactoryRequests)
        .values(values)
        .onConflictDoNothing()
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!created && values.idempotencyKey) {
        const existing = await db
          .select()
          .from(companyFactoryRequests)
          .where(and(
            eq(companyFactoryRequests.companyId, companyId),
            eq(companyFactoryRequests.idempotencyKey, values.idempotencyKey),
          ))
          .then((rows) => rows[0] ?? null);
        if (!existing) throw conflict("Factory request idempotency key could not be resolved.");
        if (
          existing.title !== values.title
          || existing.requestMarkdown !== values.requestMarkdown
          || existing.projectName !== values.projectName
          || (existing.workspaceCwd ?? null) !== values.workspaceCwd
          || JSON.stringify(existing.templateSelection ?? null) !== JSON.stringify(values.templateSelection)
        ) {
          throw conflict("Factory request idempotency key already exists for a different request.");
        }
        return toFactoryRequest(existing);
      }
      if (!created) throw conflict("Factory request could not be created.");

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: actor.userId,
        action: "company_factory.request_created",
        entityType: "company_factory_request",
        entityId: created.id,
        details: {
          projectName: created.projectName,
          idempotencyKey: created.idempotencyKey ?? null,
          workspaceBound: Boolean(created.workspaceCwd),
          templateId: templateSelection?.templateId ?? null,
          templateTarget: templateSelection?.target ?? null,
        },
      });
      return toFactoryRequest(created);
    },

    propose: async (companyId: string, requestId: string, actor: CompanyFactoryActor) => {
      const current = await getOrThrow(companyId, requestId);
      if (current.status === "applied" || current.status === "applying") return toFactoryRequest(current);
      if (current.proposal && current.status !== "draft" && current.status !== "rejected") {
        return toFactoryRequest(current);
      }

      const request = toFactoryRequest(current);
      if (request.templateSelection?.target === "new_company" && !actor.isInstanceAdmin) {
        throw forbidden("Creating a company from a Factory template requires an instance administrator.");
      }
      const proposal = request.templateSelection
        ? await buildCatalogImportProposal({ companyId, request })
        : (() => Promise.all([
          resolveSkillInventory(companyId),
          projectsSvc.list(companyId, { includeArchived: false }),
          listReusableOutcomeRows(companyId),
        ]).then(([skills, activeProjects, outcomes]) => buildProposal({
          request,
          activeProjects,
          skills,
          sharedContext: buildFactorySharedContext({ companyId, request, outcomes }),
        })))();
      const resolvedProposal = await proposal;
      const proposalRevision = current.proposalRevision + 1;
      const reviewIssue = await issuesSvc.create(companyId, {
        projectId: current.reviewProjectId ?? null,
        title: `Factory proposal: ${current.title}`,
        description: renderReviewIssueDescription({ request, proposal: resolvedProposal }),
        status: "backlog",
        priority: "high",
        createdByUserId: actor.userId,
        idempotencyKey: `factory:${current.id}:proposal:${proposalRevision}`,
        allowDuplicate: false,
      });
      const proposalBody = renderProposalDocument({ request, proposal: resolvedProposal });
      const existingPlan = await documentsSvc.getIssueDocumentByKey(reviewIssue.id, "plan");
      const proposalDocument = existingPlan && existingPlan.body === proposalBody
        ? existingPlan
        : (await documentsSvc.upsertIssueDocument({
          issueId: reviewIssue.id,
          key: "plan",
          title: `Factory proposal: ${current.title}`,
          format: "markdown",
          body: proposalBody,
          changeSummary: `Factory proposal revision ${proposalRevision}`,
          baseRevisionId: existingPlan?.latestRevisionId ?? null,
          createdByUserId: actor.userId,
        })).document;
      if (!proposalDocument.latestRevisionId) {
        throw conflict("Factory proposal document did not receive a revision ID.");
      }
      const interactionInput: Extract<CreateIssueThreadInteraction, { kind: "request_confirmation" }> = {
        kind: "request_confirmation",
        idempotencyKey: `factory:${current.id}:proposal:${proposalRevision}:approval`,
        title: `Approve Factory proposal: ${current.title}`,
        summary: resolvedProposal.catalogImport
          ? `Approve the reviewed ${resolvedProposal.catalogImport.templateName} template import. External side effects remain blocked.`
          : "Approve internal Claude Dev Agency provisioning. External side effects remain blocked.",
        continuationPolicy: "none",
        payload: {
          version: 1,
          prompt: resolvedProposal.catalogImport
            ? `Approve this Factory proposal to import the reviewed ${resolvedProposal.catalogImport.templateName} architecture with paused Claude agents and no credentials?`
            : "Approve this Factory proposal to provision the internal project, paused Claude roles, and QA-gated issue DAG?",
          acceptLabel: "Approve provisioning",
          rejectLabel: "Reject proposal",
          rejectRequiresReason: true,
          allowDeclineReason: true,
          detailsMarkdown: "Approval creates only internal Paperclip resources. It does not start agents or authorize publishing, purchasing, deployment, connector writes, credential movement, or destructive actions.",
          supersedeOnUserComment: false,
          target: {
            type: "issue_document",
            issueId: reviewIssue.id,
            documentId: proposalDocument.id,
            key: "plan",
            revisionId: proposalDocument.latestRevisionId,
            revisionNumber: proposalDocument.latestRevisionNumber,
            label: "Factory proposal",
          },
        },
      };
      const interaction = await interactionsSvc.create(
        { id: reviewIssue.id, companyId },
        interactionInput,
        { userId: actor.userId },
      );
      const updated = await persist(companyId, current.id, {
        status: "awaiting_approval",
        proposal: resolvedProposal,
        proposalRevision,
        reviewIssueId: reviewIssue.id,
        approvalInteractionId: interaction.id,
        failureReason: null,
      });
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: actor.userId,
        action: "company_factory.proposal_created",
        entityType: "company_factory_request",
        entityId: updated.id,
        details: {
          proposalRevision,
          recommendation: resolvedProposal.recommendation,
          reviewIssueId: reviewIssue.id,
          approvalInteractionId: interaction.id,
          templateKey: resolvedProposal.templateKey,
        },
      });
      return toFactoryRequest(updated);
    },

    apply: async (companyId: string, requestId: string, actor: CompanyFactoryActor) => {
      const claimed = await claimForApply(companyId, requestId);
      if (claimed.status === "applied") {
        const appliedRequest = toFactoryRequest(claimed);
        await completeReviewIssueAfterApply({ companyId, request: appliedRequest, actor });
        return appliedRequest;
      }
      if (claimed.status === "rejected") {
        throw conflict("The Board rejected this Factory proposal; create a revised proposal before applying it.");
      }

      const request = toFactoryRequest(claimed);
      const proposal = request.proposal;
      if (!proposal) throw conflict("Factory request has no proposal to apply.");
      if (proposal.catalogImport?.target.mode === "new_company" && !actor.isInstanceAdmin) {
        throw forbidden("Creating a company from a Factory template requires an instance administrator.");
      }

      try {
        if (proposal.catalogImport) {
          return await applyCatalogTemplateImport({ companyId, request, proposal, actor });
        }
        await validateProposalSkills(companyId, proposal);
        await assertProposalSharedContextActive(companyId, proposal);
        const resources = normalizeResources(request.appliedResources);
        const projectId = resources.projectId ?? request.appliedProjectId ?? proposal.project.id;
        if (!projectId) throw conflict("Factory request does not have a stable project ID.");

        let project = await projectsSvc.getById(projectId);
        let createdProject = false;
        if (!project) {
          if (!proposal.project.willCreate) {
            throw unprocessable("The proposed reusable project no longer exists. Create a revised Factory proposal.");
          }
          project = await projectsSvc.create(companyId, {
            id: projectId,
            name: proposal.project.name,
            description: proposal.project.description,
            status: "backlog",
          });
          createdProject = true;
        }
        if (project.companyId !== companyId) {
          throw conflict("Factory project ID belongs to a different company.");
        }

        if (createdProject) {
          await logActivity(db, {
            companyId,
            actorType: "user",
            actorId: actor.userId,
            action: "company_factory.project_provisioned",
            entityType: "project",
            entityId: project.id,
            details: { factoryRequestId: request.id, templateKey: proposal.templateKey },
          });
        }

        const existingFactoryWorkspace = await db
          .select()
          .from(projectWorkspaces)
          .where(and(
            eq(projectWorkspaces.companyId, companyId),
            eq(projectWorkspaces.projectId, project.id),
            eq(projectWorkspaces.sharedWorkspaceKey, `factory:${request.id}:primary`),
          ))
          .orderBy(asc(projectWorkspaces.createdAt))
          .then((rows) => rows[0] ?? null);
        let projectWorkspaceId = resources.projectWorkspaceId ?? existingFactoryWorkspace?.id ?? project.primaryWorkspace?.id ?? null;
        if (!projectWorkspaceId) {
          const workspaceCwd = await validateWorkspaceCwd(proposal.project.workspaceCwd);
          const workspace = await projectsSvc.createWorkspace(project.id, {
            name: "Factory primary workspace",
            sourceType: "local_path",
            cwd: workspaceCwd,
            sharedWorkspaceKey: `factory:${request.id}:primary`,
            metadata: {
              factoryRequestId: request.id,
              factoryTemplateKey: proposal.templateKey,
            },
            isPrimary: true,
          });
          if (!workspace) throw unprocessable("Factory could not create the requested project workspace.");
          projectWorkspaceId = workspace.id;
          // Brand-new Factory workspaces are empty directories; give them git
          // metadata so claude_local's first run passes workspace validation.
          await ensureWorkspaceIsGitRepo(workspaceCwd);
          await logActivity(db, {
            companyId,
            actorType: "user",
            actorId: actor.userId,
            action: "company_factory.workspace_provisioned",
            entityType: "project_workspace",
            entityId: workspace.id,
            details: { factoryRequestId: request.id, projectId: project.id },
          });
        }

        const workspaceCwd = await validateWorkspaceCwd(proposal.project.workspaceCwd ?? project.primaryWorkspace?.cwd ?? null);
        resources.projectId = project.id;
        resources.projectWorkspaceId = projectWorkspaceId;
        for (const role of Object.keys(FACTORY_ROLE_SPECS) as FactoryTeamRoleKey[]) {
          resources.agentIds[role] ??= randomUUID();
        }
        await persist(companyId, request.id, {
          appliedProjectId: project.id,
          appliedResources: resources,
        });

        const companyAgents = await agentsSvc.list(companyId);
        const companyCeo = companyAgents.find((agent) => agent.role === "ceo" && agent.status !== "terminated") ?? null;
        const pmId = resources.agentIds.project_manager;
        if (!pmId) throw conflict("Factory PM agent ID is missing.");
        const roleReportsTo: Record<FactoryTeamRoleKey, string | null> = {
          project_manager: companyCeo?.id ?? null,
          software_engineer: pmId,
          qa_reviewer: pmId,
          documentation: pmId,
        };
        const provisionedAgents: Partial<Record<FactoryTeamRoleKey, Awaited<ReturnType<typeof agentsSvc.getById>>>> = {};
        for (const role of Object.keys(FACTORY_ROLE_SPECS) as FactoryTeamRoleKey[]) {
          const agentId = resources.agentIds[role];
          if (!agentId) throw conflict(`Factory agent ID for ${role} is missing.`);
          const result = await createOrRecoverFactoryAgent({
            request,
            proposal,
            role,
            agentId,
            reportsTo: roleReportsTo[role],
            workspaceCwd,
            createdByUserId: actor.userId,
          });
          provisionedAgents[role] = result.agent;
          if (result.created) {
            await logActivity(db, {
              companyId,
              actorType: "user",
              actorId: actor.userId,
              action: "company_factory.agent_provisioned",
              entityType: "agent",
              entityId: result.agent.id,
              details: {
                factoryRequestId: request.id,
                factoryTeamRole: role,
                adapterType: result.agent.adapterType,
                startsPaused: result.agent.status === "paused",
              },
            });
          }
        }

        if (createdProject) {
          await projectsSvc.update(project.id, { leadAgentId: pmId });
          project = (await projectsSvc.getById(project.id)) ?? project;
        }

        for (const taskSpec of FACTORY_TASK_SPECS) {
          const task = proposal.taskGraph.find((candidate) => candidate.key === taskSpec.key);
          if (!task) throw conflict(`Factory proposal is missing task ${taskSpec.key}.`);
          const owner = provisionedAgents[task.ownerRole];
          if (!owner) throw conflict(`Factory task owner ${task.ownerRole} was not provisioned.`);
          const blockerIds = task.dependsOn.map((key) => resources.issueIds[key]).filter((id): id is string => Boolean(id));
          if (blockerIds.length !== task.dependsOn.length) {
            throw conflict(`Factory task ${task.key} is missing a dependency issue.`);
          }
          const issue = await issuesSvc.create(companyId, {
            projectId: project.id,
            projectWorkspaceId,
            title: `${project.name}: ${task.title}`,
            description: renderTaskDescription({
              request,
              task,
              definitionOfDone: taskSpec.definitionOfDone,
              sharedContext: proposal.sharedContext,
            }),
            status: "backlog",
            priority: taskSpec.priority,
            assigneeAgentId: owner.id,
            createdByUserId: actor.userId,
            blockedByIssueIds: blockerIds,
            idempotencyKey: `factory:${request.id}:task:${task.key}`,
            allowDuplicate: false,
          });
          const hadIssue = Boolean(resources.issueIds[task.key]);
          resources.issueIds[task.key] = issue.id;
          await persist(companyId, request.id, { appliedResources: resources });
          if (!hadIssue) {
            await logActivity(db, {
              companyId,
              actorType: "user",
              actorId: actor.userId,
              action: "company_factory.issue_provisioned",
              entityType: "issue",
              entityId: issue.id,
              details: {
                factoryRequestId: request.id,
                factoryTaskKey: task.key,
                assigneeAgentId: owner.id,
                blockerIssueIds: blockerIds,
                qaGate: task.qaGate,
              },
            });
          }
        }

        const qaIssueId = resources.issueIds.qa;
        if (!qaIssueId) throw conflict("Factory QA issue was not created.");
        const artifactExternalId = `factory:${request.id}:application-manifest`;
        let artifactId = await db
          .select({ id: issueWorkProducts.id })
          .from(issueWorkProducts)
          .where(and(
            eq(issueWorkProducts.companyId, companyId),
            eq(issueWorkProducts.issueId, qaIssueId),
            eq(issueWorkProducts.provider, "paperclip"),
            eq(issueWorkProducts.externalId, artifactExternalId),
          ))
          .then((rows) => rows[0]?.id ?? null);
        if (!artifactId) {
          const createdArtifact = await workProductsSvc.createForIssue(qaIssueId, companyId, {
            projectId: project.id,
            type: "document",
            provider: "paperclip",
            externalId: artifactExternalId,
            title: "Factory application manifest",
            status: "ready_for_review",
            reviewState: "needs_board_review",
            isPrimary: true,
            healthStatus: "healthy",
            summary: "Inspectable record that this Factory request created a paused Claude team and QA-gated issue graph. It is not a substitute for the QA verdict required by the QA task.",
            metadata: {
              factoryRequestId: request.id,
              factoryTemplateKey: proposal.templateKey,
              proposalIssueId: request.reviewIssueId,
              approvalInteractionId: request.approvalInteractionId,
              issueIds: resources.issueIds,
              agentIds: resources.agentIds,
            },
          });
          if (!createdArtifact) throw conflict("Factory could not create its QA evidence work product.");
          artifactId = createdArtifact.id;
          await logActivity(db, {
            companyId,
            actorType: "user",
            actorId: actor.userId,
            action: "company_factory.artifact_provisioned",
            entityType: "issue_work_product",
            entityId: artifactId,
            details: { factoryRequestId: request.id, issueId: qaIssueId, artifactExternalId },
          });
        }
        resources.artifactIds = [...new Set([...resources.artifactIds, artifactId])];

        const applied = await persist(companyId, request.id, {
          status: "applied",
          appliedProjectId: project.id,
          appliedResources: resources,
          appliedAt: new Date(),
          failureReason: null,
        });
        await completeReviewIssueAfterApply({ companyId, request, actor });
        await logActivity(db, {
          companyId,
          actorType: "user",
          actorId: actor.userId,
          action: "company_factory.applied",
          entityType: "company_factory_request",
          entityId: request.id,
          details: {
            projectId: project.id,
            projectWorkspaceId,
            agentCount: Object.keys(resources.agentIds).length,
            issueCount: Object.keys(resources.issueIds).length,
            artifactCount: resources.artifactIds.length,
          },
        });
        return toFactoryRequest(applied);
      } catch (error) {
        const status = error instanceof HttpError ? "blocked" : "failed";
        const failed = await persist(companyId, request.id, {
          status,
          failureReason: errorMessage(error),
        });
        await logActivity(db, {
          companyId,
          actorType: "user",
          actorId: actor.userId,
          action: "company_factory.apply_blocked",
          entityType: "company_factory_request",
          entityId: request.id,
          details: { status: failed.status, reason: failed.failureReason ?? null },
        });
        throw error;
      }
    },
  };
}
