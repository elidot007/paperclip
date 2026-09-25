import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalRunLogTail,
  inspectLocalRunLogChannel,
  LOCAL_RUN_LOG_CHANNEL_DESCRIPTOR_FILENAME,
  openLocalRunLogChannel,
  parseLocalRunLogChannelDescriptor,
  pruneLocalRunLogChannels,
  readLocalRunLogChannelDescriptor,
  resolveLocalRunLogChannelDir,
} from "./local-run-log-channel.js";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-run-log-channel-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local run log channel descriptor", () => {
  it("rejects anything that is not a v1 file-backed channel", () => {
    const base = {
      version: 1,
      runId: "run-1",
      transport: "file",
      stdoutFile: "stdout.log",
      stderrFile: "stderr.log",
      createdAt: "2026-09-26T00:00:00.000Z",
    };
    expect(parseLocalRunLogChannelDescriptor(base)).not.toBeNull();
    expect(parseLocalRunLogChannelDescriptor({ ...base, version: 2 })).toBeNull();
    expect(parseLocalRunLogChannelDescriptor({ ...base, transport: "pipe" })).toBeNull();
    expect(parseLocalRunLogChannelDescriptor({ ...base, createdAt: "not-a-date" })).toBeNull();
    expect(parseLocalRunLogChannelDescriptor({ ...base, runId: "" })).toBeNull();
  });

  it("refuses a descriptor whose log files escape the run directory", () => {
    const parsed = parseLocalRunLogChannelDescriptor({
      version: 1,
      runId: "run-1",
      transport: "file",
      stdoutFile: "../../etc/passwd",
      stderrFile: "stderr.log",
      createdAt: "2026-09-26T00:00:00.000Z",
    });
    expect(parsed).toBeNull();
  });

  it("rejects run ids that are not a single safe path segment", async () => {
    const root = await makeRoot();
    await expect(
      openLocalRunLogChannel({ runId: "../escape", rootDir: root }),
    ).rejects.toThrow(/Invalid run id/);
  });
});

describe("inspectLocalRunLogChannel", () => {
  it("reports a bound channel as live and exposes the child pid", async () => {
    const root = await makeRoot();
    const channel = await openLocalRunLogChannel({ runId: "run-live", rootDir: root });
    try {
      await channel.bind({ pid: 4242, processGroupId: 4242, startedAt: "2026-09-26T00:00:01.000Z" });
      const inspection = await inspectLocalRunLogChannel("run-live", { rootDir: root });
      expect(inspection.live).toBe(true);
      expect(inspection.reason).toBe("output_channel_file_backed");
      expect(inspection.descriptor?.pid).toBe(4242);
      expect(inspection.descriptor?.processGroupId).toBe(4242);
    } finally {
      await channel.close();
    }
  });

  it("reports a run with no descriptor as not live — the pipe-transport case", async () => {
    const root = await makeRoot();
    const inspection = await inspectLocalRunLogChannel("run-never-file-backed", { rootDir: root });
    expect(inspection.live).toBe(false);
    expect(inspection.reason).toBe("output_channel_descriptor_missing");
  });

  it("reports a channel whose log files were removed as not live", async () => {
    const root = await makeRoot();
    const channel = await openLocalRunLogChannel({ runId: "run-wiped", rootDir: root });
    await channel.close();
    await fs.rm(path.join(resolveLocalRunLogChannelDir("run-wiped", { rootDir: root }), "stdout.log"));
    const inspection = await inspectLocalRunLogChannel("run-wiped", { rootDir: root });
    expect(inspection.live).toBe(false);
    expect(inspection.reason).toBe("output_channel_file_missing");
  });

  it("writes the descriptor atomically under the run directory", async () => {
    const root = await makeRoot();
    const channel = await openLocalRunLogChannel({ runId: "run-atomic", rootDir: root });
    await channel.close();
    const dir = resolveLocalRunLogChannelDir("run-atomic", { rootDir: root });
    const entries = await fs.readdir(dir);
    expect(entries.sort()).toEqual([LOCAL_RUN_LOG_CHANNEL_DESCRIPTOR_FILENAME, "stderr.log", "stdout.log"]);
    const descriptor = await readLocalRunLogChannelDescriptor("run-atomic", { rootDir: root });
    expect(descriptor?.runId).toBe("run-atomic");
  });
});

