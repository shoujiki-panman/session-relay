/**
 * 選択画面のキー入力と描画。ロジックは picker.ts（こちらは画面だけ）。
 * 依存は入れない——Nodeの生キー入力で足りる。
 */
import type { Listed } from "./list.ts";
import {
  type PickerState,
  backspace,
  initial,
  move,
  render,
  selected,
  typed,
} from "./picker.ts";

const CLEAR = "\u001B[2J\u001B[H";
const UP = "\u001B[A";
const DOWN = "\u001B[B";
const ESC = "\u001B";
const CTRL_C = "\u0003";
const BACKSPACE = "\u007F";

export type Done = "select" | "cancel" | null;

/** 押されたキーを状態に反映する。決まった／やめたときだけ done が付く */
export function step(state: PickerState, key: string): { next: PickerState; done: Done } {
  if (key === CTRL_C || key === ESC) return { next: state, done: "cancel" };
  if (key === "\r" || key === "\n") return { next: state, done: "select" };
  if (key === UP) return { next: move(state, -1), done: null };
  if (key === DOWN) return { next: move(state, 1), done: null };
  if (key === BACKSPACE) return { next: backspace(state), done: null };
  // 制御文字と矢印以外のエスケープ列は捨てる（検索語が汚れないように）
  if (key.length !== 1 || key < " ") return { next: state, done: null };
  return { next: typed(state, key), done: null };
}

/** 型の上では number だが、TTYでないときは実行時に undefined になる */
function widthOf(out: NodeJS.WriteStream): number {
  const columns: unknown = out.columns;
  return typeof columns === "number" && columns > 20 ? columns : 100;
}

function draw(state: PickerState, out: NodeJS.WriteStream): void {
  out.write(CLEAR);
  out.write(render(state, widthOf(out)));
}

export async function pickInteractively(
  rows: readonly Listed[],
  query = "",
): Promise<Listed | null> {
  const input = process.stdin;
  // 選んだ中身を標準出力に流せるよう、画面は stderr に描く
  const out = process.stderr;
  if (!input.isTTY) return null;

  let state = initial(rows, query);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  draw(state, out);

  return new Promise((resolve) => {
    const finish = (chosen: Listed | null): void => {
      input.setRawMode(false);
      input.pause();
      input.removeAllListeners("data");
      out.write(CLEAR);
      resolve(chosen);
    };
    input.on("data", (chunk: string) => {
      const { next, done } = step(state, chunk);
      state = next;
      if (done === "cancel") finish(null);
      else if (done === "select") finish(selected(state));
      else draw(state, out);
    });
  });
}
