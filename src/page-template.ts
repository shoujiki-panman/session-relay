/**
 * 1枚のHTML。**外を一切見ない**——CDNもフォントも取りに行かないので、
 * ネットが無くても、どの端末に持っていっても同じように開く。
 * 特定のアプリの中に作らないのは、そのアプリを使っていない人が使えなくなるから。
 *
 * 会話の中身はここに入れない。入るのは見出しだけで、本文は選んだ後に relay が読む。
 * 全文を1枚に焼き込むと、そのファイルを人に見せた瞬間に鍵や個人情報ごと渡すことになる。
 */

/** 一覧のJSONを差し込む場所 */
export const ROWS_MARK = "__ROWS__";

export const TEMPLATE = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>会話の続き</title>
<style>
:root{color-scheme:light dark;--line:color-mix(in srgb,currentColor 12%,transparent);
--dim:color-mix(in srgb,currentColor 55%,transparent);--hit:color-mix(in srgb,currentColor 7%,transparent)}
*{box-sizing:border-box}
body{margin:0;padding:16px 16px 64px;max-width:900px;
font:15px/1.6 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif}
h1{font-size:17px;margin:0 0 4px}
p.lead{color:var(--dim);font-size:13px;margin:0 0 14px}
input{width:100%;padding:10px 12px;font:inherit;color:inherit;background:none;
border:1px solid var(--line);border-radius:8px;margin-bottom:18px}
h2{font-size:13px;margin:22px 0 4px;display:flex;gap:8px;align-items:baseline}
h2 .n{color:var(--dim);font-weight:400;font-size:12px}
.row{display:flex;gap:10px;align-items:center;border-top:1px solid var(--line);padding:9px 6px}
.row:hover{background:var(--hit);border-radius:6px}
.body{flex:1;min-width:0}
.topic{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{color:var(--dim);font-size:12px}
button{font:inherit;color:inherit;background:none;border:1px solid var(--line);
border-radius:6px;padding:5px 10px;cursor:pointer;white-space:nowrap}
button:hover{background:var(--hit)}
button.term{border:0;color:var(--dim);font-size:12px;padding:5px 4px;text-decoration:underline}
#empty{color:var(--dim);padding:28px 6px}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
padding:10px 16px;border:1px solid var(--line);border-radius:999px;
background:Canvas;opacity:0;transition:opacity .18s;pointer-events:none}
#toast.on{opacity:1}
</style>
</head>
<body>
<h1>会話の続き</h1>
<p class="lead">選ぶと、続きに入るための一行がクリップボードに乗ります。使いたいAIに貼ってください。</p>
<input id="q" type="search" placeholder="打つと絞れます（話の中身・場所）" autofocus>
<div id="list"></div>
<div id="empty" hidden>当たる会話がありません。</div>
<div id="toast"></div>
<script id="rows" type="application/json">${ROWS_MARK}</script>
<script>
var rows = JSON.parse(document.getElementById("rows").textContent);
var listEl = document.getElementById("list");
var emptyEl = document.getElementById("empty");
var toastEl = document.getElementById("toast");
var timer = null;

function say(text) {
  toastEl.textContent = text;
  toastEl.className = "on";
  if (timer) clearTimeout(timer);
  timer = setTimeout(function () { toastEl.className = ""; }, 2400);
}

// file:// で開くと navigator.clipboard が無いブラウザがある。黙って失敗させない
function copy(text, told) {
  var fallback = function () {
    var box = document.createElement("textarea");
    box.value = text;
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(box);
    if (ok) say(told);
    else say("コピーできませんでした。ブラウザで開き直してください");
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { say(told); }, fallback);
  } else {
    fallback();
  }
}

function instruction(row) {
  return "「" + row.topic + "」の続きから。\\n\\n" +
    "relay の get_context を ref " + row.ref + " で呼んで前の会話を読み込み、\\n" +
    "どこまで進んでいたかを一言で確認してから続けてください。";
}

function hit(row, q) {
  if (!q) return true;
  var n = q.toLowerCase();
  return [row.topic, row.project].some(function (v) {
    return String(v || "").toLowerCase().indexOf(n) >= 0;
  });
}

function rowEl(row) {
  var el = document.createElement("div");
  el.className = "row";
  var body = document.createElement("div");
  body.className = "body";
  var topic = document.createElement("span");
  topic.className = "topic";
  topic.textContent = row.topic;
  var meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = [row.when, row.harness, "発話 " + row.utterances].join(" · ");
  body.appendChild(topic);
  body.appendChild(meta);
  var term = document.createElement("button");
  term.className = "term";
  term.textContent = "端末から";
  term.onclick = function () { copy("relay --from " + row.ref, "端末に貼る一行をコピーしました"); };
  var main = document.createElement("button");
  main.textContent = "続きから";
  main.onclick = function () { copy(instruction(row), "コピーしました。AIに貼ってください"); };
  el.appendChild(body);
  el.appendChild(term);
  el.appendChild(main);
  return el;
}

function heading(name, count) {
  var h = document.createElement("h2");
  h.textContent = name;
  var n = document.createElement("span");
  n.className = "n";
  n.textContent = count + " 件";
  h.appendChild(n);
  return h;
}

function render() {
  var q = document.getElementById("q").value.trim();
  var shown = rows.filter(function (r) { return hit(r, q); });
  listEl.replaceChildren();
  emptyEl.hidden = shown.length > 0;
  var seen = null;
  shown.forEach(function (row) {
    if (row.project !== seen) {
      seen = row.project;
      listEl.appendChild(heading(row.project, shown.filter(function (r) {
        return r.project === row.project;
      }).length));
    }
    listEl.appendChild(rowEl(row));
  });
}

document.getElementById("q").addEventListener("input", render);
render();
</script>
</body>
</html>
`;
