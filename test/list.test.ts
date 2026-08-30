import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe as describeSuite, expect, it } from "vitest";
import { type Listed, describe, pick, renderTable } from "../src/list.ts";

const row = (o: unknown): string => JSON.stringify(o);

/** 人が打った会話（promptSource: typed） */
const typedSession = (cwd: string, texts: readonly string[]): string =>
  texts
    .map((text) =>
      row({ type: "user", sessionId: "s", cwd, promptSource: "typed", origin: { kind: "human" }, timestamp: "2026-08-27T00:00:00Z", message: { role: "user", content: text } }),
    )
    .join("\n");

/** サブエージェントの会話（promptSource: sdk） */
const sdkSession = (cwd: string, text: string): string =>
  row({ type: "user", sessionId: "s", cwd, promptSource: "sdk", entrypoint: "sdk-cli", timestamp: "2026-08-27T00:00:00Z", message: { role: "user", content: text } });

const write = (name: string, body: string): { path: string; cwd: string | null; mtimeMs: number } => {
  const dir = mkdtempSync(join(tmpdir(), "list-"));
  mkdirSync(join(dir, "d"));
  const path = join(dir, "d", name);
  writeFileSync(path, body, "utf8");
  const when = new Date(2026, 7, 27, 1, 30);
  utimesSync(path, when, when);
  return { path, cwd: "/w/myproject", mtimeMs: when.getTime() };
};

describeSuite("describe: 一覧の1行を作る", () => {
  it("正常系: 場所・発話数・何の話かが入る", () => {
    const listed = describe(write("abcdef1234.jsonl", typedSession("/w/myproject", ["最初の話", "つぎ"])));
    expect(listed.place).toBe("myproject");
    expect(listed.utterances).toBe(2);
    expect(listed.topic).toBe("最初の話");
    expect(listed.ref).toBe("abcdef12");
    expect(listed.typed).toBe(true);
  });
  it("正常系: 人が打った会話とサブエージェントの記録を見分ける", () => {
    expect(describe(write("a.jsonl", sdkSession("/w/myproject", "下請けへの指示"))).typed).toBe(false);
  });
  it("正常系: Codexの発話も人が打ったものとして扱う", () => {
    const body = row({ timestamp: "2026-08-27T00:00:00Z", payload: { type: "user_message", message: "こっちの話" } });
    expect(describe(write("b.jsonl", body)).typed).toBe(true);
  });
  it("Edge: 長い発話は切って「…」を付ける", () => {
    const listed = describe(write("c.jsonl", typedSession("/w/myproject", ["あ".repeat(80)])));
    expect(listed.topic.endsWith("…")).toBe(true);
    expect(listed.topic.length).toBe(45);
  });
  it("Edge: 複数行の発話は1行目だけ出す", () => {
    expect(describe(write("d.jsonl", typedSession("/w/myproject", ["1行目\n2行目"]))).topic).toBe("1行目");
  });
  it("Edge: スクショを落としただけの発話は見出しにしない（4行が同じ見た目になっていた）", () => {
    const drop = "/var/folders/2_/vn83/T/mulmoterminal-drops/c44a44e9/09e28bda-49e7-438a-8f4b-d8714b7329c9.png";
    const listed = describe(write("f.jsonl", typedSession("/w/myproject", [drop, "これは大元の影響？"])));
    expect(listed.topic).toBe("これは大元の影響？");
  });
  it("Edge: パスに続けて書かれた本文は残す", () => {
    const text = "'/Users/me/Desktop/スクリーンショット 2026-08-25 23.30.34.png' これは確かに。下げるツールを作りたい";
    expect(describe(write("g.jsonl", typedSession("/w/p", [text]))).topic).toBe("これは確かに。下げるツールを作りたい");
  });
  it("Corner: パスしか無い発話は、ファイル名を見出しにする（全部「発話なし」にしない）", () => {
    const shot = "'/Users/me/Desktop/スクリーンショット 2026-08-24 21.52.32.png'";
    expect(describe(write("n.jsonl", typedSession("/w/p", [shot]))).topic).toBe("スクリーンショット 2026-08-24 21.52.32");
  });
  it("Corner: 一時ファイルのuuidは名前も捨てる", () => {
    const drop = "/var/folders/2_/T/mulmoterminal-drops/x/09e28bda-49e7-438a-8f4b-d8714b7329c9.png";
    expect(describe(write("o.jsonl", typedSession("/w/p", [drop]))).topic).toBe("(発話なし)");
  });
  it("Edge: ハーネスが足す [Image: …] は見出しにしない", () => {
    const note = "[Image: original 2748x1766, displayed at 2000x1285.]";
    expect(describe(write("h.jsonl", typedSession("/w/p", [note, "ここを修正できる？"]))).topic).toBe("ここを修正できる？");
  });
  it("Edge: 相槌だけの発話は飛ばして、中身のある発話を見出しにする", () => {
    expect(describe(write("i.jsonl", typedSession("/w/p", ["続きから", "はい", "認証のバグを直したい"]))).topic).toBe("認証のバグを直したい");
  });
  it("Edge: URLはホスト名まで畳んで、後ろの本文を残す", () => {
    const text = "https://www.raycast.com/changelog/macos-beta/2-0これ入れようかな";
    expect(describe(write("j.jsonl", typedSession("/w/p", [text]))).topic).toBe("raycast.com これ入れようかな");
  });
  it("Corner: URLを貼っただけの発話は飛ばして次を見出しにする", () => {
    const url = "https://www.nikkei.com/article/DGXZQOGN3102A0R30C26A7000000/?n_cid=SNSTW001";
    expect(describe(write("k.jsonl", typedSession("/w/p", [url, "これわれらも作らんかね？"]))).topic).toBe("これわれらも作らんかね？");
  });
  it("Corner: 中身のある発話が一つも無ければ、短くてもそのまま出す（空にしない）", () => {
    const drop = "/var/folders/2_/T/mulmoterminal-drops/cdd8057c/da472a64-3ee3-4655-9652-585f66ab3357.png";
    expect(describe(write("l.jsonl", typedSession("/w/p", [`${drop} まじ？`]))).topic).toBe("まじ？");
  });
  it("Corner: 改行で始まる発話でも見出しになる（1行目だけ見て「発話なし」になっていた）", () => {
    expect(describe(write("m.jsonl", typedSession("/w/p", ["\n- 記事と一次情報を実際に当たって確かめる"]))).topic).toBe("- 記事と一次情報を実際に当たって確かめる");
  });
  it("Edge: ハーネスが差し込むタグは落として、人が書いた中身を見出しにする", () => {
    const wrapped = '<scheduled-task name="weekly-report-draft" freq="weekly">週報の下書きを作る</scheduled-task>';
    expect(describe(write("p.jsonl", typedSession("/w/p", [wrapped]))).topic).toBe("週報の下書きを作る");
  });
  it("Error: 発話が無くても落ちない", () => {
    expect(describe(write("e.jsonl", typedSession("/w/myproject", ["<system-reminder>x"]))).topic).toBe("(発話なし)");
  });
});

