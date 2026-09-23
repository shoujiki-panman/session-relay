/**
 * `relay doctor` が外の世界に触る部分（launchctl・HTTPS・LaunchAgentのplist）。
 * どれも `Probes` を通すので、テストでは偽物を差し込める。
 *
 * 2026-09-22、Cloudflare Tunnel が「no more connections active and exiting」で exit 0 して止まり、
 * KeepAlive=true なのに launchd が起こさなかった。受け口（127.0.0.1:8788）は生きていたので、
 * 受け口だけを見ていた doctor は止まっている間ずっと「ぜんぶ通っています」と言っていた。
 * だからトンネルの常駐と、外からの到達の両方を見る。
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
}

export interface Probes {
  readonly fetch: typeof fetch;
  readonly run: (command: string, args: readonly string[]) => Promise<RunResult>;
  readonly uid: number;
  readonly sleep: (ms: number) => Promise<void>;
}

/** launchctl を待つ上限。応答しないときに doctor ごと固まらないように */
const RUN_TIMEOUT_MS = 10_000;

function runCommand(command: string, args: readonly string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(command, [...args], { timeout: RUN_TIMEOUT_MS }, (error, stdout) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      resolve({ code, stdout });
    });
  });
}

export function realProbes(): Probes {
  return {
    fetch: globalThis.fetch,
    run: runCommand,
    uid: process.getuid?.() ?? 0,
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}

export interface Agent {
  readonly label: string;
  readonly plist: string;
}

/**
 * ~/Library/LaunchAgents のうち、中身に needle を全部含む plist を探す。
 * ラベルは人によって違う（例: 投函口は自分で名前をつける）ので決め打ちしない。
 */
export function findAgent(home: string, needles: readonly string[]): Agent | null {
  const dir = join(home, "Library", "LaunchAgents");
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".plist")) continue;
    const plist = join(dir, name);
    let text: string;
    try {
      text = readFileSync(plist, "utf8");
    } catch {
      continue;
    }
    if (!needles.every((needle) => text.includes(needle))) continue;
    const label = /<key>Label<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1];
    if (label !== undefined) return { label: label.trim(), plist };
  }
  return null;
}

export type AgentState = "running" | "stopped" | "not-loaded";

/** `launchctl print` の最初の `state = ...` を読む。見つからなければ読み込まれていない */
export async function agentState(probes: Probes, label: string): Promise<AgentState> {
  const result = await probes.run("launchctl", ["print", `gui/${String(probes.uid)}/${label}`]);
  if (result.code !== 0) return "not-loaded";
  const state = /^\s*state = (\S+)/m.exec(result.stdout)?.[1];
  return state === "running" ? "running" : "stopped";
}

/** 起こす。読み込まれていなければ先に bootstrap する */
export async function kickAgent(probes: Probes, agent: Agent): Promise<{ ok: boolean; action: string }> {
  const domain = `gui/${String(probes.uid)}`;
  const actions: string[] = [];
  if ((await agentState(probes, agent.label)) === "not-loaded") {
    await probes.run("launchctl", ["bootstrap", domain, agent.plist]);
    actions.push("bootstrap");
  }
  const kicked = await probes.run("launchctl", ["kickstart", "-k", `${domain}/${agent.label}`]);
  actions.push("kickstart");
  return { ok: kicked.code === 0, action: actions.join("+") };
}

const PORT_OF_SERVICE = /^(?:https?:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/;

function valueOf(line: string, key: string): string | null {
  const match = new RegExp(`^\\s*(?:-\\s+)?${key}:\\s*(.+?)\\s*$`).exec(line);
  return match?.[1]?.replace(/^["']|["']$/g, "") ?? null;
}

/**
 * cloudflared の config.yml から、手元の port に向く ingress の hostname を読む。
 * YAMLの全部は要らない（ingress は `- hostname:` と `service:` の並び）ので、依存を増やさず行で読む。
 */
export function tunnelHostname(yaml: string, port: number): string | null {
  let hostname: string | null = null;
  for (const line of yaml.split("\n")) {
    if (/^\s*#/.test(line)) continue;
    if (/^\s*-\s/.test(line)) hostname = null; // 次の ingress の項目に入った
    hostname = valueOf(line, "hostname") ?? hostname;
    const service = valueOf(line, "service");
    const servicePort = service === null ? undefined : PORT_OF_SERVICE.exec(service)?.[1];
    if (hostname !== null && servicePort === String(port)) return hostname;
  }
  return null;
}

/** 設定ファイルの中身。無ければ null（トンネルを使っていない人） */
export function readTunnelConfig(home: string): string | null {
  for (const name of ["config.yml", "config.yaml"]) {
    try {
      return readFileSync(join(home, ".cloudflared", name), "utf8");
    } catch {
      // 次の候補
    }
  }
  return null;
}

export interface Reach {
  readonly reached: boolean;
  readonly detail: string;
}

/**
 * 外から届いたかの判定。Cloudflare Access が 302/401/403 を返すのは「トンネルの先まで来た」証拠。
 * 530（本文に 1033 が載る）は「Cloudflareまでは来たがトンネルが繋がっていない」。
 */
export function classifyReach(status: number, body: string): Reach {
  if (status === 530 || (status >= 500 && body.includes("1033")))
    return { reached: false, detail: `HTTP ${String(status)}（トンネルが繋がっていない）` };
  if (status >= 500) return { reached: false, detail: `HTTP ${String(status)}` };
  const access = [302, 401, 403].includes(status) ? "（Accessが応答）" : "";
  return { reached: true, detail: `HTTP ${String(status)}${access}` };
}

/** 外からの到達を待つ上限。Cloudflare の遠回りを含めても普段は1秒かからない */
export const REACH_TIMEOUT_MS = 8_000;

export async function probeReach(probes: Probes, hostname: string, timeoutMs = REACH_TIMEOUT_MS): Promise<Reach> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await probes.fetch(`https://${hostname}/healthz`, {
      redirect: "manual",
      signal: controller.signal,
    });
    const body = response.status >= 500 ? (await response.text()).slice(0, 4096) : "";
    return classifyReach(response.status, body);
  } catch {
    return { reached: false, detail: controller.signal.aborted ? "時間切れ" : "接続できない" };
  } finally {
    clearTimeout(timer);
  }
}
