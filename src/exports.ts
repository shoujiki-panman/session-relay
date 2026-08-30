/**
 * 一覧を外に出す3つ。canvas と records は**画面をこちらで作らない**——
 * 既にある道具（Obsidianのキャンバス、MulmoTerminalのコレクション）に読ませる。
 *
 * page だけは1枚のHTMLを自分で書く。特定のアプリの中に作ると、そのアプリを
 * 使っていない人が選べなくなるため（本人の指摘・2026-08-30）。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { toCanvas } from "./canvas.ts";
import { buildPage } from "./page.ts";
import { projectsOf } from "./query.ts";
import { toRecords, writeRecords } from "./records.ts";

const nothingFound = (): number => {
  process.stderr.write("会話の記録が見つかりませんでした\n");
  return 1;
};

/** OSごとの「開く」。無い環境では黙って諦め、パスだけ伝える */
const opener = (): readonly string[] | null => {
  if (process.platform === "darwin") return ["open"];
  if (process.platform === "win32") return ["cmd", "/c", "start", ""];
  if (process.platform === "linux") return ["xdg-open"];
  return null;
};

/**
 * 既定の置き場。いま居るリポジトリには書かない——`relay --page` を打った場所が
 * たまたま誰かのリポジトリだと、会話の見出しが混ざったファイルが残る。
 */
const defaultPagePath = (): string =>
  join(homedir(), ".cache", "session-relay", "conversations.html");

/** ブラウザで開く1枚。どのツールも要らないので、どこからでも選べる */
export function page(given: string | null, limit: number): number {
  const projects = projectsOf().slice(0, limit);
  if (projects.length === 0) return nothingFound();
  const outPath = given ?? defaultPagePath();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buildPage(projects), "utf8");
  const sessions = projects.reduce((total, row) => total + row.sessions.length, 0);
  process.stderr.write(
    `${outPath} に書き出しました（プロジェクト ${String(projects.length)} / 会話 ${String(sessions)}）\n`,
  );
  const how = opener();
  if (how === null) return 0;
  spawnSync(how[0] ?? "", [...how.slice(1), outPath], { stdio: "ignore" });
  return 0;
}

/** プロジェクトと会話を .canvas に書き出す（Obsidianがそのまま開く） */
export function canvas(outPath: string, limit: number): number {
  const projects = projectsOf().slice(0, limit);
  if (projects.length === 0) return nothingFound();
  writeFileSync(outPath, toCanvas(projects), "utf8");
  const sessions = projects.reduce((total, row) => total + row.sessions.length, 0);
  process.stderr.write(
    `${outPath} に書き出しました（プロジェクト ${String(projects.length)} / 会話 ${String(sessions)}）\n` +
      "ObsidianのVaultに置くと、そのままキャンバスとして開けます\n",
  );
  return 0;
}

/** 一覧を1会話＝1ファイルで書き出す（画面から選ぶ用） */
export function records(dir: string, limit: number): number {
  const projects = projectsOf().slice(0, limit);
  if (projects.length === 0) return nothingFound();
  const written = writeRecords(toRecords(projects), dir);
  process.stderr.write(
    `${dir} に ${String(written)} 件書き出しました（プロジェクト ${String(projects.length)}）\n`,
  );
  return 0;
}
