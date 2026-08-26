/**
 * 「結果の信号」を集める。
 *
 * 射影は本人の発話しか持たないので、渡された先が **進捗を過小評価する**
 * （実測: テストが緑なのに「まだ動く証明はできていない」と読んだ）。
 * そこで、各ターンの最後にAIが報告した文＝そのターンで何が起きたかを足す。
 * AIの発言を全部入れると110KB（実測）になるので、ターンの最後だけを採る。
 */

export interface TurnEnding {
  readonly at: string | null;
  readonly text: string;
}

export interface TurnAcc {
  readonly endings: TurnEnding[];
  pending: TurnEnding | null;
}

export const emptyTurnAcc = (): TurnAcc => ({ endings: [], pending: null });

/** AIの発言を「いまのターンの最後」として覚えておく（次が来たら上書きされる） */
export function noteAssistantText(acc: TurnAcc, at: string | null, text: string): void {
  if (text.trim() === "") return;
  acc.pending = { at, text };
}

/** 本人の発話が来た＝前のターンが終わった。覚えていた文を確定する */
export function endTurn(acc: TurnAcc): void {
  if (acc.pending === null) return;
  acc.endings.push(acc.pending);
  acc.pending = null;
}

/** 会話の途中で渡す場合、最後のターンはまだ終わっていないが、いまの状態そのものなので採る */
export function finishTurns(acc: TurnAcc): readonly TurnEnding[] {
  endTurn(acc);
  return acc.endings;
}
