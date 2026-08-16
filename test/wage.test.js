#!/usr/bin/env node
/* 時薪判定的回歸測試。checkRate() 是全站唯一會主動指控雇主違法的地方，
   所以它是這個專案唯一強制要有測試的路徑。
 *
 * 為什麼是這一段有測試、別的沒有：checkRate() 是全站唯一會主動對使用者說出
 * 「你的雇主違法」的地方。這個判定錯一次，就會有人拿著錯的數字去跟雇主對峙，
 * 站的可信度歸零。2026-08-16 的 QA 就抓到兩類實際會發生的假指控：
 *   (a) 浮點數直接比 → 32.8375 判成低於 32.84，然後印「每小時少了 $0.00，這仍然違法」
 *   (b) 拿全國最低工資當地板 → 對合法的 award 入門級分類（園藝 Level 1／酒莊 Grade 1）下違法判定
 *
 * 這支測試不開瀏覽器：直接從 index.html 把 DATA 與 checkRate() 挖出來，
 * 配一組最小的 DOM 假件跑。跑法：
 *     node test/wage.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

/* 從原始檔挖出一段以 `{` 開頭的區塊，用大括號配對找結尾。
   刻意不用正規表示式抓整段——巢狀物件會讓 regex 提早收尾，測到的就不是正式版程式碼了。 */
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

const DATA_SRC  = slice("const DATA = {");
const CHECK_SRC = slice("function checkRate(){");

/* 最小 DOM 假件：checkRate 只碰四個 select／input 的 .value，跟一個結果容器。 */
const fields = {};
const box = { hidden: true, className: "", innerHTML: "" };
let clip = null;
const sandbox = {
  isFinite, parseFloat, Math, console,
  $: (sel) => (sel === "#rateans" ? box : (fields[sel] || { value: "" })),
  copyRow: (_box, text) => { clip = text; },
};
vm.createContext(sandbox);
/* const 宣告不會掛到 sandbox 上，要自己搬過去 */
vm.runInContext(DATA_SRC + ";\n" + CHECK_SRC + ";\nglobalThis.DATA = DATA; globalThis.checkRate = checkRate;", sandbox);

function run({ rate, type = "perm", sys = "unknown", age = "adult", cls = "unknown" }) {
  fields["#rate"]  = { value: String(rate) };
  fields["#etype"] = { value: type };
  fields["#esys"]  = { value: sys };
  fields["#eage"]  = { value: age };
  fields["#ecls"]  = { value: cls };
  box.className = ""; box.innerHTML = ""; clip = null;
  sandbox.checkRate();
  const tone = box.className.replace("ans ", "").trim();
  const verdict = (box.innerHTML.match(/<div class="verdict">([\s\S]*?)<\/div>/) || [, ""])[1];
  return { tone, verdict, html: box.innerHTML, clip };
}

/* ---------------------------------------------------------------- 測試案例 */
const W = sandbox.DATA.wage;
const E = W.entry;
let pass = 0, fail = 0;

function t(name, opts, expect) {
  const r = run(opts);
  const problems = [];
  if (expect.tone && r.tone !== expect.tone) problems.push(`色調應為 ${expect.tone}，實得 ${r.tone}`);
  if (expect.verdictHas && !r.verdict.includes(expect.verdictHas)) problems.push(`判定應含「${expect.verdictHas}」，實得「${r.verdict}」`);
  if (expect.htmlHas)  for (const s of [].concat(expect.htmlHas))  if (!r.html.includes(s)) problems.push(`內文應含「${s}」`);
  if (expect.htmlLacks) for (const s of [].concat(expect.htmlLacks)) if (r.html.includes(s)) problems.push(`內文不該含「${s}」`);
  if (problems.length) { fail++; console.log(`✗ ${name}\n    ` + problems.join("\n    ")); }
  else { pass++; console.log(`✓ ${name}`); }
}

console.log("\n— 護欄 —");
t("空白／零不判定", { rate: 0 }, { tone: "warn", verdictHas: "請輸入時薪" });
t("$900 是週薪不是時薪，不能判 ✅", { rate: 900 }, { tone: "warn", verdictHas: "這看起來不是時薪", htmlLacks: "✅" });
t("$200 仍當時薪處理（不誤擋）", { rate: 200 }, { tone: "ok" });
t("未滿 21 歲一律不判定", { rate: 20, age: "junior" }, { tone: "warn", verdictHas: "未滿 21 歲" });

console.log("\n— 浮點數邊界（舊版會印「少了 $0.00，這仍然違法」）—");
t("州系統 casual 剛好踩線不判違法", { rate: W.state.casualMin, type: "casual", sys: "wa", cls: "normal" },
  { tone: "ok", verdictHas: "剛好等於" });
t("32.8375 不得判成低於 32.84", { rate: 32.8375, type: "casual", sys: "wa", cls: "normal" },
  { tone: "ok", htmlLacks: ["🛑", "$0.00"] });
