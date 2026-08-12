import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  companies,
  companyFactoryRequests,
  createDb,
  issues,
  projects,
} from "@paperclipai/db";
import { factoryAutopilotService } from "../services/factory-autopilot.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("factory autopilot", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const previousEnabled = process.env.PAPERCLIP_FACTORY_AUTOPILOT_ENABLED;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-autopilot-");
    db = createDb(tempDb.connectionString);
    process.env.PAPERCLIP_FACTORY_AUTOPILOT_ENABLED = "true";
  }, 20_000);

  afterAll(async () => {
    if (previousEnabled === undefined) delete process.env.PAPERCLIP_FACTORY_AUTOPILOT_ENABLED;
    else process.env.PAPERCLIP_FACTORY_AUTOPILOT_ENABLED = previousEnabled;
    await tempDb?.cleanup();
  });

  beforeEach(async () => {
    // Each test seeds its own companies/projects/requests; clear tables that
    // other tests may have populated so counts like checkedRequests stay scoped.
    // activity_log references companies, so it must be cleared first.
    const { activityLog, agentWakeupRequests } = await import("@paperclipai/db");
    await db.delete(activityLog);
    await db.delete(agentWakeupRequests);
    await db.delete(issues);
    await db.delete(companyFactoryRequests);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(companies);
  });

  async function seedCompany(name = `Autopilot Test Co ${randomUUID().slice(0, 8)}`) {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `AT${randomUUID().slice(0, 4).toUpperCase()}`,
      status: "active",
    });
    return companyId;
  }

  async function seedFactoryAgent(companyId: string, name: string, status: string) {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name,
      role: "pm",
      status,
      adapterType: "claude_local",
      adapterConfig: {},
      permissions: { canCreateAgents: false, canCreateSkills: false },
      metadata: { factoryRequestId: randomUUID(), factoryTeamRole: "project_manager" },
    });
    return agentId;
  }

  async function seedAppliedRequest(companyId: string, projectId: string) {
    const requestId = randomUUID();
    await db.insert(companyFactoryRequests).values({
      id: requestId,
      companyId,
      title: "Autopilot request",
      requestMarkdown: "seed",
      projectName: "Autopilot Project",
      status: "applied",
      appliedProjectId: projectId,
    });
    return requestId;
  }

  async function seedIssue(companyId: string, projectId: string, agentId: string, status: string, title = "task") {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      status,
      title,
      assigneeAgentId: agentId,
    });
    return issueId;
  }

  function buildDeps(overrides: Record<string, unknown> = {}) {
    const wakeup = vi.fn().mockResolvedValue({ id: randomUUID() });
    const resumeAgent = vi.fn().mockImplementation(async (id: string) => ({ id }));
    const listDependencyReadiness = vi
      .fn()
      .mockResolvedValue(new Map<string, { isDependencyReady: boolean }>());
    return { wakeup, resumeAgent, listDependencyReadiness, ...overrides };
  }

  it("wakes dependency-ready backlog issues assigned to factory agents", async () => {
    const companyId = await seedCompany();
    const projectId = randomUUID();
    await db.insert(projects).values({ id: projectId, companyId, name: "Autopilot Project" });
    await seedAppliedRequest(companyId, projectId);
    const agentId = await seedFactoryAgent(companyId, "PM", "idle");
    const issueId = await seedIssue(companyId, projectId, agentId, "backlog");

    const deps = buildDeps();
    deps.listDependencyReadiness.mockResolvedValue(
      new Map([[issueId, { isDependencyReady: true }]]),
    );
    const svc = factoryAutopilotService(db as any, deps as any);

    const result = await svc.tick();

    expect(result.checkedRequests).toBe(1);
    expect(result.readyIssues).toBe(1);
    expect(result.woken).toBe(1);
    expect(result.resumed).toBe(0);
    expect(deps.wakeup).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        source: "automation",
        triggerDetail: "system",
        payload: { issueId },
        contextSnapshot: { issueId },
        requestedByActorType: "system",
      }),
    );
  });

  it("skips issues whose dependencies are not ready", async () => {
    const companyId = await seedCompany();
    const projectId = randomUUID();
    await db.insert(projects).values({ id: projectId, companyId, name: "Autopilot Project" });
    await seedAppliedRequest(companyId, projectId);
    const agentId = await seedFactoryAgent(companyId, "PM", "idle");
    const issueId = await seedIssue(companyId, projectId, agentId, "backlog");

    const deps = buildDeps();
    deps.listDependencyReadiness.mockResolvedValue(
      new Map([[issueId, { isDependencyReady: false }]]),
    );
    const svc = factoryAutopilotService(db as any, deps as any);

    const result = await svc.tick();

    expect(result.readyIssues).toBe(0);
    expect(result.woken).toBe(0);
    expect(deps.wakeup).not.toHaveBeenCalled();
  });

  it("resumes paused factory agents before waking", async () => {
    const companyId = await seedCompany();
    const projectId = randomUUID();
    await db.insert(projects).values({ id: projectId, companyId, name: "Autopilot Project" });
    await seedAppliedRequest(companyId, projectId);
    const agentId = await seedFactoryAgent(companyId, "PM", "paused");
    const issueId = await seedIssue(companyId, projectId, agentId, "backlog");

    const deps = buildDeps();
    deps.listDependencyReadiness.mockResolvedValue(
      new Map([[issueId, { isDependencyReady: true }]]),
    );
    const svc = factoryAutopilotService(db as any, deps as any);

    const result = await svc.tick();

    expect(result.resumed).toBe(1);
    expect(result.woken).toBe(1);
    expect(deps.resumeAgent).toHaveBeenCalledWith(agentId);
    expect(deps.wakeup).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({ source: "automation" }),
    );
  });

  it("does not wake when a wakeup for the same issue is already pending", async () => {
    const companyId = await seedCompany();
    const projectId = randomUUID();
    await db.insert(projects).values({ id: projectId, companyId, name: "Autopilot Project" });
    await seedAppliedRequest(companyId, projectId);
    const agentId = await seedFactoryAgent(companyId, "PM", "idle");
    const issueId = await seedIssue(companyId, projectId, agentId, "backlog");
    await db.insert(companyFactoryRequests).values({
      id: randomUUID(),
      companyId,
      title: "noop",
      requestMarkdown: "noop",
      projectName: "Noop",
      status: "draft",
    });

    const deps = buildDeps();
    deps.listDependencyReadiness.mockResolvedValue(
      new Map([[issueId, { isDependencyReady: true }]]),
    );
    const svc = factoryAutopilotService(db as any, deps as any);

    // Pre-insert a pending wakeup record referencing the issue.
    const { agentWakeupRequests } = await import("@paperclipai/db");
    await db.insert(agentWakeupRequests).values({
      companyId,
      agentId,
      source: "automation",
      status: "queued",
      payload: { issueId },
      idempotencyKey: `factory-autopilot:${issueId}`,
      requestedByActorType: "system",
    });

    const result = await svc.tick();

    expect(result.woken).toBe(0);
    expect(result.skipped.some((s) => s.reason === "wakeup_already_pending")).toBe(true);
    expect(deps.wakeup).not.toHaveBeenCalled();
  });

  it("skips requests that are not applied or whose company is inactive", async () => {
    const activeCompany = await seedCompany();
    const activeProjectId = randomUUID();
    await db.insert(projects).values({ id: activeProjectId, companyId: activeCompany, name: "Active" });
    const draftRequestId = randomUUID();
    await db.insert(companyFactoryRequests).values({
      id: draftRequestId,
      companyId: activeCompany,
      title: "draft",
      requestMarkdown: "draft",
      projectName: "Draft",
      status: "draft",
      appliedProjectId: activeProjectId,
    });
    // A genuinely eligible request: applied + active company, but its project
    // has no pending issues, so the tick inspects it and wakes nothing.
    const eligibleRequestId = randomUUID();
    await db.insert(companyFactoryRequests).values({
      id: eligibleRequestId,
      companyId: activeCompany,
      title: "applied-eligible",
      requestMarkdown: "x",
      projectName: "Eligible",
      status: "applied",
      appliedProjectId: activeProjectId,
    });

    const inactiveCompany = randomUUID();
    await db.insert(companies).values({
      id: inactiveCompany,
      name: "Inactive Co",
      status: "archived",
    });
    const inactiveProjectId = randomUUID();
    await db.insert(projects).values({ id: inactiveProjectId, companyId: inactiveCompany, name: "Inactive" });
    await db.insert(companyFactoryRequests).values({
      id: randomUUID(),
      companyId: inactiveCompany,
      title: "applied-but-inactive",
      requestMarkdown: "x",
      projectName: "Inactive Proj",
      status: "applied",
      appliedProjectId: inactiveProjectId,
    });

    const deps = buildDeps();
    const svc = factoryAutopilotService(db as any, deps as any);
    const result = await svc.tick();

    // Only the applied request in the active company is checked; it has no pending issues.
    expect(result.checkedRequests).toBe(1);
    expect(result.woken).toBe(0);
    expect(deps.wakeup).not.toHaveBeenCalled();
  });

  it("respects PAPERCLIP_FACTORY_AUTOPILOT_ENABLED=false", async () => {
    const companyId = await seedCompany();
    const projectId = randomUUID();
    await db.insert(projects).values({ id: projectId, companyId, name: "Autopilot Project" });
    await seedAppliedRequest(companyId, projectId);
    const agentId = await seedFactoryAgent(companyId, "PM", "idle");
    await seedIssue(companyId, projectId, agentId, "backlog");

    const deps = buildDeps();
    deps.listDependencyReadiness.mockResolvedValue(new Map());
    const svc = factoryAutopilotService(db as any, deps as any);

    process.env.PAPERCLIP_FACTORY_AUTOPILOT_ENABLED = "false";
    try {
      const result = await svc.tick();
      expect(result.checkedRequests).toBe(0);
      expect(result.woken).toBe(0);
      expect(deps.wakeup).not.toHaveBeenCalled();
    } finally {
      process.env.PAPERCLIP_FACTORY_AUTOPILOT_ENABLED = "true";
    }
  });

  it("skips issues assigned to non-factory agents", async () => {
    const companyId = await seedCompany();
    const projectId = randomUUID();
    await db.insert(projects).values({ id: projectId, companyId, name: "Autopilot Project" });
    await seedAppliedRequest(companyId, projectId);

    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Foreign Agent",
      role: "general",
      status: "idle",
      adapterType: "claude_local",
      adapterConfig: {},
      permissions: { canCreateAgents: false, canCreateSkills: false },
      metadata: {},
    });
    const issueId = await seedIssue(companyId, projectId, agentId, "backlog");

    const deps = buildDeps();
    deps.listDependencyReadiness.mockResolvedValue(
      new Map([[issueId, { isDependencyReady: true }]]),
    );
    const svc = factoryAutopilotService(db as any, deps as any);

    const result = await svc.tick();

    expect(result.woken).toBe(0);
    expect(result.skipped.some((s) => s.reason === "non_factory_assignee")).toBe(true);
    expect(deps.wakeup).not.toHaveBeenCalled();
  });
});
