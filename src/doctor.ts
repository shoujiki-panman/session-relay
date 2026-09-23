/**
 * `relay doctor` — 「繋がらない」を1コマンドで切り分ける。
 * 検査するのは登録と生存。`--fix` で起こせるのは常駐（受け口とトンネル）だけで、
 * 登録の直しは install や docs の仕事。表示と `--fix` は doctor-cli.ts。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Agent,
  type Probes,
  agentState,
  findAgent,
  probeReach,
  readTunnelConfig,
  realProbes,
  tunnelHostname,
} from "./doctor-probes.ts";
import { isRecord } from "./types.ts";

/** ok=通っている / down=落ちている / unconfigured=使っていない（失敗にしない） / missing=入っていない */
export type CheckState = "ok" | "down" | "unconfigured" | "missing";

export interface Check {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly state: CheckState;
  readonly detail: string;
  readonly hint: string;
  /** --fix で起こせる常駐。無ければ null */
  readonly agent: Agent | null;
}

const RESIDENT_HINT = "relay doctor --fix で起こす（常駐化は docs/remote-mcp-ja.md の常駐化の節）";

function simple(id: string, name: string, ok: boolean, hint: string): Check {
  return { id, name, ok, state: ok ? "ok" : "missing", detail: "", hint, agent: null };
}

/** ~/.claude.json のユーザースコープに relay MCP が登録されているか */
function claudeMcpRegistered(home: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
    if (!isRecord(parsed)) return false;
    const servers = parsed["mcpServers"];
    return isRecord(servers) && "relay" in servers;
  } catch {
    return false;
  }
}

/** ~/.codex/config.toml に [mcp_servers.relay] があるか */
function codexMcpRegistered(home: string): boolean {
  try {
    return readFileSync(join(home, ".codex", "config.toml"), "utf8").includes("[mcp_servers.relay]");
  } catch {
    return false;
  }
}

function harnessChecks(home: string): Check[] {
  const hasClaude = existsSync(join(home, ".claude"));
  const hasCodex = existsSync(join(home, ".codex"));
  const fix = "relay install を実行";
  const checks: Check[] = [];
  if (hasClaude)
    checks.push(
      simple("claude-mcp", "Claude CodeのMCP登録", claudeMcpRegistered(home), fix),
      simple("claude-skill", "Claude Codeのスキル", existsSync(join(home, ".claude", "skills", "relay")), fix),
    );
  if (hasCodex)
    checks.push(
      simple("codex-mcp", "CodexのMCP登録", codexMcpRegistered(home), fix),
      simple("codex-skill", "Codexのスキル", existsSync(join(home, ".codex", "skills", "relay")), fix),
    );
  if (!hasClaude && !hasCodex)
    checks.push(simple("harness", "ハーネス", false, "Claude CodeかCodexが見つからない（~/.claude / ~/.codex が無い）"));
  return checks;
}

async function depositAlive(probes: Probes, port: number): Promise<boolean> {
  try {
    const response = await probes.fetch(`http://127.0.0.1:${String(port)}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function depositCheck(home: string, port: number, probes: Probes): Promise<Check> {
  const ok = await depositAlive(probes, port);
  return {
    id: "deposit",
    name: `投函口（127.0.0.1:${String(port)}）`,
    ok,
    state: ok ? "ok" : "down",
    detail: ok ? "" : "応答が無い",
    hint: RESIDENT_HINT,
    agent: findAgent(home, ["mcp-deposit-http"]),
  };
}

function unconfigured(detail: string): Check {
  return { id: "tunnel", name: "Cloudflare Tunnel", ok: true, state: "unconfigured", detail, hint: "", agent: null };
}

const AGENT_DETAIL = { running: "動いている", stopped: "止まっている", "not-loaded": "読み込まれていない" } as const;

async function tunnelAgentCheck(probes: Probes, agent: Agent | null): Promise<Check> {
  const base = { id: "tunnel-agent", name: "トンネルの常駐（cloudflared）", hint: RESIDENT_HINT };
  if (agent === null)
    return { ...base, ok: false, state: "missing", detail: "cloudflared の LaunchAgent が無い", agent: null };
  const state = await agentState(probes, agent.label);
  const ok = state === "running";
  return { ...base, ok, state: ok ? "ok" : "down", detail: AGENT_DETAIL[state], agent };
}

/** トンネルの2項目。設定が無い人・受け口へ向いていない人は「未設定」1件だけ（失敗にしない） */
async function tunnelChecks(home: string, port: number, probes: Probes): Promise<Check[]> {
  const config = readTunnelConfig(home);
  if (config === null) return [unconfigured("~/.cloudflared/config.yml が無い")];
  const hostname = tunnelHostname(config, port);
  if (hostname === null) return [unconfigured(`${String(port)} へ向く ingress が無い`)];
  const agent = findAgent(home, ["cloudflared", "tunnel"]);
  const reach = await probeReach(probes, hostname);
  return [
    await tunnelAgentCheck(probes, agent),
    {
      id: "tunnel-reach",
      name: `外からの到達（https://${hostname}）`,
      ok: reach.reached,
      state: reach.reached ? "ok" : "down",
      detail: reach.detail,
      hint: RESIDENT_HINT,
      agent,
    },
  ];
}

export async function collectChecks(home: string, port: number, probes: Probes = realProbes()): Promise<Check[]> {
  const checks = harnessChecks(home);
  const inboxDir = join(home, ".local", "share", "session-relay", "inbox");
  const wantsDeposit = existsSync(inboxDir) || existsSync(join(home, ".config", "session-relay"));
  if (wantsDeposit) checks.push(await depositCheck(home, port, probes));
  if (wantsDeposit || readTunnelConfig(home) !== null) checks.push(...(await tunnelChecks(home, port, probes)));
  return checks;
}
