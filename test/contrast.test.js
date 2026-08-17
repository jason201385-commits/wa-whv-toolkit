#!/usr/bin/env node
/* 對比度對帳：畫面上每一組「前景色配背景色」都要算得過 WCAG AA。
 *
 * 為什麼需要這支——2026-08-17 把整站配色從深色調換成暖色調時，
 * 有一組差點就這樣上線了：分享圖底下那行出處小字算出來 3.90，
 * 用眼睛看完全看不出它不夠。**顏色是少數「看起來對」跟「真的對」
 * 差最遠的東西**，因為判斷的人已經知道那行字寫什麼了。
 *
 * 同一天還修掉一個更早就在的：`.copybtn.done` 的字色寫死 `#fff`，
 * 深色主題下 `--ok` 是亮綠 (#7FD69F)，白字壓上去只剩 1.6。
 * 那顆按鈕是整個站唯一會回報「複製成功了」的地方。
 *
 * 這支刻意**不自己抄一份色票**——色票抄過來就會跟 index.html 分家，
 * 然後它守的是它自己那份，不是站上那份。全部從 index.html 現挖：
 *   1. 三個 token 區塊（:root / prefers-color-scheme / [data-theme="dark"]）
 *   2. 分享圖 canvas 裡寫死的那幾個色（那是印在圖上的，不吃 token）
 *   3. DATA.cards 的三個 accent（會當成分享圖上的符號色）
 *
 * 順便釘住一件手改很容易漏的事：深色的**兩個**區塊必須逐鍵相同。
 * 一個給「系統深色」、一個給「使用者按了深色」，值不一樣的話
 * 兩種進入方式會看到兩種畫面，而且只有其中一種會被人測到。
 *
 * 跑法：node test/contrast.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

let pass = 0, fail = 0;
const ok  = m => { pass++; console.log("✓ " + m); };
const bad = m => { fail++; console.log("✗ " + m); };

/* ============ WCAG 2.1 相對亮度與對比度 ============ */
function lum(hex) {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* ============ 從 index.html 挖 token ============ */
/* 只認 `--名稱:#RRGGBB;`。--shadow 那種 rgba() 疊出來的不在這裡對帳
   （它是陰影不是文字，沒有可讀性門檻）。 */
function tokensIn(block) {
  const t = {};
  const re = /--([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/g;
  let m;
  while ((m = re.exec(block))) t[m[1]] = m[2].toUpperCase();
  return t;
}
function blockAfter(marker) {
  const i = HTML.indexOf(marker);
  if (i < 0) throw new Error("在 index.html 找不到：" + marker);
  const open = HTML.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < HTML.length; j++) {
    if (HTML[j] === "{") depth++;
    else if (HTML[j] === "}") { depth--; if (depth === 0) return HTML.slice(open, j + 1); }
  }
  throw new Error("大括號沒有配對成功：" + marker);
}

const LIGHT   = tokensIn(blockAfter("/* ============ tokens ============ */\n:root{"));
const DARK_OS = tokensIn(blockAfter('@media (prefers-color-scheme:dark){\n  :root:not([data-theme="light"])'));
const DARK_UI = tokensIn(blockAfter(':root[data-theme="dark"]{'));

/* ============ 1. 兩個深色區塊必須完全一樣 ============ */
{
  const ka = Object.keys(DARK_OS).sort(), kb = Object.keys(DARK_UI).sort();
  if (ka.join() !== kb.join()) {
    bad("兩個深色區塊的鍵不一樣：只在 media 的 [" +
      ka.filter(k => !(k in DARK_UI)) + "]，只在 [data-theme] 的 [" +
      kb.filter(k => !(k in DARK_OS)) + "]");
  } else {
    const diff = ka.filter(k => DARK_OS[k] !== DARK_UI[k]);
    if (diff.length) {
      diff.forEach(k => bad("深色 --" + k + " 兩邊不同：media " + DARK_OS[k] + " vs [data-theme] " + DARK_UI[k]));
    } else {
      ok("兩個深色區塊逐鍵相同（" + ka.length + " 個 token）");
    }
  }
}

/* ============ 2. 淺色與深色要定義同一組 token ============ */
{
  const missing = Object.keys(LIGHT).filter(k => !(k in DARK_OS) && k !== "cjk" && k !== "mono");
  const extra   = Object.keys(DARK_OS).filter(k => !(k in LIGHT));
  if (missing.length) bad("深色沒有覆蓋到的顏色 token：" + missing.join("、") + "（會沿用淺色的值）");
  else ok("淺色的每一個顏色 token 深色都有覆蓋");
  if (extra.length) bad("深色多定義了淺色沒有的 token：" + extra.join("、"));
}

/* ============ 3. 每一組實際會疊在一起的顏色 ============ */
/* 只列**畫面上真的會這樣疊**的組合。憑空多列幾組會讓這支看起來很嚴格，
   實際上守的是不存在的畫面；少列一組則是真的漏。
   選色器一律用 var(--x)，所以「誰疊在誰上面」查 CSS 就查得到。 */
const GROUNDS = ["card", "paper", "sunk"];
const PAIRS = [];
GROUNDS.forEach(g => {
  ["ink", "ink-2", "muted", "accent", "ok", "warn", "bad"].forEach(f => PAIRS.push([f, g]));
});
PAIRS.push(
  ["accent-ink", "accent"],   /* ol.steps li::before、.cardtabs 選中那顆 */
  ["paper", "ok"],            /* .copybtn.done */
  ["paper", "bad"],           /* .copybtn.failed */
  ["ok", "ok-soft"],          /* .ans.ok */
  ["warn", "warn-soft"],      /* .ans.warn、.pending */
  ["bad", "bad-soft"]         /* .ans.bad */
);

/* AA 的門檻：一般文字 4.5、大字（≥18.66px 粗體或 ≥24px）3.0。
   這個站的判定文字最大到 16.5px，`.pending` 只有 10px——
   所以一律用 4.5 對帳，不給自己「那一行算大字」的空間。 */
const MIN = 4.5;
[["淺色", LIGHT], ["深色", DARK_OS]].forEach(([label, T]) => {
  let worst = { r: Infinity, n: "" };
  let n = 0;
  PAIRS.forEach(([f, b]) => {
    if (!(f in T) || !(b in T)) { bad(label + "：找不到 token --" + (f in T ? b : f)); return; }
    const r = ratio(T[f], T[b]);
    n++;
    if (r < worst.r) worst = { r, n: "--" + f + " on --" + b };
    if (r < MIN) bad(label + " --" + f + " 疊在 --" + b + " 上只有 " + r.toFixed(2) + "（需 " + MIN + "）");
  });
  ok(label + " " + n + " 組全部 ≥ " + MIN + "，最勉強的是 " + worst.n + " " + worst.r.toFixed(2));
});

/* ============ 4. 分享圖：canvas 上寫死的色 ============ */
/* 分享圖是要被存下來貼到 LINE 群的一張 PNG，它不吃 token 也不跟主題走，
   所以只能單獨對帳。底色從 draw() 的第一個 fillRect 挖，不要用猜的。 */
{
  const draw = HTML.slice(HTML.indexOf("function draw(){"));
  const groundM = draw.match(/g\.fillStyle = "(#[0-9A-Fa-f]{6})"; g\.fillRect\(0,0,W,H\)/);
  if (!groundM) { bad("分享圖：找不到底色那一行（draw() 的 fillRect(0,0,W,H)）"); }
  else {
    const ground = groundM[1].toUpperCase();
    /* 圖上會出現的文字色。線條（strokeStyle）是分隔線不是文字，不列入。 */
    const inks = [...draw.slice(0, draw.indexOf("c.setAttribute"))
      .matchAll(/g\.fillStyle = "(#[0-9A-Fa-f]{6})"/g)]
      .map(m => m[1].toUpperCase())
      .filter(h => h !== ground);
    if (!inks.length) bad("分享圖：一個文字色都沒挖到，這支等於沒在測");
    else {
      let worst = { r: Infinity, h: "" };
      inks.forEach(h => {
        const r = ratio(h, ground);
        if (r < worst.r) worst = { r, h };
        if (r < MIN) bad("分享圖 " + h + " 疊在底色 " + ground + " 上只有 " + r.toFixed(2));
      });
      ok("分享圖 " + inks.length + " 個文字色全部 ≥ " + MIN + "（底 " + ground +
         "，最勉強 " + worst.h + " " + worst.r.toFixed(2) + "）");
    }

    /* DATA.cards 的 accent 會被拿去畫每一條前面的 ✕ 與頂端那條色帶。
       它跟文字一樣要讀得出來，而且它是三張卡各一個色，很容易只調到其中一個。 */
    const accents = [...HTML.matchAll(/accent:"(#[0-9A-Fa-f]{6})"/g)].map(m => m[1].toUpperCase());
    if (accents.length < 3) bad("DATA.cards 的 accent 只挖到 " + accents.length + " 個，預期 3 個");
    else {
      const low = accents.filter(h => ratio(h, ground) < MIN);
      if (low.length) low.forEach(h => bad("卡片 accent " + h + " 疊在分享圖底色上只有 " + ratio(h, ground).toFixed(2)));
      else ok("DATA.cards 的 " + accents.length + " 個 accent 在分享圖底色上都 ≥ " + MIN);
    }
  }
}

/* ============ 5. 守門：不准有人繞過 token 直接寫死顏色 ============ */
/* 這支測的是 token，所以 token 以外寫死的色它一概看不到——
   2026-08-17 之前 `.copybtn.done{color:#fff}` 就是這樣活了很久。
   所以反過來禁掉那條路：token 區塊以下的 CSS 一個色碼都不准出現。 */
{
  const css = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));
  const tokenBlockEnd = css.indexOf(':root[data-theme="dark"]{');
  const body = css.slice(css.indexOf("}", tokenBlockEnd));
  /* 先確認掃描範圍不是空的。一個掃到空字串的守門會永遠通過。 */
  if (body.length < 5000 || !body.includes("var(--ink)")) {
    bad("守門的掃描範圍不對（長度 " + body.length + "），這條等於沒在掃");
  } else {
    const hits = [...body.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)].map(m => m[0]);
    if (hits.length) bad("token 區塊以外的 CSS 出現寫死的顏色：" + hits.join("、"));
    else ok("token 區塊以外的 CSS 沒有任何寫死的顏色（掃了 " + body.length + " 字）");
  }
}

