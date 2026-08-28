/**
 * プロジェクトと会話を JSON Canvas（`.canvas`）に書き出す。
 *
 * 本人の要望（2026-08-27）:「Miroのように繋げられたらいい」。
 * 画面は作らない。JSON Canvas は Obsidian のキャンバス形式が公開仕様になったもので
 * （MIT・https://jsoncanvas.org/）、`.canvas` を開けばそのまま無限キャンバスになる。
 * ドラッグも矢印も既にある機能なので、こちらが作るのは**中身だけ**でいい。
 *
 * 仕様は意図的に拡張可能で、知らない項目は読み手が無視する。
 * だから relay 用の情報を足しても他のアプリで壊れない。
 */
import type { Listed } from "./list.ts";
import type { Project } from "./projects.ts";

export interface CanvasNode {
  readonly id: string;
  readonly type: "text";
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color?: string;
}

export interface CanvasEdge {
  readonly id: string;
  readonly fromNode: string;
  readonly fromSide: "right";
  readonly toNode: string;
  readonly toSide: "left";
}

/** 置き方。プロジェクトを左の列に、その会話を右の列に並べる */
const PROJECT_X = 0;
const SESSION_X = 520;
const CARD_W = 420;
const CARD_H = 120;
const GAP_Y = 150;
/** プロジェクトどうしの間。中の会話がぶつからないだけ空ける */
const BLOCK_GAP = 80;

const projectCard = (project: Project): string =>
  [
    `# ${project.name}`,
    "",
    project.cwd ?? "(場所不明)",
    `会話 ${String(project.sessions.length)} 件 / 最終 ${project.when}`,
  ].join("\n");

/**
 * 会話のカード。**続けるためのコマンドまで書く**。
 * 見えるだけのカードは、結局どこかで打ち直すことになる。
 */
const sessionCard = (session: Listed): string =>
  [
    `**${session.topic}**`,
    "",
    `${session.when} · ${session.harness} · 発話 ${String(session.utterances)}`,
    "",
    "```",
    `relay --from ${session.ref}`,
    "```",
  ].join("\n");

interface Placed {
  readonly nodes: CanvasNode[];
  readonly edges: CanvasEdge[];
  readonly nextY: number;
}

function placeProject(project: Project, index: number, top: number): Placed {
  const projectId = `p${String(index)}`;
  const nodes: CanvasNode[] = [
    { id: projectId, type: "text", text: projectCard(project), x: PROJECT_X, y: top, width: CARD_W, height: CARD_H, color: "6" },
  ];
  const edges: CanvasEdge[] = [];
  project.sessions.forEach((session, i) => {
    const id = `s${String(index)}-${String(i)}`;
    nodes.push({ id, type: "text", text: sessionCard(session), x: SESSION_X, y: top + i * GAP_Y, width: CARD_W, height: CARD_H });
    edges.push({ id: `e${id}`, fromNode: projectId, fromSide: "right", toNode: id, toSide: "left" });
  });
  const used = Math.max(1, project.sessions.length) * GAP_Y;
  return { nodes, edges, nextY: top + used + BLOCK_GAP };
}

export interface Canvas {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
}

/** プロジェクトと会話をキャンバスの形に組む */
export function buildCanvas(projects: readonly Project[]): Canvas {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  let top = 0;
  projects.forEach((project, index) => {
    const placed = placeProject(project, index, top);
    nodes.push(...placed.nodes);
    edges.push(...placed.edges);
    top = placed.nextY;
  });
  return { nodes, edges };
}

/** JSON Canvas（`.canvas`）の中身にする */
export const toCanvas = (projects: readonly Project[]): string =>
  `${JSON.stringify(buildCanvas(projects), null, 2)}\n`;
