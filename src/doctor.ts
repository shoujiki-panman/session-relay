/**
 * `relay doctor` — 「繋がらない」を1コマンドで切り分ける。
 * 検査するのは登録と生存だけ。直すのは install や docs の仕事。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isRecord } from "./types.ts";

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly hint: string;
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

async function depositAlive(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function collectChecks(home: string, port: number): Promise<Check[]> {
  const hasClaude = existsSync(join(home, ".claude"));
  const hasCodex = existsSync(join(home, ".codex"));
  const checks: Check[] = [];
  if (hasClaude) {
    checks.push(
      { name: "Claude CodeのMCP登録", ok: claudeMcpRegistered(home), hint: "relay install を実行" },
      { name: "Claude Codeのスキル", ok: existsSync(join(home, ".claude", "skills", "relay")), hint: "relay install を実行" },
    );
  }
  if (hasCodex) {
    checks.push(
      { name: "CodexのMCP登録", ok: codexMcpRegistered(home), hint: "relay install を実行" },
      { name: "Codexのスキル", ok: existsSync(join(home, ".codex", "skills", "relay")), hint: "relay install を実行" },
    );
  }
  if (!hasClaude && !hasCodex)
    checks.push({ name: "ハーネス", ok: false, hint: "Claude CodeかCodexが見つからない（~/.claude / ~/.codex が無い）" });
  const inboxDir = join(home, ".local", "share", "session-relay", "inbox");
  const wantsDeposit = existsSync(inboxDir) || existsSync(join(home, ".config", "session-relay"));
  if (wantsDeposit)
    checks.push({
      name: "投函口（127.0.0.1:" + String(port) + "）",
      ok: await depositAlive(port),
      hint: "relay mcp-deposit-http の起動を確認（docs/remote-mcp-ja.md の常駐化の節）",
    });
  return checks;
}

export async function runDoctor(home: string = homedir(), port = 8788): Promise<number> {
  const checks = await collectChecks(home, port);
  for (const check of checks) {
    const mark = check.ok ? "✅" : "⚠️";
    const tail = check.ok ? "" : `  → ${check.hint}`;
    process.stdout.write(`${mark} ${check.name}${tail}\n`);
  }
  const bad = checks.filter((c) => !c.ok).length;
  process.stdout.write(bad === 0 ? "ぜんぶ通っています\n" : `${String(bad)}件が要確認です\n`);
  return bad === 0 ? 0 : 1;
}
