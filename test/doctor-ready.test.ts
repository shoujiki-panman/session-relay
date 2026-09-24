/**
 * relay doctor の接続の検査（cloudflared の /ready）。launchctl と HTTP は偽物を差し込む。
 * 「プロセスは生きているのに接続だけ落ちた」と、別の cloudflared を拾わないことを確かめる。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import type { Probes } from "../src/doctor-probes.ts";
import { classifyReady, metricsFromLog } from "../src/doctor-ready.ts";
import { diagnose } from "../src/doctor-cli.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const ID_OLD = "11111111-1111-1111-1111-111111111111";
const ID = "22222222-2222-2222-2222-222222222222";
const run = (id: string, port: number): string =>
  `2026-09-24T00:00:00Z INF Starting tunnel tunnelID=x\n` +
  `2026-09-24T00:00:00Z INF Generated Connector ID: ${id}\n` +
  `2026-09-24T00:00:00Z INF Starting metrics server on 127.0.0.1:${String(port)}/metrics\n` +
  `2026-09-24T00:00:01Z INF Registered tunnel connection connIndex=0\n`;

it("ログからは最後の起動のメトリクスと Connector ID だけを取る", () => {
  expect(metricsFromLog(run(ID_OLD, 20241) + run(ID, 20242))).toEqual({ address: "127.0.0.1:20242", connectorId: ID });
  // 最後の起動にメトリクスの行がまだ無ければ、前の起動の値を使わない
  expect(metricsFromLog(run(ID_OLD, 20241) + "INF Starting tunnel tunnelID=x\n")).toBeNull();
  expect(metricsFromLog("何も無い")).toBeNull();
  // ループバック以外は叩かない
  expect(metricsFromLog(run(ID, 20242).replace("127.0.0.1", "203.0.113.5"))).toBeNull();
});

it("/ready は connectorId が一致したときだけ信じる。0本は down", () => {
  expect(classifyReady({ status: 200, readyConnections: 4, connectorId: ID }, ID).state).toBe("ok");
  expect(classifyReady({ status: 503, readyConnections: 0, connectorId: ID }, ID).state).toBe("down");
  expect(classifyReady({ status: 200, readyConnections: 4, connectorId: ID_OLD }, ID).state).toBe("unknown");
  expect(classifyReady("x", ID).state).toBe("unknown");
  expect(classifyReady({ connectorId: ID }, ID).state).toBe("unknown");
});

const CONFIG = "ingress:\n  - hostname: relay.example.com\n    service: http://127.0.0.1:8788\n  - service: http_status:404\n";

function home(withLogPath = true): { dir: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "session-relay-ready-"));
  roots.push(dir);
  mkdirSync(join(dir, ".claude", "skills", "relay"), { recursive: true });
  writeFileSync(join(dir, ".claude.json"), JSON.stringify({ mcpServers: { relay: {} } }));
  mkdirSync(join(dir, ".config", "session-relay"), { recursive: true });
  mkdirSync(join(dir, ".cloudflared"), { recursive: true });
  writeFileSync(join(dir, ".cloudflared", "config.yml"), CONFIG);
  const agents = join(dir, "Library", "LaunchAgents");
  mkdirSync(agents, { recursive: true });
  const log = join(dir, "cloudflared.err.log");
  const logKey = withLogPath ? `<key>StandardErrorPath</key><string>${log}</string>` : "";
  writeFileSync(
    join(agents, "tunnel.plist"),
    `<plist><dict><key>Label</key><string>test.tunnel</string>${logKey}` +
      `<key>ProgramArguments</key><array><string>cloudflared</string><string>tunnel</string><string>run</string></array></dict></plist>`,
  );
  writeFileSync(log, run(ID, 20242));
  return { dir, log };
}

/** 接続の本数を、/ready を聞かれるたびに列から1つずつ出す（最後の値は繰り返す） */
function world(readies: (number | "unreachable")[], connectorId = ID) {
  const calls: string[] = [];
  let asked = 0;
  const fetchImpl: typeof fetch = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("http://127.0.0.1:8788")) return Promise.resolve(new Response("{}"));
    if (url.startsWith("https://")) return Promise.resolve(new Response("", { status: 401 }));
    const ready = readies[Math.min(asked, readies.length - 1)];
    asked += 1;
    if (ready === "unreachable" || ready === undefined) return Promise.reject(new Error("ECONNREFUSED"));
    return Promise.resolve(Response.json({ status: ready > 0 ? 200 : 503, readyConnections: ready, connectorId }));
  };
  const probes: Probes = {
    uid: 501,
    fetch: fetchImpl,
    sleep: () => Promise.resolve(),
    run: (command, args) => {
      calls.push([command, ...args].join(" "));
      return Promise.resolve({ code: 0, stdout: "\tstate = running\n" });
    },
  };
  return { probes, calls, asked: () => asked };
}

it("プロセスは生きていて外から 401 でも、接続が0本なら ✗ を出す", async () => {
  const w = world([0]);
  const report = await diagnose(home().dir, 8788, w.probes, false);
  const by = new Map(report.checks.map((c) => [c.id, c]));
  expect(by.get("tunnel-agent")?.ok).toBe(true);
  expect(by.get("tunnel-reach")?.ok).toBe(true);
  expect(by.get("tunnel-ready")?.state).toBe("down");
  expect(report.ok).toBe(false);
});

it("--fix は接続0本のトンネルを起こし、接続が張れるまで待ってから ok と言う", async () => {
  // 起こす前の1回は0本。起こした直後は届かない・0本が続き、4回目で張れる
  const w = world([0, "unreachable", 0, 0, 4]);
  const report = await diagnose(home().dir, 8788, w.probes, true);
  expect(w.calls).toContain("launchctl kickstart -k gui/501/test.tunnel");
  expect(report.fixes.map((f) => f.reasons)).toEqual([["tunnel-ready"]]);
  expect(report.ok).toBe(true);
  expect(report.checks.find((c) => c.id === "tunnel-ready")?.state).toBe("ok");
  expect(w.asked()).toBe(5);
});

it("別の cloudflared の答え・メトリクスに届かないときは「未確認」で、失敗にしない", async () => {
  for (const w of [world([4], ID_OLD), world(["unreachable"])]) {
    const report = await diagnose(home().dir, 8788, w.probes, false);
    const ready = report.checks.find((c) => c.id === "tunnel-ready");
    expect(ready?.state).toBe("unknown");
    expect(ready?.ok).toBe(true);
    expect(report.ok).toBe(true);
  }
});

it("LaunchAgent にログの場所が無ければ、接続の検査は出さない（総当たりしない）", async () => {
  const w = world([4]);
  const report = await diagnose(home(false).dir, 8788, w.probes, false);
  expect(report.checks.some((c) => c.id === "tunnel-ready")).toBe(false);
  expect(w.asked()).toBe(0);
});
