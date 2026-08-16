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
  "globalThis.checkCost = checkCost; globalThis.comparePrice = comparePrice;",
  sandbox
);

const C = sandbox.DATA.cost;

/* 預設值刻意跟畫面上的 <select> 第一個選項一致：
   creg=unknown、cbills=inc、ctrans=walk。填了別的才代表使用者主動選過。 */
function runCost(o) {
  const set = (k, v) => { fields[k] = { value: v == null ? "" : String(v) }; };
  set("#crate", o.rate); set("#chours", o.hours);
  set("#creg", o.reg || "unknown");
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

/* ---------------------------------------------------------------- 輸入護欄 */
console.log("\n— 護欄：算不出來就不要硬算 —");
t("沒填時薪不判定", { hours: 38 }, { tone: "warn", verdictHas: "請先填時薪" });
t("沒填工時不判定", { rate: 33 }, { tone: "warn", verdictHas: "請先填時薪" });
t("時薪 0 不判定", { rate: 0, hours: 38 }, { tone: "warn", verdictHas: "請先填時薪" });
t("每週 100 小時 → 先要求確認，不直接算",
  { rate: 30, hours: 100 }, { tone: "warn", verdictHas: "先確認" });
t("每週 80 小時（邊界內）照算", { rate: 30, hours: 80 }, { tone: "ok" });
ok("結果框一定會顯示出來", runCost({ rate: 33, hours: 38 }).hidden === false);

/* ------------------------------------------------------------ 浮點數邊界 */
console.log("\n— 浮點數邊界（舊事故：印出「短少 $0.00」）—");
(function () {
  /* 刻意湊一組稅後剛好等於支出的輸入：先算稅後，再把它整個填成房租。 */
  const probe = runCost({ rate: 30, hours: 38 });
  const net = probe.html.match(/稅後週薪<\/strong> <span class="num">\$([\d.]+)</);
  if (!net) { fail++; console.log("✗ 抓不到稅後週薪，後面的邊界測試無法進行"); return; }
  const exact = parseFloat(net[1]);
  const r = runCost({ rate: 30, hours: 38, rent: exact });
  ok("支出剛好等於稅後收入 → 不得判成負的",
    r.tone !== "bad" && !r.html.includes("短少"),
    `實得色調 ${r.tone}／判定「${r.verdict}」`);
  ok("剛好打平時不得出現 $-0.00", !r.html.includes("-0.00") && !r.verdict.includes("-0.00"));
  const r2 = runCost({ rate: 30, hours: 38, rent: exact + 0.01 });
  ok("再多一分錢就要判負", r2.tone === "bad", `實得 ${r2.tone}`);
})();

/* -------------------------------------------------------- 房租 30/40 rule */
console.log("\n— 房租佔比：ABS／AIHW 的 30/40 rule —");
(function () {
  /* 稅前 $1,000／週：$300 剛好踩線，$301 越線。 */
  const opts = { rate: 25, hours: 40 };   /* 25 × 40 = 1000 */
  const at = runCost(Object.assign({}, opts, { rent: 1000 * C.stress }));
  ok("剛好 30% 不判 housing stress",
    at.tone === "ok" && !at.verdict.includes("吃掉"),
    `實得色調 ${at.tone}／判定「${at.verdict}」`);
  ok("剛好 30% 要說「配得上這份工作」", at.html.includes("配得上"));
  const over = runCost(Object.assign({}, opts, { rent: 1000 * C.stress + 1 }));
  ok("超過 30% 判 warn", over.tone === "warn", `實得 ${over.tone}`);
  ok("超過 30% 要給兩條可動的路（降房租／加工時）",
    over.html.includes("房租降到") && over.html.includes("每週工時提高到"));
  ok("超過 30% 算出來的房租上限＝稅前的 30%",
    over.html.includes("$300.00"), "應出現 $300.00 作為房租上限");
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
  const a = runCost({ rate: 30, hours: 38, reg: "reg" });
  const b = runCost({ rate: 30, hours: 38, reg: "unreg" });
  const g = h => parseFloat((h.match(/稅後週薪<\/strong> <span class="num">\$([\d.]+)</) || [, "0"])[1]);
  ok("沒登記的稅後收入一定比較低", g(b.html) < g(a.html),
    `有登記 $${g(a.html)}／沒登記 $${g(b.html)}`);
  ok("「不知道」與「有登記」算出來一樣（不知道時採較保守的估法）",
    g(runCost({ rate: 30, hours: 38, reg: "unknown" }).html) === g(a.html));
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
  ok("有總計「其中幾小時是在付這些」", r.html.includes("小時</strong>是在付這三項"));
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
  ok("要提醒斷工，並給一個加了緩衝的數字", r.html.includes("週去抓比較接近現實"));
  const n = runCost({ rate: 30, hours: 40, rent: 200 });
  ok("沒填目標就不要講存錢", !n.html.includes("存到"));
})();

/* --------------------------------------------------- 包吃住／水電另計 */
console.log("\n— 住宿附帶條件 —");
t("不含水電 → 要說那筆錢還沒算進去",
  { rate: 30, hours: 38, rent: 200, bills: "exc" },
  { htmlHas: ["還沒進上面的計算", "獨立水表"] });
t("包吃住從薪水扣 → 要說必須在 payslip 分列",
  { rate: 30, hours: 38, rent: 200, bills: "farm" },
  { htmlHas: ["分開列", "書面同意"] });

/* -------------------------------------------------- 貼文與畫面必須一致 */
console.log("\n— 剪貼簿文字必須跟畫面判定一致 —");
for (const { o, mark } of [
  { o: { rate: 20, hours: 10, rent: 300 }, mark: "🛑" },
  { o: { rate: 25, hours: 40, rent: 400 }, mark: "⚠️" },
  { o: { rate: 30, hours: 38, rent: 200 }, mark: "✅" },
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
ok("這一區不得寫死任何「每週生活費大約多少」的金額",
  !JSON.stringify(C.save).match(/每週.{0,6}\$\d/) && !JSON.stringify(C.band).match(/每週.{0,6}\$\d/));

console.log(`\n${fail === 0 ? "全數通過" : "有失敗"}：${pass} 過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
