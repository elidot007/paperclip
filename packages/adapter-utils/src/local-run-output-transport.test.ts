import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectLocalRunLogChannel, openLocalRunLogChannel } from "./local-run-log-channel.js";
import { runAdapterExecutionTargetProcess } from "./execution-target.js";

const roots: string[] = [];
const strays: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-local-run-output-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    [
      ...roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
      ...strays.splice(0).map((file) => fs.rm(file, { force: true })),
    ],
  );
});

const node = process.execPath;

// `runAdapterExecutionTargetProcess` takes a fully-populated env, but
// process.env is `string | undefined`; a real spawn drops the undefined keys.
function fullEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") base[key] = value;
  }
  return { ...base, ...overrides };
}

describe("local run output transport", () => {
  // The bug this pins: with pipe stdio, the read ends live in the server
  // process. When the server goes away the child's next write raises SIGPIPE
  // and the run dies — a hot-restart report would have called it `adopted` a
  // moment earlier. With file-backed stdio the write cannot fail.
  it("keeps a child writing to its log after the spawning process drops the read end", async () => {
    const root = await makeRoot();
    const runId = "run-survives-reader-exit";
    const channel = await openLocalRunLogChannel({ runId, rootDir: root });

    // A short-lived "server" that spawns the run, records the pid, and exits
    // immediately without waiting — the restart, in miniature.
    const pidFile = path.join(root, "pid.txt");
    const spawner = spawn(
      node,
      [
        "-e",
        [
          'const fs = require("node:fs");',
          `const out = fs.openSync(${JSON.stringify(channel.stdoutPath)}, "w");`,
          `const err = fs.openSync(${JSON.stringify(channel.stderrPath)}, "w");`,
          'const child = require("node:child_process").spawn(process.execPath, ["-e",',
          '  \'const fs=require("node:fs");fs.writeSync(1,"first\\\\n");setTimeout(()=>{fs.writeSync(1,"second\\\\n");fs.writeSync(2,"warn\\\\n");},400)\'],',
          '  { stdio: ["ignore", out, err], detached: true });',
          `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
          'child.unref();',
        ].join("\n"),
      ],
      { stdio: "ignore" },
    );
    await new Promise((resolve) => spawner.on("close", resolve));

    const childPid = Number((await fs.readFile(pidFile, "utf8")).trim());
    expect(Number.isInteger(childPid) && childPid > 0).toBe(true);
    await channel.close();

    // Give the orphaned child time to make its SECOND write — the one that
    // would have been SIGPIPE on a pipe.
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    const stdout = await fs.readFile(channel.stdoutPath, "utf8");
    const stderr = await fs.readFile(channel.stderrPath, "utf8");
    expect(stdout).toContain("first");
    expect(stdout).toContain("second");
    expect(stderr).toContain("warn");

    // And the run is still adoptable: a live process with a re-attachable
    // output channel, which is exactly the pair the report must require.
    const inspection = await inspectLocalRunLogChannel(runId, { rootDir: root });
    expect(inspection.live).toBe(true);
    try {
      process.kill(childPid, 0);
    } catch {
      // Already reaped; the byte assertions above are the load-bearing check.
    }
  });

  it("captures stdout and stderr and records the child pid for a real run", async () => {
    const root = await makeRoot();
    const runId = "run-capture";
    const previousHome = process.env.PAPERCLIP_HOME;
    process.env.PAPERCLIP_HOME = path.join(root, "home");
    try {
      const logs: string[] = [];
      const result = await runAdapterExecutionTargetProcess(
        runId,
        null,
        node,
        ["-e", 'process.stdout.write("out-bytes");process.stderr.write("err-bytes")'],
        {
          cwd: root,
          env: fullEnv(),
          timeoutSec: 30,
          graceSec: 1,
          onLog: async (stream, chunk) => {
            logs.push(`${stream}:${chunk}`);
          },
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("out-bytes");
      expect(result.stderr).toBe("err-bytes");
      expect(logs).toContain("stdout:out-bytes");
      expect(logs).toContain("stderr:err-bytes");

      const inspection = await inspectLocalRunLogChannel(runId);
      expect(inspection.live).toBe(true);
      expect(inspection.descriptor?.pid).toBe(result.pid);
    } finally {
      if (previousHome === undefined) delete process.env.PAPERCLIP_HOME;
      else process.env.PAPERCLIP_HOME = previousHome;
    }
  });

  it("falls back to pipe transport when the file channel is disabled", async () => {
    const root = await makeRoot();
    const previousHome = process.env.PAPERCLIP_HOME;
    process.env.PAPERCLIP_HOME = path.join(root, "home");
    try {
      const result = await runAdapterExecutionTargetProcess(
        "run-pipe-fallback",
        null,
        node,
        ["-e", 'process.stdout.write("still-works")'],
        {
          cwd: root,
          env: fullEnv({ PAPERCLIP_LOCAL_RUN_LOG_CHANNEL: "off" }),
          timeoutSec: 30,
          graceSec: 1,
          onLog: async () => {},
        },
      );
      expect(result.stdout).toBe("still-works");
      const inspection = await inspectLocalRunLogChannel("run-pipe-fallback");
      expect(inspection.live).toBe(false);
      expect(inspection.reason).toBe("output_channel_descriptor_missing");
    } finally {
      if (previousHome === undefined) delete process.env.PAPERCLIP_HOME;
      else process.env.PAPERCLIP_HOME = previousHome;
    }
  });
});
