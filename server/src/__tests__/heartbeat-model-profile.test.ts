import { describe, expect, it } from "vitest";
import {
  listAdapterModelProfiles,
  type AdapterModelProfileDefinition,
} from "../adapters/index.js";
import {
  mergeModelProfileAdapterConfig,
  normalizeModelProfileWakeContext,
  resolveModelProfileApplication,
  isConfigurationIncompleteFailedRun,
} from "../services/heartbeat.ts";

const cheapProfile: AdapterModelProfileDefinition = {
  key: "cheap",
  label: "Cheap",
  adapterConfig: {
    model: "adapter-cheap",
    modelReasoningEffort: "low",
  },
  source: "adapter_default",
};

describe("heartbeat model profile application", () => {
  it("keeps Codex on its primary model when cheap has no explicit model override", async () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: await listAdapterModelProfiles("codex_local"),
      agentRuntimeConfig: {},
      issueModelProfile: "cheap",
      contextSnapshot: {},
    });

    const merged = mergeModelProfileAdapterConfig({
      baseConfig: { model: "primary" },
      modelProfile,
      issueAdapterConfig: null,
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      requestedBy: "issue_override",
      applied: "cheap",
      configSource: "adapter_default",
      fallbackReason: null,
      adapterConfig: {},
    });
    expect(merged).toEqual({ model: "primary" });
  });

  it("applies cheap profile patches before explicit issue adapter config overrides", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [cheapProfile],
      agentRuntimeConfig: {},
      issueModelProfile: "cheap",
      contextSnapshot: {},
    });

    const merged = mergeModelProfileAdapterConfig({
      baseConfig: {
        model: "primary",
        modelReasoningEffort: "high",
        approvalPolicy: "strict",
      },
      modelProfile,
      issueAdapterConfig: {
        model: "issue-explicit",
      },
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      requestedBy: "issue_override",
      applied: "cheap",
      configSource: "adapter_default",
      fallbackReason: null,
    });
    expect(merged).toEqual({
      model: "issue-explicit",
      modelReasoningEffort: "low",
      approvalPolicy: "strict",
    });
  });

  it("lets agent runtime profile config customize adapter defaults", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [cheapProfile],
      agentRuntimeConfig: {
        modelProfiles: {
          cheap: {
            adapterConfig: {
              model: "agent-cheap",
            },
          },
        },
      },
      issueModelProfile: null,
      contextSnapshot: { modelProfile: "cheap" },
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      requestedBy: "wake_context",
      applied: "cheap",
      configSource: "agent_runtime",
      adapterConfig: {
        model: "agent-cheap",
        modelReasoningEffort: "low",
      },
    });
  });

  it("falls back to the primary config when the adapter does not support the requested profile", () => {
    const modelProfile = resolveModelProfileApplication({
      adapterModelProfiles: [],
      agentRuntimeConfig: {
        modelProfiles: {
          cheap: {
            adapterConfig: {
              model: "agent-cheap",
            },
          },
        },
      },
      issueModelProfile: null,
      contextSnapshot: { modelProfile: "cheap" },
    });

    const merged = mergeModelProfileAdapterConfig({
      baseConfig: {
        model: "primary",
      },
      modelProfile,
      issueAdapterConfig: null,
    });

    expect(modelProfile).toMatchObject({
      requested: "cheap",
      applied: null,
      fallbackReason: "adapter_profile_not_supported",
      adapterConfig: null,
    });
    expect(merged).toEqual({ model: "primary" });
  });

  it("normalizes a wake payload model profile into run context", () => {
    const contextSnapshot = normalizeModelProfileWakeContext({
      contextSnapshot: {},
      payload: { modelProfile: "cheap" },
    });

    expect(contextSnapshot).toMatchObject({ modelProfile: "cheap" });
  });

  // AUT-906: the stranded_assigned_issue recovery re-applies modelProfile:"cheap" to
  // issues it is trying to rescue. On the local fleet the claude_local adapter's
  // built-in cheap default is a Claude id the upstream does not serve, so the rescue
  // run 401s and re-triggers the recovery that wrote it. These three cases pin the
  // only shape that is safe (enabled:false) against the two that fail open.
  describe("cheap profile on a fleet whose upstream serves no Claude ids", () => {
    const agentLane = { model: "space-bunny-free[1m]", effort: "high" };

    it("DISABLED is the only shape that keeps the run on the agent's own lane", () => {
      const modelProfile = resolveModelProfileApplication({
        adapterModelProfiles: [cheapProfile],
        agentRuntimeConfig: {
          modelProfiles: { cheap: { enabled: false, adapterConfig: {} } },
        },
        issueModelProfile: "cheap",
        contextSnapshot: {},
      });

      expect(modelProfile).toMatchObject({
        requested: "cheap",
        requestedBy: "issue_override",
        applied: null,
        configSource: null,
        fallbackReason: "agent_runtime_profile_disabled",
        adapterConfig: null,
      });
      expect(
        mergeModelProfileAdapterConfig({
          baseConfig: agentLane,
          modelProfile,
          issueAdapterConfig: null,
        }),
      ).toEqual(agentLane);
    });

    it("ABSENT fails open to the adapter default, it does not fall back safely", () => {
      // An empty or missing slot is the shape AUT-931/D left behind on all 11 agents.
      for (const agentRuntimeConfig of [{}, { modelProfiles: {} }, { modelProfiles: { cheap: {} } }]) {
        const modelProfile = resolveModelProfileApplication({
          adapterModelProfiles: [cheapProfile],
          agentRuntimeConfig,
          issueModelProfile: "cheap",
          contextSnapshot: {},
        });

        expect(modelProfile).toMatchObject({
          requested: "cheap",
          applied: "cheap",
          configSource: "adapter_default",
          fallbackReason: null,
        });
        expect(
          mergeModelProfileAdapterConfig({
            baseConfig: agentLane,
            modelProfile,
            issueAdapterConfig: null,
          }),
        ).not.toEqual(agentLane);
      }
    });

    it("a disabled slot keeps a retired model id parked instead of live", () => {
      // The dead id is unreachable while disabled, and becomes live again the moment
      // `enabled` is flipped — which is why removing the id is not the same as defusing.
      const parked = resolveModelProfileApplication({
        adapterModelProfiles: [cheapProfile],
        agentRuntimeConfig: {
          modelProfiles: {
            cheap: { enabled: false, adapterConfig: { model: "mimo-v2.6-pro" } },
          },
        },
        issueModelProfile: "cheap",
        contextSnapshot: {},
      });
      expect(parked).toMatchObject({ applied: null, adapterConfig: null });

      const revived = resolveModelProfileApplication({
        adapterModelProfiles: [cheapProfile],
        agentRuntimeConfig: {
          modelProfiles: {
            cheap: { enabled: true, adapterConfig: { model: "mimo-v2.6-pro" } },
          },
        },
        issueModelProfile: "cheap",
        contextSnapshot: {},
      });
      expect(revived).toMatchObject({ applied: "cheap", configSource: "agent_runtime" });
      expect(revived.adapterConfig).toMatchObject({ model: "mimo-v2.6-pro" });
    });
  });

  it("treats model resolution failures as non-retryable configuration failures", () => {
    expect(isConfigurationIncompleteFailedRun({ errorCode: "model_not_found" })).toBe(true);
    expect(isConfigurationIncompleteFailedRun({ errorCode: "provider_quota" })).toBe(false);
  });
});
