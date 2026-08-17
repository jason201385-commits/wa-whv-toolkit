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
  /* `.kv .n` 的 CSS 是 display:block，畫面上它自己一行。攤平時不補這個斷行的話，
     門檻總表會變成「IELTS AcademicProficient 7 / 7…」——名稱跟門檻黏在一起，
     快照就讀不出來了，而快照的全部價值就是讀得出來。 */
  .replace(/<span class="n">/g, "\n")
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
  /* ctrans 這一格 2026-08-17 之前填的是 `"pt"`——那不是 `#ctrans` 的合法值
     （合法的只有 walk／sr20／sr／cash／car），於是它靜默落回走路那條路，
     這一格的通勤費從頭到尾是 0，快照等於沒有釘住任何交通成本。
     不是拼錯字的小事：一個不存在的選項不會報錯，只會讓你以為測過了。
     改成 sr20（SmartRider 有開 Autoload，8 折）——是這個站建議的走法，
     也是唯一會同時走到折扣算式的那一支。 */
  scene("WHM・合法時薪＋房租過重＋存錢目標",
    { crate: 34, chours: 38, ctax: "reg", crent: 450, cfood: 120, ctrans: "sr20", cgoal: 5000 });
  /* 這兩檔剛好跨在兩條線的兩側：$18 連不含 casual loading 的全國最低都不到，
     $27 過得了全國最低但過不了 casual 最低——後者是「可能合法也可能不合法」，
     文案不可以把它講成違法。 */
  scene("低於全國最低時薪", { crate: 18, chours: 38, ctax: "reg" });
  scene("過得了全國最低、過不了 casual 最低", { crate: 27, chours: 38, ctax: "reg" });
  scene("沒填時薪", {});

  /* ↓↓ 以下這幾格是 2026-08-17 補的。補的理由不是「多幾個場景比較好看」——
     這一輪的兩個錯（剪貼簿房租行不跟著踩線走、未登記在剪貼簿印出兩組括號）
     剛好都躲在上面那十一格**沒有走到的分支**裡：沒有一格是負結餘、
     沒有一格踩在 30% 的線上、沒有一格同時觸發兩條附註。
     場景沒覆蓋到的分支，等於這支快照對它完全沒有意見。 */

  /* 負結餘 ＋ 存錢目標走不到。這兩件事寫在同一格：
     結餘是負的時候，「存到 N 週」那一段會換成另一句話，而那句話只有這裡走得到。 */
  scene("🛑 負結餘＋存錢目標走不到",
    { crate: 34, chours: 20, ctax: "reg", crent: 500, cfood: 200, cgoal: 3000 });

  /* 房租剛好踩在 30% 的線上：$387.65／$1,292 ＝ 30.003%，四捨五入印出來是 30.0%。
     判定用嚴格大於，顯示四捨五入，所以這一格會印出「30%」再說「超過 30%」——
     除非文案改講「剛好壓在線上」。三處輸出（標題、房租段、剪貼簿）都要一致。 */
  scene("房租剛好踩在 30% 的線上",
    { crate: 34, chours: 38, ctax: "reg", crent: 387.65 });

  /* 包吃住從薪水扣：附註那一段只有 cbills=farm 走得到。 */
  scene("農場包吃住（從薪水扣）",
    { crate: 34, chours: 38, ctax: "reg", crent: 150, cbills: "farm" });

  /* 開車通勤：transW 走的是使用者自己填的油錢，不是車資表。 */
  scene("開車通勤（自己填油錢）",
    { crate: 34, chours: 38, ctax: "reg", crent: 250, ctrans: "car", ccar: 90 });

  /* 兩條附註同時成立（未登記＋低於全國最低）。畫面收在一組括號裡，
     剪貼簿以前是兩組——這一格就是為了把那個分岔釘死。 */
  scene("未登記＋低於全國最低（兩條附註同時成立）",
    { crate: 18, chours: 38, ctax: "unreg" });

  /* 兩道新護欄。它們的價值在於「擋下來」而不是「算出來」，
     所以要看的是它有沒有真的中斷、以及那句話講不講得清楚。 */
  scene("時薪多打一個位數（超過上界）", { crate: 500, chours: 38, ctax: "reg" });
  scene("房租填成負數", { crate: 34, chours: 38, ctax: "reg", crent: -100 });

  /* ↓↓ 2026-08-17 第二輪 QA 之後補的四格。理由跟上一批一樣：
     這一輪修掉的三個錯全都躲在沒有場景走過的分支裡，包括一條
     「規則寫對了但沒有任何一格走得到」的通則（房租過重＋附註）。 */

  /* 房租過重 ＋ 一條附註：這是剪貼簿印出兩組括號的那個組合。
     上一輪加的「標題列最多一組括號」對它從來沒有執行過。 */
  scene("房租過重＋雇主未登記（兩組括號的入口）",
    { crate: 34, chours: 38, ctax: "unreg", crent: 450 });

  /* 30% 的下緣：剛好 30.0%，判定說沒超過、顯示也是 30.0。
     上一輪只修了超過的那一側，這一側原封不動印著「30%……低於 30%」。
     $300／$1,000 是唯一整除得漂亮的一組。 */
  scene("房租剛好 30.0%（線的另一側）",
    { crate: 40, chours: 25, ctax: "reg", crent: 300 });

  /* 房租高到補工時也救不了：needHours > 80 那一支會改口說
     「那不是這個房租的解法，那是這個房租不合理」——這句話只有這裡走得到。 */
  scene("房租高到補工時也救不了（needHours > 80）",
    { crate: 34, chours: 38, ctax: "reg", crent: 900 });

  /* 支出欄填 -1e999（parseFloat 得 -Infinity）。守門端與計算端以前
     對這個值的答案不一樣：守門說「不算負數」放行，計算說「不是有限數」歸零，
     於是房租憑空消失、結餘偏高、整頁看起來完全正常。 */
  scene("房租填 -1e999（守門與計算曾經各答各的）",
    { crate: 34, chours: 38, ctax: "reg", crent: "-1e999" });

  /* 時薪與工時各自都過得了護欄，乘起來仍然進位到 0——而那是後面
     每一個百分比的分母。這一格看的是它有沒有真的中斷。 */
  scene("週薪進位到 0（分母會是零）", { crate: 0.001, chours: 1, ctax: "reg" });

  /* ↓↓ 2026-08-17 第三輪 QA 之後補的四格。前一批補的是「沒有場景走過的分支」，
     這一批補的是**修法本身新開的分支**——新的護欄、新的原地訊息、新的打平句。
     修法沒有配場景的話，這支快照對修出來的那段文字從頭到尾沒有意見。 */

  /* 有限但過大：`isFinite()` 檢查的是「元」，×100 與 pct() 的 ×1000 之後才溢位。
     這一格看的是那句話講不講得清楚，以及上界是不是從 DATA 推出來的。 */
  scene("房租填 1e308（換算之後才溢位）",
    { crate: 34, chours: 38, ctax: "reg", crent: "1e308" });

  /* 存錢目標是選填欄，壞掉的時候走「原地講清楚」不是 bail——
     上面每一個數字都還是對的，為一個選填欄擋掉整頁不划算。
     所以這一格要同時看得到那句話**和**完整的稅後計算。 */
  scene("存錢目標填 1e308（選填欄壞掉，整頁照算）",
    { crate: 34, chours: 38, ctax: "reg", crent: 250, cgoal: "1e308" });
  scene("存錢目標填負數（同上，另一種壞法）",
    { crate: 34, chours: 38, ctax: "reg", crent: 250, cgoal: -5000 });

  /* 剛好打平：$1,034.21 是 $34×38 的稅後週薪，整個填成房租就是結餘 $0.00。
     舊寫法用 `leftW <= 0` 把零併進負數那一句，於是畫面同時寫著
     「每週剩下 $0.00」與「每週是負的，缺口只會越來越大」。 */
  scene("剛好打平＋存錢目標（結餘 $0.00 不是負的）",
    { crate: 34, chours: 38, ctax: "reg", crent: 1034.21, cgoal: 5000 });
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

