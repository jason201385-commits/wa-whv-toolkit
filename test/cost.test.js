#!/usr/bin/env node
/* 生活成本試算的回歸測試。
 *
 * 為什麼這一段也要測（跟 wage.test.js 同一個理由的延伸）：
 * checkCost() 會對使用者說出三種會影響他行為的話——
 *   (a)「你的雇主沒登記，所以你每週被多扣 $XXX」→ 有人會拿這句去找雇主對質
 *   (b)「你的房租超過 housing stress 的官方判準」→ 有人會拿這句去決定要不要搬
 *   (c)「存到目標要 N 週」→ 有人會拿這個數字決定要不要留下來
 * 這三句只要有一句算錯，代價都是實際的金錢與時間，不是版面問題。
 *
 * 另外它是全站第二個會做浮點數運算的地方。wage.test.js 的成因（32.8375 被判成
 * 低於 32.84、然後印出「每小時少了 $0.00，這仍然違法」）在這裡會以另一種形式重演：
 * 每週結餘算出 -0.004 就會印成「短少 $0.00，這個組合是負的」。所以邊界要測。
 *
 * 跑法：node test/cost.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

/* 與 wage.test.js 同一套大括號配對切法。刻意複製而不共用：
   測試檔互相 require 之後，改壞一支會讓兩支一起停擺。 */
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

const SRC = [
  slice("const DATA = {"),
  slice("function whmTaxCents("),
  slice("function residentTaxCents("),
  slice("function medicareLevyCents("),
  slice("function checkCost("),
  slice("function comparePrice("),
].join(";\n");

const fields = {};
const boxes = {
  "#costans": { hidden: true, className: "", innerHTML: "" },
  "#uans":    { hidden: true, className: "", innerHTML: "" },
};
let clip = null;
const sandbox = {
  isFinite, parseFloat, Math, Number, String, console,
  $: (sel) => boxes[sel] || fields[sel] || { value: "" },
  copyRow: (_box, text) => { clip = text; },
};
vm.createContext(sandbox);
vm.runInContext(
  SRC + ";\nglobalThis.DATA = DATA; globalThis.whmTaxCents = whmTaxCents;" +
  "globalThis.residentTaxCents = residentTaxCents; globalThis.medicareLevyCents = medicareLevyCents;" +
  "globalThis.checkCost = checkCost; globalThis.comparePrice = comparePrice;",
  sandbox
);

const C = sandbox.DATA.cost;

/* 預設值刻意跟畫面上的 <select> 第一個選項一致：
   ctax=unknown、cbills=inc、ctrans=walk。填了別的才代表使用者主動選過。
   o.reg 這個鍵名沿用舊的（它現在餵的是稅表模式，多了 resident 這個值）——
   改鍵名要動 7 個呼叫點，而那 7 行本身沒有變髒。 */
function runCost(o) {
  const set = (k, v) => { fields[k] = { value: v == null ? "" : String(v) }; };
  set("#crate", o.rate); set("#chours", o.hours);
  set("#ctax", o.reg || "unknown");
  set("#crent", o.rent); set("#cbills", o.bills || "inc");
  set("#ctrans", o.trans || "walk"); set("#ccar", o.car);
  set("#cfood", o.food); set("#cgoal", o.goal);
  const box = boxes["#costans"];
  box.className = ""; box.innerHTML = ""; box.hidden = true; clip = null;
  sandbox.checkCost();
  return {
    tone: box.className.replace("ans ", "").trim(),
    verdict: (box.innerHTML.match(/<div class="verdict">([\s\S]*?)<\/div>/) || [, ""])[1],
    html: box.innerHTML,
    hidden: box.hidden,
    clip,
  };
}

function runUnit(o) {
  const set = (k, v) => { fields[k] = { value: v == null ? "" : String(v) }; };
  set("#ua", o.pa); set("#uaq", o.qa); set("#ub", o.pb); set("#ubq", o.qb);
  set("#uunit", o.unit || "g");
  const box = boxes["#uans"];
  box.className = ""; box.innerHTML = "";
  sandbox.comparePrice();
  return {
    tone: box.className.replace("ans ", "").trim(),
    verdict: (box.innerHTML.match(/<div class="verdict">([\s\S]*?)<\/div>/) || [, ""])[1],
    html: box.innerHTML,
  };
}

/* 從畫面／剪貼簿讀回來的金額一律先換成「分」再比，不要用浮點容差。
   站上所有算術都跑在整數分上，畫面印的是 `分 / 100` 再 toFixed(2)，
   所以讀回來換成分之後本來就該完全相等——需要容差就代表哪裡漏了一次捨入。
   ⚠️ 容差還會反過來咬人：0.011 這種寫法**比一分錢大**，
   而「差一分」正是捨入寫錯時的典型長相，等於斷言對它要抓的錯誤是瞎的。 */
const cents = n => Math.round(n * 100);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + (extra ? "\n    " + extra : "")); }
}
function t(name, o, expect) {
  const r = runCost(o);
  const problems = [];
  if (expect.tone && r.tone !== expect.tone) problems.push(`色調應為 ${expect.tone}，實得 ${r.tone}`);
  if (expect.verdictHas) for (const s of [].concat(expect.verdictHas))
    if (!r.verdict.includes(s)) problems.push(`判定應含「${s}」，實得「${r.verdict}」`);
  if (expect.htmlHas) for (const s of [].concat(expect.htmlHas))
    if (!r.html.includes(s)) problems.push(`內文應含「${s}」`);
  if (expect.htmlLacks) for (const s of [].concat(expect.htmlLacks))
    if (r.html.includes(s)) problems.push(`內文不該含「${s}」`);
  if (problems.length) { fail++; console.log(`✗ ${name}\n    ` + problems.join("\n    ")); }
  else { pass++; console.log(`✓ ${name}`); }
}

/* ------------------------------------------------ 稅：對得上 ATO 公布的級距 */
console.log("\n— WHM 稅級距（ATO 2025–26）—");
const c = x => Math.round(x * 100);
ok("$45,000 整（有登記）＝ $6,750",
  sandbox.whmTaxCents(c(45000), true) === c(6750),
  "實得 " + sandbox.whmTaxCents(c(45000), true) / 100);
ok("$45,000 以下一律 15%，沒有免稅額",
  sandbox.whmTaxCents(c(10000), true) === c(1500),
  "實得 " + sandbox.whmTaxCents(c(10000), true) / 100);
ok("$1 也要繳（沒有 tax-free threshold）",
  sandbox.whmTaxCents(c(1), true) === 15);
ok("跨到第二級距：$50,000 ＝ 6750 + 5000×30% ＝ $8,250",
  sandbox.whmTaxCents(c(50000), true) === c(8250),
  "實得 " + sandbox.whmTaxCents(c(50000), true) / 100);
ok("$135,000 整 ＝ $33,750",
  sandbox.whmTaxCents(c(135000), true) === c(33750),
  "實得 " + sandbox.whmTaxCents(c(135000), true) / 100);
ok("雇主沒登記：外國居民稅率 30% 起，$45,000 → $13,500",
  sandbox.whmTaxCents(c(45000), false) === c(13500),
  "實得 " + sandbox.whmTaxCents(c(45000), false) / 100);
ok("沒登記一定比有登記扣得多（$20,000 年收）",
  sandbox.whmTaxCents(c(20000), false) > sandbox.whmTaxCents(c(20000), true));
ok("稅永遠不超過收入本身",
  [1, 1000, 45000, 46000, 135000, 200000].every(
    y => sandbox.whmTaxCents(c(y), true) <= c(y) && sandbox.whmTaxCents(c(y), false) <= c(y)));

/* ---------------------------------------------------------------------------
   第三、四級距。這一段是 2026-08-16 的回歸測試，成因寫在下面，不要刪。

   舊的 whmTaxCents() 兩條 return 都以 `+ Math.max(0, annualCents - b2)` 結尾——
   超過 $135,000 的部分被「原封不動加進稅裡」，也就是**邊際稅率 100%**。
   時薪 $40 × 每週 70 小時（護欄是 80，所以進得來）年化 $145,600：
   站上算 $44,350，ATO 是 $33,750 + $10,600×0.37 = $37,672，一年多扣 $6,678。

   上面那條「稅永遠不超過收入本身」的斷言涵蓋了 y=200000，**而且是綠的**——
   $98,750 ≤ $200,000 成立。斷言蓋到了出錯的區間卻沒有鑑別力，比沒有更糟：
   它讓人以為那一段測過了。所以這裡改測邊際稅率，不測「小於收入」。
   --------------------------------------------------------------------------- */
console.log("\n— 第三、四級距與邊際稅率（回歸：曾經是 100%）—");
const TOP = C.tax.r4;
for (const reg of [true, false]) {
  const label = reg ? "有登記" : "沒登記";
  let worst = 0, worstAt = 0;
  for (let y = 1000; y <= 260000; y += 1000) {
    const mr = (sandbox.whmTaxCents(c(y + 1000), reg) - sandbox.whmTaxCents(c(y), reg)) / c(1000);
    if (mr > worst) { worst = mr; worstAt = y; }
  }
  ok(`${label}：邊際稅率全程不超過法定最高 ${TOP * 100}%`,
    worst <= TOP + 1e-9, `最高 ${(worst * 100).toFixed(1)}% 出現在 $${worstAt.toLocaleString()}`);
  ok(`${label}：稅額單調遞增，不會多賺反而多拿`,
    [46000, 135000, 136000, 190000, 191000, 250000].every(
      y => sandbox.whmTaxCents(c(y), reg) > sandbox.whmTaxCents(c(y - 1000), reg)));
}
/* 級距端點的累計金額直接抄 ATO 表，不是從程式推回來的。 */
for (const [y, want] of [[135000, 33750], [145600, 37672], [190000, 54100], [200000, 58600]]) {
  ok(`有登記 $${y.toLocaleString()} → $${want.toLocaleString()}（ATO 2025–26）`,
    sandbox.whmTaxCents(c(y), true) === c(want),
    "實得 " + sandbox.whmTaxCents(c(y), true) / 100);
}
for (const [y, want] of [[135000, 40500], [190000, 60850], [200000, 65350]]) {
  ok(`沒登記 $${y.toLocaleString()} → $${want.toLocaleString()}（外國居民表）`,
    sandbox.whmTaxCents(c(y), false) === c(want),
    "實得 " + sandbox.whmTaxCents(c(y), false) / 100);
}
ok("沒登記在任何收入下都不會比有登記划算",
  [1, 45000, 135000, 145600, 190000, 250000].every(
    y => sandbox.whmTaxCents(c(y), false) >= sandbox.whmTaxCents(c(y), true)));

/* ---------------------------------------------------------------------------
   居民稅表（2026–27）與 Medicare levy。

   為什麼這一段要單獨測：離開打工度假簽之後，稅是**整個換一張表**算的，
   而中文社群普遍把「稅務居民」跟「拿到 PR」當同一件事。這兩件事在 ATO 是分開的，
   誤判的代價是整年的預扣稅算錯。
   免稅額那一格（$18,200）是兩張表差最多的地方，年收 $20,800 的人
   在 WHM 表要繳 $3,120，在居民表只要 $390。
   --------------------------------------------------------------------------- */
