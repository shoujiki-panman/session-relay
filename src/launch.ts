/**
 * 渡す先の起動のしかた。
 *
 * 実測（2026-09-18）: Codexの枠の93%は、何百回も回る実装セッション2本で消えていた。
 * 一番効くのは「重いモデルで決めて、軽いモデルで回す」こと。それを1コマンドにするため、
 * 渡すときにモデルを指定できるようにする。
 * `--model` は claude も codex もそのまま受け取る（codex-cli は `-m, --model`）。
 */
export interface Destination {
  readonly target: string;
  /** 指定が無ければ、そのハーネスの既定に任せる */
  readonly model: string | null;
}

/** フラグの直後の値。無い・次がフラグなら null（`--model --print` でモデル名を "--print" にしない） */
export function valueOf(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value === undefined || value.startsWith("-") ? null : value;
}

export const destinationOf = (args: readonly string[]): Destination => ({
  target: valueOf(args, "--to") ?? "claude",
  model: valueOf(args, "--model"),
});

/** 文脈は最後の引数（＝最初の発話）として渡す */
export const launchArgs = (to: Destination, context: string): string[] =>
  to.model === null ? [context] : ["--model", to.model, context];

export const describeLaunch = (to: Destination): string =>
  to.model === null ? to.target : `${to.target}（${to.model}）`;
