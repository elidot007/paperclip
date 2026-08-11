import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Building2, CheckCircle2, ExternalLink, FileText, LibraryBig, Loader2, Settings2, ShieldCheck, Sparkles } from "lucide-react";
import type {
  CompanyTemplateCatalogEntry,
  CreateFactoryOutcome,
  FactoryOutcomeRecord,
  FactoryIntakeResult,
  FactoryRequest,
  FactoryRequestStatus,
  FactoryTemplateAssessment,
  FactoryTemplateTarget,
} from "@paperclipai/shared";
import { companyFactoryApi } from "../api/companyFactory";
import { ApiError } from "../api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { NavLink } from "../lib/router";
import { queryKeys } from "../lib/queryKeys";

type Draft = {
  title: string;
  requestMarkdown: string;
  projectName: string;
  projectDescription: string;
  workspaceCwd: string;
  templateId: string;
  templateTarget: FactoryTemplateTarget;
  newCompanyName: string;
};

type OutcomeDraft = {
  title: string;
  outcomeMarkdown: string;
  retrospectiveMarkdown: string;
  evidenceWorkProductIds: string;
  expiresAt: string;
};

const EMPTY_OUTCOME_DRAFT: OutcomeDraft = {
  title: "",
  outcomeMarkdown: "",
  retrospectiveMarkdown: "",
  evidenceWorkProductIds: "",
  expiresAt: "",
};

const EMPTY_DRAFT: Draft = {
  title: "",
  requestMarkdown: "",
  projectName: "",
  projectDescription: "",
  workspaceCwd: "",
  templateId: "",
  templateTarget: "new_company",
  newCompanyName: "",
};

function statusBadgeVariant(status: FactoryRequestStatus) {
  if (status === "applied") return "default" as const;
  if (status === "rejected" || status === "failed") return "destructive" as const;
  if (status === "blocked") return "outline" as const;
  return "secondary" as const;
}

function requestStatusLabel(status: FactoryRequestStatus) {
  return status.replaceAll("_", " ");
}

function requestErrorMessage(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "The Factory request could not be completed.";
}

