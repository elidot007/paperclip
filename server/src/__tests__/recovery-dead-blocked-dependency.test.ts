import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  issueComments,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const mockTelemetryClient = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../telemetry.ts", () => ({ getTelemetryClient: () => mockTelemetryClient }));

import { recoveryService } from "../services/recovery/service.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres dead-blocked dependency tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("recovery reconcileResolvedDependencyWakeBackstop dead-blocked release", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-dead-blocked-dependency-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  const enqueueWakeup = vi.fn(async () => undefined);

  async function seed(dependent: {
    description?: string | null;
    monitorNextCheckAt?: Date | null;
  } = {}) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const blockerIssueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Release",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: blockerIssueId,
      companyId,
      title: "Blocker",
      status: "done",
      priority: "high",
      assigneeAgentId: agentId,
    });

    const dependentIssueId = randomUUID();
    await db.insert(issues).values({
      id: dependentIssueId,
      companyId,
      title: "Dependent",
      // The AUT-900 shape: blocked, assigned, every blocker already done.
      status: "blocked",
      priority: "high",
      assigneeAgentId: agentId,
      blockedTransitionAt: new Date(),
      description: dependent.description ?? null,
      monitorNextCheckAt: dependent.monitorNextCheckAt ?? null,
    });
    await db.insert(issueRelations).values({
      companyId,
      issueId: blockerIssueId,
      relatedIssueId: dependentIssueId,
      type: "blocks",
    });

    return { companyId, agentId, blockerIssueId, dependentIssueId };
  }

  const sweep = (opts: { companyId: string; blockerIssueId: string }) =>
    recoveryService(db, { enqueueWakeup }).reconcileResolvedDependencyWakeBackstop({
      ...opts,
      source: "issue.blockers_resolved",
    });

  const readStatus = (issueId: string) =>
    db
      .select({
        status: issues.status,
        blockedTransitionAt: issues.blockedTransitionAt,
        unblockDescriptor: issues.unblockDescriptor,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);

  it("releases a dependent left blocked with every blocker already done", async () => {
    const { companyId, blockerIssueId, dependentIssueId } = await seed();

    // Pre-fix this is the whole defect: the wake fires, the status never moves.
    const result = await sweep({ companyId, blockerIssueId });

    expect(result.statusReleased).toBe(1);
    expect(result.issueIds).toContain(dependentIssueId);
    expect(await readStatus(dependentIssueId)).toMatchObject({
      status: "todo",
      blockedTransitionAt: null,
      unblockDescriptor: null,
    });

    const audit = await db
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(eq(activityLog.action, "issue.updated"))
      .then((rows) => rows[0]);
    expect(
      (audit?.details as { reason?: string } | null | undefined)?.reason,
    ).toBe("resolved_dependency_deadlock");
  });

  it("leaves a dependent alone while a blocker is still unresolved", async () => {
    const { companyId, blockerIssueId, dependentIssueId } = await seed();
    await db
      .update(issues)
      .set({ status: "in_progress" })
      .where(eq(issues.id, blockerIssueId));

    const result = await sweep({ companyId, blockerIssueId });

    expect(result.statusReleased).toBe(0);
    expect((await readStatus(dependentIssueId))?.status).toBe("blocked");
  });

  it("leaves an externally held dependent alone even with every blocker done", async () => {
    const { companyId, blockerIssueId, dependentIssueId } = await seed({
      description: "Waiting on the vendor.\n\nexternal owner: Legal\n external action: countersign",
    });

    const result = await sweep({ companyId, blockerIssueId });

    expect(result.statusReleased).toBe(0);
    expect(result.statusReleaseHeld).toBe(1);
    expect((await readStatus(dependentIssueId))?.status).toBe("blocked");
  });

  it("leaves a monitored dependent alone even with every blocker done", async () => {
    const { companyId, blockerIssueId, dependentIssueId } = await seed({
      monitorNextCheckAt: new Date(Date.now() + 30 * 60_000),
    });

    const result = await sweep({ companyId, blockerIssueId });

    expect(result.statusReleased).toBe(0);
    expect((await readStatus(dependentIssueId))?.status).toBe("blocked");
  });

  it("is idempotent — a second pass finds nothing left to release", async () => {
    const { companyId, blockerIssueId } = await seed();

    const first = await sweep({ companyId, blockerIssueId });
    const second = await sweep({ companyId, blockerIssueId });

    expect(first.statusReleased).toBe(1);
    expect(second.statusReleased).toBe(0);
    expect((await readStatus(blockerIssueId))?.status).toBe("done");
  });
});