t("全國 casual 剛好踩線不判違法", { rate: W.casualMin, type: "casual", sys: "nat", cls: "normal" },
  { tone: "ok", verdictHas: "剛好等於" });

console.log("\n— 入門級分類：合法低於全國最低工資（QA 紅旗①）—");
t("園藝 Level 1 casual $32.18 且分類未確認 → 不得判違法", { rate: E.hort.casualMin, type: "casual", sys: "nat" },
  { tone: "warn", htmlLacks: "🛑" });
t("酒莊 Grade 1 casual $32.24 且分類未確認 → 不得判違法", { rate: E.wine.casualMin, type: "casual", sys: "nat" },
  { tone: "warn", htmlLacks: "🛑" });
t("園藝 Level 1 part-full $25.74 且分類未確認 → 不得判違法", { rate: E.hort.nmw, sys: "nat" },
  { tone: "warn", htmlLacks: "🛑" });
t("自稱入門級 + 低於一般地板 → ⚠️ 並說明期限", { rate: E.casualMin, type: "casual", sys: "nat", cls: "entry" },
  { tone: "warn", htmlHas: ["Level 1", "Grade 1", "往回追討"] });
t("低於入門級地板 → 才敢下 🛑", { rate: 30.00, type: "casual", sys: "nat" },
  { tone: "bad", verdictHas: "🛑", htmlHas: "入門級" });
t("一般分類低於全國地板 → 維持全力 🛑", { rate: 32.50, type: "casual", sys: "nat", cls: "normal" },
  { tone: "bad", verdictHas: "🛑", htmlHas: "一般分類" });

console.log("\n— 兩套系統（州 vs 全國）—");
t("介於兩條線之間且系統未填 → ⚠️ 不判違法", { rate: 32.90, type: "casual", cls: "normal" },
  { tone: "warn", htmlHas: "Pty Ltd", htmlLacks: "🛑" });
t("系統未填、分類未填、落在兩個原因之間 → 兩條理由都要出現",
  { rate: 32.50, type: "casual" },
  { tone: "warn", htmlHas: ["入門級", "Pty Ltd"] });
t("州系統踩線但可能其實是全國系統 → ✅ 要附翻盤警告",
  { rate: 32.90, type: "casual", sys: "wa", cls: "normal" },
  { tone: "ok", htmlHas: "結論會整個反過來" });
t("州系統違法 → 導向 Wageline 而非 Fair Work",
  { rate: 20, type: "casual", sys: "wa", cls: "normal" },
  { tone: "bad", htmlHas: "Wageline" });
t("州系統合法 → 不得叫人去用 Pay and Conditions Tool",
  { rate: 40, type: "casual", sys: "wa", cls: "normal" },
  { tone: "ok", htmlHas: "不要用 Fair Work 的 Pay and Conditions Tool" });

console.log("\n— 計件（QA 紅旗②：站上自己寫 Wine Award 沒有下限）—");
t("計件不下違法判定", { rate: 18, type: "piece", sys: "nat" },
  { tone: "warn", htmlLacks: "🛑" });
t("計件要同時講園藝有保底、酒莊沒有", { rate: 18, type: "piece", sys: "nat" },
  { htmlHas: ["每一個工作日", "沒有保底", "15%", "20%"] });
t("計件 + 州系統 → 要說聯邦 award 管不到", { rate: 18, type: "piece", sys: "wa" },
  { htmlHas: ["聯邦", "Wageline"] });

console.log("\n— 剪貼簿文字必須跟畫面判定一致 —");
(function () {
  const cases = [
    { o: { rate: 20, type: "casual", sys: "nat", cls: "normal" }, mark: "🛑" },
    { o: { rate: 32.50, type: "casual" }, mark: "⚠️" },
    { o: { rate: 40, type: "casual", sys: "nat", cls: "normal" }, mark: "✅" },
  ];
  for (const { o, mark } of cases) {
    const r = run(o);
    const ok = r.clip && r.clip.includes(mark) && r.verdict.includes(mark);
    if (ok) { pass++; console.log(`✓ 貼文與畫面同為 ${mark}`); }
    else { fail++; console.log(`✗ 貼文與畫面不一致（畫面「${r.verdict}」／貼文「${(r.clip || "").split("\n")[0]}」）`); }
  }
})();

console.log("\n— 退休金提醒每一條路徑都要在 —");
for (const o of [
  { rate: 20, type: "casual", sys: "nat", cls: "normal" },
  { rate: 32.50, type: "casual" },
  { rate: 40, type: "casual", sys: "nat", cls: "normal" },
  { rate: 18, type: "piece", sys: "nat" },
]) {
  const r = run(o);
  if (r.html.includes("退休金")) { pass++; console.log(`✓ $${o.rate} ${o.type} 有退休金提醒`); }
  else { fail++; console.log(`✗ $${o.rate} ${o.type} 少了退休金提醒`); }
}

console.log(`\n${fail === 0 ? "全數通過" : "有失敗"}：${pass} 過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
