import { describe, expect, it } from "vitest";
import {
  claudeModelUsageTotals,
  parseClaudeStreamJson,
  detectClaudeLoginRequired,
  extractClaudeRetryNotBefore,
  isClaudeProviderQuotaError,
  isClaudeTransientUpstreamError,
  isClaudePoisonedPreviousMessageIdError,
  isClaudeRefusalResult,
  isClaudeUnknownSessionError,
  isClaudeImageProcessingError,
  isClaudeModelNotFoundError,
  isClaudeModelNotFoundFailure,
} from "./parse.js";

describe("detectClaudeLoginRequired", () => {
  it("classifies Claude's invalid API key login prompt as auth required", () => {
    expect(
      detectClaudeLoginRequired({
        parsed: null,
        stdout: "",
        stderr: "Invalid API key · Please run /login",
      }),
    ).toEqual({ requiresLogin: true, loginUrl: null });
  });

  it("does not classify a bare invalid API key as the Claude login flow", () => {
    expect(
      detectClaudeLoginRequired({
        parsed: null,
        stdout: "",
        stderr: "Invalid API key",
      }).requiresLogin,
    ).toBe(false);
  });

  // AUT-1145, reproduced from run 7bfed83d (subtype=error_max_turns, num_turns=61).
  // The detector used to scan the whole stdout line-by-line, so the transcript the
  // model read — here the `CLAUDE_AUTH_REQUIRED_RE` literal from this very file —
  // was indistinguishable from the run's own failure. The platform stamped
  // `claude_auth_required`, set wakePolicy manual_repair_required, and enqueued no
  // wake; 16 such lines existed in that run and zero auth text in its result record.
  it("ignores auth phrases quoted in the transcript and reads only the CLI's own error records", () => {
    const quotedSource = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          content: '9:const CLAUDE_AUTH_REQUIRED_RE = /(?:not\\s+logged\\s+in|login\\s+required|unauthorized)/i;',
        }],
      },
    });
    const assistantText = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "The guard returns unauthorized when login is required." }] },
    });
    const resultRecord = JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      terminal_reason: "max_turns",
      num_turns: 61,
      is_error: true,
      result: "Reached the turn limit; nothing was left to hand back.",
    });

    // The quoted transcript really does carry auth phrases…
    expect(/(?:not\s+logged\s+in|unauthorized|login\s+required)/i.test(quotedSource)).toBe(true);
    // …but none of them may vote.
    expect(
      detectClaudeLoginRequired({
        parsed: JSON.parse(resultRecord),
        stdout: `${quotedSource}\n${assistantText}\n${resultRecord}`,
        stderr: "",
      }).requiresLogin,
    ).toBe(false);
  });

  it("does not take a successful run's closing message as an auth verdict", () => {
    // The closing message of a clean run is text the run produced, not a verdict
    // about the run, so auth wording inside it must not force a login stamp.
    expect(
      detectClaudeLoginRequired({
        parsed: {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Checked the endpoint; it returned unauthorized for an anonymous caller.",
        },
        stdout: "",
        stderr: "",
      }).requiresLogin,
    ).toBe(false);
  });

  it("still reads auth text from an error result record and from stderr", () => {
    expect(
      detectClaudeLoginRequired({
        parsed: { subtype: "error_during_execution", is_error: true, result: "API Error: 401 Unauthorized" },
        stdout: "",
        stderr: "",
      }).requiresLogin,
    ).toBe(true);

    expect(
      detectClaudeLoginRequired({
        parsed: null,
        stdout: "",
        stderr: "Please log in. Run `claude login` first.",
      }).requiresLogin,
    ).toBe(true);
  });
});

describe("isClaudeModelNotFoundError", () => {
  it("detects model resolution failures from structured and fallback output", () => {
    expect(isClaudeModelNotFoundError({
      parsed: {
        result: "API Error: 404 model not found: claude-haiku-4-6",
      },
    })).toBe(true);
    expect(isClaudeModelNotFoundError({
      stderr: "Unknown model claude-haiku-4-6",
    })).toBe(true);
  });

  it("does not classify unrelated provider failures as model resolution errors", () => {
    expect(isClaudeModelNotFoundError({
      errorMessage: "API Error: 503 service unavailable",
    })).toBe(false);
  });
});

