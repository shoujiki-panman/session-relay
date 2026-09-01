/** スマホ等から会話を預けるだけのMCP。ローカル会話を読む道具は置かない。 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { type Inbox, createInbox } from "./inbox.ts";

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

export function createDepositServer(inbox: Inbox = createInbox()): McpServer {
  const server = new McpServer({ name: "relay-deposit", version: "0.2.0" });
  server.registerTool(
    "deposit_conversation",
    {
      title: "この会話をrelayに預ける",
      description:
        "ユーザーが『この会話をrelayに預けて』『この続きをCodexでやりたい』と言ったときに使う。" +
        "user_messagesには、この会話で本人が実際に打った発言を時系列で、要約・翻訳・言い換えせず原文のまま入れる。" +
        "progressには直近の回答や決定を最大10件入れる。添付ファイル本体や非表示のツールデータは送らない。",
      inputSchema: {
        title: z.string().max(120).optional().describe("会話の短い題名"),
        source: z.enum(["claude-mobile", "claude-web", "other"]).default("claude-mobile"),
        user_messages: z.array(z.string().max(65_536)).min(1).max(200),
        progress: z.array(z.string().max(65_536)).max(10).default([]),
      },
    },
    ({ title, source, user_messages: userMessages, progress }) => {
      try {
        const saved = inbox.put({ ...(title === undefined ? {} : { title }), source, userMessages, progress });
        return reply(
          `預けました。ref ${saved.id}\nMac側では get_deposit にこのrefを渡すか、refなしで最新を読めます。`,
        );
      } catch (error) {
        return reply(`預けられませんでした: ${errorText(error)}`, false);
      }
    },
  );
  return server;
}

export async function serveDepositOverStdio(): Promise<void> {
  await createDepositServer().connect(new StdioServerTransport());
}
