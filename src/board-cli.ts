/**
 * 伝言板をコマンドから読み書きする（relay board post / relay board read）。
 *
 * ChatGPT のプラグインは、Cloudflare のログインが切れるたびにつなぎ直しが要って使いにくい
 * （2026-10-31 本人）。Dots は本人の Mac でコマンドを打てる（同日、relay --help を打って最初の1行を
 * 返した）ので、プラグインを通さずにここから伝言板を使う。中身は MCP の post_message / read_messages と同じ。
 */
import { type Board, createBoard, renderMessages } from "./board.ts";
import { DEFAULT_LOOKBACK_HOURS } from "./board-tools.ts";

export const BOARD_USAGE = `使い方:
  relay board post --from <自分の名前> [--to <相手の名前>] <伝言>
  relay board read [--to <自分の名前>] [--since <日時> | --hours <時間>]
    read は since より後の伝言を古い順に出す（省略すると${String(DEFAULT_LOOKBACK_HOURS)}時間前から）。
    --to を付けると、自分あてと全員あて（all）の分だけ
`;

interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const realIo: Io = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

const VALUE_FLAGS = new Set(["--from", "--to", "--since", "--hours"]);

/** 値を取る指定と、それ以外の言葉に分ける。知らない指定は null */
function parse(args: readonly string[]): { flags: Map<string, string>; words: string[] } | null {
  const flags = new Map<string, string>();
  const words: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined) return null;
      flags.set(arg, value);
      i += 1;
    } else if (arg.startsWith("--")) {
      return null;
    } else {
      words.push(arg);
    }
  }
  return { flags, words };
}

/**
 * 失敗の理由を、パスを出さずに伝える。
 * Dots が Mac で打ったとき「保存に失敗しました」としか出ず、理由が分からなかった（2026-10-31）。
 * 書き込みを止められたとき（サンドボックスなど）は、そうと分かる言葉にする。
 */
export function failureText(error: unknown): string {
  if (!(error instanceof Error)) return "保存に失敗しました";
  if (!("code" in error)) return error.message;
  const code = String(error.code);
  if (code === "EPERM" || code === "EACCES" || code === "EROFS") {
    return `保存先に書き込めませんでした（${code}）。この場所への書き込みを止められています。サンドボックスの中で動いているなら、伝言板の場所（~/.local/share/session-relay/board）への書き込みを許してから、もう一度打ってください`;
  }
  return `保存に失敗しました（${code}）`;
}

function post(board: Board, flags: Map<string, string>, words: readonly string[], io: Io): number {
  const from = flags.get("--from");
  const text = words.join(" ");
  if (from === undefined || text.trim() === "") {
    io.err(BOARD_USAGE);
    return 2;
  }
  const to = flags.get("--to");
  try {
    const saved = board.post({ from, ...(to === undefined ? {} : { to }), text });
    io.out(`伝言板に書きました（${saved.createdAt} / ${saved.from} → ${saved.to}）\n`);
    return 0;
  } catch (error) {
    io.err(`書けませんでした: ${failureText(error)}\n`);
    return 1;
  }
}

function read(board: Board, flags: Map<string, string>, now: number, io: Io): number {
  const hours = flags.has("--hours") ? Number(flags.get("--hours")) : DEFAULT_LOOKBACK_HOURS;
  const since = flags.get("--since") ?? new Date(now - hours * 60 * 60 * 1000).toISOString();
  if (!(hours > 0) || Number.isNaN(Date.parse(since))) {
    io.err("--since は日時（ISO 8601）、--hours は正の数で渡してください\n");
    return 2;
  }
  io.out(`${renderMessages(board.since(since, flags.get("--to")), since)}\n`);
  return 0;
}

export function runBoard(
  args: readonly string[],
  board: Board = createBoard(),
  now: number = Date.now(),
  io: Io = realIo,
): number {
  const [command, ...rest] = args;
  const parsed = parse(rest);
  if (parsed === null || (command !== "post" && command !== "read")) {
    io.err(BOARD_USAGE);
    return 2;
  }
  return command === "post" ? post(board, parsed.flags, parsed.words, io) : read(board, parsed.flags, now, io);
}