describe("isClaudeModelNotFoundFailure", () => {
  // AUT-735, reproduced from the real AUT-726 runs. A `--resume`d session's stdout
  // quotes the previous turn, and the previous turn's run was itself stamped
  // `model_not_found`. The raw regex matches that quoted text, so a run that died
  // at the turn cap was stamped `model_not_found`; the platform then read it as a
  // missing key, set `wakePolicy: manual_repair_required`, and enqueued no wake.
  it("does not let a quoted model_not_found in resumed stdout beat this run's own turn-cap verdict", () => {
    const quotedPreviousRun = JSON.stringify({
      run: "348bfdfb",
      errorCode: "model_not_found",
      note: "the run before this one was stamped model_not_found",
    });

    expect(isClaudeModelNotFoundError({
      parsed: { subtype: "error_max_turns", is_error: true, stopReason: "max_turns_exhausted", num_turns: 61 },
      stdout: `Reading prior transcript…\n${quotedPreviousRun}\nReached turn limit.`,
    })).toBe(true); // the raw regex really does match the quoted text

    expect(isClaudeModelNotFoundFailure({
      parsed: { subtype: "error_max_turns", is_error: true, stopReason: "max_turns_exhausted", num_turns: 61 },
      stdout: `Reading prior transcript…\n${quotedPreviousRun}\nReached turn limit.`,
    })).toBe(false); // …but the structured turn-cap verdict wins
  });

  it("still reports a genuine model resolution failure when the run did not hit the turn cap", () => {
    expect(isClaudeModelNotFoundFailure({
      parsed: { subtype: "error", result: "API Error: 404 model not found: claude-haiku-4-6" },
    })).toBe(true);
  });

  it("falls back to the raw check when there is no parsed result to prefer", () => {
    expect(isClaudeModelNotFoundFailure({
      parsed: null,
      stdout: "API Error: 404 model not found: claude-haiku-4-6",
    })).toBe(true);
  });
});

describe("isClaudeTransientUpstreamError", () => {
  it("classifies the 'out of extra usage' subscription window failure as provider quota", () => {
    expect(
      isClaudeProviderQuotaError({
        errorMessage: "You're out of extra usage · resets 4pm (America/Chicago)",
      }),
    ).toBe(true);
    expect(
      isClaudeProviderQuotaError({
        parsed: {
          is_error: true,
          result: "You're out of extra usage. Resets at 4pm (America/Chicago).",
        },
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "You're out of extra usage · resets 4pm (America/Chicago)",
      }),
    ).toBe(false);
  });

  it("classifies Claude session-limit windows as provider quota and extracts the retry time", () => {
    const now = new Date("2026-04-22T15:15:00.000Z");
    const errorMessage = "You've hit your session limit - resets at 4pm (America/Chicago).";

    expect(isClaudeProviderQuotaError({ errorMessage })).toBe(true);
    expect(isClaudeTransientUpstreamError({ errorMessage })).toBe(false);
    expect(extractClaudeRetryNotBefore({ errorMessage }, now)?.toISOString()).toBe(
      "2026-04-22T21:00:00.000Z",
    );
  });

  it("classifies Anthropic API rate_limit_error and overloaded_error as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          is_error: true,
          errors: [{ type: "rate_limit_error", message: "Rate limit reached for requests." }],
        },
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          is_error: true,
          errors: [{ type: "overloaded_error", message: "Overloaded" }],
        },
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        stderr: "HTTP 429: Too Many Requests",
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        stderr: "Bedrock ThrottlingException: slow down",
      }),
    ).toBe(true);
  });

  it("classifies the subscription 5-hour / weekly limit wording as provider quota", () => {
    expect(
      isClaudeProviderQuotaError({
        errorMessage: "Claude usage limit reached — weekly limit reached. Try again in 2 days.",
      }),
    ).toBe(true);
    expect(
      isClaudeProviderQuotaError({
        errorMessage: "5-hour limit reached.",
      }),
    ).toBe(true);
  });

  it("does not classify login/auth failures as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        stderr: "Please log in. Run `claude login` first.",
      }),
    ).toBe(false);
  });

  it("does not classify max-turns or unknown-session as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        parsed: { subtype: "error_max_turns", result: "Maximum turns reached." },
      }),
    ).toBe(false);
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          result: "No conversation found with session id abc-123",
          errors: [{ message: "No conversation found with session id abc-123" }],
        },
      }),
    ).toBe(false);
  });

  it("does not classify deterministic validation errors as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "Invalid request_error: Unknown parameter 'foo'.",
      }),
    ).toBe(false);
  });

  it("does not classify poisoned previous_message_id errors as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          subtype: "success",
          is_error: true,
          result: "API Error: 400 diagnostics.previous_message_id: must be the `id` from a prior /v1/messages response (starts with `msg_`)",
        },
      }),
    ).toBe(false);
  });
});

