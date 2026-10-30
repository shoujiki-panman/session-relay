/**
 * 渡す文脈から、鍵やトークンの形をした文字列を伏せる純関数。
 *
 * 会話の記録には、本人が貼った鍵やAIが表示したトークンがそのまま残る。
 * relay はそれを別のAIへ渡し、預けた会話はスマホやDotsからも届くので、
 * **渡す直前の出口で**伏せる。記録そのものは書き換えない（手元の正本は残す）。
 *
 * 伏せるのは「形で鍵だと分かるもの」だけ。`password=` のような言葉を手がかりに
 * 推測で伏せると、普通の会話（パスワードの話をしている発話）まで壊すのでやらない。
 * 同じ考えの道具（handoff-agent など）も、既知の形に絞ってベストエフォートと明記している。
 */

interface SecretShape {
  readonly kind: string;
  readonly pattern: RegExp;
  /** 残す前置き（`Bearer ` など）。伏せるのはその後ろだけ */
  readonly keepPrefix?: boolean;
}

/** 長い形・固有の前置きを先に置く（`sk-ant-` を `sk-` より先に当てるため） */
const SHAPES: readonly SecretShape[] = [
  {
    kind: "秘密鍵",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { kind: "Anthropicの鍵", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "OpenAIの鍵", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  { kind: "GitHubのトークン", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g },
  { kind: "npmのトークン", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: "AWSの鍵", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "Googleの鍵", pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: "Slackのトークン", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "Stripeの鍵", pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}/g },
  {
    kind: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  { kind: "Bearerトークン", pattern: /(\bBearer\s+)[A-Za-z0-9._~+/=-]{20,}/g, keepPrefix: true },
];

const mask = (kind: string): string => `[伏せた: ${kind}]`;

/** 文字列の中の鍵らしい部分を `[伏せた: 種類]` に置き換える。何度かけても同じ結果になる */
export function redactSecrets(text: string): string {
  return SHAPES.reduce(
    (current, shape) =>
      current.replace(shape.pattern, (_match: string, prefix: unknown) =>
        shape.keepPrefix === true && typeof prefix === "string" ? `${prefix}${mask(shape.kind)}` : mask(shape.kind),
      ),
    text,
  );
}