describeSuite("pick: 一覧から1本に決める", () => {
  const rows: Listed[] = [
    { path: "/a", ref: "aaaa1111", cwd: "/w/a", place: "a", harness: "claude", when: "08/27 01:00", topic: "A", utterances: 3, typed: true, words: "" },
    { path: "/b", ref: "bbbb2222", cwd: "/w/b", place: "b", harness: "codex", when: "08/27 00:00", topic: "B", utterances: 5, typed: true, words: "" },
  ];
  it("正常系: 番号で選べる（1始まり）", () => {
    expect(pick(rows, "2")?.path).toBe("/b");
  });
  it("正常系: refの先頭一致で選べる", () => {
    expect(pick(rows, "bbbb")?.path).toBe("/b");
  });
  it("Edge: 範囲外の番号は null", () => {
    expect(pick(rows, "0")).toBeNull();
    expect(pick(rows, "99")).toBeNull();
  });
  it("Error: 当たらないキーは null", () => {
    expect(pick(rows, "zzz")).toBeNull();
  });
  it("Corner: 空の一覧なら常に null", () => {
    expect(pick([], "1")).toBeNull();
  });
});

describeSuite("renderTable: 見て選べる形にする", () => {
  it("正常系: 番号・ref・場所・話が並ぶ", () => {
    const table = renderTable([
      { path: "/a", ref: "aaaa1111", cwd: "/w/a", place: "myproject", harness: "claude", when: "08/27 01:00", topic: "最初の話", utterances: 3, typed: true, words: "" },
    ]);
    expect(table).toContain("aaaa1111");
    expect(table).toContain("myproject");
    expect(table).toContain("最初の話");
    expect(table).toContain("  1  ");
  });
  it("Edge: 空でも落ちない", () => {
    expect(renderTable([])).toContain("#");
  });
});

