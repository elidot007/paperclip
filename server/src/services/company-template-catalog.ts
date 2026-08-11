import type {
  CompanyTemplateCatalogEntry,
  FactoryExistingCompanyCandidate,
  FactoryOutcomeScoringEvidence,
  FactoryTemplateAssessment,
  FactoryTemplateAssessmentInput,
  FactoryTemplateCandidate,
} from "@paperclipai/shared";

type CatalogSeed = CompanyTemplateCatalogEntry & {
  signals: readonly string[];
};

export type ExistingCompanyForTemplateAssessment = {
  id: string;
  name: string;
  description: string | null;
};

const COMPANIES_REPOSITORY_BASE = "https://github.com/paperclipai/companies/tree/main";

const CATALOG: readonly CatalogSeed[] = [
  {
    id: "default",
    name: "Default",
    description: "Baseline Paperclip roles used as a safe starting point for a new company.",
    sourceUrl: null,
    category: "baseline",
    importMode: "baseline",
    expectedAgentCount: 0,
    expectedSkillCount: 0,
    requiresReview: true,
    signals: ["new company", "new team", "新公司", "新团队", "从零", "基础"],
  },
  {
    id: "gstack",
    name: "GStack",
    description: "Product-aware engineering delivery with planning, review, release, and QA roles.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/gstack`,
    category: "engineering",
    importMode: "direct",
    expectedAgentCount: 5,
    expectedSkillCount: 27,
    requiresReview: true,
    signals: ["software", "engineering", "feature", "web", "app", "api", "release", "deploy", "qa", "开发", "软件", "功能", "网站", "应用", "接口", "发布", "部署", "测试"],
  },
  {
    id: "superpowers",
    name: "Superpowers Dev Shop",
    description: "Disciplined TDD engineering workflow with planning, review, and release gates.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/superpowers`,
    category: "engineering",
    importMode: "direct",
    expectedAgentCount: 4,
    expectedSkillCount: 14,
    requiresReview: true,
    signals: ["tdd", "test driven", "refactor", "debug", "code review", "研发", "测试驱动", "重构", "调试", "代码审查"],
  },
  {
    id: "agentsys-engineering",
    name: "AgentSys Engineering",
    description: "Phase-gated engineering lifecycle from discovery through production delivery.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/agentsys-engineering`,
    category: "engineering",
    importMode: "direct",
    expectedAgentCount: 5,
    expectedSkillCount: 14,
    requiresReview: true,
    signals: ["production", "delivery", "performance", "architecture", "lifecycle", "生产", "交付", "性能", "架构", "生命周期"],
  },
  {
    id: "aeon-intelligence",
    name: "Aeon Intelligence",
    description: "Research, intelligence, analysis, and decision-support organization.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/aeon-intelligence`,
    category: "research",
    importMode: "direct",
    expectedAgentCount: 4,
    expectedSkillCount: 32,
    requiresReview: true,
    signals: ["intelligence", "research", "analysis", "insight", "briefing", "情报", "研究", "调研", "分析", "洞察", "简报"],
  },
  {
    id: "clawteam-research-lab",
    name: "ClawTeam Research Lab",
    description: "Small research laboratory team for evidence-oriented investigation.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/clawteam-research-lab`,
    category: "research",
    importMode: "direct",
    expectedAgentCount: 4,
    expectedSkillCount: 1,
    requiresReview: true,
    signals: ["investigate", "literature", "hypothesis", "evidence", "实验", "论文", "假设", "证据", "研究"],
  },
  {
    id: "redoak-review",
    name: "RedOak Review",
    description: "Independent review and quality-gate team for engineering work.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/redoak-review`,
    category: "security",
    importMode: "review_only",
    expectedAgentCount: 5,
    expectedSkillCount: 6,
    requiresReview: true,
    signals: ["review", "quality", "verification", "pull request", "审核", "质量", "验收", "评审"],
  },
  {
    id: "trail-of-bits-security",
    name: "Trail of Bits Security",
    description: "Security auditing, verification, reverse engineering, and application-security specialists.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/trail-of-bits-security`,
    category: "security",
    importMode: "review_only",
    expectedAgentCount: 28,
    expectedSkillCount: 35,
    requiresReview: true,
    signals: ["security", "audit", "vulnerability", "penetration", "contract", "crypto", "安全", "审计", "漏洞", "渗透", "合约", "密码"],
  },
  {
    id: "product-compass-consulting",
    name: "Product Compass Consulting",
    description: "Product strategy, market, user, growth, and go-to-market specialists.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/product-compass-consulting`,
    category: "product",
    importMode: "curated_roles",
    expectedAgentCount: 48,
    expectedSkillCount: 65,
    requiresReview: true,
    signals: ["product", "market", "customer", "user", "growth", "gtm", "positioning", "产品", "市场", "用户", "增长", "定位", "竞品", "获客"],
  },
  {
    id: "minimax-studio",
    name: "MiniMax Studio",
    description: "Creative studio for content and media-oriented work.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/minimax-studio`,
    category: "creative",
    importMode: "curated_roles",
    expectedAgentCount: 5,
    expectedSkillCount: 10,
    requiresReview: true,
    signals: ["content", "media", "creative", "brand", "copy", "内容", "媒体", "创意", "品牌", "文案", "视频"],
  },
  {
    id: "taches-creative",
    name: "TACHES Creative",
    description: "Creative strategy, research methodology, and workflow optimization expertise.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/taches-creative`,
    category: "creative",
    importMode: "curated_roles",
    expectedAgentCount: 6,
    expectedSkillCount: 35,
    requiresReview: true,
    signals: ["strategy", "workflow", "framework", "creative", "methodology", "策略", "工作流", "方法论", "创意", "框架"],
  },
  {
    id: "clawteam-capital",
    name: "ClawTeam Capital",
    description: "Capital and finance-oriented organization requiring human financial controls.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/clawteam-capital`,
    category: "finance",
    importMode: "catalog_only",
    expectedAgentCount: 7,
    expectedSkillCount: 1,
    requiresReview: true,
    signals: ["finance", "capital", "investment", "portfolio", "financial", "财务", "资本", "投资", "融资", "金融"],
  },
  {
    id: "clawteam-engineering",
    name: "ClawTeam Engineering",
    description: "Alternative engineering organization that requires role-level selection before import.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/clawteam-engineering`,
    category: "engineering",
    importMode: "catalog_only",
    expectedAgentCount: 5,
    expectedSkillCount: 1,
    requiresReview: true,
    signals: ["engineering", "developer", "code", "技术", "工程", "代码", "开发"],
  },
  {
    id: "agency-agents",
    name: "Agency Agents",
    description: "Large multi-specialist agency catalog; select roles instead of importing wholesale.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/agency-agents`,
    category: "general",
    importMode: "catalog_only",
    expectedAgentCount: 167,
    expectedSkillCount: 0,
    requiresReview: true,
    signals: ["agency", "specialist", "multi domain", "代理公司", "专家团队", "多领域"],
  },
  {
    id: "fullstack-forge",
    name: "Fullstack Forge",
    description: "Large full-stack engineering catalog requiring role-level selection.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/fullstack-forge`,
    category: "engineering",
    importMode: "catalog_only",
    expectedAgentCount: 49,
    expectedSkillCount: 66,
    requiresReview: true,
    signals: ["full stack", "frontend", "backend", "mobile", "全栈", "前端", "后端", "移动端"],
  },
  {
    id: "kdense-science-lab",
    name: "K-Dense Science Lab",
    description: "Large scientific research catalog requiring tool and data capability review.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/kdense-science-lab`,
    category: "research",
    importMode: "catalog_only",
    expectedAgentCount: 54,
    expectedSkillCount: 177,
    requiresReview: true,
    signals: ["science", "scientific", "data", "experiment", "biology", "科学", "科研", "数据", "实验", "生物"],
  },
  {
    id: "donchitos-game-studio",
    name: "Donchitos Game Studio",
    description: "Large game-studio template requiring role and asset pipeline review.",
    sourceUrl: `${COMPANIES_REPOSITORY_BASE}/donchitos-game-studio`,
    category: "creative",
    importMode: "catalog_only",
    expectedAgentCount: 48,
    expectedSkillCount: 38,
    requiresReview: true,
    signals: ["game", "gaming", "unity", "art", "游戏", "手游", "美术", "关卡"],
  },
];