export function CompanyFactory() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [intakeBrief, setIntakeBrief] = useState("");
  const [intakeResult, setIntakeResult] = useState<FactoryIntakeResult | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Company Factory" }]);
  }, [setBreadcrumbs]);

  const requestsQuery = useQuery({
    queryKey: queryKeys.companyFactory.requests(selectedCompanyId!),
    queryFn: () => companyFactoryApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
  const templatesQuery = useQuery({
    queryKey: queryKeys.companyFactory.templates(selectedCompanyId!),
    queryFn: () => companyFactoryApi.listTemplates(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
  const outcomesQuery = useQuery({
    queryKey: queryKeys.companyFactory.outcomes(selectedCompanyId!, true),
    queryFn: () => companyFactoryApi.listOutcomes(selectedCompanyId!, true),
    enabled: Boolean(selectedCompanyId),
  });
  const requests = requestsQuery.data ?? [];
  const outcomes = outcomesQuery.data ?? [];
  const importableTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((template) => template.importMode === "direct" || template.importMode === "review_only"),
    [templatesQuery.data],
  );
  const selectedCatalogTemplate = useMemo(
    () => importableTemplates.find((template) => template.id === draft.templateId) ?? null,
    [draft.templateId, importableTemplates],
  );
  const selected = useMemo(
    () => requests.find((item) => item.id === selectedRequestId) ?? requests[0] ?? null,
    [requests, selectedRequestId],
  );
  const refresh = async () => {
    if (!selectedCompanyId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.companyFactory.requests(selectedCompanyId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.companyFactory.outcomes(selectedCompanyId, true) });
  };

  const createProposal = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) throw new Error("Select a company before creating a Factory request.");
      const created = await companyFactoryApi.create(selectedCompanyId, {
        title: draft.title.trim(),
        requestMarkdown: draft.requestMarkdown.trim(),
        projectName: draft.projectName.trim() || undefined,
        projectDescription: draft.projectDescription.trim() || null,
        workspaceCwd: draft.workspaceCwd.trim() || null,
        templateSelection: selectedCatalogTemplate
          ? {
            templateId: selectedCatalogTemplate.id,
            target: draft.templateTarget,
            newCompanyName: draft.templateTarget === "new_company" ? (draft.newCompanyName.trim() || null) : null,
          }
          : null,
      });
      return companyFactoryApi.propose(selectedCompanyId, created.id);
    },
    onSuccess: async (request) => {
      setSelectedRequestId(request.id);
      setDraft(EMPTY_DRAFT);
      setErrorText(null);
      await refresh();
    },
    onError: (error) => setErrorText(requestErrorMessage(error)),
  });

  const assessTemplates = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) throw new Error("Select a company before assessing reusable templates.");
      return companyFactoryApi.assessTemplates(selectedCompanyId, {
        title: draft.title.trim() || undefined,
        requestMarkdown: draft.requestMarkdown.trim(),
        projectName: draft.projectName.trim() || undefined,
      });
    },
    onSuccess: () => setErrorText(null),
    onError: (error) => setErrorText(requestErrorMessage(error)),
  });

  const intake = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) throw new Error("Select a company before using Factory chat intake.");
      return companyFactoryApi.intake(selectedCompanyId, {
        businessRequest: intakeBrief.trim(),
        projectName: draft.projectName.trim() || undefined,
      });
    },
    onSuccess: (result) => {
      setIntakeResult(result);
      setDraft((current) => ({
        ...current,
        title: result.normalizedRequest.title,
        projectName: result.normalizedRequest.projectName,
        requestMarkdown: result.normalizedRequest.requestMarkdown,
        templateId: result.suggestedTemplateSelection?.templateId ?? "",
        templateTarget: result.suggestedTemplateSelection?.target ?? "new_company",
        newCompanyName: result.suggestedTemplateSelection?.newCompanyName ?? "",
      }));
      setErrorText(null);
    },
    onError: (error) => setErrorText(requestErrorMessage(error)),
  });

  const propose = useMutation({
    mutationFn: async (requestId: string) => {
      if (!selectedCompanyId) throw new Error("Select a company before proposing a Factory request.");
      return companyFactoryApi.propose(selectedCompanyId, requestId);
    },
    onSuccess: async (request) => {
      setSelectedRequestId(request.id);
      setErrorText(null);
      await refresh();
    },
    onError: (error) => setErrorText(requestErrorMessage(error)),
  });

  const apply = useMutation({
    mutationFn: async (requestId: string) => {
      if (!selectedCompanyId) throw new Error("Select a company before applying a Factory proposal.");
      return companyFactoryApi.apply(selectedCompanyId, requestId);
    },
    onSuccess: async (request) => {
      setSelectedRequestId(request.id);
      setErrorText(null);
      await refresh();
    },
    onError: (error) => setErrorText(requestErrorMessage(error)),
  });

  const createOutcome = useMutation({
    mutationFn: async (input: { requestId: string; data: CreateFactoryOutcome }) => {
      if (!selectedCompanyId) throw new Error("Select a company before submitting Factory outcome memory.");
      return companyFactoryApi.createOutcome(selectedCompanyId, input.requestId, input.data);
    },
    onSuccess: async () => {
      setErrorText(null);
      await refresh();
    },
    onError: (error) => setErrorText(requestErrorMessage(error)),
  });

  const promoteOutcome = useMutation({
    mutationFn: async (outcomeId: string) => {
      if (!selectedCompanyId) throw new Error("Select a company before promoting Factory outcome memory.");
      return companyFactoryApi.promoteOutcome(selectedCompanyId, outcomeId);
    },
    onSuccess: async () => {
      setErrorText(null);
      await refresh();
    },
    onError: (error) => setErrorText(requestErrorMessage(error)),
  });

  if (!selectedCompanyId) {
    return (
      <div className="mx-auto w-full max-w-5xl py-8 text-sm text-muted-foreground">
        Select a company to create a governed Factory proposal.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-10">
      <section data-testid="company-factory-hero" className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Sparkles className="h-4 w-4" />
              Governed Codex-first delivery
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Company Factory</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Turn a Board request into a reviewable proposal. The Factory creates only internal Paperclip resources after approval; agents start paused and external actions remain blocked.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
              <span>New Factory roles default to <strong className="font-medium text-foreground">GPT-5.6 Luna</strong>.</span>
              <NavLink data-testid="factory-manage-agent-models" to="/agents/all" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                <Settings2 className="h-3.5 w-3.5" /> Manage agent models and secret bindings
              </NavLink>
            </div>
          </div>
          <Badge variant="outline">Phase 1</Badge>
        </div>
      </section>

      <FactoryChatIntake
        brief={intakeBrief}
        result={intakeResult}
        loading={intake.isPending}
        onBriefChange={setIntakeBrief}
        onSubmit={() => intake.mutate()}
      />

      <TemplateCatalogAssessment
        templates={templatesQuery.data ?? []}
        loading={templatesQuery.isLoading}
        assessment={assessTemplates.data ?? intakeResult?.assessment ?? null}
        assessing={assessTemplates.isPending}
        canAssess={Boolean(draft.requestMarkdown.trim())}
        onAssess={() => assessTemplates.mutate()}
        onSelectTemplate={(templateId) => setDraft((current) => ({ ...current, templateId }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Create a request and proposal</CardTitle>
          <CardDescription>
            Give the Factory a company-scoped outcome and an existing local workspace. It will propose reuse, the governed Codex Dev Agency kernel, or a reviewed curated company template before creating anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="factory-title">Request title</Label>
              <Input
                id="factory-title"
                value={draft.title}
                maxLength={240}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Ship a reviewed product increment"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="factory-project-name">Project name</Label>
              <Input
                id="factory-project-name"
                value={draft.projectName}
                maxLength={240}
                onChange={(event) => setDraft((current) => ({ ...current, projectName: event.target.value }))}
                placeholder="Defaults to the request title"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="factory-request">Outcome, deliverables, constraints, and Definition of Done</Label>
            <Textarea
              id="factory-request"
              value={draft.requestMarkdown}
              className="min-h-36"
              maxLength={100_000}
              onChange={(event) => setDraft((current) => ({ ...current, requestMarkdown: event.target.value }))}
              placeholder="Describe the desired outcome, scope limits, acceptance criteria, and risks."
            />
          </div>
          <div className="space-y-2" data-testid="factory-template-choice">
            <Label htmlFor="factory-template">Provisioning architecture</Label>
            <select
              id="factory-template"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={draft.templateId}
              onChange={(event) => setDraft((current) => ({ ...current, templateId: event.target.value }))}
              disabled={templatesQuery.isLoading}
            >
              <option value="">Governed Codex Dev Agency kernel (default)</option>
              {importableTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} · {template.importMode === "review_only" ? "review-only import" : "direct import"}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Catalog import stays read-only until native approval. It imports only agents and Skills, never credentials, projects, tasks, routines, or external actions.
            </p>
          </div>
          {selectedCatalogTemplate ? (
            <div className="grid gap-4 rounded-lg border bg-muted/20 p-4 md:grid-cols-2" data-testid="factory-template-target">
              <div className="space-y-2">
                <Label htmlFor="factory-template-target">Import target</Label>
                <select
                  id="factory-template-target"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={draft.templateTarget}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    templateTarget: event.target.value as FactoryTemplateTarget,
                  }))}
                >
                  <option value="new_company">Create a new company</option>
                  <option value="current_company">Import into this company (renamed, non-destructive)</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  {selectedCatalogTemplate.importMode === "review_only"
                    ? "This review-only template always requires a Board approval and retains every importer warning."
                    : "Every imported agent will be configured for GPT-5.6 Luna, paused, and unable to create agents or Skills."}
                </p>
              </div>
              {draft.templateTarget === "new_company" ? (
                <div className="space-y-2">
                  <Label htmlFor="factory-new-company-name">New company name</Label>
                  <Input
                    id="factory-new-company-name"
                    value={draft.newCompanyName}
                    maxLength={240}
                    onChange={(event) => setDraft((current) => ({ ...current, newCompanyName: event.target.value }))}
                    placeholder="Defaults to the project name"
                  />
                  <p className="text-xs text-muted-foreground">The current Factory company’s active Board memberships are copied by the safe importer; no cross-company target can be selected here.</p>
                </div>
              ) : (
                <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
                  The template is added only to this company. Existing agents are not overwritten: the importer uses rename-on-conflict behavior.
                </div>
              )}
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="factory-workspace">Local workspace path</Label>
              <Input
                id="factory-workspace"
                value={draft.workspaceCwd}
                maxLength={4096}
                onChange={(event) => setDraft((current) => ({ ...current, workspaceCwd: event.target.value }))}
                placeholder="/absolute/path/to/workspace"
              />
              <p className="text-xs text-muted-foreground">
                {selectedCatalogTemplate
                  ? "Required: this existing absolute path becomes the paused Codex workspace for every imported agent."
                  : "Required for a new project. A reusable project can use its existing primary workspace."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="factory-description">Project description</Label>
              <Textarea
                id="factory-description"
                value={draft.projectDescription}
                className="min-h-20"
                maxLength={20_000}
                onChange={(event) => setDraft((current) => ({ ...current, projectDescription: event.target.value }))}
                placeholder="Optional project context"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              data-testid="factory-create-proposal"
              onClick={() => createProposal.mutate()}
              disabled={createProposal.isPending || !draft.title.trim() || !draft.requestMarkdown.trim() || Boolean(selectedCatalogTemplate && !draft.workspaceCwd.trim())}
            >
              {createProposal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Create reviewable proposal
            </Button>
            <span className="text-xs text-muted-foreground">No project, agent, Skill, credential binding, or task is created at this step.</span>
          </div>
        </CardContent>
      </Card>

      {errorText ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorText}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.8fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Requests</CardTitle>
            <CardDescription>{requests.length} recorded proposal{requests.length === 1 ? "" : "s"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {requestsQuery.isLoading ? <div className="text-sm text-muted-foreground">Loading requests…</div> : null}
            {requestsQuery.isError ? <div className="text-sm text-destructive">Could not load Factory requests.</div> : null}
            {requests.map((request) => (
              <button
                key={request.id}
                type="button"
                onClick={() => setSelectedRequestId(request.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${selected?.id === request.id ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-sm font-medium">{request.title}</span>
                  <Badge variant={statusBadgeVariant(request.status)}>{requestStatusLabel(request.status)}</Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{request.projectName}</div>
              </button>
            ))}
            {!requestsQuery.isLoading && requests.length === 0 ? (
              <div data-testid="factory-empty-state" className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No Factory requests yet.</div>
            ) : null}
          </CardContent>
        </Card>

        <FactoryRequestDetail
          request={selected}
          outcomes={selected ? outcomes.filter((outcome) => outcome.factoryRequestId === selected.id) : []}
          proposing={propose.isPending}
          applying={apply.isPending}
          creatingOutcome={createOutcome.isPending}
          promotingOutcome={promoteOutcome.isPending}
          onPropose={() => selected && propose.mutate(selected.id)}
          onApply={() => selected && apply.mutate(selected.id)}
          onCreateOutcome={(requestId, data) => createOutcome.mutate({ requestId, data })}
          onPromoteOutcome={(outcomeId) => promoteOutcome.mutate(outcomeId)}
        />
      </div>
    </div>
  );
}

function FactoryChatIntake(input: {
  brief: string;
  result: FactoryIntakeResult | null;
  loading: boolean;
  onBriefChange: (brief: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Card data-testid="factory-chat-intake">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary"><Sparkles className="h-4 w-4" /> Chat-first Factory intake</div>
            <CardTitle className="mt-2">Describe the business outcome in one message</CardTitle>
            <CardDescription className="mt-1 max-w-3xl">
              The Factory turns your brief into an editable governed request, compares company/template reuse options, and never creates anything at this stage.
            </CardDescription>
          </div>
          <Badge variant="outline">deterministic · read-only</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          data-testid="factory-chat-brief"
          value={input.brief}
          className="min-h-28"
          maxLength={100_000}
          onChange={(event) => input.onBriefChange(event.target.value)}
          placeholder="For example: We need a secure contract-audit delivery team. Reuse proven work where safe, create a new company only if needed, keep credentials and external actions blocked, and require QA evidence."
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            data-testid="factory-chat-intake-submit"
            variant="outline"
            onClick={input.onSubmit}
            disabled={input.loading || !input.brief.trim()}
          >
            {input.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Understand and prefill proposal
          </Button>
          <span className="text-xs text-muted-foreground">No LLM is called in this initial interpreter. Edit the populated fields before creating the separate reviewable proposal.</span>
        </div>
        {input.result ? (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm" data-testid="factory-chat-intake-result">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">Interpreted request: {input.result.normalizedRequest.title}</div>
              <Badge variant="secondary">approval required · external actions blocked</Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-muted-foreground">Capability signals</div>
                <div className="mt-1 text-sm">{input.result.normalizedRequest.capabilitySignals.length > 0 ? input.result.normalizedRequest.capabilitySignals.join(" · ") : "No strong catalog capability signal; start from the governed baseline."}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Constraint signals</div>
                <div className="mt-1 text-sm">{input.result.normalizedRequest.constraintSignals.length > 0 ? input.result.normalizedRequest.constraintSignals.join(" · ") : "No explicit constraint keyword was extracted; review the full brief before proposing."}</div>
              </div>
            </div>
            {input.result.suggestedTemplateSelection ? (
              <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                Suggested editable import choice: <strong className="text-foreground">{input.result.suggestedTemplateSelection.templateId}</strong> into a new company. The source is still previewed and snapshot-pinned only during proposal creation.
              </div>
            ) : null}
            <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">{input.result.reuseBoundary.rationale}</div>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {input.result.normalizedRequest.interpretationNotes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function recommendationActionLabel(action: FactoryTemplateAssessment["recommendation"]["action"]) {
  switch (action) {
    case "reuse_existing_company":
      return "Reuse an existing company";
    case "import_template_new_company":
      return "Propose a new company from a template";
    case "compose_template_roles":
      return "Compose selected template roles";
    default:
      return "Start from the governed baseline";
  }
}

function templateModeLabel(mode: CompanyTemplateCatalogEntry["importMode"]) {
  switch (mode) {
    case "direct":
      return "direct import candidate";
    case "review_only":
      return "review-only template";
    case "curated_roles":
      return "role-level composition";
    case "catalog_only":
      return "catalog only";
    default:
      return "baseline";
  }
}

function TemplateCatalogAssessment(input: {
  templates: CompanyTemplateCatalogEntry[];
  loading: boolean;
  assessment: FactoryTemplateAssessment | null;
  assessing: boolean;
  canAssess: boolean;
  onAssess: () => void;
  onSelectTemplate: (templateId: string) => void;
}) {
  const rankedTemplates = input.assessment?.templateCandidates.filter((candidate) => candidate.score > 0).slice(0, 3) ?? [];
  const topExistingCompany = input.assessment?.existingCompanyCandidates[0] ?? null;

  return (
    <Card data-testid="factory-template-catalog">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary"><LibraryBig className="h-4 w-4" /> AI Company template catalog</div>
            <CardTitle className="mt-2">Assess reuse before you provision</CardTitle>
            <CardDescription className="mt-1 max-w-3xl">
              Compare the request with curated company architectures and existing companies. This is deterministic, explainable, read-only, and never imports a company or grants permissions.
            </CardDescription>
          </div>
          <Badge variant="outline">{input.loading ? "Loading…" : `${input.templates.length} curated templates`}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {input.templates.slice(0, 8).map((template) => (
            <span key={template.id} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
              {template.name} · {templateModeLabel(template.importMode)}
            </span>
          ))}
          {input.templates.length > 8 ? <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">+{input.templates.length - 8} more</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={input.onAssess}
            disabled={input.assessing || !input.canAssess}
            data-testid="factory-assess-templates"
          >
            {input.assessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
            Assess reusable companies
          </Button>
          <span className="text-xs text-muted-foreground">A native approval is still required before any future import, company creation, or Agent activation.</span>
        </div>
        {input.assessment ? (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm" data-testid="factory-template-assessment">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{recommendationActionLabel(input.assessment.recommendation.action)}</div>
              <Badge variant="secondary" data-testid="factory-template-assessment-approval">
                approval required · external actions blocked
              </Badge>
            </div>
            <p className="text-muted-foreground">{input.assessment.recommendation.rationale}</p>
            {rankedTemplates.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-3">
                {rankedTemplates.map((candidate) => (
                  <div key={candidate.template.id} className="rounded-md border bg-background p-3">
                    <div className="font-medium">{candidate.template.name} <span className="text-xs text-muted-foreground">{candidate.score}/100</span></div>
                    <div className="mt-1 text-xs text-muted-foreground">{candidate.rationale}</div>
                    {candidate.outcomeEvidence.length > 0 ? (
                      <div className="mt-2 rounded border bg-muted/20 p-2 text-xs text-muted-foreground">
                        Company-local approved outcome evidence: {candidate.outcomeEvidence.map((outcome) => `${outcome.title} (+${outcome.scoreBoost})`).join(" · ")}
                      </div>
                    ) : null}
                    {candidate.template.importMode === "direct" || candidate.template.importMode === "review_only" ? (
                      <Button
                        variant="outline"
                        className="mt-3 h-8 px-2 text-xs"
                        onClick={() => input.onSelectTemplate(candidate.template.id)}
                      >
                        Use for proposal
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {topExistingCompany ? (
              <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                Existing-company candidate: <strong className="text-foreground">{topExistingCompany.name}</strong> · {topExistingCompany.score}/100 · {topExistingCompany.rationale}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FactoryRequestDetail(input: {
  request: FactoryRequest | null;
  outcomes: FactoryOutcomeRecord[];
  proposing: boolean;
  applying: boolean;
  creatingOutcome: boolean;
  promotingOutcome: boolean;
  onPropose: () => void;
  onApply: () => void;
  onCreateOutcome: (requestId: string, data: CreateFactoryOutcome) => void;
  onPromoteOutcome: (outcomeId: string) => void;
}) {
  const { request } = input;
  if (!request) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Select a request to inspect its proposal and approval state.
        </CardContent>
      </Card>
    );
  }
  const proposal = request.proposal;
  const catalogImport = proposal?.catalogImport ?? null;
  const sharedContext = proposal?.sharedContext ?? null;
  const canPropose = request.status === "draft" || request.status === "rejected";
  const canApply = request.status === "awaiting_approval" || request.status === "approved" || request.status === "blocked" || request.status === "failed";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{request.title}</CardTitle>
            <CardDescription className="mt-1">{request.projectName}</CardDescription>
          </div>
          <Badge variant={statusBadgeVariant(request.status)}>{requestStatusLabel(request.status)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-wrap">{request.requestMarkdown}</div>
        {request.failureReason ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{request.failureReason}</div>
        ) : null}
        {proposal ? (
          <>
            <section className="space-y-2">
              <div className="flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4 text-primary" /> Recommendation</div>
              <p className="text-sm">
                <strong>{proposal.recommendation.replaceAll("_", " ")}</strong> · {catalogImport
                  ? `${catalogImport.target.mode === "new_company" ? "creates a company" : "imports into the current company"} from a snapshot-pinned catalog package`
                  : proposal.project.willCreate ? "creates a project" : "reuses an existing project"}
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {proposal.rationale.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </section>
            {sharedContext ? (
              <section className="space-y-3" data-testid="factory-shared-context">
                <div className="flex items-center gap-2 font-medium"><LibraryBig className="h-4 w-4 text-primary" /> Reusable company context</div>
                <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                  <div>Policy: <span className="font-mono text-foreground">{sharedContext.selectionPolicy}</span></div>
                  <div className="mt-1">{sharedContext.rationale}</div>
                  <div className="mt-1">This is a read-only, proposal-pinned snapshot. It does not change permanent agent instructions or authorize external actions.</div>
                </div>
                {sharedContext.entries.length > 0 ? (
                  <div className="space-y-2">
                    {sharedContext.entries.map((entry) => (
                      <div key={entry.outcomeId} className="rounded-lg border p-3 text-sm">
                        <div className="font-medium">{entry.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">Outcome {entry.outcomeId} · matches {entry.matchedTerms.join(", ")} · expires {entry.expiresAt ? new Date(entry.expiresAt).toLocaleString() : "never"}</div>
                        <div className="mt-2 text-xs text-muted-foreground">{entry.retrospectiveExcerpt || entry.outcomeExcerpt}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
            {catalogImport ? (
              <section className="space-y-3" data-testid="factory-template-import-proposal">
                <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4 text-primary" /> Curated template import controls</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border p-3 text-sm">
                    <div className="font-medium">{catalogImport.templateName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{catalogImport.importMode} · source snapshot {catalogImport.sourceDigest.slice(0, 19)}…</div>
                  </div>
                  <div className="rounded-lg border p-3 text-sm">
                    <div className="font-medium">{catalogImport.target.companyName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{catalogImport.target.mode === "new_company" ? "new company" : "current company"} · {catalogImport.selectedAgentSlugs.length} paused Codex agents · {catalogImport.selectedSkillCount} detected Skills</div>
                  </div>
                </div>
                {catalogImport.optionalEnvInputs.length > 0 ? (
                  <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                    Optional environment inputs left unbound: {catalogImport.optionalEnvInputs.map((inputValue) => inputValue.key).join(", ")}
                  </div>
                ) : null}
                {catalogImport.previewWarnings.length > 0 ? (
                  <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">Importer preview warnings</div>
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {catalogImport.previewWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  </div>
                ) : null}
                {request.appliedResources?.importedCompanyId ? (
                  <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                    Imported company ID: <span className="font-mono text-foreground">{request.appliedResources.importedCompanyId}</span> · {Object.keys(request.appliedResources.importedAgentIds).length} agents normalized to GPT-5.6 Luna and paused.
                  </div>
                ) : null}
              </section>
            ) : (
              <section className="space-y-2">
                <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4 text-primary" /> Proposed team and gates</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {proposal.team.map((role) => (
                    <div key={role.key} className="rounded-lg border p-3 text-sm">
                      <div className="font-medium">{role.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Codex · {role.model ?? "gpt-5.6-luna"} · managed instructions · starts paused</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {proposal.taskGraph.map((task) => (
                    <div key={task.key} className="flex gap-3 rounded-lg border p-3 text-sm">
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div>
                        <div className="font-medium">{task.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">Owner: {task.ownerRole} · Depends on: {task.dependsOn.length ? task.dependsOn.join(", ") : "none"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">Skills: {task.taskScopedSkills.map((skill) => skill.slug).join(", ")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {request.status === "applied" || input.outcomes.length > 0 ? (
              <FactoryOutcomeMemory
                request={request}
                outcomes={input.outcomes}
                submitting={input.creatingOutcome}
                promoting={input.promotingOutcome}
                onCreate={input.onCreateOutcome}
                onPromote={input.onPromoteOutcome}
              />
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">This request has not been proposed yet.</div>
        )}
        <div className="flex flex-wrap gap-3 border-t pt-4">
          {canPropose ? (
            <Button onClick={input.onPropose} disabled={input.proposing}>
              {input.proposing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {request.status === "rejected" ? "Create revised proposal" : "Create proposal"}
            </Button>
          ) : null}
          {request.reviewIssueId ? (
            <Button asChild variant="outline">
              <NavLink to={`/issues/${request.reviewIssueId}`}>
                Open approval issue <ExternalLink className="h-4 w-4" />
              </NavLink>
            </Button>
          ) : null}
          {canApply ? (
            <Button onClick={input.onApply} disabled={input.applying}>
              {input.applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {catalogImport ? "Apply approved import" : "Apply approved plan"}
            </Button>
          ) : null}
          {request.appliedProjectId ? (
            <Button asChild variant="outline">
              <NavLink to={`/projects/${request.appliedProjectId}`}>Open provisioned project <ArrowRight className="h-4 w-4" /></NavLink>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function FactoryOutcomeMemory(input: {
  request: FactoryRequest;
  outcomes: FactoryOutcomeRecord[];
  submitting: boolean;
  promoting: boolean;
  onCreate: (requestId: string, data: CreateFactoryOutcome) => void;
  onPromote: (outcomeId: string) => void;
}) {
  const [draft, setDraft] = useState<OutcomeDraft>(EMPTY_OUTCOME_DRAFT);
  const qaIssueId = input.request.appliedResources?.issueIds.qa ?? null;
  const canSubmit = input.request.status === "applied" && Boolean(qaIssueId);

  useEffect(() => {
    setDraft({
      ...EMPTY_OUTCOME_DRAFT,
      evidenceWorkProductIds: input.request.appliedResources?.artifactIds.join(", ") ?? "",
    });
  }, [input.request.id, input.request.appliedResources?.artifactIds]);

  const submit = () => {
    const evidenceWorkProductIds = Array.from(new Set(
      draft.evidenceWorkProductIds
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ));
    input.onCreate(input.request.id, {
      title: draft.title.trim(),
      outcomeMarkdown: draft.outcomeMarkdown.trim(),
      retrospectiveMarkdown: draft.retrospectiveMarkdown.trim(),
      evidenceWorkProductIds,
      expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : undefined,
    });
  };

  return (
    <section className="space-y-3 border-t pt-5" data-testid="factory-outcome-memory">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-medium"><LibraryBig className="h-4 w-4 text-primary" /> Company-local outcome memory</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Only an accepted Board review can promote QA-backed evidence and a retrospective. Approved records are readable only inside this company; no cross-company retrieval path exists.
          </p>
        </div>
        <Badge variant="outline">{input.outcomes.filter((outcome) => outcome.activeForReuse).length} active for reuse</Badge>
      </div>

      {canSubmit ? (
        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div className="text-sm font-medium">Submit delivery outcome for review</div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`factory-outcome-title-${input.request.id}`}>Outcome title</Label>
              <Input
                id={`factory-outcome-title-${input.request.id}`}
                value={draft.title}
                maxLength={240}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="What was delivered and verified?"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`factory-outcome-expiry-${input.request.id}`}>Reuse expiry (optional)</Label>
              <Input
                id={`factory-outcome-expiry-${input.request.id}`}
                type="datetime-local"
                value={draft.expiresAt}
                onChange={(event) => setDraft((current) => ({ ...current, expiresAt: event.target.value }))}
              />
              <p className="text-xs text-muted-foreground">If omitted, the policy defaults to 180 days. The server verifies QA and same-company evidence again before review.</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`factory-outcome-evidence-${input.request.id}`}>Evidence work-product IDs</Label>
            <Input
              id={`factory-outcome-evidence-${input.request.id}`}
              value={draft.evidenceWorkProductIds}
              onChange={(event) => setDraft((current) => ({ ...current, evidenceWorkProductIds: event.target.value }))}
              placeholder="Comma-separated same-company work-product UUIDs"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`factory-outcome-summary-${input.request.id}`}>Outcome and evidence summary</Label>
              <Textarea
                id={`factory-outcome-summary-${input.request.id}`}
                value={draft.outcomeMarkdown}
                className="min-h-28"
                maxLength={100_000}
                onChange={(event) => setDraft((current) => ({ ...current, outcomeMarkdown: event.target.value }))}
                placeholder="Describe what QA accepted, with the important evidence and limitations."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`factory-outcome-retro-${input.request.id}`}>Retrospective for future reuse</Label>
              <Textarea
                id={`factory-outcome-retro-${input.request.id}`}
                value={draft.retrospectiveMarkdown}
                className="min-h-28"
                maxLength={100_000}
                onChange={(event) => setDraft((current) => ({ ...current, retrospectiveMarkdown: event.target.value }))}
                placeholder="Record reusable practices, failed approaches, risks, and when this pattern should not be reused."
              />
            </div>
          </div>
          <Button
            variant="outline"
            onClick={submit}
            disabled={input.submitting || !draft.title.trim() || !draft.outcomeMarkdown.trim() || !draft.retrospectiveMarkdown.trim() || !draft.evidenceWorkProductIds.trim()}
          >
            {input.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Submit outcome for Board review
          </Button>
        </div>
      ) : input.request.status === "applied" ? (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          This applied request has no QA-gated delivery issue, so it cannot be promoted as reusable delivery memory. The import/application manifest remains an audit record, not an outcome claim.
        </div>
      ) : null}

      {input.outcomes.length > 0 ? (
        <div className="space-y-2">
          {input.outcomes.map((outcome) => (
            <div key={outcome.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{outcome.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {outcome.status.replaceAll("_", " ")} · {outcome.activeForReuse ? "active for company reuse" : "not active for reuse"} · expires {outcome.expiresAt ? new Date(outcome.expiresAt).toLocaleString() : "never"}
                  </div>
                </div>
                <Badge variant={outcome.status === "rejected" ? "destructive" : outcome.activeForReuse ? "default" : "secondary"}>{outcome.status.replaceAll("_", " ")}</Badge>
              </div>
              <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{outcome.retrospectiveMarkdown}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {outcome.reviewIssueId ? (
                  <Button asChild variant="outline" className="h-8 px-2 text-xs">
                    <NavLink to={`/issues/${outcome.reviewIssueId}`}>Open outcome review <ExternalLink className="h-3.5 w-3.5" /></NavLink>
                  </Button>
                ) : null}
                {outcome.status === "awaiting_review" ? (
                  <Button
                    variant="outline"
                    className="h-8 px-2 text-xs"
                    onClick={() => input.onPromote(outcome.id)}
                    disabled={input.promoting}
                  >
                    {input.promoting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Promote accepted memory
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
