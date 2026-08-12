export const FACTORY_REQUEST_STATUSES = [
  "draft",
  "awaiting_approval",
  "approved",
  "applying",
  "applied",
  "rejected",
  "blocked",
  "failed",
] as const;

export type FactoryRequestStatus = (typeof FACTORY_REQUEST_STATUSES)[number];

export const FACTORY_OUTCOME_STATUSES = [
  "awaiting_review",
  "approved",
  "rejected",
] as const;

export type FactoryOutcomeStatus = (typeof FACTORY_OUTCOME_STATUSES)[number];

export const FACTORY_RECOMMENDATIONS = [
  "reuse_existing_project",
  "create_project_team",
  "import_catalog_template",
] as const;

export type FactoryRecommendation = (typeof FACTORY_RECOMMENDATIONS)[number];

export const FACTORY_TEMPLATE_TARGETS = [
  "new_company",
  "current_company",
] as const;

export type FactoryTemplateTarget = (typeof FACTORY_TEMPLATE_TARGETS)[number];

/**
 * An explicit request-time choice to use one catalog architecture instead of
 * the built-in Codex Dev Agency kernel. The current company is the only
 * existing-company target in this first governed slice; cross-company access
 * delegation is intentionally a later capability.
 */
export interface FactoryCatalogTemplateSelection {
  templateId: string;
  target: FactoryTemplateTarget;
  newCompanyName: string | null;
}

export const COMPANY_TEMPLATE_CATEGORIES = [
  "baseline",
  "engineering",
  "research",
  "security",
  "product",
  "creative",
  "finance",
  "general",
] as const;

export type CompanyTemplateCategory = (typeof COMPANY_TEMPLATE_CATEGORIES)[number];

export const COMPANY_TEMPLATE_IMPORT_MODES = [
  "baseline",
  "direct",
  "curated_roles",
  "review_only",
  "catalog_only",
] as const;

export type CompanyTemplateImportMode = (typeof COMPANY_TEMPLATE_IMPORT_MODES)[number];

export const COMPANY_TEMPLATE_RECOMMENDATION_ACTIONS = [
  "reuse_existing_company",
  "import_template_new_company",
  "compose_template_roles",
  "create_baseline_company",
] as const;

export type CompanyTemplateRecommendationAction =
  (typeof COMPANY_TEMPLATE_RECOMMENDATION_ACTIONS)[number];

export interface CompanyTemplateCatalogEntry {
  id: string;
  name: string;
  description: string;
  sourceUrl: string | null;
  category: CompanyTemplateCategory;
  importMode: CompanyTemplateImportMode;
  expectedAgentCount: number;
  expectedSkillCount: number;
  requiresReview: boolean;
}

export interface FactoryTemplateCandidate {
  template: CompanyTemplateCatalogEntry;
  score: number;
  matchedSignals: string[];
  rationale: string;
  outcomeEvidence: Array<{
    outcomeId: string;
    title: string;
    matchedTerms: string[];
    scoreBoost: number;
    expiresAt: Date | null;
  }>;
}

export interface FactoryExistingCompanyCandidate {
  companyId: string;
  name: string;
  description: string | null;
  score: number;
  matchedSignals: string[];
  rationale: string;
}

export interface FactoryTemplateAssessment {
  generatedAt: string;
  inputSummary: string;
  templateCandidates: FactoryTemplateCandidate[];
  existingCompanyCandidates: FactoryExistingCompanyCandidate[];
  recommendation: {
    action: CompanyTemplateRecommendationAction;
    templateId: string | null;
    existingCompanyId: string | null;
    requiresApproval: true;
    externalSideEffectsBlocked: true;
    rationale: string;
  };
}

/**
 * Read-only, deterministic normalization of a single chat-style business brief
 * into the fields required by a governed Factory request. It deliberately does
 * not claim model reasoning or perform any provisioning.
 */
export interface FactoryIntakeResult {
  interpretedAt: string;
  deterministic: true;
  businessRequest: string;
  normalizedRequest: {
    title: string;
    projectName: string;
    requestMarkdown: string;
    capabilitySignals: string[];
    constraintSignals: string[];
    interpretationNotes: string[];
  };
  assessment: FactoryTemplateAssessment;
  suggestedTemplateSelection: FactoryCatalogTemplateSelection | null;
  reuseBoundary: {
    existingCompanyId: string | null;
    automatedAttachment: false;
    rationale: string;
  };
  governance: {
    createsResources: false;
    requiresApprovalForProvisioning: true;
    externalSideEffectsBlocked: true;
  };
}

/**
 * A preview-pinned importer plan included in a reviewable Factory proposal.
 * `sourceDigest` prevents a mutable upstream branch from changing between
 * Board approval and application without a new proposal.
 */
export interface FactoryTemplateImportPlan {
  templateId: string;
  templateName: string;
  sourceUrl: string;
  importMode: Extract<CompanyTemplateImportMode, "direct" | "review_only">;
  sourceDigest: string;
  target: {
    mode: FactoryTemplateTarget;
    companyId: string | null;
    companyName: string;
  };
  selectedAgentSlugs: string[];
  selectedSkillCount: number;
  previewWarnings: string[];
  optionalEnvInputs: Array<{
    key: string;
    description: string | null;
    kind: "secret" | "plain";
    agentSlug: string | null;
  }>;
}

