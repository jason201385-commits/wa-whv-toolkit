#!/usr/bin/env node
/* 面板快照（golden file）比對。
 *
 * 為什麼要有這一支：
 * 斷言測的是「該出現的字串有出現」，突變測的是「常數改了會不會被抓到」。
 * 兩種都測不到**整段話組裝起來之後長什麼樣**——
 *   2026-08-17 的實例：剪貼簿在居民模式下印「WHM 稅率」與「離境領回課 65%」，
 *   而同一次計算的畫面印的是居民稅表與 35%。340 條斷言全綠，
 *   因為沒有任何一條斷言在看那一整段文字。
 * `render.js` 印得出來，但它沒有判定——只跑不讀等於沒跑，而人不會每次都讀。
 * 這一支把同一份輸出釘成檔案：**組裝邏輯只要動一個字，這裡就會紅。**
 *
 * 跑法：
 *   node test/golden.test.js              比對 test/golden.txt
 *   node test/golden.test.js --update     文案是故意改的，重寫快照
 *
 * ⚠️ `--update` 是這支測試唯一的失效方式。它紅的時候，
 *    **先把下面印出來的「舊 → 新」逐行讀完再決定要不要更新**。
 *    看到紅字直接 --update，這支測試就退化成一個很貴的 no-op。
 *    所以它一次只印前 40 個差異行，而且新舊都印——逼你真的看見改了什麼。
 *
 * 這支跟 render.js 的分工：
 *   render.js  → 相對今天算日期，人眼讀，四種狀態永遠都在（不會過期）
 *   golden     → 日期與輸入全部釘死，機器比對（可重現）
 * 兩支都留，因為它們防的不是同一種退化。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
const GOLDEN = path.join(__dirname, "golden.txt");
const UPDATE = process.argv.includes("--update");

/* 與 cost.test.js／settle.test.js／pr.test.js 同一套切法，同樣**刻意複製而不共用**：
   這幾支測試的存在理由就是彼此獨立，抽成共用工具會讓「改一支壞三支」。 */
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
function oneLine(needle) {
  const i = HTML.indexOf(needle);
  if (i < 0) throw new Error("在 index.html 找不到：" + needle);
  return HTML.slice(i, HTML.indexOf("\n", i));
}

/* 表格要在 td/th 之間補分隔、tr 收尾斷行，否則費用表會黏成一行，
   而那張表的重點正好是「哪個金額對到哪一條路」。 */
const plain = h => h
  .replace(/<\/t[dh]>/g, "　│　").replace(/<\/tr>/g, "\n")
  .replace(/<\/li>|<\/p>|<\/div>/g, "\n").replace(/<br\s*\/?>/g, "\n")
  .replace(/<[^>]+>/g, "").replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, "—")
  .split("\n").map(l => l.trim()).filter(Boolean).join("\n");

const out = [];
const put = s => out.push(s);
let scenes = 0;
function head(kind, label) {
  scenes++;
  put("");
  put("════════════════════════════════════════════════════════════");
  put(kind + "　" + label);
  put("════════════════════════════════════════════════════════════");
}

/* ═══════════════════════════ /cost ═══════════════════════════
   輸入全部寫死。稅表沒有「今天」的概念，所以這一區不需要假時鐘。 */
