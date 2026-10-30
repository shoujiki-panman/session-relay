/**
 * 伝言板の道具。外向きの受け口（Dots・Muse など）と手元のMCP（Claude Code・Codex）の両方に載せる。
 * 外から読めるのは伝言板に書かれたものだけで、手元の会話を読む道具はここに置かない。
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Board, MAX_NAME_CHARS, MAX_TEXT_CHARS, renderMessages } from "./board.ts";

interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const reply = (text: string, ok = true): ToolResult => ({
  content: [{ type: "text", text }],
  ...(ok ? {} : { isError: true }),
});

/** 自作の検証メッセージだけ返す。fs系エラー（codeを持つ）はパスが混ざるので固定文言に落とす */
const errorText = (error: unknown): string =>
  error instanceof Error && !("code" in error) ? error.message : "保存に失敗しました";

/** since を言われなかったときに読み返す長さ */
export const DEFAULT_LOOKBACK_HOURS = 24;

function addPostTool(server: McpServer, board: Board): void {
  server.registerTool(
    "post_message",
    {
      title: "伝言板に書く",
      description:
        "ほかのAIエージェント（Dots・Muse・Claude Code など）に伝言を書く。" +
        "『Museに頼んで』『Claude Codeに伝えて』と言われたときや、ほかのAIに続きを任せたいときに使う。" +
        "from には自分の名前、to には相手の名前（全員なら all）を入れる。鍵やトークンの形をしたものは伏せて保存される。",
      inputSchema: {
        from: z.string().max(MAX_NAME_CHARS).describe("書いた自分の名前（例: ちゃま、Muse、Claude Code）"),
        to: z.string().max(MAX_NAME_CHARS).optional().describe("宛先の名前。省略すると全員（all）"),
        text: z.string().max(MAX_TEXT_CHARS).describe("伝言の本文"),
      },
    },
    ({ from, to, text }) => {
      try {
        const saved = board.post({ from, ...(to === undefined ? {} : { to }), text });
        return reply(`伝言板に書きました（${saved.createdAt} / ${saved.from} → ${saved.to}）。`);
      } catch (error) {
        return reply(`書けませんでした: ${errorText(error)}`, false);
      }
    },
  );
}

function addReadTool(server: McpServer, board: Board, now: () => number): void {
  server.registerTool(
    "read_messages",
    {
      title: "伝言板を読む",
      description:
        "ほかのAIエージェントからの伝言を、since より後の分だけ古い順に読む。" +
        "『伝言を見て』『Museから何か来てる？』と言われたときや、定期的な見回りで使う。" +
        "to に自分の名前を入れると、自分あてと全員あての分だけ返す。",
      inputSchema: {
        since: z
          .string()
          .optional()
          .describe(`この日時より後の伝言だけ返す（ISO 8601）。省略すると${String(DEFAULT_LOOKBACK_HOURS)}時間前から`),
        to: z.string().max(MAX_NAME_CHARS).optional().describe("自分の名前。省略すると全員分"),
      },
    },
    ({ since, to }) => {
      const from = since ?? new Date(now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
      if (Number.isNaN(Date.parse(from))) return reply("since が日時として読めませんでした（ISO 8601 で渡してください）", false);
      return reply(renderMessages(board.since(from, to), from));
    },
  );
}

export function addBoardTools(server: McpServer, board: Board, now: () => number = Date.now): void {
  addPostTool(server, board);
  addReadTool(server, board, now);
}
