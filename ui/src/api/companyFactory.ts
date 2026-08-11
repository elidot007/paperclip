import type {
  CompanyTemplateCatalogEntry,
  CreateFactoryOutcome,
  CreateFactoryRequest,
  FactoryOutcomeRecord,
  FactoryIntakeInput,
  FactoryIntakeResult,
  FactoryRequest,
  FactoryRequestStatus,
  FactoryTemplateAssessment,
  FactoryTemplateAssessmentInput,
} from "@paperclipai/shared";
import { api } from "./client";

export const companyFactoryApi = {
  listTemplates: (companyId: string) =>
    api.get<CompanyTemplateCatalogEntry[]>(`/companies/${companyId}/factory/templates`),
  assessTemplates: (companyId: string, data: FactoryTemplateAssessmentInput) =>
    api.post<FactoryTemplateAssessment>(`/companies/${companyId}/factory/templates/assess`, data),
  intake: (companyId: string, data: FactoryIntakeInput) =>
    api.post<FactoryIntakeResult>(`/companies/${companyId}/factory/intake`, data),
  listOutcomes: (companyId: string, includeInactive = false) =>
    api.get<FactoryOutcomeRecord[]>(
      `/companies/${companyId}/factory/outcomes${includeInactive ? "?includeInactive=true" : ""}`,
    ),
  list: (companyId: string, status?: FactoryRequestStatus) =>
    api.get<FactoryRequest[]>(
      `/companies/${companyId}/factory/requests${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  get: (companyId: string, requestId: string) =>
    api.get<FactoryRequest>(`/companies/${companyId}/factory/requests/${requestId}`),
  create: (companyId: string, data: CreateFactoryRequest) =>
    api.post<FactoryRequest>(`/companies/${companyId}/factory/requests`, data),
  createOutcome: (companyId: string, requestId: string, data: CreateFactoryOutcome) =>
    api.post<FactoryOutcomeRecord>(`/companies/${companyId}/factory/requests/${requestId}/outcomes`, data),
  promoteOutcome: (companyId: string, outcomeId: string) =>
    api.post<FactoryOutcomeRecord>(`/companies/${companyId}/factory/outcomes/${outcomeId}/promote`, {}),
  propose: (companyId: string, requestId: string) =>
    api.post<FactoryRequest>(`/companies/${companyId}/factory/requests/${requestId}/propose`, {}),
  apply: (companyId: string, requestId: string) =>
    api.post<FactoryRequest>(`/companies/${companyId}/factory/requests/${requestId}/apply`, {}),
};