describe("isClaudePoisonedPreviousMessageIdError", () => {
  it("detects the previous_message_id 400 error in the result field", () => {
    expect(
      isClaudePoisonedPreviousMessageIdError({
        subtype: "success",
        is_error: true,
        result: "API Error: 400 diagnostics.previous_message_id: must be the `id` from a prior /v1/messages response (starts with `msg_`)",
      }),
    ).toBe(true);
  });

  it("detects the error in the errors array", () => {
    expect(
      isClaudePoisonedPreviousMessageIdError({
        is_error: true,
        result: "",
        errors: [{ message: "400 diagnostics.previous_message_id: must be the `id` from a prior /v1/messages response (starts with `msg_`)" }],
      }),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(
      isClaudePoisonedPreviousMessageIdError({
        is_error: true,
        result: "No conversation found with session id abc-123",
      }),
    ).toBe(false);
  });

  it("returns false for empty parsed result", () => {
    expect(isClaudePoisonedPreviousMessageIdError({})).toBe(false);
  });
});

describe("isClaudeRefusalResult", () => {
  it("detects stop_reason: refusal even on a clean (is_error=false) result", () => {
    expect(
      isClaudeRefusalResult({
        type: "result",
        subtype: "success",
        is_error: false,
        stop_reason: "refusal",
        result: "",
      }),
    ).toBe(true);
  });

  it("detects the camelCase stopReason variant", () => {
    expect(isClaudeRefusalResult({ stopReason: "refusal" })).toBe(true);
  });

  it("detects subtype: model_refusal", () => {
    expect(
      isClaudeRefusalResult({ subtype: "model_refusal", is_error: false }),
    ).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    expect(isClaudeRefusalResult({ stop_reason: "  Refusal " })).toBe(true);
  });

  it("returns false for ordinary successful turns", () => {
    expect(
      isClaudeRefusalResult({
        subtype: "success",
        is_error: false,
        stop_reason: "end_turn",
        result: "Here is your answer.",
      }),
    ).toBe(false);
  });

  it("returns false for max-turns and other stop reasons", () => {
    expect(isClaudeRefusalResult({ stop_reason: "max_turns" })).toBe(false);
    expect(isClaudeRefusalResult({ subtype: "error_max_turns" })).toBe(false);
  });

  it("returns false for null/empty parsed result", () => {
    expect(isClaudeRefusalResult(null)).toBe(false);
    expect(isClaudeRefusalResult({})).toBe(false);
  });
});

describe("isClaudeUnknownSessionError", () => {
  it("detects the legacy 'no conversation found' message", () => {
    expect(
      isClaudeUnknownSessionError({
        result: "Error: No conversation found with session id 1234",
      }),
    ).toBe(true);
  });

  it("detects 'session ... not found' style errors", () => {
    expect(
      isClaudeUnknownSessionError({
        errors: [{ message: "Session abc123 not found" }],
      }),
    ).toBe(true);
  });

  it("detects '--resume requires a valid session' validation error from non-UUID input", () => {
    expect(
      isClaudeUnknownSessionError({
        errors: [
          {
            message:
              'Error: --resume requires a valid session ID or session title when used with --print. Usage: claude -p --resume <session-id|title>. Provided value "ses_268c2d0a5ffemYbEaeG7c86Uvo" is not a UUID and does not match any session title.',
          },
        ],
      }),
    ).toBe(true);
  });

  it("returns false for unrelated error text", () => {
    expect(
      isClaudeUnknownSessionError({
        result: "Some other failure",
        errors: [{ message: "Network timeout" }],
      }),
    ).toBe(false);
  });
});

describe("isClaudeImageProcessingError", () => {
  it("detects the 'Could not process image' 400 error in the result field", () => {
    expect(
      isClaudeImageProcessingError({
        subtype: "success",
        is_error: true,
        result: "API Error: 400 Could not process image: image source URL has expired",
      }),
    ).toBe(true);
  });

  it("detects the error in the errors array", () => {
    expect(
      isClaudeImageProcessingError({
        is_error: true,
        result: "",
        errors: [{ message: "400 Could not process image" }],
      }),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(
      isClaudeImageProcessingError({
        is_error: true,
        result: "could not process image attached to message",
      }),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(
      isClaudeImageProcessingError({
        is_error: true,
        result: "No conversation found with session id abc-123",
      }),
    ).toBe(false);
  });

  it("returns false for empty parsed result", () => {
    expect(isClaudeImageProcessingError({})).toBe(false);
  });
});

describe("extractClaudeRetryNotBefore", () => {
  it("parses the 'resets 4pm' hint in its explicit timezone", () => {
    const now = new Date("2026-04-22T15:15:00.000Z");
    const extracted = extractClaudeRetryNotBefore(
      { errorMessage: "You're out of extra usage · resets 4pm (America/Chicago)" },
      now,
    );
    expect(extracted?.toISOString()).toBe("2026-04-22T21:00:00.000Z");
  });

  it("rolls forward past midnight when the reset time has already passed today", () => {
    const now = new Date("2026-04-22T23:30:00.000Z");
    const extracted = extractClaudeRetryNotBefore(
      { errorMessage: "Usage limit reached. Resets at 3:15 AM (UTC)." },
      now,
    );
    expect(extracted?.toISOString()).toBe("2026-04-23T03:15:00.000Z");
  });

  it("returns null when no reset hint is present", () => {
    expect(
      extractClaudeRetryNotBefore({ errorMessage: "Overloaded. Try again later." }, new Date()),
    ).toBeNull();
  });
});

describe("claudeModelUsageTotals", () => {
  it("sums per-model usage across models and counts cache writes as input", () => {
    const totals = claudeModelUsageTotals({
      "claude-fable-5": {
        inputTokens: 100,
        outputTokens: 70_000,
        cacheReadInputTokens: 250_000,
        cacheCreationInputTokens: 4_000,
        costUSD: 1.2,
      },
      "claude-haiku-4-5": {
        inputTokens: 50,
        outputTokens: 7_000,
        cacheReadInputTokens: 10_000,
        cacheCreationInputTokens: 500,
        costUSD: 0.05,
      },
    });
    expect(totals).toEqual({
      inputTokens: 4_650,
      outputTokens: 77_000,
      cachedInputTokens: 260_000,
    });
  });

  it("returns null for missing or empty modelUsage", () => {
    expect(claudeModelUsageTotals(undefined)).toBeNull();
    expect(claudeModelUsageTotals({})).toBeNull();
  });
});

describe("parseClaudeStreamJson usage extraction", () => {
  const resultEvent = (extra: Record<string, unknown>) =>
    JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "sess-1",
      result: "done",
      total_cost_usd: 1.25,
      usage: { input_tokens: 10, output_tokens: 1_800, cache_read_input_tokens: 20 },
      ...extra,
    });

  it("prefers modelUsage totals over the main-loop usage block and marks them per-run", () => {
    const parsed = parseClaudeStreamJson(
      `${resultEvent({
        modelUsage: {
          "claude-fable-5": {
            inputTokens: 90,
            outputTokens: 77_000,
            cacheReadInputTokens: 300_000,
            cacheCreationInputTokens: 2_000,
          },
        },
      })}\n`,
    );
    expect(parsed.usage).toEqual({
      inputTokens: 2_090,
      outputTokens: 77_000,
      cachedInputTokens: 300_000,
    });
    expect(parsed.usageBasis).toBe("per_run");
    expect(parsed.costUsd).toBeCloseTo(1.25);
  });

  it("falls back to the result usage block when modelUsage is absent", () => {
    const parsed = parseClaudeStreamJson(`${resultEvent({})}\n`);
    expect(parsed.usage).toEqual({
      inputTokens: 10,
      outputTokens: 1_800,
      cachedInputTokens: 20,
    });
    expect(parsed.usageBasis).toBe("per_run");
  });
});