console.log("\n— 居民稅表（ATO 2026–27）—");
const R = C.tax.res;
ok("免稅額整數點（$18,200）→ $0",
  sandbox.residentTaxCents(c(R.free)) === 0,
  "實得 " + sandbox.residentTaxCents(c(R.free)) / 100);
ok("免稅額以下一毛都不用繳——這是跟 WHM 表最大的差別",
  sandbox.residentTaxCents(c(10000)) === 0 && sandbox.whmTaxCents(c(10000), true) === c(1500));
ok("超過免稅額 $1 → 15 分（不是從第一元起算）",
  sandbox.residentTaxCents(c(18201)) === 15,
  "實得 " + sandbox.residentTaxCents(c(18201)));
/* 端點金額直接抄 ATO 表，不是從程式推回來的。 */
for (const [y, want] of [[45000, 4020], [50000, 5520], [135000, 31020],
                         [190000, 51370], [200000, 55870]]) {
  ok(`居民 $${y.toLocaleString()} → $${want.toLocaleString()}（ATO 2026–27）`,
    sandbox.residentTaxCents(c(y)) === c(want),
    "實得 " + sandbox.residentTaxCents(c(y)) / 100);
}
ok("居民表的邊際稅率全程不超過 45%", (() => {
  let worst = 0;
  for (let y = 1000; y <= 260000; y += 1000)
    worst = Math.max(worst, (sandbox.residentTaxCents(c(y + 1000)) - sandbox.residentTaxCents(c(y))) / c(1000));
  return worst <= C.tax.r4 + 1e-9;
})());
ok("居民表的所得稅在任何收入下都不會高於 WHM 表",
  [1, 18200, 20000, 45000, 135000, 190000, 250000].every(
    y => sandbox.residentTaxCents(c(y)) <= sandbox.whmTaxCents(c(y), true)));

console.log("\n— Medicare levy 的三段（低收入門檻）—");
const LV = C.tax.levy;
ok("下門檻（$28,011）以下不課",
  sandbox.medicareLevyCents(c(LV.lo)) === 0 && sandbox.medicareLevyCents(c(20000)) === 0);
/* 這一條是整段的錨：ATO 自己的示範案例就寫著 $29,000 的人繳 $98.90。
   如果哪天這個數字對不上，代表門檻或 10% 那個係數變了，兩個都要回去查頁面。 */
ok("ATO 示範案例：年收 $29,000 → levy 恰為 $98.90",
  sandbox.medicareLevyCents(c(29000)) === c(98.90),
  "實得 " + sandbox.medicareLevyCents(c(29000)) / 100);
ok("剛超過下門檻 $1 → 只課 10 分，不是 2%",
  sandbox.medicareLevyCents(c(28012)) === 10,
  "實得 " + sandbox.medicareLevyCents(c(28012)));
ok("上門檻（$35,013）→ $700.20（分段公式，不是 2%）",
  sandbox.medicareLevyCents(c(LV.hi)) === c(700.20),
  "實得 " + sandbox.medicareLevyCents(c(LV.hi)) / 100);
ok("超過上門檻就是全額 2%",
  sandbox.medicareLevyCents(c(35014)) === c(700.28) &&
  sandbox.medicareLevyCents(c(70000)) === c(1400));
ok("levy 單調遞增",
  [29000, 30000, 35013, 35014, 40000, 100000].every(
    (y, i, a) => i === 0 || sandbox.medicareLevyCents(c(y)) > sandbox.medicareLevyCents(c(a[i - 1]))));
ok("上門檻就是下門檻除以 0.8 取整——兩個數字不是各自獨立的，改一個就要改另一個",
  Math.floor(LV.lo / (1 - 2 * LV.phase + LV.phase)) === LV.hi || Math.floor(LV.lo / 0.8) === LV.hi,
  `lo=${LV.lo} hi=${LV.hi}`);
ok("居民稅表的三個累計基底彼此推得出來",
  Math.round((R.b1 - R.free) * R.r1) === R.base2 &&
  Math.round(R.base2 + (R.b2 - R.b1) * R.r2) === R.base3 &&
  Math.round(R.base3 + (R.b3 - R.b2) * R.r3) === R.base4);

console.log("\n— 居民模式從畫面走一遍 —");
/* 年收 $69,160（$35 × 38 小時）：落在全額 2% 那一段，換簽之後是省錢的。 */
t("居民模式要講免稅額，不能沿用「沒有免稅額」那句 WHM 文案",
  { rate: 35, hours: 38, reg: "resident" },
  { htmlHas: ["免稅", "Medicare levy"], htmlLacks: ["沒有免稅額", "一律 15%"] });
t("全額 2% 這一段要能算出 MES 免掉的年金額",
  { rate: 35, hours: 38, reg: "resident" },
  { htmlHas: ["Medicare Entitlement Statement", "8 週", "7 月 1 日", "有機會整筆免掉"] });
t("要把「這一天起 2% 開始繳」接回 /settle",
  { rate: 35, hours: 38, reg: "resident" }, { htmlHas: 'href="#settle"' });
t("要說明兩張表的公布年度不同，不要假裝在比同一年",
  { rate: 35, hours: 38, reg: "resident" },
  { htmlHas: [C.tax.whmYear, C.tax.res.year] });
t("換簽省錢時要寫「少繳」", { rate: 35, hours: 38, reg: "resident" },
  { htmlHas: "少繳", htmlLacks: "多繳" });
/* 年收 $156,000（$40 × 75 小時）：$135,000 以上居民表加上 levy 反而比 WHM 貴。
   這個方向真的存在，文案不准寫死「換簽一定比較省」。 */
t("高收入時居民＋levy 反而較貴，要寫「多繳」",
  { rate: 40, hours: 75, reg: "resident" }, { htmlHas: "多繳", htmlLacks: "少繳" });
/* 年收 $20,800（$20 × 20 小時）：在下門檻以下，levy 是 0。
   這時候還跳出「有機會整筆免掉」等於叫人去申請一份他根本不需要的文件。 */
t("levy 是 0 的時候不要叫人去辦 MES",
  { rate: 20, hours: 20, reg: "resident" },
  { htmlHas: ["Medicare levy", "本來就不課"], htmlLacks: ["有機會整筆免掉", "Medicare Entitlement Statement"] });
/* 年收 $32,500（$25 × 25 小時）：落在兩個門檻之間，只課超出部分的 10%。 */
t("中間段要講「超過下門檻部分的 10%」，不是 2%",
  { rate: 25, hours: 25, reg: "resident" },
  { htmlHas: "超過下門檻部分的 10%" });
/* DASP 的稅率不看稅表，看簽證——這一段在加居民模式時漏了分支，
   結果對「已經不是打工度假簽」的人印出 65%，而且跟 /settle 釘住的
   「拿到 PR 那一刻 DASP 資格永久消失」直接矛盾。兩個方向都要釘。 */
t("居民模式不得沿用打工度假的 65% DASP",
  { rate: 35, hours: 38, reg: "resident" },
  { htmlHas: ["taxed element", "35%", "永久消失"],
    htmlLacks: "打工度假者的 DASP 稅率是 65%" });
t("居民模式要把 PR 之後領不到那件事接回 /settle",
  { rate: 35, hours: 38, reg: "resident" },
  { htmlHas: ["拿到 PR 的那一刻", 'href="#settle"'] });
t("WHM 模式仍然要保留 65% 那句，不要被居民分支洗掉",
  { rate: 35, hours: 38, reg: "reg" },
  { htmlHas: "打工度假者的 DASP 稅率是 65%", htmlLacks: "taxed element" });

/* 這裡不能用「免稅」兩個字當反向斷言——WHM 那支的文案是「沒有免稅額」，
   本來就含這兩個字。要挑真的只屬於居民表的字串。 */
t("WHM 三種選項都不該出現居民表的字眼",
  { rate: 35, hours: 38, reg: "reg" },
  { htmlHas: "沒有免稅額", htmlLacks: ["Medicare levy", "居民稅表前"] });

/* 這個站不做身分判定，但必須把判準與「這不是看有沒有 PR」講出來，
   否則使用者只會照自己的直覺選，而直覺在這一題上是錯的。 */
ok("畫面要點破「稅務居民 ≠ 有 PR」並附四個法定測試的名字",
  HTML.includes("We don't use the same rules as the Department of Home Affairs") &&
  HTML.includes("183 天") && HTML.includes("本站<b>不替你判定</b>"));
ok("畫面要擋住還在打工度假簽的台灣人去選居民表（台灣不在 NDA 名單）",
  HTML.includes("還在打工度假簽的台灣人不要選它") && HTML.includes("台灣不在名單上"));

/* 從 UI 進得去的那一格：護欄放行 80 小時，所以高時薪一定會跨到第三級距。 */
(function () {
  const r = runCost({ rate: 40, hours: 70, reg: "reg" });
  const want = (Math.round(c(37672) / 52) / 100).toFixed(2);   /* $724.46／週 */
  ok("$40×70h 走 UI 進來，預扣稅要對得上第三級距（$" + want + "／週）",
    r.html.includes(want),
    "畫面上找不到 " + want + "；判定「" + r.verdict + "」");
  ok("$40×70h 的預扣比例不得再被印成 15%", !r.clip.includes("WHM 15%"), r.clip.split("\n")[1]);
})();

/* -------------------------------------------------- 低於法定最低的時薪 */
/* /cost 的問題是「這樣過不過得下去」，/wage 的問題是「這樣合不合法」。
   兩者混起來會出事的方向只有一個：算得出結餘就蓋 ✅，
   於是一個被開 $18 的人拿到綠燈，還把綠燈貼進 LINE 群。
   所以這一段釘的不是判定，是**不准給乾淨的 ✅、而且要把人送去 /wage**。 */
console.log("\n— 低於法定最低的時薪不得配 ✅ —");
(function () {
  const nmw = sandbox.DATA.wage.nmw, cas = sandbox.DATA.wage.casualMin;
  ok("前提：casual 最低高於全國最低（下面兩段的分界靠這個）", cas > nmw, `nmw ${nmw} / casual ${cas}`);

  const low = runCost({ rate: 18, hours: 38, reg: "reg" });
  ok("低於全國最低 → 色調降成 warn", low.tone === "warn", `實得 ${low.tone}`);
  ok("低於全國最低 → 標題不得留 ✅", !low.verdict.includes("✅"), low.verdict);
  ok("低於全國最低 → 標題要指名是哪一條線", low.verdict.includes("全國最低"), low.verdict);
  ok("低於全國最低 → 要送去 /wage，而不是自己判合不合法",
    low.html.includes('href="#wage"') && !low.html.includes("違法"),
    (low.html.match(/合不合法[^<]*/) || [""])[0]);
  ok("低於全國最低 → 要講明「算的是過不過得下去，不是合不合法」",
    low.html.includes("不是「這樣合不合法」"));
  ok("低於全國最低 → 要提 junior rate（未滿 21 歲那條例外）",
    low.html.includes("junior rate"));

  /* 剪貼簿是唯一會被別人看到的那一份。它跟畫面各走各的組裝路徑，
     2026-08-17 就是在這裡各自寫死而分岔的，所以兩份都要釘。 */
  ok("低於全國最低 → 剪貼簿也不得留 ✅", !low.clip.includes("✅"), low.clip.split("\n")[0]);
  ok("低於全國最低 → 剪貼簿要帶上同一條線", low.clip.includes("全國最低"), low.clip.split("\n")[0]);

  /* nmw 與 casualMin 之間：casual 就是短給，part/full-time 未必。
     這一段的文案不可以講成違法，否則就是這個站自己在造謠。 */
  const mid = runCost({ rate: 27, hours: 38, reg: "reg" });
  ok("介於全國最低與 casual 最低之間 → 仍降成 warn", mid.tone === "warn", `實得 ${mid.tone}`);
  ok("介於兩條線之間 → 要指名 casual 最低，不得誤報成全國最低",
    mid.verdict.includes("casual 最低") && !mid.verdict.includes("全國最低"), mid.verdict);
  ok("介於兩條線之間 → 不得斷言違法", !mid.html.includes("違法") && !mid.html.includes("非法"));

  /* 合法時薪不可以被這條新規則波及——過度警告會讓警告失去意義。 */
  const okRate = runCost({ rate: 34, hours: 38, reg: "reg" });
  ok("時薪高於 casual 最低 → 不掛任何低薪附註",
    okRate.tone === "ok" && !okRate.verdict.includes("時薪低於")
      && !okRate.clip.includes("時薪低於"), okRate.verdict);

  /* 兩條附註可能同時成立。各自包一組括號會印成「（…）（…）」，
     所以數的是括號組數而不是有沒有出現括號——後者兩種寫法都會過。 */
  const both = runCost({ rate: 30, hours: 38, reg: "unknown" });
  ok("附註同時成立時併在同一組括號裡（只准有一組）",
    (both.verdict.match(/（/g) || []).length === 1, both.verdict);
  ok("附註同時成立時兩條都要在",
    both.verdict.includes("雇主有登記") && both.verdict.includes("casual 最低"), both.verdict);
})();