(function () {
  const SRC = [slice("const DATA = {"), slice("function whmTaxCents("),
    slice("function residentTaxCents("), slice("function medicareLevyCents("),
    slice("function checkCost(")].join(";\n");
  const fields = {}, box = { hidden: true, className: "", innerHTML: "" };
  let clip = null;
  const sb = {
    isFinite, parseFloat, Math, Number, String, console,
    $: s => s === "#costans" ? box : (fields[s] || { value: "" }),
    /* 剪貼簿是第二份輸出，而且是唯一會被貼進 LINE 群的那一份。
       它跟畫面各走各的組裝路徑，所以一定要一起釘。 */
    copyRow: (_b, text) => { clip = text; },
  };
  vm.createContext(sb);
  vm.runInContext(SRC + ";globalThis.checkCost = checkCost;", sb);

  function scene(label, inp) {
    Object.assign(fields, {
      "#crate": { value: "" }, "#chours": { value: "" }, "#ctax": { value: "reg" },
      "#crent": { value: "" }, "#cbills": { value: "inc" }, "#ctrans": { value: "walk" },
      "#ccar": { value: "" }, "#cfood": { value: "" }, "#cgoal": { value: "" },
    });
    Object.keys(inp).forEach(k => { fields["#" + k] = { value: String(inp[k]) }; });
    box.innerHTML = ""; box.className = ""; box.hidden = true; clip = null;
    sb.checkCost();

    head("/cost", label);
    put("輸入：" + Object.keys(inp).map(k => k + "=" + inp[k]).join("　"));
    put("tone：" + box.className.replace("ans", "").trim() + "　hidden：" + box.hidden);
    put("──── 畫面 ────");
    put(plain(box.innerHTML));
    put("──── 剪貼簿 ────");
    put(clip === null ? "（沒有剪貼簿）" : clip);
  }

  /* Medicare levy 的三段（免課／過渡 10%／全額 2%）各走一次——
     這三段是加居民稅表時最容易被寫成 min() 的地方。 */
  scene("居民・levy 門檻以下", { crate: 20, chours: 20, ctax: "resident" });
  scene("居民・levy 過渡段", { crate: 25, chours: 25, ctax: "resident" });
  scene("居民・levy 全額 2%＋房租", { crate: 35, chours: 38, ctax: "resident", crent: 250 });
  scene("居民・高收入", { crate: 40, chours: 75, ctax: "resident" });
  scene("WHM・雇主有登記", { crate: 35, chours: 38, ctax: "reg" });
  scene("WHM・雇主沒登記（外國居民表）", { crate: 35, chours: 38, ctax: "unreg" });
  scene("WHM・不知道有沒有登記", { crate: 30, chours: 38, ctax: "unknown", crent: 250, cbills: "exc" });
  /* 房租過重要單獨看。時薪刻意設在 casual 最低之上，
     否則「低於法定最低」的附註會一起長出來，兩個問題混在同一格分不出是誰壞的。 */
  scene("WHM・合法時薪＋房租過重＋存錢目標",
    { crate: 34, chours: 38, ctax: "reg", crent: 450, cfood: 120, ctrans: "pt", cgoal: 5000 });
  /* 這兩檔剛好跨在兩條線的兩側：$18 連不含 casual loading 的全國最低都不到，
     $27 過得了全國最低但過不了 casual 最低——後者是「可能合法也可能不合法」，
     文案不可以把它講成違法。 */
  scene("低於全國最低時薪", { crate: 18, chours: 38, ctax: "reg" });
  scene("過得了全國最低、過不了 casual 最低", { crate: 27, chours: 38, ctax: "reg" });
  scene("沒填時薪", {});
})();

/* ═══════════════════════════ /settle ═══════════════════════════
   這一區有兩個時鐘，所以時間必須釘死；日期也全部寫絕對值，
   不用「N 個月前」——相對日期會讓快照每天長不一樣，等於沒有快照。 */
