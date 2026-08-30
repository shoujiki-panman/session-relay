/**
 * `relay --projects | head` のように途中で読むのをやめられたときの後始末。
 *
 * 受け手が先に閉じると書き込みが EPIPE で落ち、Nodeの既定では
 * **スタックトレースが利用者の画面に出る**（実測 2026-08-29）。
 * パイプで切るのは普通の使い方なので、静かに終わる。
 */
const isBrokenPipe = (error: Error): boolean =>
  "code" in error && error.code === "EPIPE";

export function quitQuietlyOnBrokenPipe(stream: NodeJS.WriteStream = process.stdout): void {
  stream.on("error", (error: Error) => {
    if (isBrokenPipe(error)) process.exit(0);
    throw error;
  });
}
