import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_QUEUED_OWNERSHIP_TIMEOUT_MS,
  heartbeatRunCanOwnExecution,
} from "../services/issues.js";

// AUT-917: `2ad1753d` retired `scheduled_retry` as an owner but left `queued`
// live forever, and the commit message's premise ("a queued run has not started
// but it will") has no counter-example-free case: on this instance 7 in_progress
// issues were held by queued runs whose `startedAt` was null 17-110 minutes
// after `createdAt`, all still 409ing after a restart. The bound has to key on
// queue age, not on the status name.
const NOW = Date.parse("2026-09-26T00:40:00.000Z");
const queuedFor = (minutes: number) => new Date(NOW - minutes * 60_000);

describe("heartbeatRunCanOwnExecution", () => {
  it("keeps a fresh queued run as the live owner", () => {
    // A run genuinely waiting for a lane slot. Treating every queued run as dead
    // would hand the issue to a second run while the first one is still coming.
    expect(
      heartbeatRunCanOwnExecution(
        { status: "queued", startedAt: null, createdAt: queuedFor(8) },
        NOW,
      ),
    ).toBe(true);
  });

  it("releases at the same 15-minute mark regardless of which run is victim", () => {
    // AUT-865 was the youngest of the seven at 17 minutes, so at the issue's
    // suggested 15-minute ceiling it is released alongside AUT-862's 110. The
    // bound is deliberately on age alone; the alternative reading (keep any run
    // under 30) is indistinguishable from the permanent lock we are removing.
    expect(
      heartbeatRunCanOwnExecution(
        { status: "queued", startedAt: null, createdAt: queuedFor(17) },
        NOW,
      ),
    ).toBe(false);
  });

  it("releases a queued run that has aged past the queue ceiling", () => {
    // AUT-862: queued since 2026-09-25T22:50:13Z, startedAt still null 110
    // minutes later. The scheduler will never start it.
    expect(
      heartbeatRunCanOwnExecution(
        { status: "queued", startedAt: null, createdAt: queuedFor(110) },
        NOW,
      ),
    ).toBe(false);
  });

  it("respects the boundary: one minute under holds, one minute over releases", () => {
    const boundary = HEARTBEAT_QUEUED_OWNERSHIP_TIMEOUT_MS / 60_000;
    expect(boundary).toBe(15);
    expect(
      heartbeatRunCanOwnExecution(
        { status: "queued", startedAt: null, createdAt: queuedFor(boundary) },
        NOW,
      ),
    ).toBe(true);
    expect(
      heartbeatRunCanOwnExecution(
        { status: "queued", startedAt: null, createdAt: queuedFor(boundary + 1) },
        NOW,
      ),
    ).toBe(false);
  });

  it("keeps a queued run that already started, however old", () => {
    // Belt and braces: a status can lag `startedAt`, and a started run is
    // executing regardless of its queue age.
    expect(
      heartbeatRunCanOwnExecution(
        { status: "queued", startedAt: queuedFor(200), createdAt: queuedFor(300) },
        NOW,
      ),
    ).toBe(true);
  });

  it("fails open when a queued run carries no age to judge", () => {
    // A status-only projection reaches this path. Stealing the lock from a
    // queue we cannot age is the failure the bound exists to prevent.
    expect(heartbeatRunCanOwnExecution({ status: "queued" }, NOW)).toBe(true);
    expect(
      heartbeatRunCanOwnExecution({ status: "queued", startedAt: null, createdAt: null }, NOW),
    ).toBe(true);
  });

  it("still retires the terminal and scheduled_retry owners", () => {
    for (const status of ["succeeded", "interrupted", "failed", "cancelled", "timed_out", "scheduled_retry"]) {
      expect(
        heartbeatRunCanOwnExecution({ status, startedAt: null, createdAt: queuedFor(200) }, NOW),
        status,
      ).toBe(false);
    }
    expect(heartbeatRunCanOwnExecution(null, NOW)).toBe(false);
    expect(heartbeatRunCanOwnExecution(undefined, NOW)).toBe(false);
  });

  it("keeps a running run as the live owner regardless of age", () => {
    expect(
      heartbeatRunCanOwnExecution(
        { status: "running", startedAt: queuedFor(200), createdAt: queuedFor(300) },
        NOW,
      ),
    ).toBe(true);
  });
});
