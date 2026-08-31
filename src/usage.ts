/**
 * 使い方の表示と、打ち間違いの検出。
 *
 * これが無いと `relay --help` が**新しいセッションを起動していた**（実測 2026-08-28）。
 * 知らないフラグを黙って読み飛ばすと、一番よく打つ言葉が一番大きい動作に落ちる。
 */
export const USAGE = `会話を別スレッド／別ハーネスへ渡す

  relay                      いまの会話を新しいClaudeセッションで開く
  relay --to codex           Codexで開く
  relay --print              文脈だけ出す（貼りたいとき）
  relay --print --previous   自分ではなく「直前の会話」を引く

  relay --projects [件数]    プロジェクト単位の一覧（選ぶ単位はこちら）
  relay --list [件数]        いまいる場所の会話の一覧
  relay --list --in <#|名前> そのプロジェクトの会話まで降りる
  relay --list --all         他のプロジェクトの会話も見る
  relay --from <#|ref>       一覧から1本を選んで渡す（refはどれだけ古くても当たる）
  relay --pick [検索語]      その場で選ぶ（↑↓ / 打つと絞る / Enter / Esc）
  relay --page [出力先]      一覧を1枚のHTMLにしてブラウザで開く（道具を選ばない）
  relay --canvas [出力先]    プロジェクトと会話を .canvas に書き出す
  relay --records <場所>     一覧を1会話＝1ファイルで書き出す（画面から選ぶ用）

  relay mcp                  MCPサーバーとして話す（AIが自分で取りに来る）
  relay mcp-deposit          会話を預けるだけのMCP（ローカル会話は読めない）
  relay mcp-deposit-http     Cloudflare Access必須のHTTP投函口（127.0.0.1限定）
  relay install [--dry-run]  MCPとスキルをまとめて登録する
  relay show <path>          射影の中身を確かめる
`;

/** 値を取るフラグ。次の引数は値なので、フラグとして検査しない */
const TAKES_VALUE = new Set([
  "--to",
  "--from",
  "--in",
  "--projects",
  "--list",
  "--pick",
  "--page",
  "--canvas",
  "--records",
]);

const KNOWN = new Set([
  ...TAKES_VALUE,
  "--print",
  "--previous",
  "--all",
  "--dry-run",
  "--help",
  "-h",
]);

export const wantsHelp = (args: readonly string[]): boolean =>
  args.includes("--help") || args.includes("-h") || args[0] === "help";

/**
 * 知らない引数を1つ返す。無ければ null。
 * 値を取るフラグの直後は値なので飛ばす（`--in mulmo` の `mulmo` を叱らない）。
 * 宙に浮いた言葉も返す——`relay mulmo` のつもりが会話を起動する、が一番困る。
 */
export function unknownArg(args: readonly string[]): string | null {
  let expectsValue = false;
  for (const arg of args) {
    const isValue = expectsValue && !arg.startsWith("-");
    expectsValue = TAKES_VALUE.has(arg);
    if (isValue) continue;
    if (!KNOWN.has(arg)) return arg;
  }
  return null;
}
