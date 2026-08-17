#!/usr/bin/env node
/* 英文區（/english）的回歸測試。
 *
 * 這一區為什麼特別容易錯：它同時處理**兩張門檻表**與**兩個效期時鐘**，
 * 而這四樣東西的邊界日期彼此不同——
 *   — 2025-08-07 換表（考試日在這天之前之後，對的是完全不同的門檻）
 *   — 2028-08-06 舊制成績的絕對大限
 *   — 成績本身的 3 年（量到**遞件**那天）
 *   — 技術評估的 3 年（量到**收到邀請**那天）
 * 網路上的中文懶人包幾乎都只講「IELTS 各 6 就有 Competent」，
 * 上面四條沒有一條被講清楚，而每一條都足以讓一份遞件作廢。
 *
 * 這支測試釘的不只是算術，還有**兩種不可以回頭的呈現方式**：
 *   （1）判定說不能用，內文不准照印到期日與邀請日換算；
 *   （2）四項沒到 Competent 的成績不准用「還有 N 年」倒數。
 * 這兩條都是實際發生過的——第一版兩樣都印了，斷言全綠，
 * 是把面板印成純文字讀出來才看見的（test/render.js）。
 *
 * 跑法：node test/english.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

/* 與 settle.test.js／pr.test.js／flags.test.js 同一套切法，同樣刻意複製而不共用：
   這幾支測試的存在理由就是彼此獨立，共用工具會讓「改一支壞三支」。 */
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

/* /english 共用 /pr 的日期工具（ymd／norm／dayGap／fmtD／human），
   所以連著整段 tail 切——切一半會變成 ReferenceError 而不是紅字，很難查。 */
const PR_HEAD = "/* ================= 年齡時鐘與點數";
if (HTML.indexOf(PR_HEAD) < 0) throw new Error("找不到 PR／定居區塊");
const tailBlock = HTML.slice(HTML.indexOf(PR_HEAD), HTML.lastIndexOf("</script>"));
const ENG_HEAD = "(function english(){";
if (tailBlock.indexOf(ENG_HEAD) < 0) throw new Error("找不到 /english 區塊");

const SRC = [slice("const DATA = {"), oneLine("const esc = s =>"), oneLine("const el = (t,c,h) =>"), tailBlock].join(";\n");

/* ---- 極簡假 DOM ---- */
let NOW = [2026, 8, 17];
const RealDate = Date;
function FakeDate(...a) {
  if (a.length === 0) return new RealDate(NOW[0], NOW[1] - 1, NOW[2]);
  return new RealDate(...a);
}
FakeDate.UTC = RealDate.UTC;
FakeDate.now = () => new RealDate(NOW[0], NOW[1] - 1, NOW[2]).getTime();

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
/* `#etest` 一定要當成真的 <select> 來假造，不能用上面那個「value 是普通屬性」的 div。
   真的 <select> **不接受選項以外的值**：指定一個選單上沒有的 value，它會靜默變成 ""。
   假 DOM 少了這一條的代價不是漏測，是**反向背書**——測試可以在 fillTests() 跑完之後
   直接把 value 塞成任何字串，於是 index.html 那條「這張表上沒有這個考試」在測試裡
   走得到、在瀏覽器裡永遠走不到，而「換表把 IELTS 靜默改判成 C1」在這裡看不出來。
   2026-08-17 QA 抓到的原話：修 fillTests 而不同時修這裡，下一輪會原地退化。 */
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
const sandbox = {
  Math, Number, String, console, isFinite, parseFloat,
  Date: FakeDate,
  Event: function (t) { return { type: t }; },
  document: { createElement: mkEl, querySelector() { return null; } },
  $: sel => boxes[sel] || mkEl("div"),
};
vm.createContext(sandbox);
vm.runInContext(SRC + ";\nglobalThis.DATA = DATA;\nglobalThis.dayGap = dayGap;\nglobalThis.ymd = ymd;", sandbox);

const E = sandbox.DATA.eng;
const dayGap = sandbox.dayGap;
const ymd = sandbox.ymd;

function flat(node) {
  return (node.innerHTML || "") + node.children.map(flat).join("");
}

/* 面板攤成「讀者實際讀到的字」。跟 render.js／golden.test.js 是同一套規則，
   同樣刻意各留一份（見檔頭）。
   為什麼斷言需要它：這個站抓到十八次的那個形狀，有一半躲在
   「兩截話都在同一個 innerHTML 裡、彼此矛盾」——`html.includes(...)` 對它是瞎的，
   因為兩截都在、兩截都 includes 得到。要判「這兩句不該同時出現」，
   得先有一份沒有標籤的文字，才寫得出否定式斷言。
   另外 `超過 <b class="num">60</b> 天` 這種橫跨標籤的句子，
   在原始 HTML 上根本比對不到——比對不到會偽裝成「這句話沒印」。 */
const plain = h => String(h)
  .replace(/<\/t[dh]>/g, "　│　").replace(/<\/tr>/g, "\n")
  .replace(/<span class="n">/g, "\n")
  .replace(/<\/li>|<\/p>|<\/div>/g, "\n").replace(/<br\s*\/?>/g, "\n")
  .replace(/<[^>]+>/g, "").replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, "—")
  .split("\n").map(l => l.trim()).filter(Boolean).join("\n");

/* 一次操作 = 填日期 → 觸發換表 → 選考試 → 填四項 → 按鈕。
   markup 裡 #edate 在 #etest 前面（861 vs 863），所以這是畫面上的真實順序。
   ⚠️ 但**這個順序剛好是安全的那一個**，而測試只跑安全順序，等於沒在測換表。
   真正會出事的是「填完之後回頭改日期」——年份打錯很常見，而改日期會重跑
   fillTests()，使用者沒有做任何選擇動作，選的考試就被換掉了。
   `o.redate` 就是那條路：先照正常順序填完，再改一次日期，然後才按按鈕。 */