/* ---------------------------------------------------------------- 輸入護欄 */
console.log("\n— 護欄：算不出來就不要硬算 —");
t("沒填時薪不判定", { hours: 38 }, { tone: "warn", verdictHas: "請先填時薪" });
t("沒填工時不判定", { rate: 33 }, { tone: "warn", verdictHas: "請先填時薪" });
t("時薪 0 不判定", { rate: 0, hours: 38 }, { tone: "warn", verdictHas: "請先填時薪" });
t("每週 100 小時 → 先要求確認，不直接算",
  { rate: 30, hours: 100 }, { tone: "warn", verdictHas: "先確認" });
t("每週 80 小時（邊界內）照算", { rate: 34, hours: 80 }, { tone: "ok" });
ok("結果框一定會顯示出來", runCost({ rate: 33, hours: 38 }).hidden === false);

/* 工時有上界、時薪沒有——多打一個 0 會安靜地算出一整頁看起來完全正常的數字，
   而使用者不會懷疑一個「有算出答案」的畫面。上界取全國最低的 10 倍，
   它是打字錯誤的啟發式，不是「時薪不可能超過這個數」的宣稱。 */
(function () {
  const cap = Math.round(sandbox.DATA.wage.nmw * 10);
  const over = runCost({ rate: cap + 1, hours: 38 });
  ok("時薪超過上界 → 先要求確認，不直接算",
    over.tone === "warn" && over.verdict.includes("先確認"), over.verdict);
  ok("時薪超過上界 → 不得產生剪貼簿（那一份會被貼進群組）", over.clip === null);
  ok("時薪超過上界 → 門檻要跟著 DATA.wage.nmw 走，不是寫死的數字",
    over.verdict.includes("$" + cap), over.verdict);
  ok("剛好等於上界 → 照算", runCost({ rate: cap, hours: 38 }).tone === "ok");
})();

/* 時薪與工時各自都過得了護欄，乘起來仍然可以進位到 0——而 grossW 是後面
   每一個百分比的分母。分母是 0 的時候 pct() 一律回 0，於是
   「房租佔稅前收入 0%」會配上「你在線上」，整頁的判定建立在一個等於零的分母上。 */
(function () {
  const r = runCost({ rate: 0.001, hours: 1 });
  ok("週薪進位到 0 → 擋下來，不讓後面的比例除以零",
    r.tone === "warn" && r.verdict.includes("$0.00"), r.verdict);
  ok("週薪進位到 0 → 不產生剪貼簿", r.clip === null);
  ok("週薪進位到 0 → 不得印出任何百分比判定",
    !r.html.includes("housing stress") && !r.html.includes("稅後週薪"), r.html.slice(0, 120));
  /* 上界那條是「打字錯誤的啟發式」，這一條也是；但兩者擋的是相反方向，
     所以下緣要留一格證明它沒有連正常的低薪一起擋掉。 */
  ok("一分錢就算得下去（這道門只擋到 0，不是擋小額）",
    runCost({ rate: 0.01, hours: 1 }).tone !== "warn"
    || !runCost({ rate: 0.01, hours: 1 }).verdict.includes("$0.00"),
    runCost({ rate: 0.01, hours: 1 }).verdict);
})();

/* 負支出以前跟「沒填」走同一條路安靜歸零：填 -500 的人會看到
   「你沒有填任何支出」，然後拿到一個偏高、卻長得完全正常的結餘。
   算錯而看起來正常，比擋下來危險。

   標題只指名是哪一格（欄位名要出現在標題裡，使用者才知道回頭改哪一欄），
   「不能是負數」屬於理由，寫在下面的說明段——所以斷言也分兩層問。 */
(function () {
  for (const [label, o] of [
    ["房租", { rate: 34, hours: 38, rent: -100 }],
    ["伙食", { rate: 34, hours: 38, food: -50 }],
    ["油錢", { rate: 34, hours: 38, trans: "car", car: -30 }],
  ]) {
    const r = runCost(o);
    ok(`${label}填負數 → 擋下來並指名是哪一格`,
      r.tone === "warn" && r.verdict.includes(label)
      && r.verdict.includes("不是有效金額"), r.verdict);
    ok(`${label}填負數 → 說明段要講出為什麼（不能是負數）`, r.html.includes("負數"), r.html);
    ok(`${label}填負數 → 不得再說「你沒有填任何支出」`, !r.html.includes("沒有填任何支出"));
    ok(`${label}填負數 → 不產生剪貼簿`, r.clip === null);
  }

  /* 這一格是 2026-08-17 第二輪 QA 的紅旗 3：守門端問「是不是負數」、
     計算端問「是不是有限數」，同一個問題問兩次得到兩個答案。
     `-1e999` 的 parseFloat 是 -Infinity——守門說「不算負數」放行，
     amt() 說「不是有限數」歸零，於是房租憑空消失、結餘偏高、畫面全綠。
     這是全檔最危險的一種錯：安靜、看起來正常、而且要貼進群組。 */
  for (const [label, o] of [
    ["房租", { rate: 34, hours: 38, rent: -1e999 }],
    ["伙食", { rate: 34, hours: 38, food: 1e999 }],
    ["油錢", { rate: 34, hours: 38, trans: "car", car: -1e999 }],
  ]) {
    const r = runCost(o);
    ok(`${label}填 ±Infinity → 跟負數走同一條路擋下來`,
      r.tone === "warn" && r.verdict.includes(label)
      && r.verdict.includes("不是有效金額"), r.verdict);
    ok(`${label}填 ±Infinity → 不得安靜歸零算完一整頁`,
      r.clip === null && !r.html.includes("每週剩下"), r.html.slice(0, 120));
  }

  /* 0 是合法的（住家裡、公司包吃住），不能跟負數一起擋掉。 */
  const zero = runCost({ rate: 34, hours: 38, rent: 0, food: 0 });
  ok("支出填 0 照算，不當成無效輸入", zero.tone === "ok", zero.verdict);

  /* 沒選「開車」的時候，油錢那一格的舊值不該擋住整個計算。 */
  const stale = runCost({ rate: 34, hours: 38, trans: "walk", car: -30 });
  ok("沒選開車時，油錢欄的舊負值不擋計算", stale.tone === "ok", stale.verdict);
})();

/* ------------------------------------------ 有限但過大：換算之後才溢位的那一類 */
/* 上面那一組擋的是 ±Infinity——`isFinite()` 自己就看得出來。這一組是不同的失效形狀：
   **在一個單位上做的有效性檢查，管不到換算成另一個單位之後的事**。
   1e308 在「元」是有限的，`c()` 的 ×100 之後就是 Infinity；1.7e306 撐得過 ×100，
   撐不過 pct() 裡的 ×1000。兩者都會讓「$∞」與「Infinity%」同時出現在畫面**和剪貼簿**上，
   而 `type="number"` 攔不住——`1e308` 是合法的 HTML 浮點字面值。
   第三輪 QA 只指到 1e308 並說「1.7e306 是安全的」，那句話是錯的（×1000 那一段沒算進去）；
   下面 1.7e306 那一格就是釘住這件事的，別把它當成 1e308 的重複。 */
console.log("\n— 有限但過大：溢位發生在換算之後 —");
(function () {
  const weekCap = Math.round(sandbox.DATA.wage.nmw * 10) * 80;
  const goalCap = weekCap * C.tax.weeksPerYear;
  /* 不能對整段 html 做字串搜尋——擋下來的那個說明段**自己就引用了**「$∞」與
     「Infinity%」當例子，搜整段會搜到解釋文字，於是這道斷言永遠紅。
     要看的是**印出來的數字**：畫面上的金額一律包在 <span class="num"> 裡，
     週數是裸的整數（存錢那一段的「需要 N 週」），剪貼簿則整份是純文字。 */
  const infNum = h => (String(h || "").match(/<span class="num">[^<]*<\/span>/g) || [])
    .some(s => /∞|Infinity|NaN/.test(s)) || /(Infinity|NaN|∞)\s*(週|個月)/.test(String(h || ""));
  const inf = t => /∞|Infinity|NaN/.test(String(t || ""));

  for (const [label, key] of [["房租", "rent"], ["伙食", "food"]]) {
    for (const v of [1e308, 1.7e306, weekCap + 1]) {
      const o = { rate: 34, hours: 38 }; o[key] = v;
      const r = runCost(o);
      ok(`${label}填 ${v} → 擋下來並指名是哪一格`,
        r.tone === "warn" && r.verdict.includes(label) && r.verdict.includes("超過每週"),
        r.verdict);
      ok(`${label}填 ${v} → 畫面與剪貼簿都不得印出 $∞／Infinity`,
        !infNum(r.html) && r.clip === null, r.html.slice(0, 160));
    }
  }
  /* 油錢只有選了「開車」才進這道門——沒選就不該被那一格的舊值擋住。 */
  const carHuge = runCost({ rate: 34, hours: 38, trans: "car", car: 1e308 });
  ok("開車＋油錢 1e308 → 擋下來", carHuge.verdict.includes("油錢") && carHuge.verdict.includes("超過每週"),
    carHuge.verdict);
  ok("沒選開車時，油錢欄的 1e308 不擋計算",
    !runCost({ rate: 34, hours: 38, trans: "walk", car: 1e308 }).verdict.includes("超過每週"));

  /* 上界本身要照算——這道門是打字錯誤的啟發式，不是「房租不可能貴」的宣稱。 */
  const at = runCost({ rate: 34, hours: 38, rent: weekCap });
  ok("剛好等於週上界 → 照算，不擋", !at.html.includes("超過每週") && at.clip !== null, at.verdict);

  /* 門檻要從 DATA 推出來，不是寫死的數字：nmw 一改，這句話要跟著改。 */
  ok("週上界的門檻文字要跟著 DATA.wage.nmw 走",
    runCost({ rate: 34, hours: 38, rent: 1e308 }).html.includes("$" + weekCap.toLocaleString("en-AU") + ".00"),
    `期待 $${weekCap.toLocaleString("en-AU")}.00`);

  /* 存錢目標是選填欄，走的是「原地講清楚」不是 bail——上面每一個數字都還是對的。
     但它以前連 grade() 都沒走：填 -5000 或 1e308 的時候整段存錢**靜默消失**。 */
  for (const [what, v] of [["1e308", 1e308], ["負數", -5000], ["超過年上界", goalCap + 1]]) {
    const g = runCost({ rate: 34, hours: 38, rent: 200, goal: v });
    ok(`存錢目標填${what} → 原地說清楚，不是靜默消失`,
      g.html.includes("存錢目標那一格填的是"), g.html.slice(-200));
    ok(`存錢目標填${what} → 不得 bail 掉整頁（其他數字還是對的）`,
      g.tone === "ok" && g.clip !== null && g.html.includes("稅後週薪"), g.tone);
    ok(`存錢目標填${what} → 不得印出 $∞／Infinity`, !infNum(g.html) && !inf(g.clip), g.html.slice(-200));
  }
  const gAt = runCost({ rate: 34, hours: 38, rent: 200, goal: goalCap });
  ok("存錢目標剛好等於年上界 → 照算",
    !gAt.html.includes("存錢目標那一格填的是") && gAt.html.includes("存到"), gAt.html.slice(-200));
  ok("存錢目標的年上界要跟週上界差一個 weeksPerYear（不是另外發明的數字）",
    goalCap === weekCap * C.tax.weeksPerYear);
})();