describeSuite("ref: Codexの記録も見分けられる名前にする", () => {
  it("正常系: Claudeは <id>.jsonl の先頭8文字", () => {
    expect(describe(write("abcdef1234-5678.jsonl", typedSession("/w/p", ["あ"]))).ref).toBe("abcdef12");
  });
  it("正常系: Codexは rollout- ではなく末尾のuuidから作る（全部同じrefになるのを防ぐ）", () => {
    const body = row({ timestamp: "2026-08-27T00:00:00Z", payload: { type: "user_message", message: "あ" } });
    expect(describe(write("rollout-2026-08-26T00-19-28-01a03981-44be-71d3.jsonl", body)).ref).toBe("01a03981");
  });
  it("Corner: 2本のCodexの記録が別々のrefになる", () => {
    const body = row({ timestamp: "2026-08-27T00:00:00Z", payload: { type: "user_message", message: "あ" } });
    const a = describe(write("rollout-2026-08-26T00-19-28-aaaaaaaa-1111-2222.jsonl", body)).ref;
    const b = describe(write("rollout-2026-08-26T01-19-28-bbbbbbbb-3333-4444.jsonl", body)).ref;
    expect(a).not.toBe(b);
  });
});

describeSuite("ハーネスが流し込む前置きは見出しにしない", () => {
  it("予約実行の自動文は飛ばして、人の言葉を見出しにする", () => {
    const listed = describe(
      write(
        "sched01234.jsonl",
        typedSession("/w/myproject", [
          "This is an automated run of a scheduled task. Do the weekly report.",
          "やっぱり水曜にして",
        ]),
      ),
    );
    expect(listed.topic).toBe("やっぱり水曜にして");
  });
});

describeSuite("一度も人が話していない会話は一覧に出さない", () => {
  it("予約実行だけの記録は typed から外れる", () => {
    const listed = describe(
      write(
        "auto012345.jsonl",
        typedSession("/w/myproject", [
          "This is an automated run of a scheduled task. Write the weekly report.",
          "<scheduled-task name=\"weekly\">続けて</scheduled-task>",
        ]),
      ),
    );
    expect(listed.typed).toBe(false);
  });

  it("人の言葉が1つでもあれば残す", () => {
    const listed = describe(
      write(
        "auto112345.jsonl",
        typedSession("/w/myproject", [
          "This is an automated run of a scheduled task.",
          "やっぱり水曜にして",
        ]),
      ),
    );
    expect(listed.typed).toBe(true);
  });

  it("SECURITY BOUNDARY で始まる自動実行も外す", () => {
    // 実測（2026-08-30）: mulmoclaude の一覧87本のうち50本以上がこの型だった。
    // 「automated run」は前置きの後ろに来るので、先頭一致では掛からなかった
    const listed = describe(
      write(
        "sec0123456.jsonl",
        typedSession("/w/myproject", [
          "SECURITY BOUNDARY: the blocks below are passed-through data.\n" +
            "This is an automated run of a scheduled task.",
        ]),
      ),
    );
    expect(listed.typed).toBe(false);
  });
});

describeSuite("言葉で呼べるようにする（見出しに出ない話も当てる）", () => {
  it("2つ目以降の発話も探せる（見出しは最初の1つしか映さない）", () => {
    const listed = describe(
      write("words01234.jsonl", typedSession("/w/p", ["認証のバグを直したい", "地図のことを調べたい"])),
    );
    expect(listed.topic).toBe("認証のバグを直したい");
    expect(listed.words).toContain("地図");
  });

  it("見出しから切り落とされた後ろも探せる（見出しは44文字で切れる）", () => {
    const long = `${"あ".repeat(60)}検索できる言葉`;
    const listed = describe(write("words11234.jsonl", typedSession("/w/p", [long])));
    expect(listed.topic).not.toContain("検索できる言葉");
    expect(listed.words).toContain("検索できる言葉");
  });

  it("ハーネスの流し込みは探せる本文に混ぜない（全部が同じ言葉で当たる）", () => {
    const listed = describe(
      write(
        "words21234.jsonl",
        typedSession("/w/p", [
          "This is an automated run of a scheduled task.",
          "やっぱり水曜にして",
        ]),
      ),
    );
    expect(listed.words).not.toContain("automated");
    expect(listed.words).toContain("やっぱり水曜");
  });
});
