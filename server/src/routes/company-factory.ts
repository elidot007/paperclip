import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createFactoryRequestSchema,
  createFactoryOutcomeSchema,
  factoryIntakeSchema,
  factoryOutcomeListQuerySchema,
  factoryRequestListQuerySchema,
  factoryTemplateAssessmentSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { companyFactoryService } from "../services/company-factory.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

/**
 * Board-facing API for the deliberately narrow Phase-1 Factory vertical slice:
 * request -> reviewable proposal -> native confirmation -> internal provisioning.
 */
export function companyFactoryRoutes(db: Db) {
  const router = Router();
  const svc = companyFactoryService(db);

  router.get("/companies/:companyId/factory/templates", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    res.json(svc.listTemplates());
  });

  router.post(
    "/companies/:companyId/factory/templates/assess",
    validate(factoryTemplateAssessmentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);
      res.json(await svc.assessTemplates(companyId, req.body));
    },
  );

  router.post(
    "/companies/:companyId/factory/intake",
    validate(factoryIntakeSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      res.json(await svc.intake(companyId, req.body));
    },
  );

  router.get("/companies/:companyId/factory/outcomes", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const parsed = factoryOutcomeListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid Factory outcome query", details: parsed.error.flatten() });
      return;
    }
    const includeInactive = parsed.data.includeInactive === "true";
    if (includeInactive) assertBoard(req);
    res.json(await svc.listOutcomes(companyId, { includeInactive }));
  });

  router.get("/companies/:companyId/factory/requests", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const parsed = factoryRequestListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid Factory request query", details: parsed.error.flatten() });
      return;
    }
    res.json(await svc.list(companyId, parsed.data));
  });

  router.post(
    "/companies/:companyId/factory/requests",
    validate(createFactoryRequestSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      const request = await svc.create(companyId, req.body, {
        userId: req.actor.userId ?? "board",
        isInstanceAdmin: req.actor.isInstanceAdmin === true,
      });
      res.status(201).json(request);
    },
  );

  router.post(
    "/companies/:companyId/factory/requests/:requestId/outcomes",
    validate(createFactoryOutcomeSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const requestId = req.params.requestId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      const outcome = await svc.createOutcome(companyId, requestId, req.body, {
        userId: req.actor.userId ?? "board",
        isInstanceAdmin: req.actor.isInstanceAdmin === true,
      });
      res.status(201).json(outcome);
    },
  );

  router.post("/companies/:companyId/factory/outcomes/:outcomeId/promote", async (req, res) => {
    const companyId = req.params.companyId as string;
    const outcomeId = req.params.outcomeId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await svc.promoteOutcome(companyId, outcomeId, {
      userId: req.actor.userId ?? "board",
      isInstanceAdmin: req.actor.isInstanceAdmin === true,
    }));
  });

  router.get("/companies/:companyId/factory/requests/:requestId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const requestId = req.params.requestId as string;
    assertCompanyAccess(req, companyId);
    const request = await svc.get(companyId, requestId);
    if (!request) {
      res.status(404).json({ error: "Factory request not found" });
      return;
    }
    res.json(request);
  });

  router.post("/companies/:companyId/factory/requests/:requestId/propose", async (req, res) => {
    const companyId = req.params.companyId as string;
    const requestId = req.params.requestId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await svc.propose(companyId, requestId, {
      userId: req.actor.userId ?? "board",
      isInstanceAdmin: req.actor.isInstanceAdmin === true,
    }));
  });

  router.post("/companies/:companyId/factory/requests/:requestId/apply", async (req, res) => {
    const companyId = req.params.companyId as string;
    const requestId = req.params.requestId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await svc.apply(companyId, requestId, {
      userId: req.actor.userId ?? "board",
      isInstanceAdmin: req.actor.isInstanceAdmin === true,
    }));
  });

  return router;
}
