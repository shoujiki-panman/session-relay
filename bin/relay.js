#!/usr/bin/env node
/**
 * 会話を別スレッド／別ハーネスへ渡す。
 *   relay [--to codex] [--print] [--previous] [--from <#|ref>]
 *   relay --projects / --list / --pick / --canvas
 *   relay mcp                 MCPサーバーとして話す（AIが自分で取りに来る側）
 *   relay show <session.jsonl>
 *
 * **手元に src があれば src を読む。** 配布物には src が入っていない（package.json の
 * files が dist だけ）ので、入れた人は必ず dist を読む。
 * 逆にすると、開発中に古い dist が黙って使われて「直したのに直っていない」になる
 * （2026-08-28 に実際にやった。出力が変わったのはデータが変わっただけだった）。
 * Nodeは node_modules の中では型を剥がさないので、配る方は必ずビルド済みが要る。
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fromSource = existsSync(join(here, "..", "src", "cli.ts"));
const dir = join(here, "..", fromSource ? "src" : "dist");
const ext = fromSource ? "ts" : "js";

const args = process.argv.slice(2);
const entry = args[0] === "mcp" ? "mcp-main" : "cli";
// cli 側は先頭に「何をするか」を要求する。`relay --print` のように省かれたら足す
if (entry === "cli" && args[0] !== "show") process.argv.splice(2, 0, "relay");

await import(pathToFileURL(join(dir, `${entry}.${ext}`)).href);
