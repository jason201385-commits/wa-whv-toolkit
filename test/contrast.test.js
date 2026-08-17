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

/* 上面三組只守到判定那一行（.verdict），沒守到判定底下的內文。
   而 `.ans` 的底色是 JS 用 `box.className = "ans " + tone` 換的，
   所以 `.ans .detail`（--ink）跟 index.html:3220/3239 兩處寫死在
   innerHTML 裡的 `style="color:var(--muted)"`，會落在四種底色的**任何一種**上，
   之前只對到 --sunk 那一種。答案框正是整個站唯一真的要讀的地方。
   `--ink-2` 不列：查過了，它只出現在 .navgrid a / .ask label / ol.steps p /
   .disclaim，四個都是靜態版面，進不到 .ans 裡面。列它就是守不存在的畫面。 */
["ok-soft", "warn-soft", "bad-soft"].forEach(g => {
  PAIRS.push(["ink", g], ["muted", g]);
});

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

/* ============ 3c. 邊界：不是文字，但照樣要看得見 ============ */
/* 上面第 3 節只管「字讀不讀得出來」，管不到「這個框存不存在」。
   而 `.ans` 的四種底色跟 --card 之間只差 1.00–1.17（深色 --bad-soft 是 1.00，
   字面上跟卡片同一個顏色），所以整個答案框能不能被看見，全靠那一圈 border。
   WCAG 1.4.11 對這種「識別元件與狀態所需的視覺資訊」給的是 3:1，不是 4.5。

   只列這三個 tone 邊界（用在 .ans.ok/.warn/.bad 與 .pending）。
   --line / --line-soft 故意不列：那些是分隔用的細線，本來就該淡，
   拉到 3:1 會讓整個版面變成格線紙。**門檻要跟著用途走，不是全站一個數字。** */
const MIN_UI = 3.0;
[["淺色", LIGHT], ["深色", DARK_OS]].forEach(([label, T]) => {
  let worst = { r: Infinity, n: "" };
  ["ok-line", "warn-line", "bad-line"].forEach(f => {
    const r = ratio(T[f], T["card"]);
    if (r < worst.r) worst = { r, n: "--" + f };
    if (r < MIN_UI) bad(label + " 狀態框邊界 --" + f + " 疊在 --card 上只有 " +
                        r.toFixed(2) + "（非文字門檻 " + MIN_UI + "）");
  });
  ok(label + " 三個狀態框邊界都 ≥ " + MIN_UI + "，最勉強的是 " + worst.n + " " + worst.r.toFixed(2));
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
   所以反過來禁掉那條路：token 區塊以下的 CSS 一個色碼都不准出現。
   註解先剝掉再掃：註解不會被算繪，而「不准在註解裡出現色碼」等於
   「不准解釋某個顏色當初為什麼不合格」——那正是這幾條規則旁邊最該寫的東西。 */
{
  const css = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));
  const tokenBlockEnd = css.indexOf(':root[data-theme="dark"]{');
  const body = css.slice(css.indexOf("}", tokenBlockEnd)).replace(/\/\*[\s\S]*?\*\//g, "");
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

/* ============ 5c. 守門：不准用 opacity 把文字調淡 ============ */
/* 這支全部的計算都是 token 對 token，對「把 token 稀釋掉」完全是盲的。
   `.catlist li.no{opacity:.62}` 就從這個洞鑽過去：--muted 對 --sunk 明明是 4.90，
   乘上 .62 之後畫面上只剩 4.26，而這支照樣報全數通過。
   降階要改指定 --muted，不要用 opacity——這樣第 3 節才守得到。
   opacity:1（重設瀏覽器預設值用）不在此限。 */
{
  const css = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"))
    .replace(/\/\*[\s\S]*?\*\//g, "");   /* 同 5 節：註解裡舉的反例不算違規 */
  const dim = [...css.matchAll(/opacity:\s*(0?\.\d+|0)\b/g)].map(m => m[0]);
  if (dim.length) bad("CSS 用 opacity 把東西調淡了：" + dim.join("、") +
                      "（第 3 節看不到這種稀釋，請改成指定 --muted）");
  else ok("CSS 沒有任何 opacity 降階（token 對帳因此是完整的）");
}

/* ============ 5d. 守門：placeholder 必須自己指定顏色 ============ */
/* 不指定的話瀏覽器會拿 input 的 color 去乘一個自己的 opacity，
   實測落在 3.50——低於 AA，而且不管你把 token 調得多好都救不回來。
   opacity:1 那半不能省：Firefox 的預設 placeholder 本身就帶 opacity，
   不歸零的話會在 --muted 上再乘一次。**兩個條件缺一，這條就白寫了。** */
{
  const css = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));
  const m = css.match(/::placeholder\{([^}]*)\}/);
  if (!m) bad("沒有 ::placeholder 規則——瀏覽器預設值算出來只有 3.50");
  else if (!/color:\s*var\(--/.test(m[1])) bad("::placeholder 沒有指定 var(--) 顏色：" + m[1]);
  else if (!/opacity:\s*1\b/.test(m[1])) bad("::placeholder 少了 opacity:1，Firefox 會再乘一次：" + m[1]);
  else ok("::placeholder 有自己的 token 顏色，而且把瀏覽器的 opacity 歸零了");
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

  /* 3c 的 canary。改調亮度就能過關的門檻很容易被下一個人「順手調回好看的顏色」，
     所以留一組原值：舊的深色 --bad-line 疊在 --card 上是 2.13。 */
  const oldLine = ratio("#8C4439", "#2C2621");
  if (oldLine < MIN_UI) ok("canary：舊的深色 --bad-line 算得出來是不合格的（" + oldLine.toFixed(2) + "）");
  else bad("canary：連 2.13 的框線都判成看得見，3c 在守空氣");
}

console.log(fail === 0
  ? "\n全數通過：" + pass + " 過 / 0 失敗"
  : "\n" + pass + " 過 / " + fail + " 失敗");
process.exit(fail === 0 ? 0 : 1);