function run(o) {
  if (o.now) NOW = o.now; else NOW = [2026, 8, 17];
  /* 每個情境都當成重新開一次頁面。選單的 value 與 dataset.was **會跨情境殘留**，
     不清掉的話「上一個情境選了什麼」會改變這一個情境的判定，
     於是調換兩個情境的順序就會有紅的——那種紅查不出原因。 */
  boxes["#etest"].innerHTML = ""; boxes["#etest"].value = ""; boxes["#etest"].dataset.was = "";
  boxes["#edate"].value = o.date || "";
  const ch = boxes["#edate"]._h.change; if (ch) ch();
  if (o.test) boxes["#etest"].value = o.test;
  if (o.redate) { boxes["#edate"].value = o.redate; if (ch) ch(); }
  ["#el", "#er", "#ew", "#es"].forEach((k, i) => {
    boxes[k].value = o.sc && o.sc[i] !== undefined && o.sc[i] !== null ? String(o.sc[i]) : "";
  });
  boxes["#esa"].value = o.sa || "";
  boxes["#edelay"].value = o.delay === undefined ? "" : String(o.delay);
  const box = boxes["#eans"];
  box.className = ""; box.innerHTML = ""; box.hidden = true;
  boxes["#ego"]._h.click();
  return {
    tone: box.className.replace("ans", "").trim(),
    verdict: (box.innerHTML.match(/<div class="verdict">([\s\S]*?)<\/div>/) || [, ""])[1],
    html: box.innerHTML,
    text: plain(box.innerHTML),
    hidden: box.hidden,
  };
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + (extra ? "\n    " + extra : "")); }
}

/* ================================================ 1. 資料自洽 */
console.log("— 資料自洽 —");

ok("兩張表的分界日對得上：t1.from 就是 cutover",
  E.t1.from === E.cutover, "cutover=" + E.cutover + " t1.from=" + E.t1.from);
ok("t2.until 恰好是 cutover 的前一天",
  dayGap(ymd(E.t2.until), ymd(E.cutover)) === 1,
  "until=" + E.t2.until + " cutover=" + E.cutover);

let shapeBad = [];
[["t1", E.t1], ["t2", E.t2]].forEach(([tn, tb]) => {
  Object.keys(tb.tests).forEach(k => {
    const t = tb.tests[k];
    if (!t.name) shapeBad.push(tn + "." + k + " 沒有 name");
    E.levels.forEach(lv => {
      const th = t[lv.k];
      if (th == null) return;                      /* 這張考試沒有這一級，合法 */
      if (Array.isArray(th)) {
        if (th.length !== 4) shapeBad.push(tn + "." + k + "." + lv.k + " 不是四項");
        if (th.some(x => typeof x !== "number" || !isFinite(x)))
          shapeBad.push(tn + "." + k + "." + lv.k + " 有非數字");
      } else if (typeof th !== "string") {
        shapeBad.push(tn + "." + k + "." + lv.k + " 既不是四項陣列也不是字母級");
      }
    });
  });
});
ok("每張考試的每一級不是四項數字就是字母級", shapeBad.length === 0, shapeBad.join("、"));

/* 門檻必須由低到高單調不減。抄表最常見的錯是把某一項抄反，
   而抄反之後計算機仍然「算得出答案」——只是答案是錯的，不會有人發現。 */
let mono = [];
[["t1", E.t1], ["t2", E.t2]].forEach(([tn, tb]) => {
  Object.keys(tb.tests).forEach(k => {
    const t = tb.tests[k];
    const chain = ["competent", "proficient", "superior"].map(x => t[x]).filter(Array.isArray);
    for (let i = 1; i < chain.length; i++)
      for (let j = 0; j < 4; j++)
        if (chain[i][j] < chain[i - 1][j])
          mono.push(tn + "." + k + " 第 " + E.parts[j] + " 項：" + chain[i - 1][j] + " → " + chain[i][j]);
  });
});
ok("每張考試的門檻由 Competent → Proficient → Superior 單調不減", mono.length === 0, mono.join("、"));

ok("levels 由高到低排，points 三級都有對應分數",
  E.levels.map(l => l.k).join(",") === "superior,proficient,competent" &&
  E.points.superior === 20 && E.points.proficient === 10 && E.points.competent === 0);
ok("舊制表比新制表少三種考試（CELPIP／MET／LANGUAGECERT 不在上面）",
  ["celpip", "met", "lc"].every(k => E.t1.tests[k] && !E.t2.tests[k]));
ok("noCalc 裡的每一項都真的存在於某一張表",
  E.noCalc.every(k => E.t1.tests[k] || E.t2.tests[k]), E.noCalc.join("、"));

/* ================================================ 2. 換表 */
console.log("\n— 換表（" + E.cutover + "）—");

ok("cutover 當天走新制表（IELTS Academic 存在）",
  run({ date: E.cutover, test: "ieltsA", sc: [7, 7, 7, 7] }).html.includes("Table 1"));
ok("cutover 前一天走舊制表",
  run({ date: E.t2.until, test: "ielts", sc: [7, 7, 7, 7] }).html.includes("Table 2"));

/* ---- 換表時「原本選的那一張」的三種下場 ----
   這一組是 2026-08-17 QA 的核心：原本只斷言「換表後的 value 是舊表上的某一個 key」，
   而**兩張表的第一個 key 都是 c1**，所以 `c1` 滿足那條斷言——
   一個把 IELTS 考生改判成劍橋 C1 的 bug，在那條斷言底下是綠的。
   斷言要指名「應該變成哪一個」，不能只問「是不是合法值」。 */
{
  /* ① 有等價的 → 對映過去。ieltsA 在舊表就是那一格 ielts，不是別的東西。 */
  const eq = run({ date: "2026-01-01", test: "ieltsA", redate: "2024-01-01", sc: [7, 7, 7, 7] });
  ok("換到舊制表：ieltsA 要對映成 ielts，不是落到表上的第一項",
    boxes["#etest"].value === "ielts", "換表後 value=" + boxes["#etest"].value);
  ok("對映過去之後照常算分（不是走錯誤訊息）",
    !eq.verdict.includes("沒有這個考試") && eq.html.includes("Table 2"), eq.verdict);

  /* ② 新表把它拆開了 → 不准替人挑一張，但也不准說「沒有這個考試」。 */
  const sp = run({ date: "2024-01-01", test: "ielts", redate: "2026-01-01", sc: [7, 7, 7, 7] });
  ok("換到新制表：ielts 不會被靜默改判成 c1", boxes["#etest"].value !== "c1",
    "換表後 value=" + boxes["#etest"].value);
  ok("而且要說「拆成兩種請重選」，不能說「這張表上沒有 IELTS」（那是假的）",
    sp.verdict.includes("分成兩種") && !sp.verdict.includes("沒有這個考試"), sp.verdict);
  ok("拆開那條路要明講成績沒作廢，否則讀者會以為整張成績不能用",
    sp.html.includes("沒有作廢"));
  ok("拆開是「要重選」不是「你不合格」，語氣不該用 bad", sp.tone === "warn", sp.tone);

  /* ③ 新表真的沒有 → 既有的那條「這張表上沒有這個考試」。
       注意這裡走的是**改日期**，不是硬塞 value：瀏覽器上選不到不存在的選項，
       所以硬塞出來的那條路是測試自己造的，不是使用者走得到的。 */
  const wrongTbl = run({ date: "2026-03-01", test: "celpip", redate: "2024-03-01", sc: [9, 9, 10, 9] });
  ok("換到舊制表：CELPIP 走「這張表上沒有這個考試」，不靜默改判",
    wrongTbl.tone === "bad" && wrongTbl.verdict.includes("沒有這個考試"), wrongTbl.verdict);
  ok("那條路要說明舊制表只有幾種考試，不是只說「錯了」",
    wrongTbl.html.includes(String(Object.keys(E.t2.tests).length) + " 種考試"));

  /* ④ 什麼都沒選 → 第三句話。這是初始狀態，以前被「預設選第一項」蓋住了。 */
  const none = run({ date: "2026-03-01", sc: [7, 7, 7, 7] });
  ok("完全沒選考試種類時要說「還沒選」，不是拿第一項幫他算",
    none.verdict.includes("還沒選"), none.verdict);

  /* ⑤ 選單本身：不存在的選項不准留在 DOM 上。 */
  ok("換表之後選單上不會出現另一張表才有的考試",
    boxes["#etest"].innerHTML.indexOf('value="ielts"') < 0 ||
    boxes["#etest"].innerHTML.indexOf('value="ieltsA"') < 0,
    boxes["#etest"].innerHTML.slice(0, 120));

  /* ⑥ splitInto 是資料，會跟表一起腐壞——對照表指到不存在的 key 就完全失效。 */
  ok("splitInto 的每一項都指得到真的存在的 key",
    Object.keys(E.splitInto).every(k => E.t2.tests[k] &&
      E.splitInto[k].every(v => E.t1.tests[v])), Object.keys(E.splitInto).join("、"));
}