/* ------------------------------------------------------------ 浮點數邊界 */
console.log("\n— 浮點數邊界（舊事故：印出「短少 $0.00」）—");
(function () {
  /* 刻意湊一組稅後剛好等於支出的輸入：先算稅後，再把它整個填成房租。
     時薪要在 casual 最低（$33.05）之上——$30 會另外掛一條「低於法定最低」的附註
     並把色調降成 warn，那條跟浮點數無關，混進來會讓下面分不出是誰造成的。
     金額要吃得下千分位：$1,034.21 用 [\d.]+ 抓只會抓到「1」。 */
  const probe = runCost({ rate: 34, hours: 38 });
  const net = probe.html.match(/稅後週薪<\/strong> <span class="num">\$([\d,.]+)</);
  if (!net) { fail++; console.log("✗ 抓不到稅後週薪，後面的邊界測試無法進行"); return; }
  const exact = parseFloat(net[1].replace(/,/g, ""));
  ok("前提：抓到的稅後週薪是四位數（否則千分位那一段沒被測到）", exact > 1000, String(exact));
  const r = runCost({ rate: 34, hours: 38, rent: exact });
  ok("支出剛好等於稅後收入 → 不得判成負的",
    r.tone !== "bad" && !r.html.includes("短少"),
    `實得色調 ${r.tone}／判定「${r.verdict}」`);
  ok("剛好打平時不得出現 $-0.00", !r.html.includes("-0.00") && !r.verdict.includes("-0.00"));
  const r2 = runCost({ rate: 34, hours: 38, rent: exact + 0.01 });
  ok("再多一分錢就要判負", r2.tone === "bad", `實得 ${r2.tone}`);
})();

/* -------------------------------------------------------- 房租 30/40 rule */
console.log("\n— 房租佔比：ABS／AIHW 的 30/40 rule —");
(function () {
  /* 稅前 $1,000／週：$300 剛好踩線，$301 越線。
     時薪要在 casual 最低（$33.05）之上——低於法定最低會另外掛一條附註並把色調降成 warn，
     那一條跟房租沒有關係，混進來會讓下面「剛好 30% 不判 stress」分不出是誰造成的。 */
  const opts = { rate: 40, hours: 25 };   /* 40 × 25 = 1000 */
  const at = runCost(Object.assign({}, opts, { rent: 1000 * C.stress }));
  ok("剛好 30% 不判 housing stress",
    at.tone === "ok" && !at.verdict.includes("吃掉"),
    `實得色調 ${at.tone}／判定「${at.verdict}」`);
  /* 這一格以前斷言的是「要說『配得上這份工作』」——那句話把它釘死在錯的行為上：
     判定用的是嚴格大於 30%，顯示的百分比卻四捨五入，所以剛好 30.0% 的人會同時
     看到「30%」與「低於 30%」。踩線這件事本身要講出來，不能拿一句安心話蓋過去。
     兩側都要測：這一格是「剛好還沒超過」，下面 387.65 那一組是「已經超過了」。 */
  ok("剛好 30% 不得說成「低於 30%」（顯示值就是 30.0）",
    !at.html.includes("低於 30%") && !at.html.includes("配得上"), at.html);
  ok("剛好 30% 要明說是踩在線上、而且是還沒超過的那一側",
    at.html.includes("剛好還沒超過") && !at.html.includes("已經超過了"), at.html);
  ok("剛好 30% 也要留著判準名稱（不能因為踩線就把出處吞掉）",
    at.html.includes("30/40 rule"), at.html);
  const over = runCost(Object.assign({}, opts, { rent: 1000 * C.stress + 1 }));
  ok("超過 30% 判 warn", over.tone === "warn", `實得 ${over.tone}`);
  ok("超過 30% 要給兩條可動的路（降房租／加工時）",
    over.html.includes("房租降到") && over.html.includes("每週工時提高到"));
  /* 這一格以前釘的是「房租上限＝稅前的 30%」（$300.00）。那個值**就是**踩線帶本身：
     照著改完顯示值還是 30.0%，而站上在踩線那一句接著說「這個位置沒有調一下就好的做法」
     ——等於把人送進自己剛剛宣告無解的地方。斷言把缺陷凍住了，修好反而會紅。
     改成驗性質，而且用同一支 checkCost 把建議值餵回去驗，不是拿算式自己推
     ——判定與顯示是兩套四捨五入，算式推得對不代表顯示值會照做。 */
  const capTxt = (over.html.match(/房租降到 <span class="num">\$([\d,]+\.\d\d)<\/span> 以下/) || [])[1];
  ok("抓得到建議的房租上限（抓不到的話下面兩格是空過的）", !!capTxt, over.html);
  if (capTxt) {
    const back = runCost(Object.assign({}, opts, { rent: Number(capTxt.replace(/,/g, "")) }));
    ok("照建議的房租上限改 → 不得落在踩線帶（顯示值 30.0%）",
      !back.html.includes("剛好壓在"), `建議 $${capTxt}／改完判定「${back.verdict}」`);
    ok("照建議的房租上限改 → 不得再判 housing stress",
      !back.html.includes("你在線上") && !back.html.includes("房租降到"),
      `建議 $${capTxt}／實得色調 ${back.tone}`);
  }
  const hrTxt = (over.html.match(/每週工時提高到 ([\d.]+) 小時以上/) || [])[1];
  ok("抓得到建議的工時", !!hrTxt, over.html);
  if (hrTxt) {
    const back = runCost(Object.assign({}, opts, { hours: Number(hrTxt), rent: 1000 * C.stress + 1 }));
    ok("照建議的工時改 → 不得落在踩線帶",
      !back.html.includes("剛好壓在"), `建議 ${hrTxt} 小時／改完判定「${back.verdict}」`);
    ok("照建議的工時改 → 不得再判 housing stress",
      !back.html.includes("你在線上") && !back.html.includes("每週工時提高到"),
      `建議 ${hrTxt} 小時／實得色調 ${back.tone}`);
  }
})();

/* 上面那一組只證明「這一組輸入的建議值是對的」。這個缺陷是整片的——
   舊寫法在 120 組掃描裡房租那一半 120/120 全中、工時那一半 107/120。
   一組過關擋不住它長回來，所以掃一片。 */
console.log("\n— 房租建議值：整片掃過，一組都不准落在踩線帶 —");
(function () {
  const badRent = [], badHours = [], noAdvice = [];
  let n = 0;
  for (let rate = 26; rate <= 45; rate++) {
    for (let hours = 20; hours <= 40; hours += 4) {
      const rent = Math.ceil(rate * hours * 0.45);      /* 45% → 一定超過 30% */
      const base = runCost({ rate, hours, rent });
      const cap = (base.html.match(/房租降到 <span class="num">\$([\d,]+\.\d\d)<\/span> 以下/) || [])[1];
      const hrs = (base.html.match(/每週工時提高到 ([\d.]+) 小時以上/) || [])[1];
      if (!cap) { noAdvice.push(`rate=${rate} hours=${hours}`); continue; }
      n++;
      const a = runCost({ rate, hours, rent: Number(cap.replace(/,/g, "")) });
      if (a.html.includes("剛好壓在") || a.html.includes("你在線上")) {
        badRent.push(`rate=${rate} hours=${hours} → 建議 $${cap}`);
      }
      /* 工時建議超過 80 小時的時候站上不給數字（自己的護欄擋掉），那不是漏網。 */
      if (hrs) {
        const b = runCost({ rate, hours: Number(hrs), rent });
        if (b.html.includes("剛好壓在") || b.html.includes("你在線上")) {
          badHours.push(`rate=${rate} hours=${hours} → 建議 ${hrs} 小時`);
        }
      }
    }
  }
  ok(`前提：掃到的 ${n} 組都真的給了房租建議`, n >= 100 && noAdvice.length === 0,
    `沒給建議的：${noAdvice.slice(0, 5).join("、")}`);
  ok(`房租建議值一組都不落在踩線帶（掃 ${n} 組）`, badRent.length === 0,
    `${badRent.length} 組漏網：\n    ` + badRent.slice(0, 5).join("\n    "));
  ok(`工時建議值一組都不落在踩線帶（掃 ${n} 組）`, badHours.length === 0,
    `${badHours.length} 組漏網：\n    ` + badHours.slice(0, 5).join("\n    "));
})();
t("沒填房租不得憑空講 housing stress",
  { rate: 30, hours: 38 }, { htmlLacks: "housing stress", htmlHas: "沒有填任何支出" });

/* ----------------------------------------------------- 雇主登記＝15 vs 30 */
console.log("\n— 雇主有沒有登記（這一頁最貴的一格）—");
t("沒登記 → 不得給乾淨的 ✅",
  { rate: 30, hours: 38, reg: "unreg" },
  { tone: "warn", verdictHas: "多扣稅", htmlHas: ["外國居民稅率", "30%"] });
t("沒登記要算出「每週差多少」", { rate: 30, hours: 38, reg: "unreg" }, { htmlHas: "每週差" });
t("不知道 → 先以有登記估，並要求對第一張 payslip",
  { rate: 30, hours: 38, reg: "unknown" },
  { htmlHas: ["以有登記估", "payslip"] });
t("有登記 → 不該再叫人去對 payslip 的 30%",
  { rate: 30, hours: 38, reg: "reg" }, { htmlLacks: "以有登記估" });
