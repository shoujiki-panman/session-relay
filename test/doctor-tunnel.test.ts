/**
 * relay doctor のトンネル検査と --fix。launchctl と HTTPS は偽物を差し込み、本物には触らない。
 * 2026-09-22 に踏んだ「受け口は生きているがトンネルが止まっている」を再現して確かめる。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { classifyReach, findAgent, type Probes, tunnelHostname } from "../src/doctor-probes.ts";
import { collectChecks } from "../src/doctor.ts";
import { diagnose, fixTargets, renderReport } from "../src/doctor-cli.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const CONFIG = `# コメント
tunnel: 00000000-0000-0000-0000-000000000000
credentials-file: /secret/creds.json
ingress:
  - hostname: other.example.com
    service: http://127.0.0.1:3000
  - hostname: relay.example.com
    service: http://127.0.0.1:8788
    originRequest:
      httpHostHeader: 127.0.0.1
  - service: http_status:404
`;

const plist = (label: string, args: string[]): string =>
  `<?xml version="1.0"?><plist><dict><key>Label</key><string>${label}</string>` +
  `<key>ProgramArguments</key><array>${args.map((a) => `<string>${a}</string>`).join("")}</array></dict></plist>`;

function home(opts: { config?: string; agents?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), "session-relay-tunnel-"));
  roots.push(dir);
  mkdirSync(join(dir, ".claude", "skills", "relay"), { recursive: true });
  writeFileSync(join(dir, ".claude.json"), JSON.stringify({ mcpServers: { relay: {} } }));
  mkdirSync(join(dir, ".config", "session-relay"), { recursive: true });
  if (opts.config !== undefined) {
    mkdirSync(join(dir, ".cloudflared"), { recursive: true });
    writeFileSync(join(dir, ".cloudflared", "config.yml"), opts.config);
  }
  if (opts.agents === true) {
    const agents = join(dir, "Library", "LaunchAgents");
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, "a.deposit.plist"), plist("test.deposit", ["node", "relay.js", "mcp-deposit-http"]));
    writeFileSync(join(agents, "b.tunnel.plist"), plist("test.tunnel", ["cloudflared", "tunnel", "run", "x"]));
  }
  return dir;
}

/** 偽の世界: 常駐の生死を持ち、kickstart で生き返る。呼ばれた launchctl を記録する */
function world(initial: { deposit: boolean; tunnel: boolean; tunnelLoaded?: boolean; reachStatus?: number }) {
  const state = { ...initial, tunnelLoaded: initial.tunnelLoaded ?? true };
  const calls: string[] = [];
  const fetched: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    fetched.push(url);
    if (url.startsWith("http://127.0.0.1")) {
      return state.deposit ? Promise.resolve(new Response("{}")) : Promise.reject(new Error("ECONNREFUSED"));
    }
    if (!state.tunnel) return Promise.resolve(new Response("error code: 1033", { status: 530 }));
    return Promise.resolve(new Response("", { status: state.reachStatus ?? 302 }));
  };
  const printed = (target: string) => {
    if (target.endsWith("test.tunnel") && !state.tunnelLoaded) return { code: 113, stdout: "" };
    const running = target.endsWith("test.tunnel") ? state.tunnel : state.deposit;
    return { code: 0, stdout: `gui/501/x = {\n\tstate = ${running ? "running" : "not running"}\n}` };
  };
  const probes: Probes = {
    uid: 501,
    fetch: fetchImpl,
    sleep: () => Promise.resolve(),
    run: (command, args) => {
      calls.push([command, ...args].join(" "));
      const target = args[args.length - 1] ?? "";
      if (args[0] === "print") return Promise.resolve(printed(target));
      if (args[0] === "bootstrap") state.tunnelLoaded = true;
      if (args[0] === "kickstart") {
        if (target.endsWith("test.tunnel")) state.tunnel = true;
        if (target.endsWith("test.deposit")) state.deposit = true;
      }
      return Promise.resolve({ code: 0, stdout: "" });
    },
  };
  return { probes, calls, fetched, state };
}

it("config.yml から、受け口の port に向く ingress の hostname だけを読む", () => {
  expect(tunnelHostname(CONFIG, 8788)).toBe("relay.example.com");
  expect(tunnelHostname(CONFIG, 3000)).toBe("other.example.com");
  expect(tunnelHostname(CONFIG, 9999)).toBeNull();
  expect(tunnelHostname('ingress:\n  - hostname: "q.example.com"\n    service: localhost:8788\n', 8788)).toBe("q.example.com");
  // 前の項目の hostname を、hostname の無い catch-all に持ち越さない
  expect(tunnelHostname("ingress:\n  - hostname: a.example.com\n    service: http://127.0.0.1:1\n  - service: http://127.0.0.1:8788\n", 8788)).toBeNull();
});

it("Access の 302/401/403 は届いている、530・1033 は届いていない", () => {
  for (const status of [200, 302, 401, 403]) expect(classifyReach(status, "").reached).toBe(true);
  expect(classifyReach(530, "").reached).toBe(false);
  expect(classifyReach(502, "error code: 1033").reached).toBe(false);
  expect(classifyReach(503, "").reached).toBe(false);
});

