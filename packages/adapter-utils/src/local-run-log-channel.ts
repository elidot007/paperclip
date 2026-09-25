// File-backed stdout/stderr channel for LOCAL adapter runs.
//
// Why this exists: `runChildProcess` gives the child `pipe` stdio, so the
// child's stdout/stderr fds point at read ends owned by the Paperclip server
// process. The moment the server exits, those read ends close and the next
// write from the child raises SIGPIPE — the run dies a few seconds AFTER a
// hot-restart report already called it `adopted`. That is the false green
// light this module removes.
//
// Instead of a pipe, the child's stdout/stderr are the write ends of two
// regular files under the Paperclip instance root. A write to a file never
// fails because the reader went away, so the run survives the server. The
// server tails those files by byte offset (host-side, no RPC), and a fresh
// server after a hot restart can re-attach to the same files from the
// descriptor written here.
//
// One directory + descriptor per run:
//
//   <instance root>/local-run-logs/<runId>/channel.json
//   <instance root>/local-run-logs/<runId>/stdout.log
//   <instance root>/local-run-logs/<runId>/stderr.log
//
// The descriptor is the adoption handshake: a run whose descriptor is missing
// was started on a pipe, so its output channel died with the previous server
// and it must never be reported as adopted.

import { promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { resolvePaperclipInstanceRootForAdapter } from "./server-utils.js";

export const LOCAL_RUN_LOG_CHANNEL_VERSION = 1;
export const LOCAL_RUN_LOG_CHANNEL_DIRNAME = "local-run-logs";
export const LOCAL_RUN_LOG_CHANNEL_DESCRIPTOR_FILENAME = "channel.json";
export const LOCAL_RUN_LOG_CHANNEL_TRANSPORT = "file";

const DEFAULT_TAIL_POLL_INTERVAL_MS = 250;
const DEFAULT_TAIL_MAX_CHUNK_BYTES = 256 * 1024;
// Every run leaves its stdout/stderr on disk, so retention has to be bounded
// or the instance root grows without limit. 7 days is well past any realistic
// run and long enough to read a lost run's output after the fact.
const DEFAULT_CHANNEL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_SCAN_LIMIT = 500;

// runIds are server-generated uuids; keep the segment conservative anyway so a
// hostile id can never escape the channel root.
const RUN_ID_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;

export type LocalRunLogChannelStream = "stdout" | "stderr";

export interface LocalRunLogChannelDescriptor {
  version: typeof LOCAL_RUN_LOG_CHANNEL_VERSION;
  runId: string;
  transport: typeof LOCAL_RUN_LOG_CHANNEL_TRANSPORT;
  stdoutFile: string;
  stderrFile: string;
  createdAt: string;
  /** Written by `bind` once the child pid is known. */
  boundAt: string | null;
  pid: number | null;
  processGroupId: number | null;
  processStartedAt: string | null;
}

export interface LocalRunLogChannelHandle {
  runId: string;
  dir: string;
  descriptorPath: string;
  stdoutPath: string;
  stderrPath: string;
  /** Raw fds to hand to `spawn` stdio so the child owns the write ends. */
  stdoutFd: number;
  stderrFd: number;
  bind(meta: {
    pid: number;
    processGroupId: number | null;
    startedAt: string;
  }): Promise<void>;
  close(): Promise<void>;
}

export type LocalRunLogSink = (stream: LocalRunLogChannelStream, chunk: string) => Promise<void>;

export interface LocalRunLogTail {
  start(onLog: LocalRunLogSink): void;
  /** Stop the poll loop. Resolves once no further chunks will be emitted. */
  stop(): Promise<void>;
  /** Bytes already emitted per stream, for suffix backfill at close. */
  consumedBytes(): Record<LocalRunLogChannelStream, number>;
}

export interface LocalRunLogChannelPathOptions {
  /** Defaults to the resolved Paperclip instance root. */
  rootDir?: string;
}

export interface LocalRunLogChannelInspection {
  live: boolean;
  reason:
    | "output_channel_file_backed"
    | "output_channel_descriptor_missing"
    | "output_channel_descriptor_unreadable"
    | "output_channel_file_missing";
  descriptor: LocalRunLogChannelDescriptor | null;
}

function safeRunIdSegment(runId: string): string {
  const trimmed = runId.trim();
  if (!trimmed || !RUN_ID_SEGMENT_RE.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new Error(`Invalid run id for a local run log channel: '${runId}'`);
  }
  return trimmed;
}

function resolveChannelRoot(options: LocalRunLogChannelPathOptions): string {
  const base = options.rootDir?.trim()
    ? path.resolve(options.rootDir)
    : resolvePaperclipInstanceRootForAdapter();
  return path.join(base, LOCAL_RUN_LOG_CHANNEL_DIRNAME);
}

export function resolveLocalRunLogChannelDir(
  runId: string,
  options: LocalRunLogChannelPathOptions = {},
): string {
  return path.join(resolveChannelRoot(options), safeRunIdSegment(runId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asIsoDate(value: unknown): string | null {
  const candidate = asString(value);
  if (!candidate) return null;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/**
 * Parse an untrusted on-disk descriptor. Returns null for anything that is not
 * a v1 file-backed channel, which callers must treat as "no channel".
 */
export function parseLocalRunLogChannelDescriptor(value: unknown): LocalRunLogChannelDescriptor | null {
  if (!isRecord(value)) return null;
  if (value.version !== LOCAL_RUN_LOG_CHANNEL_VERSION) return null;
  if (value.transport !== LOCAL_RUN_LOG_CHANNEL_TRANSPORT) return null;
  const runId = asString(value.runId);
  const stdoutFile = asString(value.stdoutFile);
  const stderrFile = asString(value.stderrFile);
  const createdAt = asIsoDate(value.createdAt);
  if (!runId || !stdoutFile || !stderrFile || !createdAt) return null;
  // Basenames only: the descriptor must not be able to point the tail loop at
  // an arbitrary path, and `resolve` below re-anchors inside the run dir.
  if (stdoutFile !== path.basename(stdoutFile) || stderrFile !== path.basename(stderrFile)) return null;
  return {
    version: LOCAL_RUN_LOG_CHANNEL_VERSION,
    runId,
    transport: LOCAL_RUN_LOG_CHANNEL_TRANSPORT,
    stdoutFile,
    stderrFile,
    createdAt,
    boundAt: asIsoDate(value.boundAt),
    pid: asPositiveInt(value.pid),
    processGroupId: asPositiveInt(value.processGroupId),
    processStartedAt: asIsoDate(value.processStartedAt),
  };
}

function resolveWithinRunDir(dir: string, fileName: string): string {
  const resolved = path.resolve(dir, fileName);
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error(`Local run log channel file '${fileName}' escapes ${dir}`);
  }
  return resolved;
}

async function writeDescriptor(descriptorPath: string, descriptor: LocalRunLogChannelDescriptor) {
  const tempPath = `${descriptorPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, descriptorPath);
}

export async function readLocalRunLogChannelDescriptor(
  runId: string,
  options: LocalRunLogChannelPathOptions = {},
): Promise<LocalRunLogChannelDescriptor | null> {
  try {
    const descriptorPath = path.join(resolveLocalRunLogChannelDir(runId, options), LOCAL_RUN_LOG_CHANNEL_DESCRIPTOR_FILENAME);
    const raw = await fs.readFile(descriptorPath, "utf8");
    return parseLocalRunLogChannelDescriptor(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Decide whether a run's output channel survived the server that started it.
 *
 * This is the check the hot-restart adoption report must make: a live pid is
 * not enough, because a pipe-backed run keeps its pid while its output channel
 * is already dead. Only a file-backed channel is genuinely re-attachable.
 */
export async function inspectLocalRunLogChannel(
  runId: string,
  options: LocalRunLogChannelPathOptions = {},
): Promise<LocalRunLogChannelInspection> {
  let dir: string;
  try {
    dir = resolveLocalRunLogChannelDir(runId, options);
  } catch {
    return { live: false, reason: "output_channel_descriptor_missing", descriptor: null };
  }
  const descriptorPath = path.join(dir, LOCAL_RUN_LOG_CHANNEL_DESCRIPTOR_FILENAME);
  let descriptor: LocalRunLogChannelDescriptor | null;
  try {
    descriptor = parseLocalRunLogChannelDescriptor(JSON.parse(await fs.readFile(descriptorPath, "utf8")));
  } catch {
    return { live: false, reason: "output_channel_descriptor_missing", descriptor: null };
  }
  if (!descriptor || descriptor.runId !== runId) {
    return { live: false, reason: "output_channel_descriptor_unreadable", descriptor: null };
  }
  try {
    await fs.stat(resolveWithinRunDir(dir, descriptor.stdoutFile));
    await fs.stat(resolveWithinRunDir(dir, descriptor.stderrFile));
  } catch {
    return { live: false, reason: "output_channel_file_missing", descriptor };
  }
  return { live: true, reason: "output_channel_file_backed", descriptor };
}

function resolveChannelRetentionMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PAPERCLIP_LOCAL_RUN_LOG_RETENTION_MS?.trim();
  if (!raw) return DEFAULT_CHANNEL_RETENTION_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CHANNEL_RETENTION_MS;
  return Math.trunc(parsed);
}

/**
 * Drop channel directories whose last write is past the retention window.
 *
 * Best-effort and never fatal: a failed prune must not stop a run from
 * starting. Freshness comes from the LOG files rather than the descriptor,
 * because a live run appends to them continuously while its descriptor is
 * only written once at bind — the descriptor's age would expire a run that is
 * still producing output.
 */
export async function pruneLocalRunLogChannels(options: {
  rootDir?: string;
  keepRunId?: string;
  retentionMs?: number | null;
  now?: number;
  scanLimit?: number | null;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<{ scanned: number; removed: string[] }> {
  const removed: string[] = [];
  let root: string;
  try {
    root = resolveChannelRoot({ rootDir: options.rootDir });
  } catch {
    return { scanned: 0, removed };
  }
  const retentionMs = normalizePositiveInt(options.retentionMs, resolveChannelRetentionMs(options.env));
  const now = typeof options.now === "number" ? options.now : Date.now();
  const scanLimit = normalizePositiveInt(options.scanLimit, PRUNE_SCAN_LIMIT);

  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return { scanned: 0, removed };
  }
  let scanned = 0;
  for (const entry of entries) {
    if (scanned >= scanLimit) break;
    if (!RUN_ID_SEGMENT_RE.test(entry) || entry === "." || entry === "..") continue;
    if (options.keepRunId && entry === options.keepRunId) continue;
    scanned += 1;
    const dir = path.join(root, entry);
    try {
      const stats = await Promise.all(
        [LOCAL_RUN_LOG_CHANNEL_DESCRIPTOR_FILENAME, "stdout.log", "stderr.log"].map((name) =>
          fs.stat(path.join(dir, name)).catch(() => null),
        ),
      );
      const mtimes = stats.filter((stat): stat is Stats => stat !== null).map((stat) => stat.mtimeMs);
      // Never saw a file: leave it alone rather than delete on no evidence.
      if (mtimes.length === 0) continue;
      const lastWrite = Math.max(...mtimes);
      if (now - lastWrite <= retentionMs) continue;
      await fs.rm(dir, { recursive: true, force: true });
      removed.push(entry);
    } catch {
      // A concurrent run finalizing the same directory is expected, not an error.
    }
  }
  return { scanned, removed };
}

export async function openLocalRunLogChannel(input: {
  runId: string;
  rootDir?: string;
}): Promise<LocalRunLogChannelHandle> {
  const runId = safeRunIdSegment(input.runId);
  const dir = resolveLocalRunLogChannelDir(runId, { rootDir: input.rootDir });
  const stdoutFile = "stdout.log";
  const stderrFile = "stderr.log";
  await fs.mkdir(dir, { recursive: true });
  await pruneLocalRunLogChannels({ keepRunId: runId, rootDir: input.rootDir });

  const stdoutPath = resolveWithinRunDir(dir, stdoutFile);
  const stderrPath = resolveWithinRunDir(dir, stderrFile);
  // Truncate any leftovers from a previous run with the same id so the tail
  // offsets start from a known state.
  const stdoutHandle = await fs.open(stdoutPath, "w");
  const stderrHandle = await fs.open(stderrPath, "w");

  const descriptor: LocalRunLogChannelDescriptor = {
    version: LOCAL_RUN_LOG_CHANNEL_VERSION,
    runId,
    transport: LOCAL_RUN_LOG_CHANNEL_TRANSPORT,
    stdoutFile,
    stderrFile,
    createdAt: new Date().toISOString(),
    boundAt: null,
    pid: null,
    processGroupId: null,
    processStartedAt: null,
  };
  const descriptorPath = path.join(dir, LOCAL_RUN_LOG_CHANNEL_DESCRIPTOR_FILENAME);
  try {
    await writeDescriptor(descriptorPath, descriptor);
  } catch (error) {
    await Promise.allSettled([stdoutHandle.close(), stderrHandle.close()]);
    throw error;
  }

  let closed = false;
  return {
    runId,
    dir,
    descriptorPath,
    stdoutPath,
    stderrPath,
    stdoutFd: stdoutHandle.fd,
    stderrFd: stderrHandle.fd,
    async bind(meta) {
      descriptor.boundAt = new Date().toISOString();
      descriptor.pid = meta.pid;
      descriptor.processGroupId = meta.processGroupId;
      descriptor.processStartedAt = meta.startedAt;
      await writeDescriptor(descriptorPath, descriptor);
    },
    async close() {
      if (closed) return;
      closed = true;
      // The child holds its own dup of these fds, so closing ours is safe even
      // while the child is still running.
      await Promise.allSettled([stdoutHandle.close(), stderrHandle.close()]);
    },
  };
}

interface TailStreamState {
  stream: LocalRunLogChannelStream;
  logPath: string;
  offset: number;
  decoder: StringDecoder;
  handle: FileHandle | null;
}

function normalizePositiveInt(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback;
}

export function createLocalRunLogTail(options: {
  stdoutPath: string;
  stderrPath: string;
  startOffset?: number | null;
  pollIntervalMs?: number | null;
  maxChunkBytesPerTick?: number | null;
}): LocalRunLogTail {
  const pollIntervalMs = normalizePositiveInt(options.pollIntervalMs, DEFAULT_TAIL_POLL_INTERVAL_MS);
  const maxChunkBytes = normalizePositiveInt(options.maxChunkBytesPerTick, DEFAULT_TAIL_MAX_CHUNK_BYTES);
  const startOffset = options.startOffset ?? 0;

  const streams: [TailStreamState, TailStreamState] = [
    {
      stream: "stdout",
      logPath: options.stdoutPath,
      offset: startOffset,
      decoder: new StringDecoder("utf8"),
      handle: null,
    },
    {
      stream: "stderr",
      logPath: options.stderrPath,
      offset: startOffset,
      decoder: new StringDecoder("utf8"),
      handle: null,
    },
  ];

  let sink: LocalRunLogSink | null = null;
  let stopped = false;
  let loopPromise: Promise<void> | null = null;
  let wakeSleep: (() => void) | null = null;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        wakeSleep = null;
        resolve();
      }, ms);
      wakeSleep = () => {
        clearTimeout(timer);
        wakeSleep = null;
        resolve();
      };
    });
  }

  async function openStream(state: TailStreamState): Promise<FileHandle | null> {
    if (state.handle) return state.handle;
    try {
      state.handle = await fs.open(state.logPath, "r");
    } catch {
      return null;
    }
    return state.handle;
  }

  async function emitBytes(state: TailStreamState, bytes: Buffer): Promise<void> {
    if (bytes.length === 0) return;
    state.offset += bytes.length;
    const text = state.decoder.write(bytes);
    if (text.length > 0 && sink) {
      await sink(state.stream, text);
    }
  }

  async function tick(): Promise<void> {
    for (const state of streams) {
      const handle = await openStream(state);
      if (!handle) continue;
      const buffer = Buffer.alloc(maxChunkBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxChunkBytes, state.offset);
      await emitBytes(state, buffer.subarray(0, bytesRead));
    }
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      await sleep(pollIntervalMs);
      if (stopped) break;
      try {
        await tick();
      } catch {
        // A transient read error must not kill the tail: the run log is the
        // only channel the adopted run has. Keep polling; `finish` backfills
        // any gap from the file on close.
      }
    }
  }

  return {
    start(onLog) {
      if (loopPromise || stopped) return;
      sink = onLog;
      loopPromise = loop();
    },
    async stop() {
      stopped = true;
      wakeSleep?.();
      if (loopPromise) {
        await loopPromise.catch(() => undefined);
        loopPromise = null;
      }
      await Promise.allSettled(streams.map((state) => state.handle?.close() ?? Promise.resolve()));
    },
    consumedBytes() {
      return { stdout: streams[0].offset, stderr: streams[1].offset };
    },
  };
}

/**
 * Emit whatever is still unread past `consumed` for each stream. Used at
 * process close so a degraded tail never truncates the adapter's own view of
 * its output.
 */
export async function backfillLocalRunLogTail(options: {
  stdoutPath: string;
  stderrPath: string;
  consumed: Record<LocalRunLogChannelStream, number>;
  onLog: LocalRunLogSink;
}): Promise<void> {
  const targets: [LocalRunLogChannelStream, string, number][] = [
    ["stdout", options.stdoutPath, options.consumed.stdout],
    ["stderr", options.stderrPath, options.consumed.stderr],
  ];
  for (const [stream, logPath, consumed] of targets) {
    let contents: Buffer;
    try {
      contents = await fs.readFile(logPath);
    } catch {
      continue;
    }
    if (contents.length <= consumed) continue;
    const text = contents.subarray(consumed).toString("utf8");
    if (text.length > 0) await options.onLog(stream, text);
  }
}
