import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agentWakeupRequests,
  agents,
  companies,
  companyFactoryRequests,
  issues,
} from "@paperclipai/db";
import { evaluateAgentInvokability } from "./agent-invokability.js";
import { logActivity } from "./activity-log.js";
import { logger } from "../middleware/logger.js";

/**
 * Factory Autopilot — the "无人公司" execution driver.
 *
 * Paperclip's Factory provisions agents paused and issues in backlog, and
 * `queueIssueAssignmentWakeup` deliberately skips backlog issues
 * (issue-assignment-wakeup.ts). Nothing was waking the approved DAG, so an
 * approved project sat idle until a human manually poked each agent.
 *
 * This tick closes that gap: for every applied Factory request in an active
 * company, it finds dependency-ready backlog/todo issues, resumes the
 * Factory-owned assignee if it is still paused, and wakes it with
 * source="automation". The existing heartbeat execution path then
 * auto-checkouts the issue and runs it, so no new execution engine is needed.
 *
 * Safety: it only touches agents carrying metadata.factoryRequestId (i.e.
 * agents this Factory created), never grants permissions, never bypasses the
 * Board approval gate for external side effects, and is fully disabled by
 * setting PAPERCLIP_FACTORY_AUTOPILOT_ENABLED=false.
 */
export interface FactoryAutopilotDeps {
  wakeup: (
    agentId: string,
    opts: {
      source?: "timer" | "assignment" | "on_demand" | "automation";
      triggerDetail?: "manual" | "ping" | "callback" | "system";
      reason?: string | null;
      payload?: Record<string, unknown> | null;
      idempotencyKey?: string | null;
      requestedByActorType?: "user" | "agent" | "system";
      requestedByActorId?: string | null;
      contextSnapshot?: Record<string, unknown>;
    },
  ) => Promise<unknown>;
  resumeAgent: (agentId: string) => Promise<{ id: string } | null>;
  listDependencyReadiness: (
    companyId: string,
    issueIds: string[],
  ) => Promise<Map<string, { isDependencyReady: boolean }>>;
}

type FactoryRequestRow = typeof companyFactoryRequests.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type IssueRow = typeof issues.$inferSelect;

export interface FactoryAutopilotTickResult {
  checkedRequests: number;
  readyIssues: number;
  woken: number;
  resumed: number;
  skipped: Array<{ issueId: string; reason: string }>;
}

function autopilotEnabled(): boolean {
  return process.env.PAPERCLIP_FACTORY_AUTOPILOT_ENABLED?.trim().toLowerCase() !== "false";
}

function toOrgRow(agent: Pick<AgentRow, "id" | "companyId" | "name" | "reportsTo" | "status">) {
  return { id: agent.id, companyId: agent.companyId, name: agent.name, reportsTo: agent.reportsTo, status: agent.status };
}