(function () {
  /* ⚠️ 這一段原本用 `[\d.]+` 抓金額，跟 542 行那條警告犯的是同一個錯——
     只是那裡寫了註解、這裡沒有。`$1,034.21` 被 `[\d.]+` 抓成「1」，
     而下面兩條比大小、比相等的斷言**照樣會過**：1 < 904 成立、1 === 1 也成立。
     原本的時薪 30 剛好讓兩邊都不到四位數，所以這個洞一直沒被踩到——
     **「測試是綠的」跟「測試在測東西」是兩件事**，這裡是後者失守。
     一併把時薪調到 34（同 543 行），讓千分位那條路真的被走過一次。 */
  const a = runCost({ rate: 34, hours: 38, reg: "reg" });
  const b = runCost({ rate: 34, hours: 38, reg: "unreg" });
  const g = h => {
    const m = h.match(/稅後週薪<\/strong> <span class="num">\$([\d,.]+)</);
    return m ? parseFloat(m[1].replace(/,/g, "")) : 0;
  };
  ok("前提：有登記那一邊是四位數（否則千分位那條路沒被走到）", g(a.html) > 1000, String(g(a.html)));
  ok("沒登記的稅後收入一定比較低", g(b.html) < g(a.html),
    `有登記 $${g(a.html)}／沒登記 $${g(b.html)}`);
  ok("「不知道」與「有登記」算出來一樣（不知道時採較保守的估法）",
    g(runCost({ rate: 34, hours: 38, reg: "unknown" }).html) === g(a.html));
})();

/* ------------------------------------------------------------------ 通勤 */
console.log("\n— 通勤：票價要來自 DATA.cost.fares，不能寫死 —");
(function () {
  const F = C.fares.goAnywhere;
  const each = { cash: F.cash, sr: F.sr10, sr20: F.sr20 };
  for (const [k, fare] of Object.entries(each)) {
    const r = runCost({ rate: 30, hours: 38, trans: k });
    const want = "$" + (fare * 2 * 5).toFixed(2);
    ok(`${k} → 每週 ${want}（來回 2 趟 × 5 天）`, r.html.includes(want),
      `內文找不到 ${want}`);
  }
  ok("Autoload（8 折）一定比原價便宜", F.sr20 < F.cash);
  const walk = runCost({ rate: 30, hours: 38, trans: "walk" });
  ok("走路不產生通勤支出", !walk.html.includes("通勤 −"));
  const car = runCost({ rate: 30, hours: 38, trans: "car", car: 60 });
  ok("開車用自己填的油錢", car.html.includes("$60.00") && car.html.includes("自己填的油錢"));
  const car0 = runCost({ rate: 30, hours: 38, trans: "car" });
  ok("開車但沒填油錢 → 不得偷偷套大眾運輸票價", !car0.html.includes("通勤 −"));
})();

/* -------------------------------------------------------------- 換算成工時 */
console.log("\n— 每一項換算成「要工作幾小時」—");
(function () {
  const r = runCost({ rate: 30, hours: 40, rent: 200, food: 100 });
  ok("每一筆支出都附上工時", (r.html.match(/你要工作 <strong>/g) || []).length === 2);
  ok("有總計「其中幾小時是在付這 N 項」", r.html.includes("小時</strong>是在付這 2 項"));
  /* 舊版不管填幾項都寫「這三項」。只填房租的人看到「這三項」會以為工具算錯。 */
  const one = runCost({ rate: 30, hours: 40, rent: 200 });
  ok("只填一項時要指名那一項，不得說「這三項」",
    one.html.includes("是在付房租") && !one.html.includes("這三項"),
    (one.html.match(/是在付[^<）]*/) || [""])[0]);
  const three = runCost({ rate: 30, hours: 40, rent: 200, food: 100, trans: "cash" });
  ok("三項都填才會出現「這 3 項」", three.html.includes("是在付這 3 項"));

  /* 判定吃真值（spendW / netRate）、句子卻印 hrs() 四捨五入後的值，於是
     20.04 > 20 成立、兩邊印成同一個數字，寫出「要 20.0 小時才付得完，
     而你一週只工作 20 小時」——同一句話自打嘴巴，而且它掛在「每週短少 $0.35」
     底下，讀起來像站上算錯了。這是「顯示與判定各用一套數字」，不是「兩份輸出各自組裝」。
     先釘住第三輪 QA 指名的那一組，再掃一片——一組過關擋不住它長回來。 */
  const self = runCost({ rate: 26.45, hours: 20, rent: 450 });
  const sent = (self.html.replace(/<[^>]+>/g, "").match(/（[^）]*才付得完[^）]*）/) || [""])[0];
  ok("QA 指名的那一組不得自打嘴巴（要 X 小時／只工作 X 小時）",
    !/要 (\d+(?:\.\d)?) 小時才付得完，而你一週只工作 \1(?:\.0)? 小時/.test(sent), sent || "(沒出現這一句)");
  ok("前提：那一組真的走到這一段（不是因為沒印才過關）",
    self.html.includes("才付得完") || self.html.includes("是在付"), self.html.slice(-300));
})();

console.log("\n— 「要 X 小時才付得完，而你一週只工作 X 小時」：整片掃過 —");
(function () {
  const bad = [];
  let seen = 0;
  for (let r5 = 2000; r5 <= 4500; r5 += 5) {           /* 時薪 $20.00–$45.00，每 5 分一格 */
    const rate = r5 / 100;
    for (const hours of [10, 20, 30, 40]) {
      for (const rent of [300, 450, 600]) {
        const x = runCost({ rate, hours, rent });
        const m = x.html.replace(/<[^>]+>/g, "")
          .match(/要 (\d+\.\d) 小時才付得完，而你一週只工作 (\d+) 小時/);
        if (!m) continue;
        seen++;
        if (Number(m[1]) === Number(m[2])) bad.push(`rate=${rate} hours=${hours} rent=${rent}`);
      }
    }
  }
  ok(`前提：掃到的組合真的走到那一句（${seen} 組）`, seen > 1000, `只走到 ${seen} 組`);
  ok(`一組都不准自打嘴巴（掃 ${seen} 組）`, bad.length === 0,
    `${bad.length} 組漏網：\n    ` + bad.slice(0, 5).join("\n    "));
})();

/* ---------------------------------------------------------------- 退休金 */
console.log("\n— 退休金：每一條路徑都要在，而且要講 DASP —");
for (const o of [
  { rate: 30, hours: 38 },
  { rate: 30, hours: 38, rent: 400, reg: "unreg" },
  { rate: 20, hours: 10, rent: 300 },
]) {
  const r = runCost(o);
  ok(`$${o.rate}×${o.hours} 有退休金與 65% 提醒`,
    r.html.includes("退休金") && r.html.includes("65%"));
}

/* ------------------------------------------------------------------ 存錢 */
console.log("\n— 存錢目標 —");
t("結餘為負時不得給「N 週可存到」",
  { rate: 20, hours: 10, rent: 300, goal: 5000 },
  { tone: "bad", htmlHas: "永遠存不到", htmlLacks: "需要 " });
(function () {
  const r = runCost({ rate: 30, hours: 40, rent: 200, goal: 5000 });
  ok("有目標就要算週數", /存到 .* 需要 \d+ 週/.test(r.html.replace(/<[^>]+>/g, "")));
  ok("要提醒農場會斷工", r.html.includes("整週不算"));
  /* 舊版印「用 N×1.3 週去抓比較接近現實」。1.3 沒有出處卻被印成具體週數——
     站上每個數字都要有來源，這一個沒有。改成把比例交給使用者自己填。 */
  ok("不得再印沒有出處的緩衝倍數",
    !r.html.includes("週去抓比較接近現實") && r.html.includes("站上不猜"));
  ok("換算示範要用除的，不是乘一個猜來的倍數", r.html.includes("除以你這一行實際有工作的週數比例"));
  const n = runCost({ rate: 30, hours: 40, rent: 200 });
  ok("沒填目標就不要講存錢", !n.html.includes("存到"));

  /* 剛好打平是自己一種狀態，不是「負的」。舊寫法用 `leftW <= 0` 把零併進負數那一句，
     結餘正好 $0.00 的人會看到「每週是負的，缺口只會越來越大」——畫面上同一刻寫著
     「每週剩下 $0.00」，兩句話直接打架，他會以為站上算錯了。
     湊法跟上面浮點數邊界那一段一樣：先算出稅後週薪，再整個填成房租。 */
  const probe = runCost({ rate: 34, hours: 38 });
  const netTxt = (probe.html.match(/稅後週薪<\/strong> <span class="num">\$([\d,.]+)</) || [])[1];
  ok("前提：抓得到稅後週薪（抓不到的話下面三格是空過的）", !!netTxt, probe.html.slice(0, 200));
  if (netTxt) {
    const z = runCost({ rate: 34, hours: 38, rent: parseFloat(netTxt.replace(/,/g, "")), goal: 5000 });
    const zt = z.html.replace(/<[^>]+>/g, "");
    ok("前提：這一組真的剛好打平", zt.includes("每週剩下 $0.00"), zt.slice(-300));
    ok("剛好打平不得說成「每週是負的」", !zt.includes("每週是負的"), zt.slice(-300));
    ok("剛好打平要說「存不到」但也要說沒有在惡化",
      zt.includes("以現在的結構存不到") && zt.includes("不會惡化"), zt.slice(-300));
    ok("剛好打平不得給出週數（除以零會印 Infinity）",
      !/需要 \d+ 週/.test(zt) && !/Infinity/.test(zt), zt.slice(-300));
  }
})();

/* --------------------------------------------------- 包吃住／水電另計 */
console.log("\n— 住宿附帶條件 —");
t("不含水電 → 要說那筆錢還沒算進去",
  { rate: 30, hours: 38, rent: 200, bills: "exc" },
  { htmlHas: ["還沒進上面的計算", "獨立水表"] });
t("包吃住從薪水扣 → 要說必須在 payslip 分列",
  { rate: 30, hours: 38, rent: 200, bills: "farm" },
  { htmlHas: ["分開列", "書面同意"] });
/* 剪貼簿的房租行以前只有金額與佔比，沒有這一格選了什麼。貼進群組之後
   「房租 $200／週，佔稅前收入 17.5%」，包吃住的人跟另外自付水電的人貼出來一模一樣
   ——而那正是別人拿來比價的那一行。畫面上有（費用表的灰字），剪貼簿沒有。 */
(function () {
  for (const [bills, note] of [
    ["inc", "含水電網路"], ["exc", "不含水電網路"], ["farm", "包吃住，直接從薪水扣"],
  ]) {
    const r = runCost({ rate: 30, hours: 38, rent: 200, bills });
    const screen = r.html.replace(/<[^>]+>/g, "");
    const line = r.clip.split("\n").filter(l => l.startsWith("房租"))[0] || "";
    ok(`bills=${bills} → 畫面的費用表要標「${note}」`, screen.includes(note), screen.slice(0, 400));
    ok(`bills=${bills} → 剪貼簿的房租行也要標「${note}」`, line.includes(note), line);
    /* 三種選項的字串不得互相包含，否則上面兩格會互相冒領。 */
    const others = ["含水電網路", "不含水電網路", "包吃住，直接從薪水扣"].filter(x => x !== note);
    ok(`bills=${bills} → 剪貼簿不得同時掛上別種說法`,
      !others.some(x => x !== "含水電網路" && line.includes(x)), line);
  }
})();