ok("選單不列 OET（字母級不進計算機）",
  boxes["#etest"].innerHTML.indexOf('value="oet"') < 0);

/* ================================================ 3. 沒填 / 填不全 */
console.log("\n— 沒填 / 填不全 —");

const blank = run({});
ok("什麼都沒填 → 先要考試日期，不是先罵分數", blank.tone === "warn" && blank.verdict.includes("考試日期"));
ok("答案框一定先取消 hidden", blank.hidden === false);

const half = run({ date: "2026-02-17", test: "ieltsA", sc: [7, 7] });
ok("四項只填兩項 → 判不出級別", half.tone === "warn" && half.verdict.includes("四項"));
ok("而且要講出「不能拿其他三項推」", half.html.includes("不能拿其他三項推"));
ok("負數當成沒填", run({ date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, -1] }).verdict.includes("四項"));
ok("看不懂的字當成沒填", run({ date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, "七"] }).verdict.includes("四項"));
ok("千分位逗號當成沒填（成績單上不會有逗號）",
  run({ date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, "7,0"] }).verdict.includes("四項"));

/* ================================================ 4. 級別判定 */
console.log("\n— 級別判定 —");

const prof = run({ date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7] });
ok("IELTS A 7/7/7/7 → Proficient 10 分", prof.verdict.includes("Proficient") && prof.verdict.includes("10 分"));
ok("判定裡的級別與分數之間有間隔，不會黏成「Proficient10 分」",
  !/Proficient\d/.test(prof.verdict), prof.verdict);

const sup = run({ date: "2026-02-17", test: "ieltsA", sc: [8, 8, 8, 8] });
ok("IELTS A 8/8/8/8 → Superior 20 分", sup.verdict.includes("Superior") && sup.verdict.includes("20 分"));

/* 四項各自比、不能互補：三項爆表、一項差 0.5，仍然只是下面那一級。 */
const noAvg = run({ date: "2026-02-17", test: "ieltsA", sc: [9, 9, 7.5, 9] });
ok("三項 9 分、寫作 7.5 → 還是 Proficient（不看平均、不能互補）",
  noAvg.verdict.includes("Proficient"), noAvg.verdict);
ok("而且要指名差在哪一項、差多少", noAvg.html.includes("寫 差 0.5"));

const comp = run({ date: "2026-02-17", test: "ieltsA", sc: [6, 6, 6, 6] });
ok("IELTS A 6/6/6/6 → Competent，tone 是 warn 不是 ok",
  comp.verdict.includes("Competent") && comp.tone === "warn", comp.tone + " / " + comp.verdict);

const under = run({ date: "2026-02-17", test: "ieltsA", sc: [5, 5.5, 5, 6] });
ok("四項沒到 Competent → bad", under.tone === "bad" && under.verdict.includes("還沒到 Competent"));
ok("沒到 Competent 時不再重複列一次「還差」（上面每一列已經標了 ✗）",
  !under.html.includes("再上一級是"), "多印了「再上一級是」");
ok("要講清楚 Competent 是門檻不是選項", under.html.includes("不是可以跳過的一級"));

const met = run({ date: "2026-02-17", test: "met", sc: [70, 70, 80, 70] });
ok("MET 到 Proficient 就沒有更高的了", met.verdict.includes("Proficient"));
ok("而且要講明「這張考試沒有 Superior 這一級」",
  met.html.includes("沒有 Superior 這一級"), met.html.slice(0, 200));
ok("MET 頂級之後不會再印「再上一級是」", !met.html.includes("再上一級是"));

/* 每一張考試都要能在自己的門檻上剛好判到那一級——抄表抄錯會在這裡整批紅。 */
let exact = [];
Object.keys(E.t1.tests).forEach(k => {
  if (E.noCalc.indexOf(k) >= 0) return;
  E.levels.forEach(lv => {
    const th = E.t1.tests[k][lv.k];
    if (!Array.isArray(th)) return;
    const r = run({ date: "2026-02-17", test: k, sc: th });
    /* ⚠️ 不能只寫 includes(lv.n)：判定失敗那一句是「四項還沒到 Competent」，
       它自己就含著 "Competent" 三個字，所以 lv.n === "Competent" 那一輪
       無論算對算錯都會綠。整支測試最貴的一條斷言（每張考試 × 每一級）
       在最低那一級上是瞎的——把門檻改成 `<=` 這種突變照樣過。
       這跟 cost.test.js 那個 `[\d.]+` 是同一個病：比對條件寬到把反例也吃進去。 */
    const negated = r.verdict.includes("還沒到");
    if (!r.verdict.includes(lv.n) || negated) exact.push(k + " 剛好 " + lv.n + " 的門檻卻判成「" + r.verdict + "」");
  });
});
ok("新制表每張考試、每一級，剛好踩在門檻上都判得到那一級", exact.length === 0, exact.join("\n    "));

