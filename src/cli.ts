/**
 * 会話を別スレッド／別ハーネスへ渡す。
 *   relay --projects [件数]             プロジェクト単位の一覧（選ぶ単位はこちらが既定）
 *   relay --page [出力先]               一覧を1枚のHTMLにしてブラウザで開く
 *   relay --canvas [出力先]             プロジェクトと会話を .canvas に書き出す
 *   relay --pick [検索語] [--all]       その場で選ぶ（↑↓・打つと絞る・Enter・Esc）
 *   relay --list [件数] [--all] [--in <#|名前>]
 *                                       会話の一覧。--in でプロジェクトを絞る
 *   relay [--to claude|codex] [--print] [--previous] [--from <#|ref>]
 *       いまの会話を新しいセッションで開く。
 *       --previous を付けると「自分ではなく直前の会話」を引く
 *       （新しいセッションが「続きから」と言われたときに使う）
 *   show <session.jsonl>                  射影の中身を確かめる
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { quitQuietlyOnBrokenPipe } from "./pipe.ts";
import { USAGE, unknownArg, wantsHelp } from "./usage.ts";
import { install } from "./install.ts";
import { canvas, page, records } from "./exports.ts";
import { groupByProject, pickProject, renderProjects } from "./projects.ts";
import { buildContext } from "./context.ts";
import { renderTable } from "./list.ts";
import { pickInteractively } from "./run-picker.ts";
import { extractSession, humanUtterances } from "./extract.ts";
import { readRepoSignals } from "./repo.ts";
import { currentSessionFor } from "./sessions.ts";
import {
  SCAN,
  chooseByKey,
  contextOf,
  humanSessions,
  previousIn,
  projectsOf,
} from "./query.ts";

function show(path: string): number {
  const record = extractSession(readFileSync(path, "utf8"));
  if (record === null) {
    process.stderr.write("形式を判定できませんでした\n");
    return 1;
  }
  const human = humanUtterances(record);
  process.stdout.write(
    [
      `harness   : ${record.harness}`,
      `session   : ${record.sessionId ?? "-"}`,
      `title     : ${record.title ?? "(なし)"}`,
      `人間の発話: ${String(human.length)} 件 / ${String(Math.round(human.join("").length / 1024))} KB`,
      `ファイル  : ${String(record.files.length)} 件  コマンド: ${String(record.commands.length)} 件`,
      `結果の信号: ${String(record.turnEndings.length)} ターン分`,
      "",
    ].join("\n"),
  );
  return 0;
}

/** 直前の会話（自分ではない方）を引く。中身のある最初の1本を返す */
function previousContext(cwd: string): string | null {
  const built = previousIn(cwd);
  if (built === null) return null;
  process.stderr.write(`直前の会話: ${built.path}\n`);
  return built.context;
}

function currentContext(cwd: string): string | null {
  const sessionPath = currentSessionFor(cwd);
  if (sessionPath === null) return null;
  return buildContext(sessionPath, readRepoSignals(cwd));
}

/** プロジェクト単位の一覧。「どのプロジェクトの話か分からない」への答え */
function listProjects(limit: number): number {
  const rows = humanSessions(SCAN, null);
  const projects = groupByProject(rows);
  if (projects.length === 0) {
    process.stderr.write("会話の記録が見つかりませんでした\n");
    return 1;
  }
  process.stdout.write(renderProjects(projects.slice(0, limit)));
  // 黙って切らない。切った事実を出さないと「全部見た」と読まれる
  if (rows.length >= SCAN) {
    process.stdout.write(`（新しい会話 ${String(SCAN)} 件までを見ています。会話数はその範囲の数）\n`);
  }
  process.stdout.write(
    "会話まで降りるには: relay --list --in <#か名前>／キャンバスに出すには relay --canvas\n",
  );
  return 0;
}

/** そのプロジェクトの会話だけを一覧にする */
function listIn(key: string): number {
  const chosen = pickProject(projectsOf(), key);
  if (chosen === null) {
    process.stderr.write(`「${key}」に当たるプロジェクトがありません（relay --projects で確認）\n`);
    return 1;
  }
  process.stdout.write(renderTable(chosen.sessions));
  process.stdout.write(`選ぶには: relay --from <#かref> --in ${key}\n`);
  return 0;
}

/**
 * 一覧を出す。既定は**いまいる場所だけ**（Codexの `codex resume` と同じ既定）。
 * 他のプロジェクトも見たいときは --all。
 */
function list(limit: number, all: boolean): number {
  const cwd = process.cwd();
  const listed = humanSessions(limit, all ? null : cwd);
  if (listed.length === 0) {
    process.stderr.write(
      all
        ? "会話の記録が見つかりませんでした\n"
        : `この場所（${cwd}）の会話が見つかりませんでした。他の場所も見るなら relay --list --all\n`,
    );
    return 1;
  }
  process.stdout.write(renderTable(listed));
  process.stdout.write(
    all
      ? "選ぶには: relay --from <#かref>（--print を足すと中身だけ出る）\n"
      : "選ぶには: relay --from <#かref>／他の場所も見るなら --all\n",
  );
  return 0;
}

/**
 * その場で選ばせる。`codex resume` / `claude -r` と同じ作法:
 * 1コマンドで選び終わり、打てば絞り込め、Escで取り消せる。
 */