/* -------------------------------------------------- 貼文與畫面必須一致 */
console.log("\n— 剪貼簿文字必須跟畫面判定一致 —");
for (const { o, mark } of [
  { o: { rate: 20, hours: 10, rent: 300 }, mark: "🛑" },
  { o: { rate: 25, hours: 40, rent: 400 }, mark: "⚠️" },
  { o: { rate: 34, hours: 38, rent: 200 }, mark: "✅" },
]) {
  const r = runCost(o);
  ok(`貼文與畫面同為 ${mark}`,
    r.clip && r.clip.includes(mark) && r.verdict.includes(mark),
    `畫面「${r.verdict}」／貼文「${(r.clip || "").split("\n")[0]}」`);
}
(function () {
  const r = runCost({ rate: 25, hours: 40, rent: 400 });
  ok("貼文要帶上房租佔比", r.clip.includes("40%"), r.clip);
  ok("貼文要帶上退休金另計", r.clip.includes("退休金另計"));
})();

/* ------------------------------ 剪貼簿與畫面的機械對帳（通則，不是逐句） */
/* 上面那一段釘的是「這幾句話要一致」。它防得住已經知道的分岔，防不住下一個：
   2026-08-17 這一輪連續抓到同一個形狀四次——兩份輸出各自組裝，改了看得見的那一份。
   逐句斷言永遠慢一步，因為新加的欄位天生沒有人替它寫斷言。

   所以這一段不看句子，看**通則**：
     (1) 剪貼簿印出來的每一個金額，畫面上都要找得到同一個數字
     (2) 判定符號（✅／⚠️／🛑）兩邊必須相同
     (3) 剪貼簿的標題列只准有一組括號
     (4) 四位數以上的金額兩邊都要有千分位（＝兩邊真的共用同一個格式器）
   四條都跟「有哪些欄位」無關，所以以後加欄位也會被它管到。
   這是刻意選來取代「把 checkCost() 拆成 facts 物件」那個重構的：
   350 行的改寫只能用 golden 相等來證明自己沒改壞，防不住下一次新增；
   這四條防得住整個類別。 */
console.log("\n— 剪貼簿與畫面的機械對帳（通則）—");
(function () {
  /* 每一條會改變組裝路徑的分支都要有一格。少一條路徑，這個通則就對那條路徑沒有意見
     ——這一輪的兩個錯就是躲在沒有人走過的分支裡。 */
  const CASES = [
    ["WHM 有登記", { rate: 34, hours: 38, reg: "reg" }],
    ["WHM 有登記＋房租", { rate: 34, hours: 38, reg: "reg", rent: 250 }],
    ["不知道有沒有登記", { rate: 34, hours: 38, reg: "unknown", rent: 250 }],
    ["雇主未登記", { rate: 34, hours: 38, reg: "unreg", rent: 250 }],
    ["未登記＋低於全國最低（兩條附註）", { rate: 18, hours: 38, reg: "unreg" }],
    ["居民・levy 門檻以下", { rate: 20, hours: 20, reg: "resident" }],
    ["居民・levy 過渡段", { rate: 25, hours: 25, reg: "resident" }],
    ["居民・levy 全額", { rate: 35, hours: 38, reg: "resident", rent: 250 }],
    ["房租踩在 30% 的線上", { rate: 34, hours: 38, reg: "reg", rent: 387.65 }],
    ["房租過重", { rate: 34, hours: 38, reg: "reg", rent: 450 }],
    /* ↓ 這兩格是 2026-08-17 第二輪 QA 指名的缺口。上面「剪貼簿標題列最多一組括號」
       那條規則寫得是對的，但當時沒有任何一格**同時**具備 overStress 與一條附註，
       於是它對自己被寫來保護的那個分支從來沒有執行過——規則沒錯，覆蓋錯了。
       一條走不到的通則跟沒有那條通則，在測試輸出上長得一模一樣。 */
    ["房租過重＋雇主未登記（兩組括號的入口）",
      { rate: 34, hours: 38, reg: "unreg", rent: 450 }],
    ["房租過重＋低於法定最低（同上，另一條附註）",
      { rate: 20, hours: 38, reg: "reg", rent: 260 }],
    ["負結餘", { rate: 34, hours: 20, reg: "reg", rent: 500, food: 200 }],
    ["農場包吃住", { rate: 34, hours: 38, reg: "reg", rent: 150, bills: "farm" }],
    ["房租不含水電網路（多一段提醒）",
      { rate: 34, hours: 38, reg: "reg", rent: 250, bills: "exc" }],
    ["有存錢目標（多一段倒數）",
      { rate: 34, hours: 38, reg: "reg", rent: 250, goal: 8000 }],
    ["房租高到補工時也救不了（needHours > 80）",
      { rate: 34, hours: 38, reg: "reg", rent: 900 }],
    ["開車通勤", { rate: 34, hours: 38, reg: "reg", rent: 250, trans: "car", car: 90 }],
    ["六位數年收（會出現千分位）", { rate: 60, hours: 60, reg: "resident", rent: 800 }],
  ];
  const MARKS = ["✅", "⚠️", "🛑"];
  const amounts = s => s.match(/\$[\d,]+\.\d{2}/g) || [];

  for (const [label, o] of CASES) {
    const r = runCost(o);
    const screen = r.html.replace(/<[^>]+>/g, "");
    const head = r.clip.split("\n")[0];

    /* 單向查：畫面本來就講得比剪貼簿細，反方向不成立。 */
    const orphan = amounts(r.clip).filter(a => !screen.includes(a));
    ok("〔" + label + "〕剪貼簿的每個金額畫面上都找得到",
      orphan.length === 0, "畫面上沒有：" + orphan.join("、"));

    /* 畫面 ⚠️ 而剪貼簿 ✅ 是這一輪最貴的一個錯：
       貼進群組的那一份會替一個被短給的人背書。 */
    const mk = s => MARKS.filter(x => s.includes(x)).join("");
    ok("〔" + label + "〕判定符號兩邊一致", mk(r.verdict) === mk(head),
      "畫面「" + mk(r.verdict) + "」／剪貼簿「" + mk(head) + "」");

    /* 數括號組數，不是查有沒有括號——後者兩種寫法都會過。 */
    ok("〔" + label + "〕剪貼簿標題列最多一組括號",
      (head.match(/（/g) || []).length <= 1, head);

    /* 擋的是「有人把其中一邊改回 toFixed(2)」。 */
    const noSep = /\$\d{4,}\.\d{2}/;
    ok("〔" + label + "〕四位數以上的金額兩邊都有千分位",
      !noSep.test(r.clip) && !noSep.test(screen),
      (r.clip.match(noSep) || screen.match(noSep) || [""])[0]);

    /* (5) 標題列一定要帶著結餘／短少的金額。overStress 那一支曾經整份剪貼簿
       **完全沒有這個數字**——不是換位置，是整段訊息裡沒有。而剪貼簿下面就寫著
       「有人問『這個薪水在 Perth 活不活得下去』，貼這段比講感覺清楚」，
       房租過重的人正是最會被這樣問的那一群。第十次踩到「兩份輸出各自組裝」。 */
    ok("〔" + label + "〕剪貼簿標題列要帶結餘／短少金額",
      /(每週結餘|每週短少) \$[\d,]+\.\d{2}/.test(head), head);

    /* (6) 正負號兩邊要同一個方向。只查「有金額」擋不住把 -$50 印成「結餘 $50」。 */
    ok("〔" + label + "〕結餘的正負兩邊一致",
      head.includes("每週短少") === screen.includes("每週短少 "),
      "畫面「" + (screen.includes("每週短少 ") ? "短少" : "結餘") + "」／剪貼簿「"
      + (head.includes("每週短少") ? "短少" : "結餘") + "」");
  }
})();

/* ------------------------------------------------ 踩線：30% 的三處輸出 */
/* 判定用嚴格大於 30%，顯示卻四捨五入到小數一位。$387.65／$1,292 ＝ 30.003%，
   印出來是「30%」——再接一句「超過 30%」就是同一段話自打嘴巴。
   畫面早就改講「剛好壓在線上」了，剪貼簿沒跟上，於是貼進群組的那一份自我矛盾。 */
console.log("\n— 房租踩在 30% 線上時，三處輸出要講同一件事 —");
(function () {
  const r = runCost({ rate: 34, hours: 38, reg: "reg", rent: 387.65 });
  const screen = r.html.replace(/<[^>]+>/g, "");
  ok("前提：這組輸入真的踩在線上（判超過、但顯示會是 30%）",
    r.tone === "warn" && screen.includes("30/40 rule"), `實得 ${r.tone}`);
  ok("標題不得印出「30%」這個會自打嘴巴的數字",
    !/吃掉稅前收入的 30(\.0)?%/.test(r.verdict), r.verdict);
  ok("標題要改講「剛好壓在」", r.verdict.includes("剛好壓在"), r.verdict);
  ok("房租那一段也要講「剛好壓在」", screen.includes("房租剛好壓在稅前收入 30% 的線上"));
  ok("剪貼簿的標題列要跟著改", r.clip.split("\n")[0].includes("剛好壓在"), r.clip.split("\n")[0]);
  const rentLine = r.clip.split("\n").filter(l => l.startsWith("房租"))[0] || "";
  ok("剪貼簿的房租那一行也要跟著改（這一行 2026-08-17 之前寫死百分比）",
    rentLine.includes("剛好壓在"), rentLine);
  ok("剪貼簿的房租行不得留下多餘的 %", !/線上%/.test(rentLine), rentLine);

  /* 沒踩線的時候不可以被這條規則波及：一般情況還是要印出實際百分比。 */
  const over = runCost({ rate: 34, hours: 38, reg: "reg", rent: 450 });
  ok("沒踩線 → 標題印實際百分比，不講「剛好壓在」",
    over.verdict.includes("34.8%") && !over.verdict.includes("剛好壓在"), over.verdict);
  ok("沒踩線 → 剪貼簿也印實際百分比",
    over.clip.includes("34.8%") && !over.clip.includes("剛好壓在"),
    over.clip.split("\n").filter(l => l.startsWith("房租"))[0]);
})();

/* -------------------------------------------- 居民模式：拆解與合計要對得起來 */
/* levy 刻意跟所得稅分開顯示（那 2% 拿到 MES 免得掉，所得稅免不掉）。
   分開之後畫面上就沒有合計，而剪貼簿第二行印的正好是合計——
   一個數字只出現在對外那一份、畫面上查不到，就沒有人核對得了它。 */
