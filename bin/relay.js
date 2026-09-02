#!/usr/bin/env node
/**
 * 会話を別スレッド／別ハーネスへ渡す。
 *   relay [--to codex] [--print] [--previous] [--from <#|ref>]
 *   relay --projects / --list / --pick / --canvas
 *   relay mcp                 MCPサーバーとして話す（AIが自分で取りに来る側）
 *   relay mcp-deposit         会話を預けるだけのMCP（外向き候補）
 *   relay mcp-deposit-http    Cloudflare Access必須のリモート投函口
 *   relay show <session.jsonl>
 *
 * **手元では src と dist の新しい方を読む。** 配布物には src が入っていない
 * （package.json の files が dist だけ）ので、入れた人は必ず dist を読む。
 *
 * 常に src を読むと「直したのに直っていない」は防げるが、Nodeが毎回TypeScriptを
 * 変換するので**同じ操作が dist の50倍かかる**（実測: 13MBのCodexセッションで 0.13秒 → 6.4秒）。
 * 逆に常に dist だと、ビルドし忘れた古いコードが黙って動く（2026-08-28に踏んだ）。
 * だから新しい方を選ぶ。直せば src が新しくなるので必ず反映され、
 * ビルドすれば dist が新しくなるので速く戻る。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");
const distDir = join(here, "..", "dist");

/** そのディレクトリで一番新しいファイルの時刻。無ければ 0 */
const newest = (dir, suffix) => {
  if (!existsSync(dir)) return 0;
  let latest = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(suffix)) continue;
    const { mtimeMs } = statSync(join(dir, name));
    if (mtimeMs > latest) latest = mtimeMs;
  }
  return latest;
};

const fromSource = newest(srcDir, ".ts") > newest(distDir, ".js");
const dir = fromSource ? srcDir : distDir;
const ext = fromSource ? "ts" : "js";

const args = process.argv.slice(2);
const entry =
  args[0] === "mcp"
    ? "mcp-main"
    : args[0] === "mcp-deposit"
      ? "deposit-mcp-main"
      : args[0] === "mcp-deposit-http"
        ? "deposit-http-main"
        : "cli";
// cli 側は先頭に「何をするか」を要求する。`relay --print` のように省かれたら足す
if (entry === "cli" && !["show", "install", "deposits", "doctor", "unread"].includes(args[0])) process.argv.splice(2, 0, "relay");

await import(pathToFileURL(join(dir, `${entry}.${ext}`)).href);
