/**
 * 会話を選ぶ画面のロジック。
 *
 * 表を出して「もう一度コマンドを打て」は3手かかる（本人の言葉:「使いにくい、すごく」）。
 * `codex resume` も `claude -r` も、1コマンドでその場で選び終わる:
 * 打つと絞り込め、↑↓で動き、Enterで決まり、Escで取り消せる。同じ作法にする。
 *
 * ここは画面を触らない純粋な関数だけ。実際のキー入力と描画は run.ts。
 */
import type { Listed } from "./list.ts";

export interface PickerState {
  readonly rows: readonly Listed[];
  readonly query: string;
  readonly cursor: number;
}

/** 検索語つきで開ける（`claude -r <検索語>` と同じで、最初から絞った状態で出せる） */
export const initial = (rows: readonly Listed[], query = ""): PickerState => ({ rows, query, cursor: 0 });

/** 場所でも話の中身でも当たる。大文字小文字は区別しない */
export function filterRows(rows: readonly Listed[], query: string): Listed[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter((row) =>
    `${row.place} ${row.topic} ${row.ref}`.toLowerCase().includes(needle),
  );
}

export const visible = (state: PickerState): Listed[] => filterRows(state.rows, state.query);

/** 上下の移動。端で止める（行き過ぎて選び間違えるのを防ぐ） */
export function move(state: PickerState, delta: number): PickerState {
  const count = visible(state).length;
  if (count === 0) return { ...state, cursor: 0 };
  const next = Math.min(Math.max(state.cursor + delta, 0), count - 1);
  return { ...state, cursor: next };
}

/** 検索語を変えたら、選択位置は先頭に戻す（絞った先の1件目を見せる） */
export const setQuery = (state: PickerState, query: string): PickerState => ({
  ...state,
  query,
  cursor: 0,
});

export const typed = (state: PickerState, char: string): PickerState =>
  setQuery(state, state.query + char);

export const backspace = (state: PickerState): PickerState =>
  setQuery(state, state.query.slice(0, -1));

export const selected = (state: PickerState): Listed | null =>
  visible(state)[state.cursor] ?? null;

/** 画面に出す文字列。1行が長くならないよう幅で切る */
export function render(state: PickerState, width = 100): string {
  const rows = visible(state);
  const head = `続きをやる会話を選ぶ  （↑↓で移動 / 文字を打つと絞り込み / Enterで決定 / Escで取消）`;
  const query = `検索: ${state.query === "" ? "（全部）" : state.query}   ${String(rows.length)}件`;
  if (rows.length === 0) return [head, query, "", "  当たる会話がありません", ""].join("\n");
  const place = Math.max(4, ...rows.map((row) => row.place.length));
  const lines = rows.map((row, i) => {
    const mark = i === state.cursor ? "❯" : " ";
    const line = `${mark} ${row.when}  ${row.place.padEnd(place)}  ${String(row.utterances).padStart(3)}発話  ${row.topic}`;
    return line.length > width ? `${line.slice(0, width - 1)}…` : line;
  });
  return [head, query, "", ...lines, ""].join("\n");
}