console.log("\n— 居民模式：所得稅 ＋ levy ＝ 剪貼簿印的合計 —");
(function () {
  /* 用「分」比，不用容差。原本這幾條寫 `Math.abs(a + b - c) < 0.011`，
     而 0.011 **比半分錢還大**——一分錢的落差它照樣放行。可是「差一分錢」正好是
     這幾條斷言存在的理由：把四捨五入過的週數字乘 52，跟直接用年度數字算，
     典型的差距就是一分。**容差蓋掉的正是它要測的那個問題。**
     站上所有算術都跑在整數分上，畫面印的是 `分 / 100` 再 toFixed(2)，
     所以讀回來換成分之後本來就該**完全相等**，一毫的浮點鬆動都不需要。
     （2026-08-17 實測：把容差收到 0.0001 這四條照樣全過，證實那個 0.011 是純鬆弛。） */
  const money = s => parseFloat(String(s).replace(/,/g, ""));
  for (const o of [
    { rate: 25, hours: 25, reg: "resident" },              /* 過渡段 */
    { rate: 35, hours: 38, reg: "resident", rent: 250 },   /* 全額 2% */
    { rate: 60, hours: 60, reg: "resident", rent: 800 },   /* 高收入 */
  ]) {
    const r = runCost(o);
    const s = r.html.replace(/<[^>]+>/g, "");
    const inc = money((s.match(/所得稅 −\$([\d,]+\.\d\d)/) || [, "0"])[1]);
    const lv = money((s.match(/Medicare levy −\$([\d,]+\.\d\d)/) || [, "0"])[1]);
    const sum = money((s.match(/兩筆合計預扣 −\$([\d,]+\.\d\d)/) || [, "0"])[1]);
    const clipTax = money((r.clip.match(/扣稅 \$([\d,]+\.\d\d)/) || [, "0"])[1]);
    const lab = `$${o.rate}×${o.hours}h`;
    ok(`${lab} 三個數字都印出來了`, inc > 0 && lv > 0 && sum > 0, `${inc} / ${lv} / ${sum}`);
    ok(`${lab} 所得稅 ＋ levy ＝ 合計（分毫不差，不給容差）`,
      cents(inc) + cents(lv) === cents(sum), `${inc} + ${lv} ≠ ${sum}`);
    ok(`${lab} 剪貼簿的「扣稅」＝畫面的合計（分毫不差）`, cents(clipTax) === cents(sum),
      `剪貼簿 ${clipTax} ／ 畫面 ${sum}`);
    ok(`${lab} 剪貼簿要單獨列出 levy，不能只給合計`,
      r.clip.includes("Medicare levy") && r.clip.includes("MES"),
      r.clip.split("\n").filter(l => l.includes("levy"))[0] || "（沒有 levy 那一行）");
  }
  /* 門檻以下不課 levy → 就不該印合計那一行（它會等於所得稅，是一句廢話）。 */
  const lo = runCost({ rate: 20, hours: 20, reg: "resident" });
  ok("levy ＝ 0 時不印合計（那一行會跟所得稅一模一樣）",
    !lo.html.includes("兩筆合計預扣") && lo.html.includes("本來就不課"));
  ok("levy ＝ 0 時剪貼簿也不提 levy", !lo.clip.includes("Medicare levy"), lo.clip);
})();

/* ------------------------------------------------ DASP：比例跟著簽證，不跟著稅表 */
/* 稅表看所得，DASP 看你持哪一種簽證。這兩件事被寫在同一段程式裡，
   所以「換了稅表模式忘了換 DASP」是這裡唯一的失效方式——而它已經發生過一次。 */
console.log("\n— DASP 比例：三種身分各印各的 —");
(function () {
  const back = h => parseFloat(((h.replace(/<[^>]+>/g, "")
    .match(/回得到你手上|真正回到你手上的大約/) ? h.replace(/<[^>]+>/g, "") : "")
    .match(/大約 \$([\d,]+\.\d\d)/) || [, "0"])[1].replace(/,/g, ""));
  const superOf = h => parseFloat((h.replace(/<[^>]+>/g, "")
    .match(/另外還有退休金 \$([\d,]+\.\d\d)/) || [, "0"])[1].replace(/,/g, ""));

  const whm = runCost({ rate: 34, hours: 38, reg: "reg" });
  ok("WHM → 畫面寫 65%，實拿約 35%",
    whm.html.includes("DASP 稅率是 65%")
      && Math.abs(back(whm.html) / superOf(whm.html) - 0.35) < 0.01,
    `super ${superOf(whm.html)} → 實拿 ${back(whm.html)}`);
  ok("WHM → 剪貼簿同樣寫 65%，而且實拿數字跟畫面一樣",
    whm.clip.includes("領回課 65%") && whm.clip.includes("$" + back(whm.html).toFixed(2)),
    whm.clip.split("\n").pop());

  const res = runCost({ rate: 34, hours: 38, reg: "resident" });
  ok("居民稅表 → 畫面改成 35%，實拿約 65%",
    res.html.includes("<b>35%</b>")
      && Math.abs(back(res.html) / superOf(res.html) - 0.65) < 0.01,
    `super ${superOf(res.html)} → 實拿 ${back(res.html)}`);
  ok("居民稅表 → 畫面不得再出現打工度假的 65% 當成自己的稅率",
    res.html.includes("不是打工度假的那個 65%"));
  ok("居民稅表 → 要講明 PR 一下來資格就永久消失",
    res.html.includes("永久消失") && res.clip.includes("PR 一下來這一格歸零"));
  ok("居民稅表 → 剪貼簿的 DASP 稅率跟著改成 35%",
    res.clip.includes("DASP 課 35%") && !res.clip.includes("領回課 65%"),
    res.clip.split("\n").pop());
})();

/* ----------------------------------------- 剪貼簿的稅表標籤要跟著模式走 */
console.log("\n— 剪貼簿的稅表標籤 —");
(function () {
  const label = r => (r.clip.match(/（約 [\d.]+%，([^）]+)）/) || [, ""])[1];
  const want = [
    ["reg", "WHM 稅率"],
    ["unknown", "以「雇主有登記」估的 WHM 稅率"],
    ["unreg", "雇主未登記，用外國居民稅率"],
    ["resident", "已換簽，用居民稅表"],
  ];
  for (const [reg, expect] of want) {
    const r = runCost({ rate: 34, hours: 38, reg });
    ok(`${reg} → 剪貼簿標籤「${expect}」`, label(r).includes(expect), "實得「" + label(r) + "」");
  }
  ok("居民模式的標籤不得再說 WHM",
    !label(runCost({ rate: 34, hours: 38, reg: "resident" })).includes("WHM"));
  /* 比例要印實際算出來的，不是寫死的級距數字——年收跨過 $45,000 之後就對不上了。 */
  const hi = runCost({ rate: 40, hours: 70, reg: "reg" });
  ok("年收跨過第一級距後，剪貼簿的比例不得還是 15%",
    !/約 15(\.0)?%/.test(hi.clip), hi.clip.split("\n")[1]);
})();

/* --------------------------------------------- 換簽差額：年差額不是週差額 × 52 */
console.log("\n— 換簽差額 —");
(function () {
  const C2 = sandbox.DATA.cost, W = C2.tax.weeksPerYear;

  /* 兩組輸入，各自守一件事。
     $35×38 是原本那組，留著；但 2026-08-17 掃過 133,311 組（時薪 $20–$80 每 5 分、
     工時 5–60 每半小時）之後發現：**它剛好落在「兩種算法答案相同」的那 93% 裡**。
     也就是說在它身上，週差額寫成「年差額 ÷ 52」是**測不出來的**——
     不是斷言太鬆，是這組輸入根本走不到那個分歧點。
     $34.25×39 是掃出來會分歧的（正確 $25.78／寫錯 $25.79），
     時薪也在 casual 最低 $33.05 之上，不會另外掛「低於法定最低」那條附註。
     ⚠️ 這就是「突變沒紅」的第二種原因（沒有案例走到那條分支），
     跟「斷言真的抓到了」長得一模一樣——差別只有實際去掃過才看得見。 */
  for (const [rate, hours, why] of [
    [35, 38, "原本那組（兩種算法在這裡剛好同分）"],
    [34.25, 39, "掃出來會分歧的那一組（差一分）"],
  ]) {
    const lab = `$${rate}×${hours}h`;
    const r = runCost({ rate, hours, reg: "resident" });
    const s = r.html.replace(/<[^>]+>/g, "");
    const wk = parseFloat((s.match(/每週(?:少繳|多繳) \$([\d,]+\.\d\d)/) || [, "0"])[1].replace(/,/g, ""));
    const yr = parseFloat((s.match(/一年(?:少繳|多繳) \$([\d,]+\.\d\d)/) || [, "0"])[1].replace(/,/g, ""));
    ok(`${lab} 換簽差額要同時給週與年`, wk > 0 && yr > 0, `週 ${wk} ／ 年 ${yr}　${why}`);

    /* 年差額必須直接用年度數字算，不能把四捨五入過的週差額乘 52。
       不要用「兩者不相等」來測——某些時薪下它們剛好相等，
       那條斷言會變成在測輸入而不是測邏輯。改成直接對上真正的算式。 */
    const annual = Math.round(rate * hours * 100) * W;
    const whmA = sandbox.whmTaxCents(annual, true);
    const resA = sandbox.residentTaxCents(annual) + sandbox.medicareLevyCents(annual);
    const wantY = Math.abs(whmA - resA) / 100;
    /* ⚠️ 週的居民稅是**兩次分開捨入再相加**（index.html:2776-2778）：
       所得稅 /52 捨入、levy /52 捨入，然後相加。不是「先加總再除」。
       那是刻意的——畫面把兩筆分開印，分開印的兩個數字必須加得出畫面上的合計
       （就是上面「所得稅 ＋ levy ＝ 合計」那一組在守的事）。
       這裡第一版寫成先加總再捨入，跟實作差一分而**測試紅了**：
       收緊容差之後第一個抓到的不是網站的錯，是**這支測試自己抄錯了實作的形狀**。
       原本的 0.011 對這件事一樣是瞎的——它會讓錯的期望值也過。 */
    const wantTaxW = Math.round(sandbox.residentTaxCents(annual) / W)
      + Math.round(sandbox.medicareLevyCents(annual) / W);
    /* 用「分」對，不給容差。**這裡的容差比上面那組更危險**：
       週差額寫錯的典型長相是「先把年差額算出來再除以 52」，
       它跟「兩張表各自先算週稅再相減」的落差**恰好是一分錢**——
       而原本的 0.011 比一分錢大，等於這條斷言對它要抓的那個錯誤是瞎的。 */
    ok(`${lab} 年差額＝年度 WHM 稅 −（年度居民稅 ＋ 年度 levy）`,
      cents(yr) === cents(wantY), `畫面 ${yr} ／ 算式 ${wantY.toFixed(2)}`);

    const wantW = Math.abs(Math.round(whmA / W) - wantTaxW) / 100;
    ok(`${lab} 週差額＝兩張表各自的週稅相減（差一分就算錯）`, cents(wk) === cents(wantW),
      `畫面 ${wk} ／ 算式 ${wantW.toFixed(2)}`);
  }

  /* 把「這一組真的會分歧」本身也釘住。哪天稅表或 weeksPerYear 一改，
     $34.25×39 可能又變回同分——那時上面那兩條會繼續是綠的，
     但它們**守的東西已經沒了**。這一條會在那天紅給你看。 */
  const annual = Math.round(34.25 * 39 * 100) * W;
  const whmA = sandbox.whmTaxCents(annual, true);
  const resA = sandbox.residentTaxCents(annual) + sandbox.medicareLevyCents(annual);
  const taxW = Math.round(sandbox.residentTaxCents(annual) / W)
    + Math.round(sandbox.medicareLevyCents(annual) / W);
  ok("前提：$34.25×39 這組確實能分辨兩種捨入寫法（否則上面等於沒測）",
    Math.abs(Math.round(whmA / W) - taxW) !== Math.abs(Math.round((whmA - resA) / W)),
    `兩種算法都得出 ${Math.abs(Math.round(whmA / W) - taxW)} 分`);
})();

