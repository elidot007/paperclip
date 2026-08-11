import { describe, expect, it } from "vitest";
import {
  assessCompanyTemplateCatalog,
  listCompanyTemplateCatalog,
} from "../services/company-template-catalog.js";

describe("company template catalog", () => {
  it("keeps the curated upstream catalog explicit about direct and guarded import modes", () => {
    const catalog = listCompanyTemplateCatalog();

    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "gstack", importMode: "direct", category: "engineering" }),
      expect.objectContaining({ id: "trail-of-bits-security", importMode: "review_only", category: "security" }),
      expect.objectContaining({ id: "agency-agents", importMode: "catalog_only" }),
    ]));
    expect(catalog.every((entry) => entry.requiresReview)).toBe(true);
  });

  it("matches a security request to a review-gated template without claiming that it was imported", () => {
    const assessment = assessCompanyTemplateCatalog({
      request: {
        title: "Audit a smart contract",
        requestMarkdown: "Perform a security audit for a smart contract, identify vulnerabilities, and provide evidence-backed remediation guidance.",
      },
      existingCompanies: [],
    });

    expect(assessment.templateCandidates[0]).toEqual(expect.objectContaining({
      template: expect.objectContaining({ id: "trail-of-bits-security", importMode: "review_only" }),
    }));
    expect(assessment.recommendation).toEqual(expect.objectContaining({
      action: "import_template_new_company",
      templateId: "trail-of-bits-security",
      requiresApproval: true,
      externalSideEffectsBlocked: true,
    }));
  });

  it("prefers a strong existing-company reuse candidate over a weaker new template match", () => {
    const assessment = assessCompanyTemplateCatalog({
      request: {
        title: "Product market research",
        requestMarkdown: "Research market and user needs for a product growth initiative.",
      },
      existingCompanies: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Product Market Research Guild",
          description: "Product, market, user, and growth research team.",
        },
      ],
    });

    expect(assessment.existingCompanyCandidates[0]).toEqual(expect.objectContaining({
      companyId: "11111111-1111-4111-8111-111111111111",
      name: "Product Market Research Guild",
    }));
    expect(assessment.recommendation).toEqual(expect.objectContaining({
      action: "reuse_existing_company",
      existingCompanyId: "11111111-1111-4111-8111-111111111111",
    }));
  });

  it("uses only supplied approved company-local outcome evidence and exposes its provenance", () => {
    const assessment = assessCompanyTemplateCatalog({
      request: {
        title: "Ship a web API feature",
        requestMarkdown: "Deliver an engineering API feature with QA and a release checklist.",
      },
      existingCompanies: [],
      outcomeEvidence: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          templateId: "gstack",
          title: "Previous web API delivery",
          outcomeMarkdown: "The engineering team delivered a web API feature with QA evidence.",
          retrospectiveMarkdown: "Keep the release checklist and QA gate for similar API work.",
          approvedAt: new Date("2026-08-01T00:00:00.000Z"),
          expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        },
      ],
    });

    const gstack = assessment.templateCandidates.find((candidate) => candidate.template.id === "gstack");
    expect(gstack).toEqual(expect.objectContaining({
      score: expect.any(Number),
      outcomeEvidence: [expect.objectContaining({
        outcomeId: "22222222-2222-4222-8222-222222222222",
        title: "Previous web API delivery",
        scoreBoost: expect.any(Number),
      })],
    }));
    expect(gstack?.outcomeEvidence[0]?.scoreBoost).toBeGreaterThan(0);
    expect(gstack?.rationale).toContain("Approved company-scoped outcome evidence");
    expect(assessment.templateCandidates.find((candidate) => candidate.template.id === "superpowers")?.outcomeEvidence)
      .toEqual([]);
  });
});