/* ============ 5b. 定義了卻沒人用的 token ============ */
/* 一個沒有被 var() 引用的 token，上面第 3 節照樣會很認真地幫它算對比度，
   然後回報一個跟畫面無關的「通過」。`--accent-soft` 就是這樣存在了一段時間：
   三個區塊各定義一次，全站零引用。**守一個不存在的畫面，跟沒守一樣。** */
{
  const css = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));
  const unused = Object.keys(LIGHT).filter(k => !css.includes("var(--" + k + ")"));
  if (unused.length) bad("定義了但全站沒有任何 var() 引用的 token：" + unused.map(k => "--" + k).join("、"));
  else ok("每一個 token 都真的被 var() 用到（" + Object.keys(LIGHT).length + " 個）");
}

/* ============ 6. canary：確認上面那些門真的關得起來 ============ */
/* 一條永遠通過的斷言跟沒有那條斷言，在輸出上長得一模一樣。
   所以餵它幾組**應該要被擋下來**的值，確認它真的擋。 */
{
  const near = ratio("#8A7A66", "#FCF7F0");   /* 2026-08-17 真的差點上線的那一組 */
  if (near < MIN) ok("canary：當初那組 3.90 的出處小字算得出來是不合格的（" + near.toFixed(2) + "）");
  else bad("canary：連 #8A7A66 on #FCF7F0 都判成合格，這支在守空氣");

  const white = ratio("#FFFFFF", "#7FD69F");  /* 修掉的 .copybtn.done 深色版 */
  if (white < MIN) ok("canary：白字壓深色主題的 --ok 算得出來是不合格的（" + white.toFixed(2) + "）");
  else bad("canary：白字壓亮綠都判成合格");

  if (ratio("#000000", "#FFFFFF") > 20) ok("canary：黑白對比算出來是 21");
  else bad("canary：黑白對比算錯了，公式有問題");
}

console.log(fail === 0
  ? "\n全數通過：" + pass + " 過 / 0 失敗"
  : "\n" + pass + " 過 / " + fail + " 失敗");
process.exit(fail === 0 ? 0 : 1);
