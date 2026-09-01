/**
 * MCPサーバー。「引き継ぎ書を書かない」の最後の一歩。
 *
 * ここまでの relay は、人が文脈を貼る道具だった（`relay --print | pbcopy`）。
 * MCPにすると、渡された側のAIが**自分で取りに来る**。
 * 人がやることは「続きから」と言うことだけになる。
 *
 * 置き方（Claude Code / Codex / Cursor いずれも stdio）:
 *   claude mcp add relay -- relay mcp
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  type Answer,
  answerContext,
  answerConversations,
  answerMatches,
  answerProjects,
  noPrevious,
  noSuchRef,
} from "./mcp-answers.ts";
import { pickProject } from "./projects.ts";
import { chooseByKey, contextOf, findByWords, previousIn, projectsOf } from "./query.ts";
import { type Deposit, type Inbox, createInbox, renderDeposit } from "./inbox.ts";

/** SDKが受け取る形。書き換え可の配列＋追加項目を許す形でないと通らない */
interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const reply = (answer: Answer): ToolResult => ({
  content: [{ type: "text", text: answer.text }],
  ...(answer.ok ? {} : { isError: true }),
});

/**
 * 引数なし = 「いまいる場所の、自分ではない直前の会話」。
 * 自分を外さないと、始まったばかりの空の自分を読んで「前の話は無かった」になる。
 */
function contextAnswer(ref: string | undefined, cwd: string): Answer {
  if (ref === undefined || ref === "") {
    const built = previousIn(cwd);
    return built === null ? noPrevious(cwd) : answerContext(built.context);
  }
  const chosen = chooseByKey(ref, cwd, null, true);
  if (chosen === null) return noSuchRef(ref);
  const context = contextOf(chosen, cwd);
  return context === null ? noSuchRef(ref) : answerContext(context);
}

/** 本人の言葉で探す。1本に決まればそのまま渡す（refを聞き返さないため） */
function wordsAnswer(words: string, cwd: string): Answer {
  const hits = findByWords(words);
  const [only] = hits;
  if (only === undefined || hits.length > 1) return answerMatches(words, hits);
  const context = contextOf(only, cwd);
  return context === null ? answerMatches(words, []) : answerContext(context);
}

const RESUME_HINT =
  "ユーザーが「続きから」「さっきの続き」と言ったら、まずこれを引数なしで呼ぶ。";

function addContextTool(server: McpServer): void {
  server.registerTool(
    "get_context",
    {
      title: "前の会話を引き継ぐ",
      description:
        "前の会話でこの人が実際に打った言葉を、要約せず原文のまま返す（経過・触ったファイル・gitの状態つき）。" +
        `${RESUME_HINT} 別の話の続きなら、本人が言った言葉をそのまま about に渡す` +
        "（「地図の話の続き」なら about=\"地図\"）。**本人に ref や番号を聞き返さないこと。**",
      inputSchema: {
        ref: z
          .string()
          .optional()
          .describe("list_conversations が返した ref。省略すると、いまいる場所の直前の会話"),
        about: z
          .string()
          .optional()
          .describe("本人が言った言葉で探す。見出しと置き場所に当てる"),
      },
    },
    ({ ref, about }) =>
      reply(
        about === undefined || about === ""
          ? contextAnswer(ref, process.cwd())
          : wordsAnswer(about, process.cwd()),
      ),
  );
}

function addListTools(server: McpServer): void {
  server.registerTool(
    "list_projects",
    {
      title: "プロジェクト一覧",
      description:
        "この人がAIと話してきた内容を、作業していたプロジェクト単位でまとめて返す。" +
        "どの話の続きかを本人に選んでもらうときに使う。",
      inputSchema: {},
    },
    () => reply(answerProjects(projectsOf())),
  );

  server.registerTool(
    "list_conversations",
    {
      title: "そのプロジェクトの会話一覧",
      description: "プロジェクト名を渡すと、その中の会話を新しい順に返す。ref は get_context に渡す。",
      inputSchema: { project: z.string().describe("list_projects が返したプロジェクト名") },
    },
    ({ project }) => reply(answerConversations(pickProject(projectsOf(), project), project)),
  );
}

const depositLine = (deposit: Deposit): string =>
  `- ref ${deposit.id} | ${deposit.createdAt} | ${deposit.source} | ${deposit.title}`;

function addDepositListTool(server: McpServer, inbox: Inbox): void {
  server.registerTool(
    "list_deposits",
    {
      title: "預けた会話の一覧",
      description:
        "Claudeモバイル等で『relayに預けて』と明示して保存した会話を新しい順に返す。" +
        "本人が『スマホで預けた話』と言ったときに使う。",
      inputSchema: {},
    },
    () => {
      const rows = inbox.list();
      return reply({
        ok: rows.length > 0,
        text:
          rows.length === 0
            ? "預けられた会話はありません。"
            : ["預けられた会話（新しい順）:", ...rows.map(depositLine), "", "読むには get_deposit にrefを渡す。"].join(
                "\n",
              ),
      });
    },
  );
}

function addDepositReadTool(server: McpServer, inbox: Inbox): void {
  server.registerTool(
    "get_deposit",
    {
      title: "スマホ等から預けた会話を引き継ぐ",
      description:
        "本人が別のClaudeチャットから預けた会話を原文のまま返す。ref省略時は最新。" +
        "『スマホで預けた続き』『さっき預けた話』なら、本人にrefを聞かずまず引数なしで呼ぶ。",
      inputSchema: { ref: z.string().optional().describe("list_depositsが返したref。省略すると最新") },
    },
    ({ ref }) => {
      const found = inbox.get(ref);
      return reply(
        found === null
          ? { ok: false, text: "預けられた会話が見つかりません。list_depositsで確認してください。" }
          : { ok: true, text: renderDeposit(found) },
      );
    },
  );
}

/** 外から明示的に預けた会話を読む。外向きの投函MCPとはサーバーごと分ける。 */
function addInboxTools(server: McpServer, inbox: Inbox): void {
  addDepositListTool(server, inbox);
  addDepositReadTool(server, inbox);
}

/** 「続きから」を、この人が選べる形でも出しておく（Claude Codeでは /mcp のメニューに出る） */
function addResumePrompt(server: McpServer): void {
  server.registerPrompt(
    "resume",
    { title: "続きから", description: "前の会話の文脈を読み込んで、そこから続ける" },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "get_context を引数なしで呼んで、前の会話を読み込んでから続けてください。",
          },
        },
      ],
    }),
  );
}

export function createServer(inbox: Inbox = createInbox()): McpServer {
  const server = new McpServer({ name: "relay", version: "0.2.3" });
  addContextTool(server);
  addListTools(server);
  addInboxTools(server, inbox);
  addResumePrompt(server);
  return server;
}

/**
 * 標準出力はJSON-RPCで埋まっている。**1行でも余計に書くと通信が壊れる**ので、
 * この先で何かを知らせたいときは必ず stderr に書くこと。
 */
export async function serveOverStdio(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}