async function pickedContext(query: string, all: boolean, cwd: string): Promise<string | null> {
  if (!process.stdin.isTTY) {
    // パイプ越し・スキル経由では画面を出せない。黙って終わらず、代わりの手を示す
    process.stderr.write(
      "画面を出せない場所から呼ばれました（--pick は手で選ぶためのものです）。\n" +
        "代わりに relay --list で一覧を出し、relay --from <#かref> で選んでください\n",
    );
    return null;
  }
  const rows = humanSessions(40, all ? null : cwd);
  if (rows.length === 0) {
    process.stderr.write("選べる会話がありません（--all で他の場所も見られます）\n");
    return null;
  }
  const chosen = await pickInteractively(rows, query);
  if (chosen === null) return null;
  process.stderr.write(`選んだ会話: ${chosen.place} / ${chosen.topic}\n`);
  return buildContext(chosen.path, readRepoSignals(chosen.cwd ?? cwd));
}

/** 一覧から選んだ1本を渡す。ディレクトリが違っても引ける（数え方は query.ts） */
function chosenContext(key: string, cwd: string, inKey: string | null, all: boolean): string | null {
  const chosen = chooseByKey(key, cwd, inKey, all);
  if (chosen === null) return null;
  process.stderr.write(`選んだ会話: ${chosen.place} / ${chosen.topic}\n`);
  return contextOf(chosen, cwd);
}

interface Picking {
  readonly on: boolean;
  readonly query: string;
  readonly all: boolean;
}

async function chooseContext(
  usePrevious: boolean,
  from: string | null,
  picking: Picking,
  cwd: string,
  inKey: string | null,
): Promise<string | null> {
  if (picking.on) return pickedContext(picking.query, picking.all, cwd);
  if (from !== null) return chosenContext(from, cwd, inKey, picking.all);
  return usePrevious ? previousContext(cwd) : currentContext(cwd);
}

async function relay(
  target: string,
  printOnly: boolean,
  usePrevious: boolean,
  from: string | null,
  picking: Picking,
  inKey: string | null,
): Promise<number> {
  const cwd = process.cwd();
  const context = await chooseContext(usePrevious, from, picking, cwd, inKey);
  if (context === null) {
    if (!picking.on) process.stderr.write(chooseMessage(usePrevious, from));
    return 1;
  }
  if (printOnly) {
    process.stdout.write(context);
    return 0;
  }
  process.stderr.write(
    `${target} を新しいセッションで開きます（文脈 ${String(Math.round(context.length / 1024))} KB）\n`,
  );
  const result = spawnSync(target, [context], { stdio: "inherit" });
  return result.status ?? 1;
}

function chooseMessage(usePrevious: boolean, from: string | null): string {
  if (from !== null) return `「${from}」に当たる会話が一覧にありません（relay --list で番号かrefを確認）\n`;
  return usePrevious
    ? "前の会話が見つかりません（このディレクトリには、自分以外の中身のある会話がありません）\n"
    : "このディレクトリの会話が見つかりませんでした\n";
}

const args = process.argv.slice(2);
const command = args[0];
if (command === "install") {
  process.exitCode = install(args.includes("--dry-run"));
} else if (command === "relay") {
  quitQuietlyOnBrokenPipe();
  const rest = args.slice(1);
  const unknown = unknownArg(rest);
  if (wantsHelp(rest)) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  // 知らない言葉を読み飛ばすと、`relay --lst` が会話を起動する（実測で起動した）
  if (unknown !== null) {
    process.stderr.write(`知らない指定です: ${unknown}\n\n${USAGE}`);
    process.exit(2);
  }
  const toIndex = args.indexOf("--to");
  const target = toIndex >= 0 ? (args[toIndex + 1] ?? "claude") : "claude";
  const fromIndex = args.indexOf("--from");
  const from = fromIndex >= 0 ? (args[fromIndex + 1] ?? null) : null;
  const inIndex = args.indexOf("--in");
  const inKey = inIndex >= 0 ? (args[inIndex + 1] ?? null) : null;
  if (args.includes("--projects")) {
    const asked = Number(args[args.indexOf("--projects") + 1]);
    process.exitCode = listProjects(Number.isInteger(asked) && asked > 0 ? asked : 12);
  } else if (args.includes("--records")) {
    const given = args[args.indexOf("--records") + 1];
    if (given === undefined || given.startsWith("--")) {
      process.stderr.write("書き出す先を指定してください: relay --records <ディレクトリ>\n");
      process.exitCode = 2;
    } else {
      process.exitCode = records(given, 12);
    }
  } else if (args.includes("--page")) {
    const given = args[args.indexOf("--page") + 1];
    process.exitCode = page(given === undefined || given.startsWith("--") ? null : given, 12);
  } else if (args.includes("--canvas")) {
    const given = args[args.indexOf("--canvas") + 1];
    const out = given === undefined || given.startsWith("--") ? "relay.canvas" : given;
    process.exitCode = canvas(out, 12);
  } else if (inKey !== null && args.includes("--list")) {
    process.exitCode = listIn(inKey);
  } else if (args.includes("--list")) {
    const listIndex = args.indexOf("--list");
    const asked = Number(args[listIndex + 1]);
    process.exitCode = list(Number.isInteger(asked) && asked > 0 ? asked : 15, args.includes("--all"));
  } else {
    const pickIndex = args.indexOf("--pick");
    const rawQuery = pickIndex >= 0 ? (args[pickIndex + 1] ?? "") : "";
    const picking = {
      on: pickIndex >= 0,
      query: rawQuery.startsWith("--") ? "" : rawQuery,
      all: args.includes("--all"),
    };
    process.exitCode = await relay(
      target,
      args.includes("--print"),
      args.includes("--previous"),
      from,
      picking,
      inKey,
    );
  }
} else if (command === "show" && args[1] !== undefined) {
  process.exitCode = show(args[1]);
} else {
  process.stderr.write(USAGE);
  process.exitCode = 2;
}
