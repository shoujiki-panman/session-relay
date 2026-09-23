/**
 * `relay doctor [--fix] [--json]` の表示と修理。
 *
 * --fix  落ちている常駐（受け口・トンネル）を `launchctl kickstart -k` で起こし、もう一度確かめる
 * --json 機械が読む形。Mulmo Control の環境タブがこれを読んで表示し、必要なら --fix を呼ぶ
 *
 * 出力に載せるのは項目名・状態・ホスト名まで。Access の team domain / AUD や
 * トンネルの資格情報は、どこにも読みに行かないので載りようがない。
 */
import { homedir } from "node:os";
import { type Agent, type Probes, kickAgent, realProbes } from "./doctor-probes.ts";
import { type Check, collectChecks } from "./doctor.ts";

export interface FixAction {
  readonly label: string;
  /** 起こした理由になった項目の id（例: ["tunnel-agent", "tunnel-reach"]） */
  readonly reasons: readonly string[];
  readonly action: string;
  readonly ok: boolean;
  readonly at: string;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly checks: readonly Omit<Check, "agent">[];
  readonly fixes: readonly FixAction[];
}

/** 起こしてから確かめ直すまでの間隔と上限。cloudflared は接続が Registered になるまで数秒かかる */
const RECHECK_INTERVAL_MS = 3_000;
const RECHECK_LIMIT_MS = 30_000;

/** 落ちている項目を、起こす常駐ごとにまとめる（トンネルの2項目は同じ cloudflared を指す） */
export function fixTargets(checks: readonly Check[]): { agent: Agent; reasons: string[] }[] {
  const byLabel = new Map<string, { agent: Agent; reasons: string[] }>();
  for (const check of checks) {
    if (check.ok || check.agent === null) continue;
    const entry = byLabel.get(check.agent.label) ?? { agent: check.agent, reasons: [] };
    entry.reasons.push(check.id);
    byLabel.set(check.agent.label, entry);
  }
  return [...byLabel.values()];
}

async function recheckUntilHealed(
  home: string,
  port: number,
  probes: Probes,
  watched: ReadonlySet<string>,
): Promise<Check[]> {
  let checks = await collectChecks(home, port, probes);
  for (let waited = 0; waited < RECHECK_LIMIT_MS; waited += RECHECK_INTERVAL_MS) {
    if (checks.every((c) => c.ok || !watched.has(c.id))) break;
    await probes.sleep(RECHECK_INTERVAL_MS);
    checks = await collectChecks(home, port, probes);
  }
  return checks;
}

export async function diagnose(
  home: string,
  port: number,
  probes: Probes,
  fix: boolean,
  now: () => Date = () => new Date(),
): Promise<DoctorReport> {
  let checks = await collectChecks(home, port, probes);
  const fixes: FixAction[] = [];
  const targets = fix ? fixTargets(checks) : [];
  for (const { agent, reasons } of targets) {
    const kicked = await kickAgent(probes, agent);
    fixes.push({ label: agent.label, reasons, ...kicked, at: now().toISOString() });
  }
  if (targets.length > 0)
    checks = await recheckUntilHealed(home, port, probes, new Set(targets.flatMap((t) => t.reasons)));
  return {
    ok: checks.every((c) => c.ok),
    checkedAt: now().toISOString(),
    checks: checks.map(publicCheck),
    fixes,
  };
}

/** 出力には常駐のラベルやplistのパスを載せない（起こすのは doctor 自身の仕事） */
function publicCheck(check: Check): Omit<Check, "agent"> {
  const { id, name, ok, state, detail, hint } = check;
  return { id, name, ok, state, detail, hint };
}

function mark(check: Omit<Check, "agent">): string {
  if (check.state === "unconfigured") return "➖";
  return check.ok ? "✅" : "⚠️";
}

export function renderReport(report: DoctorReport): string {
  const lines = report.fixes.map((f) => `🔧 ${f.label} を起こした（${f.action}${f.ok ? "" : "・失敗"}）`);
  for (const check of report.checks) {
    const detail = check.detail === "" ? "" : `: ${check.detail}`;
    const note = check.state === "unconfigured" ? "（未設定）" : "";
    const tail = check.ok ? "" : `  → ${check.hint}`;
    lines.push(`${mark(check)} ${check.name}${note}${detail}${tail}`);
  }
  const bad = report.checks.filter((c) => !c.ok).length;
  lines.push(bad === 0 ? "ぜんぶ通っています" : `${String(bad)}件が要確認です`);
  return lines.join("\n") + "\n";
}

export async function runDoctor(args: readonly string[], home: string = homedir(), port = 8788): Promise<number> {
  const report = await diagnose(home, port, realProbes(), args.includes("--fix"));
  process.stdout.write(args.includes("--json") ? JSON.stringify(report, null, 2) + "\n" : renderReport(report));
  return report.ok ? 0 : 1;
}