function normalize(value: string | null | undefined) {
  return (value ?? "").toLocaleLowerCase();
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function matchSignals(haystack: string, signals: readonly string[]) {
  return unique(signals.filter((signal) => haystack.includes(normalize(signal))));
}

function scoreFromSignals(matches: string[], maxScore = 100) {
  if (matches.length === 0) return 0;
  return Math.min(maxScore, 28 + (matches.length - 1) * 16);
}

function formatSignals(signals: string[]) {
  return signals.slice(0, 5).map((signal) => `“${signal}”`).join("、");
}

export function listCompanyTemplateCatalog(): CompanyTemplateCatalogEntry[] {
  return CATALOG.map(({ signals: _signals, ...entry }) => ({ ...entry }));
}

export function assessCompanyTemplateCatalog(input: {
  request: FactoryTemplateAssessmentInput;
  existingCompanies: ExistingCompanyForTemplateAssessment[];
  outcomeEvidence?: FactoryOutcomeScoringEvidence[];
}): FactoryTemplateAssessment {
  const requestText = normalize([
    input.request.title ?? "",
    input.request.projectName ?? "",
    input.request.requestMarkdown,
  ].join("\n"));
  const requestTerms = unique(requestText
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length >= 2)
    .slice(0, 160));
  const activeOutcomeEvidence = input.outcomeEvidence ?? [];

  const templateCandidates: FactoryTemplateCandidate[] = CATALOG
    .map(({ signals, ...template }) => {
      const matchedSignals = matchSignals(requestText, signals);
      const outcomeEvidence = activeOutcomeEvidence
        .filter((outcome) => outcome.templateId === template.id)
        .map((outcome) => {
          const outcomeText = normalize([
            outcome.title,
            outcome.outcomeMarkdown,
            outcome.retrospectiveMarkdown,
          ].join("\n"));
          const matchedTerms = unique(requestTerms.filter((term) => outcomeText.includes(term))).slice(0, 8);
          const scoreBoost = matchedTerms.length > 0
            ? Math.min(24, 8 + (matchedTerms.length - 1) * 4)
            : 0;
          return {
            outcomeId: outcome.id,
            title: outcome.title,
            matchedTerms,
            scoreBoost,
            expiresAt: outcome.expiresAt,
          };
        })
        .filter((outcome) => outcome.scoreBoost > 0);
      const score = Math.min(
        100,
        scoreFromSignals(matchedSignals) + outcomeEvidence.reduce((total, outcome) => total + outcome.scoreBoost, 0),
      );
      const baseRationale = matchedSignals.length > 0
        ? `Matched request signals ${formatSignals(matchedSignals)}.`
        : "No explicit domain signal matched this template.";
      const outcomeRationale = outcomeEvidence.length > 0
        ? ` Approved company-scoped outcome evidence: ${outcomeEvidence.map((outcome) => `${outcome.title} (+${outcome.scoreBoost}; ${outcome.matchedTerms.map((term) => `“${term}”`).join("、")})`).join("; ")}.`
        : "";
      return {
        template,
        score,
        matchedSignals,
        rationale: `${baseRationale}${outcomeRationale}`,
        outcomeEvidence,
      };
    })
    .sort((left, right) => right.score - left.score || left.template.name.localeCompare(right.template.name));

  const existingCompanyCandidates: FactoryExistingCompanyCandidate[] = input.existingCompanies
    .map((company) => {
      const companyText = normalize(`${company.name}\n${company.description ?? ""}`);
      const matchedSignals = requestTerms.filter((term) => companyText.includes(term)).slice(0, 8);
      const score = scoreFromSignals(matchedSignals, 92);
      return {
        companyId: company.id,
        name: company.name,
        description: company.description,
        score,
        matchedSignals,
        rationale: matchedSignals.length > 0
          ? `Its name or description overlaps with ${formatSignals(matchedSignals)}.`
          : "No material overlap with the request was found.",
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 8);

  const bestTemplate = templateCandidates[0] ?? null;
  const bestExistingCompany = existingCompanyCandidates[0] ?? null;
  let action: FactoryTemplateAssessment["recommendation"]["action"] = "create_baseline_company";
  let rationale = "No focused existing company or catalog template matched strongly; start from the governed baseline and require review before provisioning.";

  if (bestExistingCompany && bestExistingCompany.score >= 60 && bestExistingCompany.score >= (bestTemplate?.score ?? 0) + 12) {
    action = "reuse_existing_company";
    rationale = `Reuse candidate ${bestExistingCompany.name} scored ${bestExistingCompany.score} from explicit request overlap. Review its current capacity, permissions, and reusable Skills before assigning work.`;
  } else if (bestTemplate && bestTemplate.score > 0) {
    if (bestTemplate.template.importMode === "direct" || bestTemplate.template.importMode === "review_only") {
      action = "import_template_new_company";
      rationale = `${bestTemplate.template.name} is the highest explainable catalog match (${bestTemplate.score}). Its ${bestTemplate.template.importMode === "review_only" ? "review-only" : "direct-import"} policy still requires native approval and leaves external side effects blocked.`;
    } else if (bestTemplate.template.importMode === "curated_roles" || bestTemplate.template.importMode === "catalog_only") {
      action = "compose_template_roles";
      rationale = `${bestTemplate.template.name} is the best domain match (${bestTemplate.score}), but its policy requires role-level composition rather than a wholesale import.`;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    inputSummary:
      input.request.title?.trim()
      || input.request.projectName?.trim()
      || input.request.requestMarkdown.trim().slice(0, 180),
    templateCandidates,
    existingCompanyCandidates,
    recommendation: {
      action,
      templateId: bestTemplate?.score ? bestTemplate.template.id : null,
      existingCompanyId: action === "reuse_existing_company" ? bestExistingCompany?.companyId ?? null : null,
      requiresApproval: true,
      externalSideEffectsBlocked: true,
      rationale,
    },
  };
}