(function () {
  const PR_HEAD = "/* ================= 年齡時鐘與點數";
  const tailBlock = HTML.slice(HTML.indexOf(PR_HEAD), HTML.lastIndexOf("</script>"));
  const SRC = [slice("const DATA = {"), oneLine("const esc = s =>"),
    oneLine("const el = (t,c,h) =>"), tailBlock].join(";\n");

  /* 假時鐘釘在 2026-08-17。改這個日期會讓整份快照重算，
     所以它跟快照是一組的——不要為了「看今天的樣子」而改它，那是 render.js 的工作。 */
  const NOW = [2026, 8, 17];
  const RealDate = Date;
  function FakeDate(...a) {
    if (a.length === 0) return new RealDate(NOW[0], NOW[1] - 1, NOW[2]);
    return new RealDate(...a);
  }
  FakeDate.UTC = RealDate.UTC;
  FakeDate.now = () => new RealDate(NOW[0], NOW[1] - 1, NOW[2]).getTime();
  FakeDate.prototype = RealDate.prototype;

  function mkEl(tag) {
    return {
      tag, className: "", innerHTML: "", value: "", hidden: true, max: "",
      dataset: {}, children: [], _h: {},
      appendChild(c) { this.children.push(c); return c; },
      setAttribute() {},
      addEventListener(ev, fn) { this._h[ev] = fn; },
      dispatchEvent(ev) { const f = this._h[ev && ev.type]; if (f) f(); },
    };
  }
  const boxes = {};
  ["#sans", "#sgo", "#sout", "#spr", "#sfee"].forEach(k => { boxes[k] = mkEl("div"); });
  const sb = {
    Math, Number, String, console, isFinite, parseFloat, Date: FakeDate,
    Event: function (t) { return { type: t }; },
    document: { createElement: mkEl, querySelector() { return null; } },
    $: s => boxes[s] || mkEl("div"),
  };
  vm.createContext(sb);
  vm.runInContext(SRC, sb);

  /* 費用表是 el()+appendChild 疊出來的，不是 HTML 字串，攤平時沒有 </li> 可以斷行，
     要自己按 tag 補，否則整張表黏成一行。 */
  function flat(n) {
    const kids = n.children.map(flat);
    const inner = (n.innerHTML || "") + (n.tag === "li" ? kids.join("　│　") : kids.join(""));
    return (n.tag === "li" || n.tag === "p") ? inner + "\n" : inner;
  }

  head("/settle", "費用表（開檔就渲染，不必按按鈕）");
  put(plain(flat(boxes["#sfee"])));

  function scene(label, sout, spr) {
    boxes["#sout"].value = sout || "";
    boxes["#spr"].value = spr || "";
    const b = boxes["#sans"];
    b.className = ""; b.innerHTML = ""; b.hidden = true;
    boxes["#sgo"]._h.click();
    head("/settle", label);
    put("輸入：離台日=" + (sout || "（空）") + "　PR 核准日=" + (spr || "（空）")
      + "　假今天=" + NOW.join("-"));
    put("tone：" + b.className.replace("ans", "").trim() + "　hidden：" + b.hidden);
    put("──── 畫面 ────");
    put(plain(b.innerHTML));
  }

  /* 兩個時鐘 ×（還在倒數／已經過了）四種組合，加上兩種只填一半——
     文案在其中一種狀態下讀起來會怪，是這一區最常見的退化方式。 */
  scene("兩個都空", "", "");
  scene("只填離台日・還在兩年內（2025-02-17）", "2025-02-17", "");
  scene("只填離台日・已超過兩年（2023-04-17）", "2023-04-17", "");
  scene("只填 PR 核准日・剛核准（2026-08-11）", "", "2026-08-11");
  scene("只填 PR 核准日・已過 8 個月（2025-12-17）", "", "2025-12-17");
  scene("兩個都填・都還在倒數", "2025-02-17", "2026-08-11");
  scene("兩個都填・都已經過了", "2023-04-17", "2025-12-17");
  /* 還沒出發、在台灣先規劃的人。輸入框的 max 會擋掉未來日期（見 index.html 的 b.max），
     所以 UI 上走不到這一格——但演算法不該因此爆掉，快照留著當防線。 */
  scene("離台日填未來（還沒出發，先規劃）", "2027-01-01", "");
})();

/* ═══════════════════════════ 比對 ═══════════════════════════ */
const now = out.join("\n").replace(/\s+$/, "") + "\n";

if (UPDATE) {
  fs.writeFileSync(GOLDEN, now, "utf8");
  console.log("已重寫 " + path.relative(ROOT, GOLDEN) + "（" + scenes + " 個場景）");
  console.log("⚠️  記得把 git diff 讀過一遍再 commit——這支測試的唯一失效方式就是盲目 --update。");
  process.exit(0);
}

if (!fs.existsSync(GOLDEN)) {
  console.log("✗ 找不到快照檔 " + path.relative(ROOT, GOLDEN));
  console.log("  第一次建立請跑：node test/golden.test.js --update");
  process.exit(1);
}

const want = fs.readFileSync(GOLDEN, "utf8");
if (want === now) {
  console.log("✓ 面板快照一致（" + scenes + " 個場景，"
    + now.split("\n").length + " 行）");
  process.exit(0);
}

/* 印出差異的時候新舊都印。只印一邊的話，讀的人沒有辦法判斷這是「文案改對了」
   還是「組裝壞了」，而判不出來的人會直接 --update。 */
const A = want.split("\n"), B = now.split("\n");
const diffs = [];
for (let i = 0; i < Math.max(A.length, B.length); i++) {
  if (A[i] !== B[i]) diffs.push({ n: i + 1, old: A[i], now: B[i] });
}
console.log("✗ 面板快照對不上：" + diffs.length + " 行不同（共 " + scenes + " 個場景）\n");
diffs.slice(0, 40).forEach(d => {
  console.log("  第 " + d.n + " 行");
  console.log("    舊：" + (d.old === undefined ? "（沒有這一行）" : d.old));
  console.log("    新：" + (d.now === undefined ? "（沒有這一行）" : d.now));
});
if (diffs.length > 40) console.log("  …… 還有 " + (diffs.length - 40) + " 行不同（只印前 40 行）");
console.log("\n讀完上面每一行，確認是你故意改的文案之後，才跑：");
console.log("  node test/golden.test.js --update");
process.exit(1);
