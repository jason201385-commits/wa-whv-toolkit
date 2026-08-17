#!/usr/bin/env node
/* 旗標對帳：DATA 裡每一筆「待核」都要真的印得出來。
 *
 * 為什麼需要這支測試——這個站的可信度全押在一件事上：沒有標「待核」的數字
 * 就是有官方頁面撐著的。所以最糟的 bug 不是印錯字，是**旗標黑洞**：
 * 資料裡標了 v:false，渲染器卻沒吃那個欄位，畫面把未查證的東西呈現成已查證。
 * index.html 的換匯合法路徑那一段就留著這個教訓的註解（「少了這一行，
 * 這一區就是旗標黑洞——比不標更糟」）。那是修過的，這支測試是不讓它再發生。
 *
 * 順便釘死一個一直被數錯的數字。用 grep 數 `v:false` 會得到 24，
 * 但其中 4 次出現在**註解裡**（第 964、1334、1493、2447 行在解釋這個機制），
 * 真正的資料筆數是 20。稽核 DOM 時該對的是這支測試算出來的數，不是 grep。
 *
 * 跑法：node test/flags.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

/* 與 wage.test.js／cost.test.js 同一套大括號配對切法。
   刻意各檔各留一份：測試檔之間共用工具會讓「改一支壞三支」，
   而這三支的存在理由就是彼此獨立。 */