/* ═══════════════════════════ /english ═══════════════════════════
   這一區的快照值特別高，因為它最容易壞的方式**斷言抓不到**：
   判定說「這張成績不能用」，同一個 innerHTML 底下卻照印到期日、倒數、
   整套邀請日換算。兩邊都在同一段字串裡，任何比對單一欄位的斷言都會全綠。
   把面板印成純文字擺在這裡，改壞的時候一眼就看得到多出來的那幾行。
   日期同樣全部寫絕對值——相對日期會讓快照每天長不一樣。 */
(function () {
  const PR_HEAD = "/* ================= 年齡時鐘與點數";
  const tailBlock = HTML.slice(HTML.indexOf(PR_HEAD), HTML.lastIndexOf("</script>"));
  const SRC = [slice("const DATA = {"), oneLine("const esc = s =>"),
    oneLine("const el = (t,c,h) =>"), tailBlock].join(";\n");

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
  /* `#etest` 要當成真的 <select>：指定選項以外的值會靜默變成 ""。
     假 DOM 用普通屬性的話，快照拍到的是「測試塞進去的值」而不是「使用者看得到的值」，
     於是換表把 IELTS 改判成 C1 這種事，快照裡永遠不會出現。 */
  function mkSelect() {
    const e = mkEl("select");
    let v = "";
    Object.defineProperty(e, "value", {
      get() { return v; },
      set(x) {
        const opts = [...String(e.innerHTML).matchAll(/value="([^"]*)"/g)].map(m => m[1]);
        v = opts.indexOf(String(x)) >= 0 ? String(x) : "";
      },
    });
    return e;
  }
  const boxes = {};
  ["#eans", "#ego", "#etest", "#edate", "#el", "#er", "#ew", "#es", "#esa", "#edelay", "#etbl"]
    .forEach(k => { boxes[k] = k === "#etest" ? mkSelect() : mkEl("div"); });
  const sb = {
    Math, Number, String, console, isFinite, parseFloat, Date: FakeDate,
    Event: function (t) { return { type: t }; },
    document: { createElement: mkEl, querySelector() { return null; } },
    $: s => boxes[s] || mkEl("div"),
  };
  vm.createContext(sb);
  vm.runInContext(SRC, sb);

  function flat(n) {
    const kids = n.children.map(flat);
    const inner = (n.innerHTML || "") + (n.tag === "li" ? kids.join("　│　") : kids.join(""));
    return (n.tag === "li" || n.tag === "p") ? inner + "\n" : inner;
  }

  head("/english", "門檻總表（開檔就渲染，不必按按鈕）");
  put(plain(flat(boxes["#etbl"])));

  /* 順序＝畫面上的真實順序：填日期 → 換表 → 才選考試（#edate 在 markup 裡就排在 #etest 前面）。
     ⚠️ 但**這個順序剛好是安全的那一個**，只跑它等於沒在測換表。
     真正會出事的是「填完之後回頭改日期」——年份打錯很常見，而改日期會重跑 fillTests()，
     使用者沒有做任何選擇動作，選的考試就被換掉了。`o.redate` 就是那條路。 */
  function scene(label, o) {
    /* 每個場景都當成重新開一次頁面：選單的 value 與 dataset.was 會跨場景殘留，
       不清掉的話調換兩個場景的順序就會讓快照變樣，而那種差異查不出原因。 */
    boxes["#etest"].innerHTML = ""; boxes["#etest"].value = ""; boxes["#etest"].dataset.was = "";
    boxes["#edate"].value = o.date || "";
    const ch = boxes["#edate"]._h.change; if (ch) ch();
    if (o.test) boxes["#etest"].value = o.test;
    if (o.redate) { boxes["#edate"].value = o.redate; if (ch) ch(); }
    ["#el", "#er", "#ew", "#es"].forEach((k, i) => {
      boxes[k].value = o.sc && o.sc[i] !== undefined ? String(o.sc[i]) : "";
    });
    boxes["#esa"].value = o.sa || "";
    boxes["#edelay"].value = o.delay === undefined ? "" : String(o.delay);
    const b = boxes["#eans"];
    b.className = ""; b.innerHTML = ""; b.hidden = true;
    boxes["#ego"]._h.click();
    head("/english", label);
    put("輸入：考試日=" + (o.date || "（空）")
      + (o.redate ? "→改成 " + o.redate : "") + "　考試=" + (o.test || "（沒選）")
      + "　四項=" + (o.sc ? o.sc.join("/") : "（空）")
      + "　技評核發日=" + (o.sa || "（空）")
      + "　遞件隔幾天=" + (o.delay === undefined ? "（空）" : o.delay)
      + "　假今天=" + NOW.join("-"));
    put("tone：" + b.className.replace("ans", "").trim() + "　hidden：" + b.hidden);
    put("──── 畫面 ────");
    put(plain(b.innerHTML));
  }

  scene("什麼都沒填", {});
  scene("四項只填兩項", { date: "2026-02-17", test: "ieltsA", sc: [7, 7] });
  scene("新制・Proficient・兩個時鐘都沒填", { date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7] });
  scene("新制・Superior", { date: "2026-02-17", test: "ieltsA", sc: [8, 8, 8, 8] });
  scene("新制・剛好 Competent", { date: "2026-02-17", test: "ieltsA", sc: [6, 6, 6, 6] });
  /* 三項 9 分、寫作差 0.5——「不看平均、不能互補」這句話的具體長相。 */
  scene("三項爆表・寫作差 0.5", { date: "2026-02-17", test: "ieltsA", sc: [9, 9, 7.5, 9] });
  /* ⚠️ 這一格是那個 bug 的現場：判定寫「還沒到 Competent」，
     舊版底下照印「這張成績能用到 2029-02-17（還有 2 年 6 個月）」跟整套邀請日換算。 */
  scene("四項沒到 Competent（不准倒數、不准算邀請日）",
    { date: "2026-02-17", test: "ieltsA", sc: [5, 5.5, 5, 6], sa: "2026-01-01", delay: 10 });
  scene("MET 到頂（這張考試沒有 Superior）", { date: "2026-02-17", test: "met", sc: [70, 70, 80, 70] });
  /* ⚠️ 同一個形狀的另一個分支：判定寫「不能用」，舊版底下照印到期日與邀請日。 */
  scene("落在不承認區間（不准印任何日期）",
    { date: "2024-01-15", test: "toefl", sc: [30, 30, 30, 30], sa: "2026-01-01", delay: 10 });
  scene("落在提醒型區間（只認紙筆版）", { date: "2024-06-01", test: "c1", sc: [200, 200, 200, 200] });
  /* ⚠️ 換表的三種下場，全部走「填完再回頭改日期」——**不是硬塞 value**。
     真的 <select> 選不到不存在的選項，硬塞出來的那條路使用者走不到，
     快照拍下來只是在替一條死路背書。舊版這三格都是硬塞的，而兩張表的第一個
     選項剛好都是 c1，所以「IELTS 被靜默改判成劍橋 C1」在舊快照裡看不出來。 */
  scene("改日期換到舊制表・那張表沒有這個考試（CELPIP）",
    { date: "2026-03-01", test: "celpip", redate: "2024-03-01", sc: [9, 9, 10, 9] });
  scene("改日期換到新制表・IELTS 被拆成兩張（成績沒作廢，要重選）",
    { date: "2024-03-01", test: "ielts", redate: "2026-03-01", sc: [7, 7, 7, 7] });
  scene("改日期換到舊制表・ieltsA 要合併回 ielts 照常算分",
    { date: "2026-03-01", test: "ieltsA", redate: "2024-03-01", sc: [7, 7, 7, 7] });
  scene("完全沒選考試種類", { date: "2026-03-01", sc: [7, 7, 7, 7] });
  scene("2/29 考的・加三年夾到 2/28", { date: "2024-02-29", test: "ielts", sc: [7, 7, 7, 7] });
  /* ⚠️ 第三個形狀：算得出「最晚邀請日」不代表它還在未來。
     成績只剩 45 天時，用滿 60 天邀請期的那個日期早就過去了。 */
  scene("剩不到 3 個月・保守邀請日已成過去式", { date: "2023-10-01", test: "pte", sc: [65, 65, 65, 65] });
  scene("已經過期（不做邀請日換算）", { date: "2022-08-17", test: "pte", sc: [65, 65, 65, 65] });
  scene("兩個時鐘・英文先關", { date: "2025-09-01", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2026-06-17", delay: 30 });
  scene("兩個時鐘・技術評估先關", { date: "2026-06-17", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2024-02-17" });
  scene("兩扇門同一天關", { date: "2025-09-01", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2025-09-01", delay: 0 });
  /* ⚠️ 第四個形狀，也是同一個：英文那一邊守了「算得出來 ≠ 還在未來」，
     技術評估那一邊當初沒守——核發日 2022-01-01 會印出「邀請日最晚是 2025-01-01」。 */
  scene("技評的 3 年早就走完（不准擺在「最晚」的位置）",
    { date: "2026-06-17", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2022-01-01" });
  scene("技評剩不到 3 個月", { date: "2026-06-17", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2023-08-20", delay: 10 });
  scene("遞件天數填超過 60 天", { date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7], delay: 90 });
  /* ⚠️ 第五個形狀，而且是同一個形狀走回招牌功能上：`gone` 只守到英文那一行，
     沒守到最後那句結論。這一格英文剩 45 天、技評還有一年多，
     舊版會在面板最底下、粗體、下定論的位置印
     「先關的是：英文。你能收到邀請的最晚日期是 2026-08-02」——那天已經過去。
     這一格與下一格分別釘住「技評還開著」與「技評也關了」兩支。 */
  scene("英文排不出邀請日、技評還開著（排不出 ≠ 來不及）",
    { date: "2023-10-01", test: "pte", sc: [65, 65, 65, 65], sa: "2025-01-01" });
  scene("兩邊都排不出來（技評關了、英文的保守日期也過去了）",
    { date: "2023-10-01", test: "pte", sc: [65, 65, 65, 65], sa: "2022-01-01" });
  /* 三種「不是正常天數」要分得開：負數、小數、看不懂。 */
  scene("遞件天數填負數", { date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7], delay: -5 });
  scene("遞件天數填小數（不能靜默捨去）", { date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7], delay: 30.7 });
  /* 考試日有「還沒到」的守，核發日當初沒有。 */
  scene("技評核發日填在未來", { date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2027-01-01" });
  /* ⚠️ 第六個形狀，這次錯的不是句子是算式：整區原本寫死「英文的 3 年量到遞件那天」，
     對 cutover（2025-08-07）以後考的成績是錯的——那一支量到「收到邀請」那天，
     效期那天本身就是最晚邀請日。舊寫法對新制少報最多一個邀請期，
     方向是「誤以為來不及」，代價是白花錢重考一張還能用的成績。
     這四格把兩支的長相各釘兩格：新制（填了天數／沒填）與舊制（填了天數／沒填）。
     考試日 2025-08-01 是刻意挑的——落在表二，效期又還很遠，
     不會跟「保守邀請日已成過去式」那一格的守混在一起。 */
  scene("新制・填了遞件天數（那個數字不會改變邀請日）",
    { date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2026-06-17", delay: 14 });
  scene("舊制・填了遞件天數（終點被壓到遞件那天）",
    { date: "2025-08-01", test: "pte", sc: [65, 65, 65, 65], sa: "2026-06-17", delay: 14 });
  scene("舊制・沒填遞件天數（給區間＋保守值）",
    { date: "2025-08-01", test: "pte", sc: [65, 65, 65, 65], sa: "2026-06-17" });
  scene("跨在 cutover 前一天考的（仍走舊制那一支）",
    { date: "2025-08-06", test: "pte", sc: [65, 65, 65, 65], sa: "2026-06-17", delay: 0 });
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
  /* 結尾那個換行不是一行。`split("\n")` 會多切出一個空字串，
     印出來的行數就比 `wc -l` 多一，而 README 抄的是這個數字。 */
  console.log("✓ 面板快照一致（" + scenes + " 個場景，"
    + now.replace(/\n$/, "").split("\n").length + " 行）");
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