describe("pruneLocalRunLogChannels", () => {
  it("removes a channel whose last write is past retention", async () => {
    const root = await makeRoot();
    const channel = await openLocalRunLogChannel({ runId: "run-old", rootDir: root });
    await channel.close();
    const stale = Date.now() - 10 * 24 * 60 * 60 * 1000;
    for (const name of ["channel.json", "stdout.log", "stderr.log"]) {
      const target = path.join(resolveLocalRunLogChannelDir("run-old", { rootDir: root }), name);
      await fs.utimes(target, new Date(stale), new Date(stale));
    }

    const result = await pruneLocalRunLogChannels({ rootDir: root, retentionMs: 7 * 24 * 60 * 60 * 1000 });
    expect(result.removed).toEqual(["run-old"]);
    await expect(fs.stat(resolveLocalRunLogChannelDir("run-old", { rootDir: root }))).rejects.toThrow();
  });

  // The failure this pins: freshness must come from the LOG files, not the
  // descriptor. A run that is still producing output has a descriptor written
  // once at bind, so descriptor-age pruning would delete a live run's output
  // and take adoption with it.
  it("keeps a run whose descriptor is old but whose log is still being written", async () => {
    const root = await makeRoot();
    const channel = await openLocalRunLogChannel({ runId: "run-live-long", rootDir: root });
    await channel.bind({ pid: 999, processGroupId: 999, startedAt: "2026-09-26T00:00:00.000Z" });
    const ancient = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await fs.utimes(channel.descriptorPath, ancient, ancient);
    await channel.close();

    const result = await pruneLocalRunLogChannels({ rootDir: root, retentionMs: 7 * 24 * 60 * 60 * 1000 });
    expect(result.removed).toEqual([]);
    expect((await inspectLocalRunLogChannel("run-live-long", { rootDir: root })).live).toBe(true);
  });

  it("never removes the channel for the run currently being opened", async () => {
    const root = await makeRoot();
    const channel = await openLocalRunLogChannel({ runId: "run-current", rootDir: root });
    const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    for (const name of ["channel.json", "stdout.log", "stderr.log"]) {
      const target = path.join(resolveLocalRunLogChannelDir("run-current", { rootDir: root }), name);
      await fs.utimes(target, stale, stale);
    }
    const result = await pruneLocalRunLogChannels({
      rootDir: root,
      keepRunId: "run-current",
      retentionMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(result.removed).toEqual([]);
  });

  it("survives a missing root instead of failing the run that triggered it", async () => {
    const root = await makeRoot();
    const result = await pruneLocalRunLogChannels({ rootDir: path.join(root, "not-there") });
    expect(result).toEqual({ scanned: 0, removed: [] });
  });
});

describe("createLocalRunLogTail", () => {  it("streams appended bytes in order and stops cleanly", async () => {
    const root = await makeRoot();
    const channel = await openLocalRunLogChannel({ runId: "run-tail", rootDir: root });
    const tail = createLocalRunLogTail({
      stdoutPath: channel.stdoutPath,
      stderrPath: channel.stderrPath,
      pollIntervalMs: 10,
    });
    const chunks: string[] = [];
    tail.start(async (stream, text) => {
      chunks.push(`${stream}:${text}`);
    });

    // The writer holds its own descriptor, exactly like the child process does.
    const writer = await fs.open(channel.stdoutPath, "a");
    await writer.writeFile("hello ", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 60));
    await writer.writeFile("world\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 60));
    await writer.close();

    await tail.stop();
    await channel.close();

    expect(chunks).toEqual(["stdout:hello ", "stdout:world\n"]);
    expect(chunks.every((chunk) => chunk.startsWith("stdout:"))).toBe(true);
    expect(tail.consumedBytes().stdout).toBe(12);
  });
});
