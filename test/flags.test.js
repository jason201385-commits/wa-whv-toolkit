#!/usr/bin/env node
/* 旗標對帳：DATA 裡每一筆「待核」都要真的印得出來。
 *
 * 為什麼需要這支測試——這個站的可信度全押在一件事上：沒有標「待核」的數字
 * 就是有官方頁面撐著的。所以最糟的 bug 不是印錯字，是**旗標黑洞**：
 * 資料裡標了 v:false，渲染器卻沒吃那個欄位，畫面把未查證的東西呈現成已查證。
 * index.html 的換匯合法路徑那一段就留著這個教訓的註解（「少了這一行，
 * 這一區就是旗標黑洞——比不標更糟」）。那是修過的，這支測試是不讓它再發生。
 *
 * 順便釘死一個一直被數錯的數字。用 grep 數 `v:false` 會得到 25，
 * 但其中 4 次出現在**註解裡**（第 857、1189、1344、2088 行在解釋這個機制），
 * 真正的資料筆數是 21。稽核 DOM 時該對的是這支測試算出來的數，不是 grep。
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
is(flagged.filter(f => f.kind === "v:false").length, 21, "DATA 裡的 v:false 筆數");
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
is(flagged.length, 22, "DATA 裡帶旗標的總筆數（＝畫面該有的徽章數上限）");

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

console.log("\n" + (fail === 0 ? "全數通過" : "有失敗") + "：" + pass + " 過 / " + fail + " 失敗");
process.exit(fail === 0 ? 0 : 1);
