import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express, { type Request } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  companies,
  companyFactoryOutcomes,
  companyFactoryRequests,
  companyMemberships,
  companySkills,
  createDb,
  issueRelations,
  issues,
  issueThreadInteractions,
  issueWorkProducts,
  projects,
} from "@paperclipai/db";
import { errorHandler } from "../middleware/index.js";
import { companyFactoryRoutes } from "../routes/company-factory.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("company factory routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let factoryHome = "";
  let workspaceCwd = "";
  const previousPaperclipHome = process.env.PAPERCLIP_HOME;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-company-factory-");
    db = createDb(tempDb.connectionString);
    factoryHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-factory-home-"));
    workspaceCwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-factory-workspace-"));
    process.env.PAPERCLIP_HOME = factoryHome;
  }, 20_000);

  afterAll(async () => {
    if (previousPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = previousPaperclipHome;
    await Promise.all([
      tempDb?.cleanup(),
      fs.rm(factoryHome, { recursive: true, force: true }),
      fs.rm(workspaceCwd, { recursive: true, force: true }),
    ]);
  });

  function appFor(companyId: string, isInstanceAdmin = true) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = {
        type: "board",
        source: "local_implicit",
        userId: "factory-board",
        companyIds: [companyId],
        memberships: [],
        isInstanceAdmin,
      } satisfies Request["actor"];
      next();
    });
    app.use("/api", companyFactoryRoutes(db));
    app.use(errorHandler);
    return app;
  }

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Factory Test Company",
      issuePrefix: `FT${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: true,
    });
    await db.insert(companySkills).values([
      {
        id: randomUUID(),
        companyId,
        key: `company/${companyId}/task-skill-router`,
        slug: "task-skill-router",
        name: "task-skill-router",
        markdown: "# Task Skill Router\n",
        sourceType: "catalog",
      },
      {
        id: randomUUID(),
        companyId,
        key: "paperclipai/paperclip/paperclip",
        slug: "paperclip",
        name: "paperclip",
        markdown: "# Paperclip\n",
        sourceType: "catalog",
      },
      {
        id: randomUUID(),
        companyId,
        key: "paperclipai/bundled/paperclip-operations/summarize-status",
        slug: "summarize-status",
        name: "summarize-status",
        markdown: "# Summarize status\n",
        sourceType: "catalog",
      },
    ]);
    await db.insert(companyMemberships).values({
      id: randomUUID(),
      companyId,
      principalType: "user",
      principalId: "factory-board",
      membershipRole: "owner",
      status: "active",
    });
    return companyId;
  }

  function mockGStackTemplateSource(options: { agentBody?: string | (() => string) } = {}) {
    const rawBase = "https://raw.githubusercontent.com/paperclipai/companies/main/gstack";
    const treeUrl = "https://api.github.com/repos/paperclipai/companies/git/trees/main?recursive=1";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const payloadByUrl: Record<string, string> = {
        [`${rawBase}/COMPANY.md`]: [
          "---",
          "name: GStack Import",
          "slug: gstack-import",
          "description: A test upstream company package.",
          "---",
          "",
          "# GStack Import",
        ].join("\n"),
        [`${rawBase}/agents/ceo/AGENTS.md`]: [
          "---",
          "name: CEO",
          "role: ceo",
          "skills:",
          "  - planning",
          "---",
          "",
          typeof options.agentBody === "function" ? options.agentBody() : options.agentBody ?? "Lead the company.",
        ].join("\n"),
        [`${rawBase}/skills/planning/SKILL.md`]: [
          "---",
          "name: planning",
          "description: Plan work.",
          "---",
          "",
          "# Planning",
        ].join("\n"),
        [`${rawBase}/.paperclip.yaml`]: [
          "schema: paperclip/v1",
          "agents:",
          "  ceo:",
          "    adapter:",
          "      type: codex_local",
          "    inputs:",
          "      env:",
          "        GH_TOKEN:",
          "          kind: secret",
          "          requirement: optional",
          "",
        ].join("\n"),
      };
      if (url === treeUrl) {
        return new Response(JSON.stringify({
          tree: [
            { path: "gstack/agents/ceo/AGENTS.md", type: "blob" },
            { path: "gstack/skills/planning/SKILL.md", type: "blob" },
            { path: "gstack/.paperclip.yaml", type: "blob" },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const payload = payloadByUrl[url];
      return payload === undefined
        ? new Response("Not found", { status: 404 })
        : new Response(payload, { status: 200, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
    return () => {
      globalThis.fetch = originalFetch;
    };
  }

  it("lists the curated company catalog and assesses reuse without mutation", async () => {
    const companyId = await seedCompany();
    const app = appFor(companyId);

    const templates = await request(app)
      .get(`/api/companies/${companyId}/factory/templates`)
      .expect(200);
    expect(templates.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "gstack", importMode: "direct" }),
      expect.objectContaining({ id: "trail-of-bits-security", importMode: "review_only" }),
    ]));

    const assessment = await request(app)
      .post(`/api/companies/${companyId}/factory/templates/assess`)
      .send({
        title: "Security audit",
        requestMarkdown: "Audit smart contract vulnerabilities and produce a security remediation plan.",
      })
      .expect(200);
    expect(assessment.body.recommendation).toEqual(expect.objectContaining({
      action: "import_template_new_company",
      templateId: "trail-of-bits-security",
      requiresApproval: true,
      externalSideEffectsBlocked: true,
    }));
    const intake = await request(app)
      .post(`/api/companies/${companyId}/factory/intake`)
      .send({
        businessRequest: "We need a security audit team for smart contracts. Do not bind credentials or make external changes; produce evidence-backed remediation guidance.",
      })
      .expect(200);
    expect(intake.body).toEqual(expect.objectContaining({
      deterministic: true,
      normalizedRequest: expect.objectContaining({
        title: "We need a security audit team for smart contracts",
        requestMarkdown: expect.stringContaining("evidence-backed remediation guidance"),
      }),
      suggestedTemplateSelection: expect.objectContaining({
        templateId: "trail-of-bits-security",
        target: "new_company",
      }),
      governance: {
        createsResources: false,
        requiresApprovalForProvisioning: true,
        externalSideEffectsBlocked: true,
      },
    }));
    expect(await db.select().from(companyFactoryRequests).where(eq(companyFactoryRequests.companyId, companyId))).toHaveLength(0);
  });

  it("requires an instance administrator before a Factory request can create a new company", async () => {
    const companyId = await seedCompany();
    const app = appFor(companyId, false);
    await request(app)
      .post(`/api/companies/${companyId}/factory/requests`)
      .send({
        title: "Unauthorized new company",
        requestMarkdown: "Attempt to create a new company from a curated template.",
        workspaceCwd,
        templateSelection: { templateId: "gstack", target: "new_company" },
      })
      .expect(403);
  });

  it("requires native approval, provisions a paused Codex team, and is idempotent", async () => {
    const companyId = await seedCompany();
    const app = appFor(companyId);
    const created = await request(app)
      .post(`/api/companies/${companyId}/factory/requests`)
      .send({
        title: "Ship a governed Factory API vertical slice",
        requestMarkdown: "Create a reviewable request-to-project flow with a QA gate.",
        projectName: "Factory API Slice",
        projectDescription: "A test-only Company Factory project.",
        workspaceCwd,
        idempotencyKey: `factory-test:${companyId}`,
      })
      .expect(201);
    expect(created.body.status).toBe("draft");

    const proposal = await request(app)
      .post(`/api/companies/${companyId}/factory/requests/${created.body.id}/propose`)
      .expect(200);
    expect(proposal.body.status).toBe("awaiting_approval");
    expect(proposal.body.proposal.recommendation).toBe("create_project_team");
    expect(proposal.body.proposal.team).toHaveLength(4);
    expect(proposal.body.proposal.team.every((role: { model?: string }) => role.model === "gpt-5.6-luna")).toBe(true);
    expect(proposal.body.proposal.sharedContext).toEqual(expect.objectContaining({ entries: [] }));
    expect(proposal.body.reviewIssueId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(proposal.body.approvalInteractionId).toMatch(/^[0-9a-f-]{36}$/i);

    await request(app)
      .post(`/api/companies/${companyId}/factory/requests/${created.body.id}/apply`)
      .expect(409);

    await db
      .update(issueThreadInteractions)
      .set({
        status: "accepted",
        result: { version: 1, outcome: "accepted" },
        resolvedByUserId: "factory-board",
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(issueThreadInteractions.id, proposal.body.approvalInteractionId));

    const applied = await request(app)
      .post(`/api/companies/${companyId}/factory/requests/${created.body.id}/apply`)
      .expect(200);
    expect(applied.body.status).toBe("applied");
    expect(applied.body.appliedProjectId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Object.keys(applied.body.appliedResources.agentIds)).toHaveLength(4);
    expect(Object.keys(applied.body.appliedResources.issueIds)).toHaveLength(4);
    expect(applied.body.appliedResources.artifactIds).toHaveLength(1);

    const [factoryProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, applied.body.appliedProjectId));
    expect(factoryProject?.name).toBe("Factory API Slice");

    const team = await db.select().from(agents).where(eq(agents.companyId, companyId));
    expect(team).toHaveLength(4);
    expect(team.every((agent) => agent.adapterType === "codex_local" && agent.status === "paused")).toBe(true);
    expect(team.every((agent) => (agent.adapterConfig as Record<string, unknown>).model === "gpt-5.6-luna")).toBe(true);
    expect(team.every((agent) => (agent.adapterConfig as Record<string, unknown>).dangerouslyBypassApprovalsAndSandbox === false)).toBe(true);
    expect(team.every((agent) => (agent.adapterConfig as Record<string, unknown>).instructionsBundleMode === "managed")).toBe(true);
    const manager = team.find((agent) => agent.role === "pm");
    expect(manager).toBeTruthy();
    expect(team.filter((agent) => agent.role !== "pm").every((agent) => agent.reportsTo === manager?.id)).toBe(true);

    const provisionedIssues = await db.select().from(issues).where(eq(issues.companyId, companyId));
    expect(provisionedIssues).toHaveLength(5); // proposal review issue plus the four task-DAG issues
    expect(provisionedIssues.filter((issue) => issue.projectId === applied.body.appliedProjectId)).toHaveLength(4);
    expect(provisionedIssues.find((issue) => issue.id === proposal.body.reviewIssueId)?.status).toBe("done");
    expect(await db.select().from(issueRelations).where(eq(issueRelations.companyId, companyId))).toHaveLength(3);
    expect(await db.select().from(issueWorkProducts).where(eq(issueWorkProducts.companyId, companyId))).toHaveLength(1);

    // Legacy/partially applied requests can retain an open proposal issue.
    // A repeat apply is idempotent and reconciles that stale Board item.
    await db.update(issues).set({ status: "backlog" }).where(eq(issues.id, proposal.body.reviewIssueId));

    const repeat = await request(app)
      .post(`/api/companies/${companyId}/factory/requests/${created.body.id}/apply`)
      .expect(200);
    expect(repeat.body.appliedResources).toEqual(applied.body.appliedResources);
    const [reconciledReviewIssue] = await db.select().from(issues).where(eq(issues.id, proposal.body.reviewIssueId));
    expect(reconciledReviewIssue?.status).toBe("done");
    expect(await db.select().from(projects).where(eq(projects.companyId, companyId))).toHaveLength(1);
    expect(await db.select().from(agents).where(eq(agents.companyId, companyId))).toHaveLength(4);
    expect(await db.select().from(companyFactoryRequests).where(eq(companyFactoryRequests.id, created.body.id))).toHaveLength(1);

    const qaIssueId = applied.body.appliedResources.issueIds.qa as string;
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, qaIssueId));
    const pendingOutcome = await request(app)
      .post(`/api/companies/${companyId}/factory/requests/${created.body.id}/outcomes`)
      .send({
        title: "Factory delivery outcome",
        outcomeMarkdown: "The QA-gated Factory API vertical slice was delivered with a paused team and reproducible validation evidence.",
        retrospectiveMarkdown: "Keep approval, QA, and documentation as separate blocked stages. Reuse the pattern only for company-scoped work.",
        evidenceWorkProductIds: applied.body.appliedResources.artifactIds,
      })
      .expect(201);
    expect(pendingOutcome.body).toEqual(expect.objectContaining({
      status: "awaiting_review",
      activeForReuse: false,
      reviewIssueId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      approvalInteractionId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }));
    expect((await request(app).get(`/api/companies/${companyId}/factory/outcomes`).expect(200)).body).toEqual([]);
    expect((await request(app).get(`/api/companies/${companyId}/factory/outcomes?includeInactive=true`).expect(200)).body)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: pendingOutcome.body.id, status: "awaiting_review" })]));
    await request(app)
      .post(`/api/companies/${companyId}/factory/outcomes/${pendingOutcome.body.id}/promote`)
      .expect(409);
    await db
      .update(issueThreadInteractions)
      .set({
        status: "accepted",
        result: { version: 1, outcome: "accepted" },
        resolvedByUserId: "factory-board",
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(issueThreadInteractions.id, pendingOutcome.body.approvalInteractionId));
    const promotedOutcome = await request(app)
      .post(`/api/companies/${companyId}/factory/outcomes/${pendingOutcome.body.id}/promote`)
      .expect(200);
    expect(promotedOutcome.body).toEqual(expect.objectContaining({ status: "approved", activeForReuse: true }));
    expect((await request(app).get(`/api/companies/${companyId}/factory/outcomes`).expect(200)).body)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: pendingOutcome.body.id, status: "approved", activeForReuse: true })]));
  }, 30_000);

  it("pins approved same-company outcome context into Factory tasks and blocks a stale snapshot", async () => {
    const companyId = await seedCompany();
    const app = appFor(companyId);
    const sourceRequestId = randomUUID();
    const sourceOutcomeId = randomUUID();
    const now = new Date();
    await db.insert(companyFactoryRequests).values({
      id: sourceRequestId,
      companyId,
      title: "Inventory launch delivery",
      requestMarkdown: "Prepare an inventory launch package with QA evidence.",
      projectName: "Inventory launch",
      status: "applied",
    });
    await db.insert(companyFactoryOutcomes).values({
      id: sourceOutcomeId,
      companyId,
      factoryRequestId: sourceRequestId,
      title: "Inventory launch QA delivery",
      outcomeMarkdown: "The inventory launch package passed QA with reproducible validation evidence.",
      retrospectiveMarkdown: "Reuse the inventory checklist and QA evidence before preparing a comparable launch package.",
      evidenceWorkProductIds: [],
      status: "approved",
      approvedAt: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
    });

    const createTarget = async (title: string) => request(app)
      .post(`/api/companies/${companyId}/factory/requests`)
      .send({
        title,
        requestMarkdown: "Prepare an inventory launch package with a QA gate and the proven inventory checklist.",
        projectName: title,
        workspaceCwd,
      })
      .expect(201);
    const acceptProposal = async (requestId: string) => {
      const proposal = await request(app)
        .post(`/api/companies/${companyId}/factory/requests/${requestId}/propose`)
        .expect(200);
      await db
        .update(issueThreadInteractions)
        .set({
          status: "accepted",
          result: { version: 1, outcome: "accepted" },
          resolvedByUserId: "factory-board",
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(issueThreadInteractions.id, proposal.body.approvalInteractionId));
      return proposal;
    };

    const first = await createTarget("Inventory context delivery");
    const firstProposal = await acceptProposal(first.body.id);
    expect(firstProposal.body.proposal.sharedContext).toEqual(expect.objectContaining({
      selectionPolicy: "approved_unexpired_same_company_term_overlap",
      entries: [expect.objectContaining({
        outcomeId: sourceOutcomeId,
        sourceCompanyId: companyId,
        sourceFactoryRequestId: sourceRequestId,
        matchedTerms: expect.arrayContaining(["inventory"]),
      })],
    }));
    const applied = await request(app)
      .post(`/api/companies/${companyId}/factory/requests/${first.body.id}/apply`)
      .expect(200);
    const taskIssues = await db
      .select()
      .from(issues)
      .where(eq(issues.projectId, applied.body.appliedProjectId));
    expect(taskIssues).toHaveLength(4);
    expect(taskIssues.every((issue) => issue.description?.includes("Reusable company context (read-only)") && issue.description.includes(sourceOutcomeId))).toBe(true);

    const stale = await createTarget("Inventory stale context delivery");
    await acceptProposal(stale.body.id);
    await db
      .update(companyFactoryOutcomes)
      .set({ expiresAt: new Date(Date.now() - 1_000), updatedAt: new Date() })
      .where(eq(companyFactoryOutcomes.id, sourceOutcomeId));
    await request(app)
      .post(`/api/companies/${companyId}/factory/requests/${stale.body.id}/apply`)
      .expect(409);
    const blocked = await request(app)
      .get(`/api/companies/${companyId}/factory/requests/${stale.body.id}`)
      .expect(200);
    expect(blocked.body).toEqual(expect.objectContaining({
      status: "blocked",
      failureReason: expect.stringContaining("execution context changed"),
    }));
  }, 30_000);

  it("imports a snapshot-pinned curated template only after approval and normalizes every agent safely", async () => {
    const restoreFetch = mockGStackTemplateSource();
    try {
      const companyId = await seedCompany();
      const app = appFor(companyId);
      const created = await request(app)
        .post(`/api/companies/${companyId}/factory/requests`)
        .send({
          title: "Build a governed engineering company",
          requestMarkdown: "Import a small engineering architecture for a reviewed delivery team.",
          projectName: "Imported GStack Team",
          workspaceCwd,
          templateSelection: {
            templateId: "gstack",
            target: "new_company",
            newCompanyName: "Imported GStack Team",
          },
        })
        .expect(201);
      expect(created.body.templateSelection).toEqual({
        templateId: "gstack",
        target: "new_company",
        newCompanyName: "Imported GStack Team",
      });

      const proposal = await request(app)
        .post(`/api/companies/${companyId}/factory/requests/${created.body.id}/propose`)
        .expect(200);
      expect(proposal.body.proposal).toEqual(expect.objectContaining({
        templateKey: "catalog_company_import",
        recommendation: "import_catalog_template",
        catalogImport: expect.objectContaining({
          templateId: "gstack",
          importMode: "direct",
          selectedAgentSlugs: ["ceo"],
          sourceDigest: expect.stringMatching(/^sha256:/),
        }),
      }));
      expect(proposal.body.proposal.catalogImport.optionalEnvInputs).toEqual([
        expect.objectContaining({ key: "GH_TOKEN", kind: "secret" }),
      ]);

      await request(app)
        .post(`/api/companies/${companyId}/factory/requests/${created.body.id}/apply`)
        .expect(409);

      await db
        .update(issueThreadInteractions)
        .set({
          status: "accepted",
          result: { version: 1, outcome: "accepted" },
          resolvedByUserId: "factory-board",
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(issueThreadInteractions.id, proposal.body.approvalInteractionId));

      const applied = await request(app)
        .post(`/api/companies/${companyId}/factory/requests/${created.body.id}/apply`)
        .expect(200);
      expect(applied.body.status).toBe("applied");
      expect(applied.body.appliedProjectId).toBeNull();
      expect(applied.body.appliedResources).toEqual(expect.objectContaining({
        importedCompanyId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        importedAgentIds: { ceo: expect.stringMatching(/^[0-9a-f-]{36}$/i) },
      }));

      const importedCompanyId = applied.body.appliedResources.importedCompanyId as string;
      const [importedCompany] = await db.select().from(companies).where(eq(companies.id, importedCompanyId));
      expect(importedCompany?.name).toBe("Imported GStack Team");
      const importedAgents = await db.select().from(agents).where(eq(agents.companyId, importedCompanyId));
      const importedAgentId = applied.body.appliedResources.importedAgentIds.ceo as string;
      const importedAgent = importedAgents.find((agent) => agent.id === importedAgentId);
      expect(importedAgent).toBeTruthy();
      expect(importedAgent).toEqual(expect.objectContaining({
        name: "CEO",
        adapterType: "codex_local",
        status: "paused",
        pauseReason: "system",
        permissions: {
          canCreateAgents: false,
          canCreateSkills: false,
        },
      }));
      expect(importedAgent?.adapterConfig).toEqual(expect.objectContaining({
        cwd: workspaceCwd,
        model: "gpt-5.6-luna",
        dangerouslyBypassApprovalsAndSandbox: false,
        instructionsBundleMode: "managed",
      }));
      expect((importedAgent?.adapterConfig as Record<string, unknown>).env).toBeUndefined();
      expect(await db.select().from(projects).where(eq(projects.companyId, importedCompanyId))).toHaveLength(0);
      expect(await db.select().from(issues).where(eq(issues.companyId, importedCompanyId))).toHaveLength(0);
      const importedSkills = await db.select().from(companySkills).where(eq(companySkills.companyId, importedCompanyId));
      expect(importedSkills).toEqual(expect.arrayContaining([
        expect.objectContaining({ slug: "planning" }),
      ]));
      const [reviewIssue] = await db.select().from(issues).where(eq(issues.id, proposal.body.reviewIssueId));
      expect(reviewIssue?.status).toBe("done");
    } finally {
      restoreFetch();
    }
  }, 30_000);

  it("blocks application when the reviewed upstream template snapshot has changed", async () => {
    let agentBody = "Original reviewed agent instructions.";
    const restoreFetch = mockGStackTemplateSource({ agentBody: () => agentBody });
    try {
      const companyId = await seedCompany();
      const app = appFor(companyId);
      const targetName = `Drift Protected ${companyId.slice(0, 8)}`;
      const created = await request(app)
        .post(`/api/companies/${companyId}/factory/requests`)
        .send({
          title: "Import snapshot-pinned template",
          requestMarkdown: "Create an engineering team only from a reviewed immutable package snapshot.",
          projectName: targetName,
          workspaceCwd,
          templateSelection: {
            templateId: "gstack",
            target: "new_company",
            newCompanyName: targetName,
          },
        })
        .expect(201);
      const proposal = await request(app)
        .post(`/api/companies/${companyId}/factory/requests/${created.body.id}/propose`)
        .expect(200);
      await db
        .update(issueThreadInteractions)
        .set({
          status: "accepted",
          result: { version: 1, outcome: "accepted" },
          resolvedByUserId: "factory-board",
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(issueThreadInteractions.id, proposal.body.approvalInteractionId));

      agentBody = "Upstream package changed after the Board reviewed it.";
      await request(app)
        .post(`/api/companies/${companyId}/factory/requests/${created.body.id}/apply`)
        .expect(409);

      const blocked = await request(app)
        .get(`/api/companies/${companyId}/factory/requests/${created.body.id}`)
        .expect(200);
      expect(blocked.body.status).toBe("blocked");
      expect(blocked.body.failureReason).toContain("package changed");
      const driftTargetCompanies = await db.select().from(companies).where(eq(companies.name, targetName));
      expect(driftTargetCompanies).toHaveLength(0);
    } finally {
      restoreFetch();
    }
  }, 30_000);
});