/* 門檻減一分就要掉下來。只驗最低那一級（Competent），掉下去就是 null。 */
let offByOne = [];
Object.keys(E.t1.tests).forEach(k => {
  if (E.noCalc.indexOf(k) >= 0) return;
  const th = E.t1.tests[k].competent;
  if (!Array.isArray(th)) return;
  for (let i = 0; i < 4; i++) {
    const sc = th.slice(); sc[i] = sc[i] - 0.5;
    const r = run({ date: "2026-02-17", test: k, sc: sc });
    if (!r.verdict.includes("還沒到 Competent")) offByOne.push(k + " 的" + E.parts[i] + "少 0.5 卻還算 Competent");
  }
});
ok("Competent 門檻任何一項少 0.5 就掉下來（四項各自比）", offByOne.length === 0, offByOne.join("\n    "));

/* ================================================ 5. 有效期 */
console.log("\n— 有效期（" + E.validYears + " 年）—");

const exp3 = run({ date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7] });
ok("考試日 + 3 年就是到期日", exp3.html.includes("2029-02-17"));
ok("要講清楚是量到「遞件那天」，不是拿成績那天起算",
  exp3.html.includes("遞件那天") && exp3.html.includes("不是從你拿到成績單那天"));

const leap = run({ date: "2024-02-29", test: "ielts", sc: [7, 7, 7, 7] });
ok("2024-02-29 加 3 年夾到 2027-02-28（往前夾，不多報剩餘時間）",
  leap.html.includes("2027-02-28"), leap.html.slice(0, 400));
ok("夾過就要說出來，不能靜默改日期", leap.html.includes("夾到當月最後一天"));

const near = run({ date: "2023-10-01", test: "pte", sc: [65, 65, 65, 65] });
ok("剩不到 3 個月 → tone 降成 warn", near.tone === "warn", near.tone);
ok("而且要提醒考位要排、成績要等", near.html.includes("考位"));

const dead = run({ date: "2022-08-17", test: "pte", sc: [65, 65, 65, 65] });
ok("已經過期 → bad，判定要說「已經過期」", dead.tone === "bad" && dead.verdict.includes("已經過期"));

/* ---- 舊制大限：證明 capped 那一支碰不到，而不是假設它碰不到 ---- */
let cappedHit = null;
{
  const cap = ymd(E.oldExpiry);
  let d = ymd("2000-01-01");
  const last = ymd(E.t2.until);
  while (dayGap(d, last) >= 0) {
    const y = d[0] + E.validYears;
    const lastDay = new Date(Date.UTC(y, d[1], 0)).getUTCDate();
    const plus = [y, d[1], Math.min(d[2], lastDay)];
    if (dayGap(cap, plus) > 0) { cappedHit = d.join("-") + " + 3 年 = " + plus.join("-") + "，晚於 " + E.oldExpiry; break; }
    /* 往後一天 */
    const nx = new Date(Date.UTC(d[0], d[1] - 1, d[2] + 1));
    d = [nx.getUTCFullYear(), nx.getUTCMonth() + 1, nx.getUTCDate()];
  }
}
ok("逐日掃 2000-01-01～" + E.t2.until + "：沒有任何一天的 3 年會晚過 " + E.oldExpiry
  + "（所以 capped 是死支，突變它等於等價突變，不要寫那條突變）",
  cappedHit === null, cappedHit);

ok("舊制成績一律要印出那條絕對大限與官方腳註原文",
  dead.html.includes(E.oldExpiry) && dead.html.includes("inclusive"));
ok("而且要糾正「所有舊成績都能用到 2028」這個誤讀",
  dead.html.includes("很多人把它讀成"));
ok("新制成績不印那條大限（那是舊制專屬的）", !exp3.html.includes(E.oldExpiry));

/* ================================================ 6. 不承認 / 特別註記區間 */
console.log("\n— 官方特別註記的區間 —");

const bad1 = run({ date: "2024-01-15", test: "toefl", sc: [30, 30, 30, 30] });
ok("TOEFL 落在不承認區間 → bad，判定就說不能用",
  bad1.tone === "bad" && bad1.verdict.includes("不能用"), bad1.verdict);
ok("理由排在最前面，不是掉到最下面才講",
  bad1.html.indexOf("不被承認") < bad1.html.indexOf("聽："), "不承認的說明排在逐項表格後面");

/* ⚠️ 這四條是第一版真的印出來過的東西：判定寫「不能用」，內文照印到期日與整套邀請日換算。
   斷言全綠、golden 也綠——因為兩邊都在同一個 innerHTML 裡，沒有任何一條斷言在比它們一致。 */
ok("不能用的成績不准有到期日", !bad1.html.includes("這張成績能用到"), "又印了到期日");
ok("不能用的成績不准做邀請日換算", !bad1.html.includes("最晚什麼時候要收到邀請"), "又印了邀請日換算");
ok("不能用的成績不准出現「還有 N 年／個月」的倒數", !/還有 \d/.test(bad1.html), "又印了倒數");
ok("要明講「這裡不印那些日期」以及為什麼", bad1.html.includes("要有日期可以排"));
/* 逐項表照印，但四個 ✓ 不能讀成「你考到 Superior 了」——判定明明說整張不算數。 */
ok("不能用的成績，逐項表前面要先拆掉「✓ ＝ 這張能用」的暗示",
  bad1.html.includes("不是判定") && bad1.html.includes("打勾不代表這張拿得出去"),
  "四個綠勾勾旁邊沒有任何一句話擋著");
ok("那句話要排在逐項表之前，不是之後",
  bad1.html.indexOf("打勾不代表") < bad1.html.indexOf("聽："));
ok("過期的成績不套這句話（那一級他當年真的拿到了，兩句話不衝突）",
  !dead.html.includes("打勾不代表這張拿得出去"));

const bad1w = run({ date: "2024-01-15", test: "toefl", sc: [30, 30, 30, 30], sa: "2026-01-01", delay: 10 });
ok("就算兩個時鐘都填了，不能用的成績照樣不印時鐘",
  !bad1w.html.includes("先關的是") && !bad1w.html.includes("技術評估這一邊"));

const soft = run({ date: "2024-06-01", test: "c1", sc: [200, 200, 200, 200] });
ok("只認紙筆版那條是提醒不是阻斷 → tone 不是 bad", soft.tone !== "bad", soft.tone);
ok("提醒型的區間排在下面，用「特別註記」的句型", soft.html.includes("特別註記的區間"));
ok("提醒型不影響到期日的計算", soft.html.includes("2027-06-01"));
ok("不承認的那條不會重複印兩次（阻斷型排在最前面就不再進下面的清單）",
  (bad1.html.match(/不被承認/g) || []).length === 1);