function slice(startPattern) {
  const i = HTML.indexOf(startPattern);
  if (i < 0) throw new Error("在 index.html 找不到：" + startPattern);
  const open = HTML.indexOf("{", i);
  let depth = 0, inStr = null, esc = false;
  for (let j = open; j < HTML.length; j++) {
    const ch = HTML[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "/" && HTML[j + 1] === "*") { j = HTML.indexOf("*/", j) + 1; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return HTML.slice(i, j + 1); }
  }
  throw new Error("大括號沒有配對成功：" + startPattern);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(slice("const DATA = {") + ";this.DATA=DATA;", sandbox);
const DATA = sandbox.DATA;

let pass = 0, fail = 0;
const ok  = m => { pass++; console.log("✓ " + m); };
const bad = m => { fail++; console.log("✗ " + m); };
const is  = (got, want, m) =>
  got === want ? ok(m + "（" + got + "）") : bad(m + "：預期 " + want + "，實際 " + got);

/* ============ 1. 資料面：哪些東西被標成待核 ============ */

/* 走遍整棵 DATA，記下每一筆帶旗標的項目，以及它所在的**陣列路徑**。
   陣列路徑才是重點——渲染器吃的是整個陣列，黑洞是以陣列為單位發生的。 */
const flagged = [];
(function walk(node, p) {
  if (Array.isArray(node)) return node.forEach((x, i) => walk(x, p + "[" + i + "]"));
  if (!node || typeof node !== "object") return;
  if (node.v === false || node.pending === true) {
    const arr = p.replace(/\[\d+\]$/, "");
    if (arr === p) throw new Error("旗標長在非陣列成員上，這支測試的假設不成立：" + p);
    flagged.push({ path: p, arr: arr.replace(/^\./, ""), kind: node.v === false ? "v:false" : "pending:true" });
  }
  Object.keys(node).forEach(k => walk(node[k], p + "." + k));
})(DATA, "");

const rawText = (HTML.match(/v:false/g) || []).length;
console.log("— 資料面 —");
is(flagged.filter(f => f.kind === "v:false").length, 20, "DATA 裡的 v:false 筆數");
is(flagged.filter(f => f.kind === "pending:true").length, 1, "DATA 裡的 pending:true 筆數");
rawText > flagged.length
  ? ok("grep 數字（" + rawText + "）本來就比資料筆數多，因為註解也在解釋這個機制——稽核不要用 grep")
  : bad("grep 到的 v:false 只有 " + rawText + " 次，比資料筆數還少，切片可能沒抓到整個 DATA");

/* ============ 2. 程式面：誰印得出「待核」 ============ */

/* 每一個會吐 <span class="pending"> 的地方，配上它實際吃的陣列。
   `must` 是那段程式碼現在長什麼樣；改寫渲染器而忘了回來看這張表，測試會紅。 */
const EMITTERS = [
  { name: "cards()（生活成本卡片）", must: "esc(x.k) + (x.pending ?", from: () => ["cost.save.items", "cost.band.items"] },
  { name: "sources()（來源清單）",   must: "(s.v===false?'<span class=\"pending\">", from: () => callSites(/sources\(\s*"#[\w-]+"\s*,\s*([\w.$]+)\s*\)/g) },
  { name: "calls()（電話清單）",     must: "(c.v === false ?",                       from: () => callSites(/calls\(\s*"#[\w-]+"\s*,\s*([\w.$]+)\s*\)/g) },
  { name: "換匯合法路徑",            must: "(s.v === false ?",                       from: () => ["scam.legal.steps"] },
  { name: "離境押金時程",            must: "(x.v === false ?",                       from: () => ["rent.exit"] },
];

/* alias 解析：`calls("#wagecalls", W.report.calls)` 裡的 W 是 DATA.wage。
   兩件事讓這個不能用「全域搜第一個」草草帶過：
   （a）同一個字母在不同 IIFE 會指到不同地方——C 同時當過 DATA.car 與 DATA.cost，
       所以取的是**呼叫點之前最近的那一次宣告**；
   （b）alias 會接力——`const A = DATA.after` 之後又有 `const c = A.consular`，
       所以要一路解到 DATA 為止，不是解一層就算。 */
function resolveExpr(expr, at, depth) {
  if (expr.startsWith("DATA.")) return expr.slice(5);
  if ((depth || 0) > 6) throw new Error("alias 解析繞不出來：" + expr);
  const parts = expr.split(".");
  const re = new RegExp("const\\s+" + parts[0] + "\\s*=\\s*([\\w.$]+)\\s*[,;]", "g");
  let m, decl = null;
  while ((m = re.exec(HTML))) { if (m.index < at) decl = m[1]; else break; }
  if (!decl) throw new Error("解不出這個陣列是誰：" + expr + "（第 " + at + " 字元附近）");
  return resolveExpr([decl].concat(parts.slice(1)).join("."), at, (depth || 0) + 1);
}
function callSites(re) {
  const out = [];
  let m;
  while ((m = re.exec(HTML))) out.push(resolveExpr(m[1], m.index, 0));
  return out;
}

console.log("\n— 程式面 —");
const emitterCount = (HTML.match(/<span class="pending">待核<\/span>/g) || []).length;
is(emitterCount, EMITTERS.length, "原始碼裡的 .pending 發射點數量");

const aware = new Set();
for (const e of EMITTERS) {
  if (!HTML.includes(e.must)) { bad(e.name + " 的旗標判斷不見了（找不到 `" + e.must + "`）"); continue; }
  let arrs;
  try { arrs = e.from(); } catch (err) { bad(e.name + "：" + err.message); continue; }
  arrs.forEach(a => aware.add(a));
  ok(e.name + " 吃得到旗標，涵蓋 " + arrs.length + " 個陣列");
}

/* ============ 3. 對帳：有沒有黑洞 ============ */

console.log("\n— 對帳 —");
const holes = flagged.filter(f => !aware.has(f.arr));
holes.length === 0
  ? ok("每一筆待核都落在吃得到旗標的陣列裡，沒有黑洞")
  : bad("旗標黑洞 " + holes.length + " 筆：" + holes.map(h => h.path + "（" + h.arr + " 沒有渲染器吃 v）").join("、"));

/* 反向也要看：宣告吃得到旗標、但那個陣列根本不存在或不是陣列，
   代表註冊指到了不存在的地方，畫面會靜默少一整區。 */
for (const a of aware) {
  const node = a.split(".").reduce((o, k) => (o == null ? o : o[k]), DATA);
  if (!Array.isArray(node)) bad("註冊了 DATA." + a + " 但它不是陣列（實際：" + typeof node + "）");
}

/* 這裡數的是 DATA 的筆數，這支測試從頭到尾沒有渲染過 DOM，
   所以講「畫面上會出現幾個」是過度宣稱——上面的黑洞對帳只證明了
   「每一筆都落在吃得到旗標的陣列裡」，證不到渲染真的跑過。 */
is(flagged.length, 21, "DATA 裡帶旗標的總筆數（＝畫面該有的徽章數上限）");

/* ============ 4. 掛載點：註冊到的 id 要真的在 HTML 裡 ============ */

console.log("\n— 掛載點 —");
/* `cards` 一定要在這串裡面。它漏掉過，而漏掉的代價可以實際做出來：
   把 markup 的 id="savelist" 改成 id="savelist-v2"（渲染器呼叫不動），
   cards() 走 `if(!w) return;` 靜默整段消失、畫面上唯一那筆 pending:true 跟著不見，
   這支測試卻全綠。這支測試存在的理由就是防這個，它自己漏掉了。 */
const regs = [...HTML.matchAll(/\b(?:flags|sources|calls|cards|li|html)\(\s*"(#[\w-]+)"/g)].map(m => m[1].slice(1));
const missing = [...new Set(regs)].filter(id => !new RegExp('id="' + id + '"').test(HTML));
missing.length === 0
  ? ok("全部 " + new Set(regs).size + " 個註冊目標都找得到對應的 id")
  : bad("註冊了但 HTML 沒有這些 id：" + missing.join("、"));

/* ============ 5. 有出處就要有日期 ============ */

console.log("\n— 來源欄位 —");
const srcArrays = [...HTML.matchAll(/sources\(\s*"#[\w-]+"\s*,\s*DATA\.(\w+)\.src\s*\)/g)].map(m => m[1]);
let bare = 0, undated = 0;
for (const k of srcArrays) {
  for (const s of DATA[k].src) {
    if (!s.u || !/^https?:\/\//.test(s.u)) { bare++; console.log("  ⚠ " + k + "：" + s.t + " 沒有可點的網址"); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.as || "")) { undated++; console.log("  ⚠ " + k + "：" + s.t + " 的查核日期格式不對"); }
  }
}
is(bare, 0, "沒有網址的來源");
is(undated, 0, "日期格式不對的來源");
is(srcArrays.length, 11, "有來源清單的區塊數");

/* ⚠️ public/README.md 裡有一張「哪個區塊幾筆來源、幾筆待核」的表，原本是手打的。
   於是 `/english` 上線之後，`eng` 那一整列**從來沒有被加進去**，合計也就一直短報 8 筆
   ——而少的是最新那一區，看起來反而最像「這區還沒有來源」。
   上面那三條 `is()` 守的是每一筆來源的欄位品質，守不到「表上少一列」。
   這裡把每區的數字印成機器讀得到的形狀，交給 counts.js 去跟 README 對帳。 */
for (const k of srcArrays) {
  const s = DATA[k].src;
  console.log("  來源明細 " + k + " " + s.length + " " + s.filter(x => x.v === false).length);
}

/* ============ 6. 分享圖上的符號要跟著卡片走 ============ */

/* draw() 原本寫死 `g.fillText("✕", …)`，於是三張卡的每一條前面都是叉。
   對前兩張是對的（那兩張列的就是不該發生的事），對「出門前」那張是反過來的
   ——那張的第一條正是這個站叫你照抄去傳的句子，卻被打了一個叉。
   分享圖是這個站唯一會被存下來、轉進別的群組的東西，錯的符號會跟著跑。
   canvas 畫出來的東西這裡驗不到（沒有瀏覽器），所以退一步守兩件**看得到**的事：
   每張卡都自己宣告 mark，而且 draw() 不准再有寫死的符號。 */
console.log("\n— 分享圖符號 —");
{
  const noMark = DATA.cards.filter(c => !c.mark).map(c => c.id);
  noMark.length === 0
    ? ok("三張卡都自己宣告了 mark：" + DATA.cards.map(c => c.tab + " " + c.mark).join("、"))
    : bad("這些卡沒有 mark，會畫不出符號：" + noMark.join("、"));
  /* 「照著做」的卡不能跟「看到就停手」的卡用同一個符號，否則這一整條等於沒改。 */
  const ask = DATA.cards.find(c => c.id === "ask");
  ask && ask.mark !== "✕"
    ? ok("「出門前」那張不是叉（它列的是要照著做的事）")
    : bad("「出門前」那張又變回叉了——它的第一條是叫人照抄去傳的句子");
  /* 寫死的符號會讓上面兩條變成裝飾品：資料改了、畫面不動。
     只看逐條那個迴圈裡面——底下那行「西澳打工度假查核工具 · 」是版面固定的
     頁尾署名，本來就該寫死，連它一起擋等於逼人把常數搬進資料裡。 */
  const loop = (HTML.match(/card\.items\.forEach\(t=>\{[\s\S]*?\n {4}\}\);/) || [""])[0];
  if (!loop) bad("找不到 draw() 逐條那個迴圈——這一條沒在對任何東西");
  else {
    const hard = [...loop.matchAll(/fillText\(\s*"([^"]+)"/g)].map(m => m[1]);
    hard.length === 0
      ? ok("逐條迴圈裡沒有寫死的符號（走 card.mark）")
      : bad("逐條迴圈裡還有寫死的 fillText 字串：" + hard.join("、"));
  }
}

/* ============ 7. 散文裡的數字要跟資料對得上 ============ */

/* 這個站有一整類內容是**只有散文、沒有計算機**的：集簽怎麼算、兩套勞資系統、
   被解僱之後的時效。它們一直沒有任何斷言守著——因為沒有 checkRate() 那種
   函式可以餵輸入，golden 也只印會動的面板。於是「散文自己抄了一份數字」
   這件事完全沒人管：`days.second` 改成 90，howdays 第一條照樣印 88。

   這一節不假裝在驗事實（那要去看官方頁），只驗**同一個數字在這份檔案裡
   只准有一個真相**，以及**修過的坑不准長回來**。 */
console.log("\n— 散文與資料對帳 —");
{
  const R = DATA.regional, W = DATA.wage;

  /* (a) 集簽天數：資料一份、散文一份，兩份要一致 */
  const h0 = R.howdays[0];
  h0.includes(String(R.days.second)) && h0.includes(String(R.days.third))
    ? ok("howdays 第一條印的天數就是 days 裡的（" + R.days.second + "／" + R.days.third + "）")
    : bad("howdays 第一條跟 days 對不上：資料是 " + R.days.second + "／" + R.days.third);

  /* (b) 88 天有**兩個**條件，這一區只講過其中一個，而且標題主動否認了另一個
        （原文是「算的是日曆日，不是你上了幾天班」）。照那句話做的人會以為
        待滿三個月就好——官方頁面自己舉的例子正是「期間跨滿、薪水合法、仍然不通過」。
        所以這裡守的不是字面，是那個條件有沒有還在畫面上。 */
  const regBlock = HTML.slice(HTML.indexOf('<div class="flags rule">'), HTML.indexOf('id="regdays"'));
  /不是你上了幾天班/.test(regBlock)
    ? bad("集簽標題又寫回「不是你上了幾天班」——那句話否認了官方兩個條件裡的第二個")
    : ok("集簽標題沒有否認「等同全職天數」那個條件");
  R.howdays.some(x => x.includes("等同全職"))
    ? ok("howdays 裡還留著「等同全職員工天數」這個條件")
    : bad("howdays 裡找不到「等同全職」——只講日曆日會讓人以為待滿三個月就算集滿");

  /* (c) 州系統 award-free 年齡表：21 個數字是人工抄的，抄錯一格看不出來。
        週薪 ÷ 38 要等於時薪、時薪 ×1.25 要等於 casual，各留 1 分錢的容差
        （官方是逐格四捨五入，不是連乘）。單一數字打錯一位，一定超過容差。 */
  const ageCell = W.sys.items.map(x => x.v).find(v => v.includes("award free"));
  if (!ageCell) bad("找不到州系統 award-free 那張年齡表");
  else {
    const rows = [...ageCell.matchAll(/\$([\d.]+)／\$([\d.]+)／\$([\d.]+)/g)]
      .map(m => m.slice(1).map(Number));
    is(rows.length, 7, "年齡表的列數");
    const off = rows.filter(([w, hr, cas]) =>
      Math.abs(w / 38 - hr) > 0.01 || Math.abs(hr * 1.25 - cas) > 0.01);
    off.length === 0
      ? ok("年齡表每一列都自洽（週薪÷38＝時薪、時薪×1.25＝casual）")
      : bad("年齡表有 " + off.length + " 列對不上：" + off.map(r => "$" + r.join("／$")).join("、"));
    /* 成人那一列同時住在 items[1] 與這張表裡，兩邊不准漂移 */
    const adult = W.sys.items.map(x => x.v).find(v => v.includes("獨資（sole trader）"));
    adult && rows[0].every(n => adult.includes(String(n.toFixed(2))))
      ? ok("成人那一列在兩張卡上是同一組數字")
      : bad("成人費率在「獨資→州系統」那張卡跟年齡表上不一致");
  }

  /* (d) 「打 Wageline 就知道」不能無條件成立：官方明講非營利／立案協會這一格
        沒有決定性規則，連 Wageline 都不提供意見。少了這個例外，這個面板會
        叫人去打一支不會給答案的電話。 */
  const how = W.sys.items.map(x => x.v).find(v => v.includes("Wageline on 1300 655 266"));
  how && /Wageline\s*明言不提供意見|Wageline\s*都無法/.test(how)
    ? ok("「怎麼判斷」有帶上非營利那個例外")
    : bad("「怎麼判斷」把 Wageline 講成萬用解——官方說非營利這一格它不給意見");

  /* (e) 被解僱的時效。這是這個區塊唯一**過了就沒了**的東西，
        而它旁邊那句「先打去問問看不叫檢舉」對還沒被解僱的人是對的、
        對已經被解僱的人是把時鐘吃掉。兩者的先後順序要守住。 */
  const clock = W.report.items.map(x => x.v).find(v => v.includes("s.394(2)"));
  clock && clock.includes("21 天") && clock.includes("28 天")
    ? ok("時效那張卡同時給了全國 21 天與州系統 28 天")
    : bad("時效那張卡缺了 21 天或 28 天——只給一個等於叫人押錯機關");
  /^<b>已經被解僱/.test(W.report.note)
    ? ok("檢舉區的結語先講時鐘，才講「可以先問問看」")
    : bad("檢舉區的結語又把「先問問看」放到最前面——被解僱的人讀到的第一句話不該是慢慢來");
}

console.log("\n" + (fail === 0 ? "全數通過" : "有失敗") + "：" + pass + " 過 / " + fail + " 失敗");
process.exit(fail === 0 ? 0 : 1);