export function factoryAutopilotService(db: Db, deps: FactoryAutopilotDeps) {
  const { wakeup, resumeAgent, listDependencyReadiness } = deps;

  async function listAppliedRequests(): Promise<Array<FactoryRequestRow & { companyStatus: string }>> {
    const rows = await db
      .select({
        id: companyFactoryRequests.id,
        companyId: companyFactoryRequests.companyId,
        title: companyFactoryRequests.title,
        requestMarkdown: companyFactoryRequests.requestMarkdown,
        projectName: companyFactoryRequests.projectName,
        projectDescription: companyFactoryRequests.projectDescription,
        workspaceCwd: companyFactoryRequests.workspaceCwd,
        templateSelection: companyFactoryRequests.templateSelection,
        reviewProjectId: companyFactoryRequests.reviewProjectId,
        status: companyFactoryRequests.status,
        proposal: companyFactoryRequests.proposal,
        proposalRevision: companyFactoryRequests.proposalRevision,
        reviewIssueId: companyFactoryRequests.reviewIssueId,
        approvalInteractionId: companyFactoryRequests.approvalInteractionId,
        appliedProjectId: companyFactoryRequests.appliedProjectId,
        appliedResources: companyFactoryRequests.appliedResources,
        idempotencyKey: companyFactoryRequests.idempotencyKey,
        failureReason: companyFactoryRequests.failureReason,
        createdByAgentId: companyFactoryRequests.createdByAgentId,
        createdByUserId: companyFactoryRequests.createdByUserId,
        approvedAt: companyFactoryRequests.approvedAt,
        appliedAt: companyFactoryRequests.appliedAt,
        createdAt: companyFactoryRequests.createdAt,
        updatedAt: companyFactoryRequests.updatedAt,
        companyStatus: companies.status,
      })
      .from(companyFactoryRequests)
      .innerJoin(companies, eq(companies.id, companyFactoryRequests.companyId))
      .where(
        and(
          eq(companyFactoryRequests.status, "applied"),
          eq(companies.status, "active"),
          isNotNull(companyFactoryRequests.appliedProjectId),
        ),
      );
    return rows as Array<FactoryRequestRow & { companyStatus: string }>;
  }

  async function listProjectPendingIssues(
    companyId: string,
    projectId: string,
  ): Promise<IssueRow[]> {
    return db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.projectId, projectId),
          inArray(issues.status, ["backlog", "todo"]),
          isNotNull(issues.assigneeAgentId),
        ),
      );
  }

  async function listCompanyAgents(companyId: string): Promise<Array<Pick<AgentRow, "id" | "companyId" | "name" | "reportsTo" | "status" | "metadata">>> {
    return db
      .select({
        id: agents.id,
        companyId: agents.companyId,
        name: agents.name,
        reportsTo: agents.reportsTo,
        status: agents.status,
        metadata: agents.metadata,
      })
      .from(agents)
      .where(eq(agents.companyId, companyId));
  }

  async function hasPendingWakeup(companyId: string, agentId: string, issueId: string): Promise<boolean> {
    const row = await db
      .select({ id: agentWakeupRequests.id })
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          eq(agentWakeupRequests.agentId, agentId),
          inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution", "claimed"]),
          sql`(
            ${agentWakeupRequests.payload} ->> 'issueId' = ${issueId}
            or ${agentWakeupRequests.payload} ->> 'taskId' = ${issueId}
            or ${agentWakeupRequests.payload} -> '_paperclipWakeContext' ->> 'issueId' = ${issueId}
            or ${agentWakeupRequests.payload} -> '_paperclipWakeContext' ->> 'taskId' = ${issueId}
          )`,
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return Boolean(row);
  }

  async function tick(now: Date = new Date()): Promise<FactoryAutopilotTickResult> {
    const result: FactoryAutopilotTickResult = {
      checkedRequests: 0,
      readyIssues: 0,
      woken: 0,
      resumed: 0,
      skipped: [],
    };
    if (!autopilotEnabled()) {
      return result;
    }

    const requests = await listAppliedRequests();
    result.checkedRequests = requests.length;

    for (const request of requests) {
      const companyId = request.companyId;
      const projectId = request.appliedProjectId!;
      let companyAgents: Awaited<ReturnType<typeof listCompanyAgents>> = [];
      try {
        companyAgents = await listCompanyAgents(companyId);
      } catch (err) {
        logger.warn({ err, companyId, requestId: request.id }, "factory-autopilot: failed to list company agents");
        continue;
      }

      const pendingIssues = await listProjectPendingIssues(companyId, projectId);
      if (pendingIssues.length === 0) continue;

      const readinessMap = await listDependencyReadiness(
        companyId,
        pendingIssues.map((issue) => issue.id),
      );

      for (const issue of pendingIssues) {
        const readiness = readinessMap.get(issue.id);
        if (!readiness?.isDependencyReady) {
          continue;
        }
        result.readyIssues += 1;

        const agent = companyAgents.find((candidate) => candidate.id === issue.assigneeAgentId);
        if (!agent) {
          result.skipped.push({ issueId: issue.id, reason: "assignee_missing" });
          continue;
        }
        // Only drive agents this Factory created. Never touch unrelated agents.
        if (!(agent.metadata?.factoryRequestId)) {
          result.skipped.push({ issueId: issue.id, reason: "non_factory_assignee" });
          continue;
        }

        const invokability = evaluateAgentInvokability(toOrgRow(agent), companyAgents.map(toOrgRow));
        if (!invokability.invokable) {
          if (invokability.reason === "paused") {
            try {
              const resumed = await resumeAgent(agent.id);
              if (!resumed) {
                result.skipped.push({ issueId: issue.id, reason: "resume_failed" });
                continue;
              }
              result.resumed += 1;
              await logActivity(db, {
                companyId,
                actorType: "system",
                actorId: "factory-autopilot",
                action: "company_factory.autopilot_agent_resumed",
                entityType: "agent",
                entityId: agent.id,
                details: {
                  factoryRequestId: request.id,
                  issueId: issue.id,
                  reason: invokability.message,
                },
              });
            } catch (err) {
              logger.warn({ err, agentId: agent.id, issueId: issue.id }, "factory-autopilot: resume failed");
              result.skipped.push({ issueId: issue.id, reason: "resume_error" });
              continue;
            }
          } else {
            result.skipped.push({ issueId: issue.id, reason: `agent_not_invokable:${invokability.reason}` });
            continue;
          }
        }

        if (await hasPendingWakeup(companyId, agent.id, issue.id)) {
          result.skipped.push({ issueId: issue.id, reason: "wakeup_already_pending" });
          continue;
        }

        try {
          await wakeup(agent.id, {
            source: "automation",
            triggerDetail: "system",
            reason: "factory-autopilot: dependency-ready issue",
            payload: { issueId: issue.id },
            idempotencyKey: `factory-autopilot:${issue.id}`,
            requestedByActorType: "system",
            requestedByActorId: "factory-autopilot",
            contextSnapshot: { issueId: issue.id },
          });
          result.woken += 1;
        } catch (err) {
          logger.warn({ err, agentId: agent.id, issueId: issue.id }, "factory-autopilot: wakeup failed");
          result.skipped.push({ issueId: issue.id, reason: "wakeup_error" });
        }
      }
    }

    return result;
  }

  return { tick };
}