export const FACTORY_TEAM_ROLE_KEYS = [
  "project_manager",
  "software_engineer",
  "qa_reviewer",
  "documentation",
] as const;

export type FactoryTeamRoleKey = (typeof FACTORY_TEAM_ROLE_KEYS)[number];

export const FACTORY_TASK_KEYS = [
  "plan",
  "implement",
  "qa",
  "document",
] as const;

export type FactoryTaskKey = (typeof FACTORY_TASK_KEYS)[number];

export interface FactorySkillReference {
  id: string;
  key: string;
  slug: string;
}

export interface FactoryProjectCandidate {
  id: string;
  name: string;
  matchReason: string;
  primaryWorkspaceCwd: string | null;
}

export interface FactoryTeamRoleProposal {
  key: FactoryTeamRoleKey;
  name: string;
  role: "pm" | "engineer" | "qa" | "general";
  title: string;
  reportsTo: FactoryTeamRoleKey | "company_ceo" | null;
  baselineSkills: FactorySkillReference[];
  managedInstructions: true;
  adapterType: "claude_local" | "codex_local";
  model: string;
  startsPaused: true;
}

export interface FactoryTaskProposal {
  key: FactoryTaskKey;
  title: string;
  ownerRole: FactoryTeamRoleKey;
  dependsOn: FactoryTaskKey[];
  taskScopedSkills: FactorySkillReference[];
  requiredArtifacts: string[];
  qaGate: boolean;
}

/**
 * A proposal-pinned, read-only snapshot of approved company-local delivery
 * learning. It is intentionally task context rather than a permanent agent
 * prompt or cross-company memory primitive.
 */
export interface FactorySharedContextEntry {
  outcomeId: string;
  sourceCompanyId: string;
  sourceFactoryRequestId: string;
  projectId: string | null;
  templateId: string | null;
  title: string;
  matchedTerms: string[];
  evidenceWorkProductIds: string[];
  outcomeExcerpt: string;
  retrospectiveExcerpt: string;
  approvedAt: string;
  expiresAt: string | null;
}

export interface FactorySharedContext {
  selectionPolicy: "approved_unexpired_same_company_term_overlap";
  generatedAt: string;
  entries: FactorySharedContextEntry[];
  rationale: string;
}

export interface FactoryProposal {
  version: 1 | 2;
  generatedAt: string;
  templateKey: "codex_dev_agency" | "catalog_company_import";
  recommendation: FactoryRecommendation;
  rationale: string[];
  candidateProjects: FactoryProjectCandidate[];
  project: {
    id: string | null;
    name: string;
    description: string | null;
    workspaceCwd: string | null;
    willCreate: boolean;
    workspaceWillCreate: boolean;
  };
  team: FactoryTeamRoleProposal[];
  taskGraph: FactoryTaskProposal[];
  sharedContext: FactorySharedContext | null;
  catalogImport: FactoryTemplateImportPlan | null;
  approval: {
    required: true;
    mechanism: "issue_thread_interaction";
    externalSideEffectsBlocked: true;
    summary: string;
  };
}

export interface FactoryAppliedResources {
  projectId: string | null;
  projectWorkspaceId: string | null;
  agentIds: Partial<Record<FactoryTeamRoleKey, string>>;
  issueIds: Partial<Record<FactoryTaskKey, string>>;
  artifactIds: string[];
  importedCompanyId: string | null;
  importedAgentIds: Record<string, string>;
  templateImportWarnings: string[];
}

/**
 * A human-reviewed, company-local record that lets later Factory assessments
 * reuse only evidence that has passed the original delivery's QA and outcome
 * review controls. It is intentionally not a cross-company memory primitive.
 */
export interface FactoryOutcomeRecord {
  id: string;
  companyId: string;
  factoryRequestId: string;
  projectId: string | null;
  templateId: string | null;
  title: string;
  outcomeMarkdown: string;
  retrospectiveMarkdown: string;
  evidenceWorkProductIds: string[];
  status: FactoryOutcomeStatus;
  activeForReuse: boolean;
  reviewIssueId: string | null;
  approvalInteractionId: string | null;
  createdByUserId: string | null;
  approvedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FactoryOutcomeScoringEvidence {
  id: string;
  templateId: string | null;
  title: string;
  outcomeMarkdown: string;
  retrospectiveMarkdown: string;
  approvedAt: Date;
  expiresAt: Date | null;
}

export interface FactoryRequest {
  id: string;
  companyId: string;
  title: string;
  requestMarkdown: string;
  projectName: string;
  projectDescription: string | null;
  workspaceCwd: string | null;
  templateSelection: FactoryCatalogTemplateSelection | null;
  reviewProjectId: string | null;
  status: FactoryRequestStatus;
  proposal: FactoryProposal | null;
  proposalRevision: number;
  reviewIssueId: string | null;
  approvalInteractionId: string | null;
  appliedProjectId: string | null;
  appliedResources: FactoryAppliedResources | null;
  idempotencyKey: string | null;
  failureReason: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  approvedAt: Date | null;
  appliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
