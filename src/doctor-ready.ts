/**
 * トンネルの接続が本当に張れているか（cloudflared の `/ready`）。
 *
 * launchctl は「プロセスが生きているか」しか言えず、外からの到達は Access が前にいると
 * トンネルが止まっていても 401 が返る（2026-09-24 実測）。だから「プロセスは生きているのに
 * 接続だけ落ちた」は、どちらでも捕まえられない。cloudflared はメトリクスのサーバーで
 * `/ready` を出していて、`readyConnections`（張れている接続の本数）が載る。
 *
 * **どの cloudflared か**が肝心。同じ Mac に別のトンネル（クイックトンネルなど）が
 * 動いていることがあり、20241〜20245 を総当たりすると別物を拾う。だから:
 *   1. relay のトンネルの LaunchAgent の StandardErrorPath（ログ）を読む
 *   2. 最後の起動（Starting tunnel）以降の「Starting metrics server on <addr>」と
 *      「Generated Connector ID: <id>」を取る
 *   3. `/ready` の connectorId がそれと一致したときだけ信じる
 * どこかで決められなければ「未確認」で、失敗にはしない。
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { Probes } from "./doctor-probes.ts";

export interface MetricsTarget {
  readonly address: string;
  readonly connectorId: string;
}

/** ログの末尾だけ読む。cloudflared のログは再接続のたびに伸び、実測で4MBあった */
const LOG_TAIL_BYTES = 1024 * 1024;
/** `/ready` を待つ上限。手元のループバックなので普段は数ミリ秒 */
const READY_TIMEOUT_MS = 3_000;

export function stderrPathOf(plistText: string): string | null {
  return /<key>StandardErrorPath<\/key>\s*<string>([^<]+)<\/string>/.exec(plistText)?.[1]?.trim() ?? null;
}

export function readLogTail(path: string, bytes = LOG_TAIL_BYTES): string | null {
  let fd: number | null = null;
  try {
    const size = statSync(path).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    fd = openSync(path, "r");
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function lastMatch(text: string, pattern: RegExp): string | null {
  let found: string | null = null;
  for (const match of text.matchAll(pattern)) found = match[1] ?? found;
  return found;
}

/** 最後の起動のメトリクスの宛先と Connector ID。前の起動の値を混ぜない */
export function metricsFromLog(log: string): MetricsTarget | null {
  const start = log.lastIndexOf("Starting tunnel");
  const run = start >= 0 ? log.slice(start) : log;
  const address = lastMatch(run, /Starting metrics server on (\S+?)\/metrics/g);
  const connectorId = lastMatch(run, /Generated Connector ID: ([0-9a-f-]+)/g);
  if (address === null || connectorId === null) return null;
  // 手元のループバックだけを叩く。ログに書いてある宛先をそのまま外へ投げない
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(address)) return null;
  return { address, connectorId };
}

export type ReadyState = "ok" | "down" | "unknown";

export interface Ready {
  readonly state: ReadyState;
  readonly detail: string;
}

/** `/ready` の答えの読み方。別の cloudflared の答えは信じない */
export function classifyReady(body: unknown, connectorId: string): Ready {
  if (typeof body !== "object" || body === null) return { state: "unknown", detail: "答えの形が違う" };
  const ready = "readyConnections" in body ? body.readyConnections : undefined;
  const id = "connectorId" in body ? body.connectorId : undefined;
  if (id !== connectorId) return { state: "unknown", detail: "別の cloudflared の答え" };
  if (typeof ready !== "number") return { state: "unknown", detail: "接続の本数が無い" };
  if (ready < 1) return { state: "down", detail: "接続0本（プロセスは居るが繋がっていない）" };
  return { state: "ok", detail: `接続${String(ready)}本` };
}

export async function probeReady(probes: Probes, target: MetricsTarget): Promise<Ready> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, READY_TIMEOUT_MS);
  try {
    // 503（接続0本）でも本文は同じ形の JSON なので、status では分けない
    const response = await probes.fetch(`http://${target.address}/ready`, { signal: controller.signal });
    const body: unknown = await response.json();
    return classifyReady(body, target.connectorId);
  } catch {
    return { state: "unknown", detail: "メトリクスに届かない" };
  } finally {
    clearTimeout(timer);
  }
}