/* -------------------------------------------------------------- 單位價格 */
console.log("\n— 單位價格換算 —");
(function () {
  ok("缺欄位不算", runUnit({ pa: 3 }).tone === "warn");
  ok("容量 0 不算（不得除以零）",
    runUnit({ pa: 3, qa: 0, pb: 5, qb: 500 }).tone === "warn");
  const r = runUnit({ pa: 3, qa: 500, pb: 5, qb: 1000, unit: "g" });
  ok("500g $3 vs 1kg $5 → B 便宜", r.verdict.includes("B"), r.verdict);
  ok("換算成每 100g", r.verdict.includes("每 100g") && r.html.includes("$0.60") && r.html.includes("$0.50"));
  const eq = runUnit({ pa: 2, qa: 500, pb: 4, qb: 1000, unit: "g" });
  ok("單價相同 → 說一樣貴，不硬選一個", eq.verdict.includes("一樣貴"), eq.verdict);
  const l = runUnit({ pa: 2.5, qa: 500, pb: 4, qb: 1000, unit: "ml" });
  ok("液體換算成每 1L", l.verdict.includes("每 1L") && l.html.includes("$5.00"));
  const p = runUnit({ pa: 6, qa: 12, pb: 3, qb: 5, unit: "pc" });
  ok("計數換算成每 1 個（$0.50 vs $0.60）",
    p.verdict.includes("A") && p.html.includes("$0.50"), p.verdict + " / " + p.html);
  ok("要提醒吃不完就不便宜", r.html.includes("會不會吃完"));
  ok("要說大超市依法本來就會標", r.html.includes("Unit Pricing Code"));
})();

/* ------------------------------------------------------------ 資料完整性 */
console.log("\n— DATA.cost 的自我一致性 —");
ok("稅級距順序正確", C.tax.b1 < C.tax.b2 && C.tax.r1 < C.tax.r2);
ok("第二級距的基底＝第一級距全額課完", Math.round(C.tax.b1 * C.tax.r1) === C.tax.base2);
ok("SmartRider 折扣就是 9 折與 8 折",
  Math.round(C.fares.goAnywhere.cash * 90) === Math.round(C.fares.goAnywhere.sr10 * 100) &&
  Math.round(C.fares.goAnywhere.cash * 80) === Math.round(C.fares.goAnywhere.sr20 * 100));
ok("每一筆來源都有查核日", C.src.every(s => /^\d{4}-\d{2}-\d{2}$/.test(s.as)));
ok("每一筆來源都標了查證與否", C.src.every(s => typeof s.v === "boolean"));
ok("旗標數量沒有被誤刪", C.flags.length >= 5);
ok("稅級距的四個端點與兩張表的基底彼此對得上",
  C.tax.b2 < C.tax.b3 && C.tax.r2 < C.tax.r3 && C.tax.r3 < C.tax.r4 &&
  Math.round(C.tax.base2 + (C.tax.b2 - C.tax.b1) * C.tax.r2) === C.tax.base3 &&
  Math.round(C.tax.base3 + (C.tax.b3 - C.tax.b2) * C.tax.r3) === C.tax.base4 &&
  Math.round(C.tax.b2 * C.tax.unreg) === C.tax.unregBase3 &&
  Math.round(C.tax.unregBase3 + (C.tax.b3 - C.tax.b2) * C.tax.r3) === C.tax.unregBase4);
ok("來源筆數與待核筆數要被釘住（README 的對帳表靠這個）",
  C.src.length === 17 && C.src.filter(s => s.v === false).length === 2,
  `實得 ${C.src.length} 筆／待核 ${C.src.filter(s => s.v === false).length} 筆——`
  + "數字變了就回去改 public/README.md 的對帳表，不要只改這一行");

/* 2026-08-16：站上曾經寫「ALDI 的門市與大多數亞超面積在門檻以下，法規不強制它們標」。
   ACCC 的 Unit Pricing Code 頁面從頭到尾沒有點名任何一家，門檻算的也是「陳列雜貨的
   樓地板面積」而不是店面總面積——沒有人量得到某一家連鎖店的那個數字。
   這是一句對具名公司的無來源合規宣稱，正是這個站說好不做的事。這條防它長回來。 */
ok("不得宣稱任何具名連鎖店不受 Unit Pricing Code 規範",
  !/(ALDI|Coles|Woolworths|IGA)[^。]{0,40}(不強制|不適用|門檻以下|免標)/.test(HTML),
  (HTML.match(/(ALDI|Coles|Woolworths|IGA)[^。]{0,40}(不強制|不適用|門檻以下|免標)/) || [])[0]);
ok("門檻要寫成『陳列雜貨的樓地板面積』，不得再寫成『賣場面積』",
  HTML.includes("陳列雜貨的樓地板面積") && !/賣場面積超過 1,000/.test(HTML));

/* 上面那兩條只掃 index.html，但同一句話在 public/README.md 也活過一次——
   說明文件跟站上內容是同一套宣稱，守則只守一半等於沒守。
   麻煩的是 README **必須** 引得動那句錯的話：它有一節就叫「已知的錯誤來源（不要再引）」，
   把原句抄在那裡是這份文件的用處所在。所以判準不是「有沒有出現」，是「以什麼身分出現」：
     ・「已知的錯誤來源」那節**之前**出現 → 那是站在說它是真的，紅
     ・那節**之後**出現，且整句包在「」裡 → 那是標本，放行
   引號是機械判得出來的證據，比「我知道那段是在講反例」可靠。 */
(function () {
  const RM_PATH = path.join(__dirname, "..", "public", "README.md");
  const RM = fs.readFileSync(RM_PATH, "utf8");
  const CLAIM = /(ALDI|Coles|Woolworths|IGA)[^。」]{0,40}(不強制|不適用|門檻以下|免標)|賣場面積超過 1,000/g;

  /* 回傳「以自己的口吻講出來」的命中，標本不算。 */
  function liveClaims(text) {
    const wrongSection = text.indexOf("### 已知的錯誤來源");
    const out = [];
    const re = new RegExp(CLAIM.source, "g");
    let m;
    while ((m = re.exec(text))) {
      const lineStart = text.lastIndexOf("\n", m.index) + 1;
      let lineEnd = text.indexOf("\n", m.index); if (lineEnd < 0) lineEnd = text.length;
      const line = text.slice(lineStart, lineEnd);
      const rel = m.index - lineStart;
      /* 包在「」裡＝這一行在引述，不是在主張。看的是命中點左右最近的引號方向。 */
      const openBefore = line.lastIndexOf("「", rel);
      const closeBefore = line.lastIndexOf("」", rel);
      const quoted = openBefore > closeBefore && line.indexOf("」", rel) > rel;
      if (wrongSection < 0 || m.index < wrongSection || !quoted) {
        out.push("第 " + text.slice(0, m.index).split("\n").length + " 行：" + m[0]);
      }
    }
    return out;
  }

  ok("public/README.md 要保留「已知的錯誤來源」那一節（例外規則靠它定位）",
    RM.indexOf("### 已知的錯誤來源") > 0);

  const live = liveClaims(RM);
  ok("public/README.md 不得以自己的口吻宣稱具名連鎖店不受 Unit Pricing Code 規範",
    live.length === 0,
    live.join("\n    ") + "\n    （要引那句錯的話，把它放進「已知的錯誤來源」那節並整句用「」包起來）");

  /* 這條守則的例外規則比正則本身複雜，所以它自己也要被測——
     不然「永遠通過」跟「守得很好」在輸出上長得一模一樣。 */
  const REAL = "### 已知的錯誤來源（不要再引）\n- 「ALDI 與多數亞超面積在門檻以下，法規不強制它們標」——2026-08-16 刪除。\n";
  ok("README 守則對三種寫法的判定都正確（不是永遠通過的假斷言）",
    liveClaims(REAL).length === 0 &&
    liveClaims("ALDI 面積在門檻以下，法規不強制標單位價格。\n" + REAL).length === 1 &&
    liveClaims(REAL + "所以 Coles 以外的店都不強制標。\n").length === 1 &&
    liveClaims("### 已知的錯誤來源\n- 賣場面積超過 1,000 平方公尺才要標。\n").length === 1,
    "自我測試沒有得到 0/1/1/1");
})();

/* ---------------------------------------------------------------------------
   這個站最大聲的那條承諾：/cost 不存任何「今天多少錢」。

   舊版只掃 C.save 與 C.band、正則寫死「每週」二字，所以三種東西它都看不到：
   markup 裡的 placeholder、寫成「一週」或「$120／週」的行情、C.flags 裡的金額。
   2026-08-16 的獨立 QA 把「Perth 一週菜錢大約 $120」塞進 C.band，68 個案例全綠。
   現在改成掃整個 DATA.cost **加上** /cost 那一段 markup。
   --------------------------------------------------------------------------- */
(function () {
  /* 「一日票」是 Transperth 的產品名，不是週期詞，所以「一」那一支不收「日」與「月」。 */
  const PERIOD = "(?:每(?:週|周|星期|月|個月|天|日)|一(?:週|周|星期|個月))";
  const MONEY = "\\$\\s?\\d";
  const RE = new RegExp(PERIOD + "[^$]{0,8}?" + MONEY + "|" + MONEY + "[\\d,.]*\\s*(?:／|/)\\s*(?:週|周|月|天|日)");

  const costMarkup = (HTML.match(/<section class="tool" id="cost">[\s\S]*?<\/section>/) || [""])[0];
  ok("抓得到 /cost 那一段 markup（抓不到的話下面兩條等於沒測）", costMarkup.length > 500);

  ok("DATA.cost 不得出現任何「每週／一週 …… $金額」的行情",
    !RE.test(JSON.stringify(C)), (JSON.stringify(C).match(RE) || [""])[0]);
  ok("/cost 的 markup 也不得出現（placeholder 曾經寫死 200 與 120）",
    !RE.test(costMarkup), (costMarkup.match(RE) || [""])[0]);

  /* 上面兩條是「不要有」，很容易寫成永遠通過。這裡證明它真的會紅。 */
  const canary = [
    'Perth 一週菜錢大約 $120，兩個人 $200 上下。',
    '房租 $180／週起跳',
    '每個月伙食抓 $500',
  ];
  ok("守門正則對三種寫法都會紅（不是永遠通過的假斷言）",
    canary.every(s => RE.test(s)), canary.filter(s => !RE.test(s)).join(" ｜ "));

  /* placeholder 是灰字，看起來不像資料，但對「不知道要填多少」的人就是錨點。 */
  for (const [id, why] of [["crent", "每週房租"], ["cfood", "每週伙食費"]]) {
    const tag = (costMarkup.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>')) || [""])[0];
    const ph = (tag.match(/placeholder="([^"]*)"/) || [, ""])[1];
    ok(`#${id}（${why}）的 placeholder 不得是數字`,
      ph !== "" && !/\d/.test(ph), `實得 placeholder="${ph}"`);
  }
  /* 時薪那格是唯一允許數字的，但必須從 DATA 灌，不能在 markup 抄第二份。 */
  const rateTag = (costMarkup.match(/<input[^>]*id="crate"[^>]*>/) || [""])[0];
  ok("#crate 的 placeholder 不得在 markup 寫死法定時薪",
    !/placeholder="[\d.]+"/.test(rateTag), rateTag);
  ok("index.html 有從 DATA.wage.casualMin 灌 #crate 的 placeholder",
    /#crate[\s\S]{0,120}placeholder\s*=\s*DATA\.wage\.casualMin/.test(HTML));
})();

console.log(`\n${fail === 0 ? "全數通過" : "有失敗"}：${pass} 過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