it("LaunchAgent はラベルを決め打ちせず、中身で探す", () => {
  const h = home({ agents: true });
  expect(findAgent(h, ["mcp-deposit-http"])?.label).toBe("test.deposit");
  expect(findAgent(h, ["cloudflared", "tunnel"])?.label).toBe("test.tunnel");
  expect(findAgent(h, ["nothing-like-this"])).toBeNull();
});

it("cloudflared の設定が無い人には「未設定」と出し、失敗にしない", async () => {
  const { probes } = world({ deposit: true, tunnel: true });
  const checks = await collectChecks(home({}), 8788, probes);
  const tunnel = checks.find((c) => c.id === "tunnel");
  expect(tunnel?.state).toBe("unconfigured");
  expect(tunnel?.ok).toBe(true);
  expect(checks.every((c) => c.ok)).toBe(true);
  expect(renderReport({ ok: true, checkedAt: "", checks, fixes: [] })).toContain("➖ Cloudflare Tunnel（未設定）");
});

it("受け口が生きていてもトンネルが止まっていれば ✗ を出す（2026-09-22 の再現）", async () => {
  const { probes, fetched } = world({ deposit: true, tunnel: false });
  const report = await diagnose(home({ config: CONFIG, agents: true }), 8788, probes, false);
  expect(report.ok).toBe(false);
  const by = new Map(report.checks.map((c) => [c.id, c]));
  expect(by.get("deposit")?.ok).toBe(true);
  expect(by.get("tunnel-agent")?.state).toBe("down");
  expect(by.get("tunnel-reach")?.detail).toContain("530");
  expect(fetched).toContain("https://relay.example.com/healthz");
  expect(report.fixes).toEqual([]);
  expect(renderReport(report)).toContain("⚠️ 外からの到達");
});

it("--fix は落ちた常駐だけを kickstart -k で起こし、確かめ直す", async () => {
  const w = world({ deposit: true, tunnel: false });
  const report = await diagnose(home({ config: CONFIG, agents: true }), 8788, w.probes, true, () => new Date("2026-09-24T01:40:00Z"));
  expect(report.ok).toBe(true);
  expect(w.calls).toContain("launchctl kickstart -k gui/501/test.tunnel");
  expect(w.calls.some((c) => c.includes("kickstart") && c.includes("test.deposit"))).toBe(false);
  expect(report.fixes).toEqual([
    { label: "test.tunnel", reasons: ["tunnel-agent", "tunnel-reach"], action: "kickstart", ok: true, at: "2026-09-24T01:40:00.000Z" },
  ]);
});

it("--fix は読み込まれていない常駐を bootstrap してから起こす。受け口も起こす", async () => {
  const w = world({ deposit: false, tunnel: false, tunnelLoaded: false });
  const h = home({ config: CONFIG, agents: true });
  const report = await diagnose(h, 8788, w.probes, true);
  expect(report.ok).toBe(true);
  expect(w.calls).toContain(`launchctl bootstrap gui/501 ${join(h, "Library", "LaunchAgents", "b.tunnel.plist")}`);
  expect(report.fixes.map((f) => [f.label, f.action])).toEqual([
    ["test.deposit", "kickstart"],
    ["test.tunnel", "bootstrap+kickstart"],
  ]);
});

it("起こしても戻らなければ、確かめ直しを打ち切って ✗ のまま返す", async () => {
  const w = world({ deposit: true, tunnel: false });
  const stubborn: Probes = {
    ...w.probes,
    run: async (command, args) => {
      const result = await w.probes.run(command, args);
      w.state.tunnel = false; // 起こしてもすぐ落ちる
      return result;
    },
  };
  const report = await diagnose(home({ config: CONFIG, agents: true }), 8788, stubborn, true);
  expect(report.ok).toBe(false);
  expect(report.fixes).toHaveLength(1);
});

it("--json の形に資格情報のたぐいが載らない", async () => {
  const { probes } = world({ deposit: true, tunnel: true });
  const report = await diagnose(home({ config: CONFIG, agents: true }), 8788, probes, false);
  const json = JSON.stringify(report);
  expect(json).not.toContain("creds.json");
  expect(json).not.toContain("00000000-0000");
  expect(json).not.toContain('"agent"');
  expect(report.checks.map((c) => Object.keys(c).sort())[0]).toEqual(["detail", "hint", "id", "name", "ok", "state"]);
});

it("起こす対象は常駐ごとに1回（トンネルの2項目は同じ cloudflared）", async () => {
  const { probes } = world({ deposit: true, tunnel: false });
  const checks = await collectChecks(home({ config: CONFIG, agents: true }), 8788, probes);
  expect(fixTargets(checks).map((t) => [t.agent.label, t.reasons])).toEqual([["test.tunnel", ["tunnel-agent", "tunnel-reach"]]]);
});