/* 區間的兩端都要含在內。TOEFL 那條是 2023-07-26 ～ 2024-05-04。 */
const w = E.windows.filter(x => x.kind === "bad")[0];
ok("不承認區間的起日當天就算在內",
  run({ date: w.from, test: w.test, sc: [30, 30, 30, 30] }).tone === "bad");
ok("不承認區間的迄日當天還算在內",
  run({ date: w.to, test: w.test, sc: [30, 30, 30, 30] }).tone === "bad");
{
  const before = new Date(Date.UTC(ymd(w.from)[0], ymd(w.from)[1] - 1, ymd(w.from)[2] - 1));
  const bstr = before.toISOString().slice(0, 10);
  const r = run({ date: bstr, test: w.test, sc: [30, 30, 30, 30] });
  ok("起日前一天不在區間內（" + bstr + "）", r.tone !== "bad" || !r.verdict.includes("不能用"), r.verdict);
}

/* ================================================ 7. 四項沒到 Competent 不准倒數 */
console.log("\n— 沒到 Competent 就不排時程 —");

ok("沒到 Competent → 不印「這張成績能用到」的倒數句型",
  !under.html.includes("這張成績能用到"), "又用倒數句型包裝一張進不了點數表的成績");
ok("沒到 Competent → 不做邀請日換算",
  !under.html.includes("最晚什麼時候要收到邀請"));
ok("但效期這個事實還是要給（別的簽證類別門檻不一樣）",
  under.html.includes("2029-02-17") && under.html.includes("效期"));
ok("而且要明說那不是現在該看的數字", under.html.includes("不是你現在該看的數字"));

const underClocks = run({ date: "2026-02-17", test: "ieltsA", sc: [5, 5, 5, 5], sa: "2026-01-01", delay: 10 });
ok("沒到 Competent 時，就算兩個時鐘都填了也不印",
  !underClocks.html.includes("先關的是") && !underClocks.html.includes("兩扇門同一天關"));

/* ================================================ 8. 邀請日換算 */
console.log("\n— 邀請日換算（189 的 " + E.inviteDays + " 天邀請期）—");

/* ⚠️ 這一整區 2026-08-17 改過語意。原本整個模組寫死「英文的 3 年量到遞件那天」，
   對 cutover（E.cutover）以後考的成績是錯的：那一支只受
   Migration Regulations 1994 reg 1.15C(1)(ba) 管，量到「收到邀請」那天，
   效期那天本身就是最晚邀請日，不必再往前扣邀請期。
   舊寫法對新制成績少報最多一個邀請期，而且方向是「誤以為來不及」——
   代價是白花錢重考一張其實還能用的成績。底下的斷言全部照兩支分開釘。 */
ok("新制留空 → 最晚邀請日就是效期那天本身，不再往前扣邀請期",
  prof.text.includes("最晚要在 2029-02-17 收到邀請"), prof.text.slice(-1200));
ok("而且要明說那 " + E.inviteDays + " 天不從這個日期扣（不講的話讀者會自己再扣一次）",
  prof.text.includes("不從上面的日期扣"), prof.text.slice(-1200));
ok("新制不該再出現「用好用滿」那個區間句型",
  !prof.text.includes("用好用滿"), prof.text.slice(-1200));

/* 移民部說明頁比法規鬆（"in the 3 years before your visa application"），
   兩份官方文件不牴觸——頁面那句自己留了 depending on the visa subclass 的活口。
   這種時候不替讀者選一個，兩個日期都給，並標明哪個是法條、哪個是保守。 */
ok("兩份官方文件口徑不同要講出來，並附上保守日",
  prof.text.includes("2028-12-19") && prof.text.includes("depending on the visa subclass"),
  prof.text.slice(-1200));
ok("但保守日不能被寫成死線——它過去了不等於來不及",
  prof.text.includes("不要因為保守日過去了就以為來不及"), prof.text.slice(-1000));

const d0 = run({ date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7], delay: 0 });
ok("填 0 天 → 邀請日就是到期日本身", d0.html.includes("2029-02-17"));
ok("而且要說明 0 跟留空不是同一件事", d0.html.includes("留空是還不知道"));

const d90 = run({ date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7], delay: 90 });
ok("填超過 " + E.inviteDays + " 天 → 要說明邀請本身會失效",
  d90.text.includes("超過 " + E.inviteDays + " 天") && d90.text.includes("邀請本身就失效"),
  d90.text.slice(-600));
/* ⚠️ 這一條要用 text 不能用 html：句子裡的數字包在 <b class="num"> 裡，
   原始 HTML 上比對「超過 60 天」永遠是 false——而 false 會偽裝成「這句沒印」。 */
ok("而且不准同時說「你填的是 " + E.inviteDays + " 天」——填 90 的人沒填過 " + E.inviteDays,
  !d90.text.includes("你填的是收到邀請後 " + E.inviteDays + " 天"), d90.text.slice(-500));
/* 同一個形狀的另一半：新制那一支複述使用者輸入時也不能拿夾完的數字。 */
ok("新制複述遞件天數要用使用者填的 90，不是夾完的 " + E.inviteDays,
  d90.text.includes("你填了隔 90 天遞件"), d90.text.slice(-600));
ok("而且要說清楚那個數字改不動上面的日期（不然讀者以為被吃掉了）",
  d90.text.includes("那不會改變上面的日期"), d90.text.slice(-600));

const dbad = run({ date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7], delay: "abc" });
ok("遞件天數看不懂 → 當成沒填並講出來", dbad.html.includes("看不懂"));

/* 負數與小數原本各自被吃掉：−5 歸到「看不懂」（跟打錯字混為一談），
   30.7 被 Math.floor 靜默改成 30，讀者完全不會知道。 */
const dneg = run({ date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7], delay: -5 });
ok("遞件天數填負數 → 要單獨講，不跟「看不懂」混為一談",
  dneg.text.includes("負數") && !dneg.text.includes("看不懂"), dneg.text.slice(-400));
ok("而且要講明理由是邀請還沒發出來", dneg.text.includes("邀請還沒發出來"));

