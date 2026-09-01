import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { createInbox, renderDeposit, MAX_DEPOSITS } from "../src/inbox.ts";
import { parseRelayContext } from "../src/relay-block.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "session-relay-inbox-"));
  roots.push(root);
  return { root, dir: join(root, "inbox") };
}

const identity = {
  id: () => "11111111-1111-4111-8111-111111111111",
  now: () => "2026-08-31T15:00:00.000Z",
};

it("本人の発話を原文のまま0600のファイルへ保存する", () => {
  const { dir } = fixture();
  const saved = createInbox(dir, identity).put({
    title: "  スマホの\n相談  ",
    source: "claude-mobile",
    userMessages: ["一行目", "二行目\n続き"],
    progress: ["ここまで決めた"],
  });

  expect(saved.title).toBe("スマホの 相談");
  expect(saved.userMessages).toEqual(["一行目", "二行目\n続き"]);
  expect(statSync(dir).mode & 0o777).toBe(0o700);
  expect(statSync(join(dir, `${saved.id}.json`)).mode & 0o777).toBe(0o600);
});

it("預けた会話をrelayの文脈形式で読み戻せる", () => {
  const { dir } = fixture();
  const inbox = createInbox(dir, identity);
  const saved = inbox.put({
    source: "claude-web",
    userMessages: ["自分の原文", "改行を\n含む原文"],
    progress: ["記事の下書きまで完了"],
  });

  const parsed = parseRelayContext(renderDeposit(saved));
  expect(parsed?.utterances).toEqual(["自分の原文", "改行を\n含む原文"]);
  expect(parsed?.turnEndings).toEqual(["記事の下書きまで完了"]);
});

it("refの先頭でも1件に決まれば読め、指定なしは最新を返す", () => {
  const { dir } = fixture();
  let next = 0;
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const times = ["2026-08-31T14:00:00.000Z", "2026-08-31T15:00:00.000Z"];
  const inbox = createInbox(dir, {
    id: () => ids[next] ?? "",
    now: () => times[next++] ?? "",
  });
  inbox.put({ source: "other", userMessages: ["古い"], progress: [] });
  inbox.put({ source: "claude-mobile", userMessages: ["新しい"], progress: [] });

  expect(inbox.get()?.userMessages).toEqual(["新しい"]);
  expect(inbox.get("11111111")?.userMessages).toEqual(["古い"]);
});

it("空・件数超過・総量超過を保存しない", () => {
  const { dir } = fixture();
  const inbox = createInbox(dir, identity);
  expect(() => inbox.put({ source: "other", userMessages: [], progress: [] })).toThrow("1件もありません");
  expect(() =>
    inbox.put({ source: "other", userMessages: Array.from({ length: 201 }, () => "発話"), progress: [] }),
  ).toThrow("200件まで");
  expect(() =>
    inbox.put({ source: "other", userMessages: Array.from({ length: 5 }, () => "あ".repeat(18_000)), progress: [] }),
  ).toThrow("256KBを超えています");
});

it("壊れたファイルと想定外の名前を一覧から無視する", () => {
  const { dir } = fixture();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "00000000-0000-4000-8000-000000000000.json"), "壊れたJSON");
  writeFileSync(join(dir, "not-a-deposit.json"), JSON.stringify({ shape: 1 }));
  expect(createInbox(dir).list()).toEqual([]);
});

it("受信箱の上限を超える投函を拒む（ディスク食い潰し対策）", () => {
  const { dir } = fixture();
  const full = createInbox(dir);
  for (let i = 0; i < MAX_DEPOSITS; i += 1) {
    full.put({ title: `t${String(i)}`, source: "claude-web", userMessages: ["a"], progress: [] });
  }
  expect(() => full.put({ title: "over", source: "claude-web", userMessages: ["b"], progress: [] })).toThrow(
    /いっぱい/,
  );
  expect(full.list().length).toBe(MAX_DEPOSITS);
});

it("refで1件に絞れたときだけ投函を消す", () => {
  const { dir } = fixture();
  const box = createInbox(dir);
  const a = box.put({ title: "消す方", source: "claude-web", userMessages: ["a"], progress: [] });
  box.put({ title: "残す方", source: "claude-web", userMessages: ["b"], progress: [] });

  expect(box.remove("")).toBeNull(); // 空refで全消しさせない
  expect(box.remove("zzzz")).toBeNull(); // 当たらない
  const removed = box.remove(a.id.slice(0, 8));
  expect(removed?.title).toBe("消す方");
  expect(box.list().map((d) => d.title)).toEqual(["残す方"]);
});
