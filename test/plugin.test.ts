import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// Anthropicのプラグイン一覧に出す形（plugins/session-relay）が、npmの本体とずれないように見張る
const ROOT = join(import.meta.dirname, "..");
const PLUGIN = join(ROOT, "plugins", "session-relay");

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const pkg = z.object({ name: z.string(), version: z.string() }).parse(readJson(join(ROOT, "package.json")));
const manifest = z
  .object({
    version: z.string(),
    mcpServers: z.record(z.string(), z.object({ command: z.string(), args: z.array(z.string()) })),
  })
  .parse(readJson(join(PLUGIN, ".claude-plugin", "plugin.json")));

describe("プラグインの形", () => {
  it("プラグインの版はnpmの版と同じ", () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it("MCPはnpxで、いまの版にぴったり固定して起動する（範囲や@latestは審査で止まる）", () => {
    expect(manifest.mcpServers["relay"]).toEqual({
      command: "npx",
      args: ["-y", `${pkg.name}@${pkg.version}`, "mcp"],
    });
  });

  it("スキルは本体の skills/relay と一字一句同じ写し", () => {
    const original = readFileSync(join(ROOT, "skills", "relay", "SKILL.md"), "utf8");
    const copy = readFileSync(join(PLUGIN, "skills", "relay", "SKILL.md"), "utf8");
    expect(copy).toBe(original);
  });

  it("プラグインのフォルダに入れていいのは決めたファイルだけ（package.jsonやロックファイルを置くと審査で止まる）", () => {
    const files = readdirSync(PLUGIN, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(PLUGIN.length + 1))
      .sort();
    expect(files).toEqual([
      ".claude-plugin/icon.png",
      ".claude-plugin/plugin.json",
      "README.md",
      "skills/relay/SKILL.md",
    ]);
  });
});