/* 考試日有「還沒到」的守，核發日當初沒有。`saIn.max` 只是 HTML 屬性，擋不住貼上。 */
const saFut = run({ date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2027-01-01" });
ok("技評核發日填在未來 → 要講明那份還沒發出來，不能當成既有事實",
  saFut.text.includes("還沒發出來"), saFut.text.slice(-600));
ok("而且提醒要跟著那個數字走（在技評那一行，不是等結論講完才補）",
  saFut.text.indexOf("還沒發出來") < saFut.text.indexOf("先關的是"), saFut.text.slice(-600));
ok("結論句也要帶著這個但書（那句話是拿未來的日期比出來的）",
  saFut.text.lastIndexOf("還沒發出來") > saFut.text.indexOf("先關的是"), saFut.text.slice(-600));

const dfrac = run({ date: "2026-02-17", test: "ieltsA", sc: [7, 7, 7, 7], delay: 30.7 });
ok("遞件天數填小數 → 要說出被當成幾天，不能靜默無條件捨去",
  dfrac.text.includes("30.7") && dfrac.text.includes("當成 30 天"), dfrac.text.slice(-400));

/* ⚠️ 算得出來不等於還在未來。成績剩不到 60 天時，用滿邀請期的那個日期早就過去了。 */
ok("保守邀請日已經過去時要講出來，不能擺在「最晚」的位置裝作還有得排",
  near.html.includes("已經過去了") && near.html.includes("45 天"), near.html.slice(-600));
const gone2 = run({ date: "2023-10-01", test: "pte", sc: [65, 65, 65, 65], delay: 60 });
ok("填了具體天數而那一天也過了，同樣要講", gone2.html.includes("那一天已經過了"));

/* ============================ 8b. 舊制那一支：終點被壓到「遞件」那天
   分界就是 E.cutover，跟表一／表二用的是同一個日期。這一支的日期算法沒有變
   （效期往前扣邀請期），但**理由**必須印出來——原本整區沒有任何一句說明
   「為什麼要扣」，讀者只能看到一個憑空出現的減法。
   考試日刻意挑 cutover 前一週：既落在表二，效期又還很遠，不會跟 gone 那條守混在一起。 */
console.log("\n— 舊制成績的邀請日換算（" + E.t2.until + " 以前考）—");

const old1 = run({ date: "2025-08-01", test: "pte", sc: [65, 65, 65, 65], sa: "2026-06-17", delay: 14 });
ok("舊制填了天數 → 邀請日 = 效期往前扣那幾天", old1.html.includes("2028-07-18"), old1.text.slice(-900));
ok("而且要講出為什麼要扣：LIN 25/016 第 10 條把終點壓到遞件日",
  old1.html.includes("LIN 25/016 第 10 條"), old1.text.slice(-900));
ok("那一條也要附官方原文，不能只報條號",
  old1.html.includes("in the period of 36 months immediately before the day "
    + "on which the visa application is made"), old1.text.slice(-900));
ok("要說明兩條規則同時要過、而這一條比較嚴",
  old1.text.includes("先咬到你的是這一條"), old1.text.slice(-900));
ok("舊制不准說兩邊量的是同一天（那是新制才成立的）",
  !old1.html.includes("是同一天"), old1.text.slice(-900));
ok("往回推用的天數在這一支也要有官方原文接地",
  old1.html.includes("You have " + E.inviteDays
    + " days from the date of your invitation to apply for the visa."), old1.text.slice(-900));

const oldBlank = run({ date: "2025-08-01", test: "pte", sc: [65, 65, 65, 65], sa: "2026-06-17" });
ok("舊制留空 → 給區間，並說明保守端是用滿邀請期",
  oldBlank.html.includes("2028-06-02") && oldBlank.html.includes("2028-08-01")
    && oldBlank.html.includes("用好用滿"), oldBlank.text.slice(-900));
ok("舊制留空 → 結論要標注英文那邊用的是保守值",
  oldBlank.html.includes("用的是保守值"), oldBlank.text.slice(-600));

/* ================================================ 9. 兩個時鐘誰先關 */
console.log("\n— 兩個時鐘 —");

/* ⚠️ 2025-09-01 是 cutover 之後考的，所以拿來比的是效期本身 2028-09-01，
   不是舊寫法的 2028-08-02（效期扣 60 天）。填的 delay:30 在這一支動不了日期。 */
const engFirst = run({ date: "2025-09-01", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2026-06-17", delay: 30 });
ok("英文先關", engFirst.html.includes("先關的是：英文") && engFirst.html.includes("2028-09-01"));
ok("新制拿去比的是效期本身，不是效期扣掉邀請期的那個舊日期",
  !engFirst.html.includes("2028-08-02"), engFirst.text.slice(-900));

const saFirst = run({ date: "2026-06-17", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2024-02-17" });
ok("技術評估先關", saFirst.html.includes("先關的是：技術評估") && saFirst.html.includes("2027-02-17"));
/* ⚠️ 這一條原本是反過來的（要求標注「保守值」）。新制那一支的日期不是推出來的，
   它就是效期本身——在那裡補一句「用的是保守值」等於憑空製造一個並不存在的不確定。 */
ok("新制不填遞件天數時，結論不准說英文那邊用的是保守值",
  !saFirst.html.includes("用的是保守值"), saFirst.text.slice(-700));

const same = run({ date: "2025-09-01", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2025-09-01", delay: 0 });
ok("同一天關 → 不套用「先關的是」句型", !same.html.includes("先關的是"), same.html.slice(-400));
ok("同一天關 → 直接講同一天", same.html.includes("兩扇門同一天關"));

/* ⚠️ 英文那一邊的「算得出來 ≠ 還在未來」守住了，技術評估那一邊當初漏掉——
   同一個形狀只守一半，比兩邊都不守更危險：守住的那一邊會讓人更相信另一邊。 */
const saDead = run({ date: "2026-06-17", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2022-01-01" });
ok("技評的 3 年已經走完 → 不把那個過去的日期擺在「最晚」的位置",
  !saDead.html.includes("邀請日最晚是 <b class=\"num\">2025-01-01"), saDead.html.slice(-700));
ok("而且要明說那一天已經過了、要重做",
  saDead.html.includes("那一天已經過了") && saDead.html.includes("得先重做一份"));
ok("技評已經關了就不套「先關的是」句型（關上的門不叫先關）",
  !saDead.html.includes("先關的是") && saDead.html.includes("技術評估那一邊已經關了"));
ok("而且要講清楚兩扇門要同時開著才遞得出去",
  saDead.html.includes("兩扇門要同時開著"));

const saNear = run({ date: "2026-06-17", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2023-08-20", delay: 10 });
ok("技評剩不到 3 個月 → 比照英文那一邊提醒（重做要跑機構流程）",
  saNear.html.includes("只剩 <span class=\"num\">3</span> 天") && saNear.html.includes("跑機構的流程"),
  saNear.html.slice(-700));
ok("技評還很久 → 不亂加急迫提醒", !saFirst.html.includes("跑機構的流程"));

/* ⚠️ 第十八次，而且是同一個形狀繞了一圈回來咬招牌功能：
   `gone` 守住了 engLine，卻沒守到最後那句結論。這個場景是英文剩 45 天、技評還有兩年多，
   舊寫法會在面板最底下、粗體、下定論的位置印
   「先關的是：英文。你能收到邀請的最晚日期是 2026-08-02」——那天是兩星期前。
   方向是「誤以為來不及」：讀者會為了一張還能用的成績再花錢重考一次。

   舊斷言看不見它，有兩個原因，兩個都得修：
   （1）`near` 沒填 sa，整個「先關的是」區塊根本不會渲染；
   （2）它只 includes 正面字串，而那句謊話跟真話在同一個 innerHTML 裡並存——
        要判「這兩句不該同時出現」，只能寫否定式、而且要讀純文字。 */
const engGoneSaOk = run({
  date: "2023-10-01", test: "pte", sc: [65, 65, 65, 65], sa: "2025-01-01",
});
ok("英文保守邀請日已過、技評還開著 → 不准把過去的日期擺在「最晚」的位置",
  !engGoneSaOk.text.includes("先關的是")
  && !engGoneSaOk.text.includes("你能收到邀請的最晚日期是 2026-08-02"),
  engGoneSaOk.text.slice(-800));
ok("而且要明說「排不出日期」不等於「來不及」",
  engGoneSaOk.text.includes("不等於來不及"), engGoneSaOk.text.slice(-500));
ok("要把還剩的天數與技評那一邊的日期一起講出來（讀者要知道現在卡在哪）",
  engGoneSaOk.text.includes("45 天") && engGoneSaOk.text.includes("2028-01-01"),
  engGoneSaOk.text.slice(-500));
/* 同一句話不准自己打自己：上面說「成績只剩 45 天」，下面就不能說門已經關了。 */
ok("同一個面板裡不准一邊說還剩 45 天、一邊說已經不算數",
  !engGoneSaOk.text.includes("英文那一邊已經不算數了"), engGoneSaOk.text.slice(-800));

/* 兩邊都算不出日期的情況：技評關了、英文的保守日期也過去了。
   舊寫法會印「英文那一邊還開著，到 2026-08-02」——同一個謊，換一支分支。 */
const bothGone = run({
  date: "2023-10-01", test: "pte", sc: [65, 65, 65, 65], sa: "2022-01-01",
});
ok("技評關了、英文也排不出日期 → 不准說「英文那一邊還開著，到 <過去的日期>」",
  !bothGone.text.includes("英文那一邊還開著"), bothGone.text.slice(-700));
ok("這種情況要說英文也排不出來，但成績本身還有天數",
  bothGone.text.includes("也排不出") && bothGone.text.includes("45 天"),
  bothGone.text.slice(-700));

/* ⚠️ 第十七次同一個形狀，這次說謊的是面板最上面那兩個訊號。
   內文寫著「技術評估那一邊已經關了」，顏色是綠的、判定印「Proficient　10 分」——
   顏色跟判定是第一眼看到的東西，內文在最底下。這幾條把上下兩截綁在一起。 */
ok("技評過期 → 判定不准只印「Proficient 10 分」就結束",
  saDead.verdict.includes("技術評估已過期"), saDead.verdict);
ok("而且不准是綠的（兩扇門要同時開著才遞得出去）", saDead.tone === "warn", saDead.tone);
ok("但也不降到 bad——他的英文成績本身沒問題，重做評估就能接著走",
  saDead.tone !== "bad" && saDead.verdict.includes("Proficient"), saDead.verdict);
ok("技評剩不到 3 個月 → 顏色也要跟著降，不能只寫在內文",
  saNear.tone === "warn", saNear.tone);
ok("但還沒過期就不加「已過期」那句（剩 3 天不等於過了）",
  !saNear.verdict.includes("技術評估已過期"), saNear.verdict);
ok("技評還很久 → 顏色與判定都不受影響",
  saFirst.tone === "ok" && !saFirst.verdict.includes("技術評估"), saFirst.tone + " / " + saFirst.verdict);
ok("沒填核發日 → 不因為「沒填」就降色（那是還沒做評估，不是評估過期）",
  prof.tone === "ok" && !prof.verdict.includes("技術評估"), prof.tone + " / " + prof.verdict);
/* 成績本身就拿不出去的時候，判定要講的是成績，不是評估——
   在「這段期間的成績不能用」後面再接一句技評，會讓人以為評估才是主因。 */
ok("成績本身不能用時，判定不摻技評那一句",
  !run({ date: "2024-01-15", test: "toefl", sc: [30, 30, 30, 30], sa: "2022-01-01" })
    .verdict.includes("技術評估已過期"));

ok("沒填技術評估核發日 → 明說這一邊沒有日期可以比，不留白",
  prof.html.includes("沒填核發日"));
/* ⚠️ 這一條原本寫死「兩邊量的終點不一樣（遞件 vs 收到邀請）」——那只對舊制成立。
   新制兩邊量的是同一天，講「不一樣」是錯的。拆成兩支各自釘。 */
/* ⚠️ 2026-08-17 突變測試當場打臉這一條：它引的兩個字串**其實都出自技評那一行**
   （`saLatest` 沒填的那一支「它的 3 年量到收到邀請那天，跟你這張成績量的是同一天」）。
   把上面「換算成最晚什麼時候要收到邀請」那段開場的整句話拿掉，這條照樣綠，
   只有 golden 紅。**斷言碰巧被別的句子滿足，等於它在守空氣**——
   所以底下補一條指名那一段自己的句子。這正是突變測試存在的理由：
   斷言看起來在守什麼，跟它實際擋得住什麼，是兩件事。 */
ok("新制要講明兩邊量的是同一天（都到「收到邀請」）",
  prof.html.includes("量到<b>收到邀請</b>那天") && prof.html.includes("同一天"),
  prof.text.slice(-1000));
ok("而且那句話要出現在換算段自己的開場，不是只靠技評那一行順帶提到",
  prof.html.includes("法規量的終點跟技術評估<b>是同一天</b>"), prof.text.slice(-1200));
ok("而且新制不准出現「量到遞件那天」",
  !prof.html.includes("量到<b>遞件</b>那天"), prof.text.slice(-1000));
/* ⚠️ 官方原文換過：原本引的是 Thapa 那條 60 天寬限，但技評 3 年的主規則是另一句。
   引寬限條款當主規則等於拿例外去解釋通則。 */
ok("技術評估那一邊要附官方原文與「以短的為準」",
  saFirst.html.includes("obtained in the " + E.validYears
    + " years before the date of your invitation")
  && saFirst.html.includes("以短的為準")
  && saFirst.html.includes("If the assessment was for a shorter period"),
  saFirst.text.slice(-900));

/* 已過期的成績不做邀請日換算——往回推只會得到一個早就過去的日期。 */
ok("已過期 → 不做邀請日換算", !dead.html.includes("最晚什麼時候要收到邀請"));
ok("已過期 → 但到期日本身還是要印（那是他要知道的事實）", dead.html.includes("2025-08-17"));
ok("已過期 → 要明說換算跳過的理由", dead.html.includes("一扇已經關上的門"));

/* ================================================ 10. 字母級的出口 */
console.log("\n— 字母級（舊制 OET）—");
{
  /* noCalc 把 OET 擋在選單外，所以正常操作到不了這裡。但 grade() 回的
     {letter:true} 沒有 level 也沒有 gone，如果 run() 沒有出口就是**拋例外**，
     而拋在 click handler 裡的例外會讓面板停在上一次的結果——靜默停格。 */
  boxes["#etest"].innerHTML = ""; boxes["#etest"].value = ""; boxes["#etest"].dataset.was = "";
  boxes["#edate"].value = "2024-01-01";
  boxes["#edate"]._h.change();
  /* 選單現在會擋掉選項以外的值（跟真的 <select> 一樣），而 noCalc 把 oet 濾掉了，
     所以這裡沒辦法用「塞 value」進去——那條路使用者也走不到。
     但要驗的東西沒有消失：**noCalc 是資料**，哪天有人把 oet 拿掉，
     這段程式就會被真的走到。所以這裡明講是在模擬那一天，手動把選項補回選單。 */
  boxes["#etest"].innerHTML += '<option value="oet">OET</option>';
  boxes["#etest"].value = "oet";
  ["#el", "#er", "#ew", "#es"].forEach(k => { boxes[k].value = "350"; });
  boxes["#esa"].value = ""; boxes["#edelay"].value = "";
  const box = boxes["#eans"];
  box.className = ""; box.innerHTML = ""; box.hidden = true;
  let threw = null;
  try { boxes["#ego"]._h.click(); } catch (e) { threw = e.message; }
  ok("硬選字母級的舊制 OET 不會拋例外（拋了就是面板靜默停格）", threw === null, threw);
  ok("而且要講得出話，不是空白", box.innerHTML.includes("字母級"), box.innerHTML.slice(0, 200));
}

/* ================================================ 11. 門檻總表（開檔就渲染） */
console.log("\n— 門檻總表 —");
const tbl = flat(boxes["#etbl"]);
ok("總表列出新制表的每一張考試",
  Object.keys(E.t1.tests).every(k => tbl.includes(E.t1.tests[k].name)),
  Object.keys(E.t1.tests).filter(k => !tbl.includes(E.t1.tests[k].name)).join("、"));
ok("總表右欄是 Competent 門檻，四項用 / 分隔",
  tbl.includes(E.t1.tests.ieltsA.competent.join(" / ")));
ok("MET 在總表上就標明沒有 Superior", tbl.includes("這張考試沒有這一級"));
ok("總表要說明舊制表少了哪三種考試", tbl.includes("沒有 CELPIP、MET、LANGUAGECERT"));
ok("總表要重申四項各自比、不看平均", tbl.includes("四項各自比"));
ok("官方把 LANGUAGECERT 拼錯這件事要留在頁面上", tbl.includes("LANGUGECERT"));

/* ================================================ 12. 版面與事實 */
console.log("\n— 版面 —");
ok("nav 有 /english 的入口", /href="#english"/.test(HTML));
ok("section#english 存在且掛載點都在",
  /<section class="tool" id="english">/.test(HTML) &&
  ["eans", "etbl", "epass", "eflags", "englishsrc"].every(id => HTML.includes('id="' + id + '"')));
ok("八個輸入欄位都在",
  ["edate", "etest", "el", "er", "ew", "es", "esa", "edelay"].every(id => HTML.includes('id="' + id + '"')));
ok("要講清楚分數不會離開瀏覽器", HTML.includes("分數只留在你自己的瀏覽器裡"));
ok("台灣護照沒有免試路這件事要留著", HTML.includes("台灣護照沒有免試路"));
ok("線上版考試不被承認的清單要在頁面上",
  ["IELTS Online", "TOEFL iBT – Home Edition", "OET@Home"].every(s => HTML.includes(s)));
ok("depending on the visa subclass 這個但書要留著", HTML.includes("depending on the visa subclass"));
/* 這一條刻意驗**渲染後的面板**而不是原始碼：原文是用字串串接組出來的，
   在原始碼裡查不到完整那一句。而且註解裡有不算數——讀者看不到註解，
   看不到就沒辦法質疑一個他被要求相信的數字。 */
ok(E.inviteDays + " 天邀請期在面板上有官方原文接地",
  prof.html.includes("You have " + E.inviteDays + " days from the date of your invitation to apply for the visa."),
  "面板上找不到那句原文");
/* ⚠️ 這一條原本反過來，要求面板寫「這句只在 189 那一頁查得到」。
   那是**查得不夠**不是事實：189 points-tested、190、491/application 三頁逐字都有
   （491 的在 /application 子頁，主頁沒有——當初就是停在主頁才誤判）。
   少報適用範圍跟報錯數字一樣傷：讀者會以為自己那條路不能用這個天數。 */
ok("而且適用範圍要寫對：189／190／491 三頁都有，不是只有 189",
  prof.html.includes("189／190／491 三頁都有這一句"), prof.text.slice(-1200));
/* 驗渲染後的面板，不驗原始碼：原始碼裡那句話還在，但它活在一段
   「這裡原本寫…，那是查得不夠」的更正註解裡。讀者看不到註解，
   要守的是「讀者看得到的地方沒有這個錯誤宣稱」。 */
ok("那句被推翻的宣稱不准出現在讀者看得到的面板上",
  !prof.html.includes("只在 189") && !engFirst.html.includes("只在 189")
    && !near.html.includes("只在 189"),
  "面板上還留著「只在 189」");
ok("拿不出去的成績連這段出處說明都不印（它屬於邀請日換算的一部分）",
  !bad1.html.includes("You have " + E.inviteDays + " days") &&
  !under.html.includes("You have " + E.inviteDays + " days"));

console.log("\n" + (fail === 0 ? "全數通過" : "有失敗") + "：" + pass + " 過 / " + fail + " 失敗");
process.exit(fail === 0 ? 0 : 1);
