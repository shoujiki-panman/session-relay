import { describe, expect, it } from "vitest";
import type { Listed } from "../src/list.ts";
import { buildPage, toPageRows } from "../src/page.ts";
import type { Project } from "../src/projects.ts";
import { unknownArg } from "../src/usage.ts";

const session = (over: Partial<Listed> = {}): Listed => ({
  path: "/rec/x.jsonl",
  ref: "01a04899",
  cwd: "/w/relay",
  place: "relay",
  harness: "claude",
  when: "08/30 12:33",
  topic: "地図の話",
  utterances: 5,
  typed: true,
  words: "",
  ...over,
});

const project = (name: string, sessions: readonly Listed[]): Project => ({
  name,
  cwd: `/w/${name}`,
  when: "08/30 12:33",
  sessions,
});

/** ページに埋めた一覧を読み戻す */
const rowsIn = (html: string): unknown => {
  const start = html.indexOf('<script id="rows" type="application/json">');
  const open = html.indexOf(">", start) + 1;
  const end = html.indexOf("</script>", open);
  return JSON.parse(html.slice(open, end).replace(/\\u003c/g, "<"));
};

describe("1枚のHTMLにする", () => {
  it("会話の本文は入らない（入るのは見出しだけ）", () => {
    const [row] = toPageRows([project("relay", [session()])]);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "harness",
      "project",
      "ref",
      "topic",
      "utterances",
      "when",
    ]);
  });

  it("外を見に行かない（CDNもフォントも取りに行かない）", () => {
    const html = buildPage([project("relay", [session()])]);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("見出しに </script> が入っていてもページが壊れない", () => {
    // 見出しは本人が打った文字。何が入っていてもおかしくない
    const html = buildPage([project("relay", [session({ topic: "</script><b>ここで終わる" })])]);
    const rows = rowsIn(html);
    expect(Array.isArray(rows) && rows.length).toBe(1);
    // 埋め込んだJSONの中に生の `</script>` は残らない
    const between = html.slice(
      html.indexOf('<script id="rows"'),
      html.indexOf("</script>", html.indexOf('<script id="rows"')),
    );
    expect(between).not.toContain("</script>");
  });

  it("見出しの $& が置換の指示として食われない", () => {
    // 文字列で差し込むと `$&` はマーカー自身に化ける
    const html = buildPage([project("relay", [session({ topic: "差額は $& で表す" })])]);
    expect(JSON.stringify(rowsIn(html))).toContain("差額は $& で表す");
    expect(html).not.toContain("__ROWS__");
  });

  it("プロジェクトごとに固まって並ぶ（画面が見出しで区切れるように）", () => {
    const rows = toPageRows([
      project("a", [session({ ref: "1" }), session({ ref: "2" })]),
      project("b", [session({ ref: "3" })]),
    ]);
    expect(rows.map((row) => row.project)).toEqual(["a", "a", "b"]);
  });

  it("--page は知らない指定として叱られない", () => {
    // `--lst` が会話を起動した件と同じ穴。足したフラグを登録し忘れると落ちる
    expect(unknownArg(["--page"])).toBeNull();
    expect(unknownArg(["--page", "/tmp/a.html"])).toBeNull();
  });
});
