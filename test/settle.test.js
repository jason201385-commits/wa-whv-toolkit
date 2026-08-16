#!/usr/bin/env node
/* 定居區（/settle）的回歸測試。
 *
 * 為什麼這一區的錯特別貴：它處理的是**不可逆或很難逆**的決定。
 * /pr 算錯只是分數不準，重算就好；這裡算錯的後果是
 *   — 駕照過期還在開（無照駕駛，不是罰單而已）
 *   — 戶籍遷出之後回台灣要空窗 6 個月才有健保
 *   — 拿到 PR 那一刻超級年金的離境提領資格永久消失
 * 所以這支測試釘的不只是算術，還有**幾句不可以退回舊版本的事實**：
 * 台灣自 2025-11-01 起不在西澳承認名單上、台灣的健保停保制度自 2024-12-23 起廢止、
 * 台灣不在 Medicare 互惠協定的 11 國名單裡。這三件事在網路上的中文資訊
 * 大多是舊的，而且沒有人回去改——這個站如果也退回舊版本，就沒有存在的理由。
 *
 * 跑法：node test/settle.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

/* 與 pr.test.js／flags.test.js 同一套切法，同樣刻意複製而不共用：
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

/* /settle 共用 /pr 的日期工具（ymd／norm／dayGap／fmtD／human），
   所以連著整段切——切一半會變成 ReferenceError 而不是紅字，很難查。 */
const PR_HEAD = "/* ================= 年齡時鐘與點數";
if (HTML.indexOf(PR_HEAD) < 0) throw new Error("找不到 PR／定居區塊");
const tailBlock = HTML.slice(HTML.indexOf(PR_HEAD), HTML.lastIndexOf("</script>"));
const SETTLE_HEAD = "/* ================= 定居：兩個時鐘";
if (tailBlock.indexOf(SETTLE_HEAD) < 0) throw new Error("找不到 /settle 區塊");

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
const boxes = {};
["#sans", "#sgo", "#sout", "#spr", "#sfee"].forEach(k => { boxes[k] = mkEl("div"); });
const sandbox = {
  Math, Number, String, console, isFinite, parseFloat,
  Date: FakeDate,
  Event: function (t) { return { type: t }; },
  document: { createElement: mkEl, querySelector() { return null; } },
  $: sel => boxes[sel] || mkEl("div"),
};
vm.createContext(sandbox);
vm.runInContext(SRC + ";\nglobalThis.DATA = DATA;\nglobalThis.human = human;\nglobalThis.dayGap = dayGap;", sandbox);

const S = sandbox.DATA.settle;

/* 遞迴把假 DOM 攤平成字串，才驗得到 #sfee 那一塊渲染出來的東西。 */
function flat(node) {
  return (node.innerHTML || "") + node.children.map(flat).join("");
}

function run(out, pr, now) {
  if (now) NOW = now;
  boxes["#sout"].value = out == null ? "" : out;
  boxes["#spr"].value = pr == null ? "" : pr;
  const box = boxes["#sans"];
  box.className = ""; box.innerHTML = ""; box.hidden = true;
  boxes["#sgo"]._h.click();
  return {
    tone: box.className.replace("ans", "").trim(),
    verdict: (box.innerHTML.match(/<div class="verdict">([\s\S]*?)<\/div>/) || [, ""])[1],
    html: box.innerHTML,
    hidden: box.hidden,
  };
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + (extra ? "\n    " + extra : "")); }
}

/* ================================================ 費用：逐格對官方表 */
console.log("\n— Transport WA 費用表逐格 —");
/* 全部存「分」，跟站上其他金額同一套。這幾個數字直接來自官方頁面的費用表。 */
const WANT = {
  ctt: 2240, cttResit: 1920, xferTest: 15080, xferNoTest: 6350,
  pdaResit: 12050, renew1: 4940, renew5: 17200,
};
Object.keys(WANT).forEach(k => {
  ok("fee." + k + " = " + (WANT[k] / 100).toFixed(2),
    S.fee[k] === WANT[k], "實際 " + S.fee[k]);
});
ok("費用一律是整數分，不得出現浮點數",
  Object.values(S.fee).every(v => Number.isInteger(v)),
  JSON.stringify(S.fee));
/* 未承認路徑一定比承認路徑貴——反過來的話不是資料錯就是把兩欄填反了。 */
ok("未承認路徑（筆試＋含路考換照）比承認路徑貴",
  S.fee.ctt + S.fee.xferTest > S.fee.xferNoTest,
  (S.fee.ctt + S.fee.xferTest) + " vs " + S.fee.xferNoTest);

console.log("\n— 費用對照要真的算出差額，不是寫死 —");
const feeHtml = flat(boxes["#sfee"]);
const gap = S.fee.ctt + S.fee.xferTest - S.fee.xferNoTest;
ok("差額 = 兩條路的必要項目相減",
  feeHtml.includes("A$" + (gap / 100).toFixed(2)), "期望 A$" + (gap / 100).toFixed(2));
ok("兩條路的金額都印出來",
  feeHtml.includes("A$" + ((S.fee.ctt + S.fee.xferTest) / 100).toFixed(2)) &&
  feeHtml.includes("A$" + (S.fee.xferNoTest / 100).toFixed(2)));
ok("明說這是一次就過的價錢，並印出重考費",
  feeHtml.includes("一次就過") && feeHtml.includes("A$" + (S.fee.pdaResit / 100).toFixed(2)));
ok("續期費用兩條路都要繳，所以要明說不算進差額",
  feeHtml.includes("不算進上面的差額"));
ok("要提醒費用每年 7 月 1 日調", feeHtml.includes("7 月 1 日"));

/* 上面那幾條鎖的全是金額，而金額對不代表話沒說反。
   實測把兩行的日期標籤對調（金額不動），整支測試照樣全綠——
   頁面會變成「2025-10-31 前要考筆試＋路考」，方向完全相反。
   所以要鎖的是「哪個標籤綁哪個金額」，不是「這些金額有出現」。 */
const aud = c => "A$" + (c / 100).toFixed(2);
const iNow = feeHtml.indexOf("2025-11-01 起"), iWas = feeHtml.indexOf("2025-10-31 前");
const segNow = iNow >= 0 && iWas > iNow ? feeHtml.slice(iNow, iWas) : "";
const segWas = iWas >= 0 ? feeHtml.slice(iWas) : "";
ok("兩行的順序是「現在這條」在前、「當時那條」在後",
  iNow >= 0 && iWas > iNow, "iNow=" + iNow + " iWas=" + iWas);
ok("2025-11-01 那行要綁筆試＋含路考，且金額是合計",
  segNow.includes("筆試") && segNow.includes("含路考") &&
  segNow.includes(aud(S.fee.ctt + S.fee.xferTest)) && !segNow.includes("免路考"),
  segNow.replace(/\s+/g, " ").slice(0, 160));
ok("2025-10-31 那行要綁免路考，而且不可以混進筆試",
  segWas.includes("免路考") && segWas.includes(aud(S.fee.xferNoTest)) &&
  !segWas.includes("筆試 "),
  segWas.replace(/\s+/g, " ").slice(0, 160));
/* 「倍以上」是下界，所以只能用 floor；而且要拿重考比重考，
   不能拿路考重考去比第一次的筆試（那是兩種不同的東西）。 */
ok("重考的倍數用 floor 算，而且比較基準是筆試重考費",
  feeHtml.includes(Math.floor(S.fee.pdaResit / S.fee.cttResit) + " 倍以上"),
  "期望 " + Math.floor(S.fee.pdaResit / S.fee.cttResit) + " 倍以上");

/* ================================================ 兩個時鐘 */
console.log("\n— 兩個時鐘：起點不同，不可以混 —");
const N = [2026, 8, 17];
ok("兩個都沒填 → 提示，不算出東西",
  run("", "", N).verdict.includes("至少填一個"), run("", "", N).verdict);
ok("只填離台日也算得出來",
  run("2026-08-11", "", N).html.includes("戶籍遷出登記"));
ok("只填 PR 核准日也算得出來",
  run("", "2026-08-11", N).html.includes("台灣駕照在西澳失效"));

/* 戶籍法：出境 2 年以上應為戶籍遷出登記。 */
const out2 = run("2026-08-11", "", N);
ok("離台 2026-08-11 → 出境滿 2 年是 2028-08-11",
  out2.html.includes("2028-08-11"), (out2.html.match(/20\d\d-\d\d-\d\d/g) || []).join("、"));
ok("離台那條只算戶籍，不會冒出駕照期限",
  !out2.html.includes("台灣駕照在西澳失效"));

/* Transport WA：成為 PR 或公民之後 3 個月。 */
const pr3 = run("", "2026-08-11", N);
ok("PR 2026-08-11 → 換照期限是 2026-11-11",
  pr3.html.includes("2026-11-11"), (pr3.html.match(/20\d\d-\d\d-\d\d/g) || []).join("、"));
ok("PR 那條同時要點出 DASP 在核准當天就消失",
  pr3.html.includes("2026-08-11") && pr3.html.includes("DASP"));
ok("PR 那條不會冒出戶籍期限", !pr3.html.includes("戶籍遷出登記"));

const both = run("2026-08-11", "2026-08-11", N);
ok("兩個都填 → 三條期限都在（戶籍、駕照、DASP）",
  both.html.includes("戶籍遷出登記") && both.html.includes("台灣駕照在西澳失效") &&
  both.html.includes("DASP"));
ok("期限依日期由近到遠排序", (function () {
  const ds = (both.html.match(/<li><span>(\d{4}-\d{2}-\d{2})/g) || [])
    .map(s => s.slice(s.length - 10));
  return ds.length >= 3 && ds.every((d, i) => i === 0 || ds[i - 1] <= d);
})(), (both.html.match(/<li><span>\d{4}-\d{2}-\d{2}/g) || []).join("、"));

console.log("\n— 月底夾值：官方沒寫月底怎麼算，所以不能靜默猜 —");
/* 2026-11-30 加 3 個月，曆法上沒有 2027-02-30。 */
const clamp = run("", "2026-11-30", [2026, 11, 1]);
ok("2026-11-30 + 3 個月 → 夾到 2027-02-28",
  clamp.html.includes("2027-02-28"), (clamp.html.match(/2027-\d\d-\d\d/g) || []).join("、"));
ok("被夾的時候要說出來，不是靜靜夾掉",
  clamp.html.includes("夾到當月最後一天"));
ok("要明說這不是查到的答案",
  clamp.html.includes("不是查到的答案"));
const noClamp = run("", "2026-08-11", N);
ok("沒被夾就不出現那段說明", !noClamp.html.includes("夾到當月最後一天"));
ok("印出來的每個日期在曆法上都要真的存在", (function () {
  return [clamp, both, out2, pr3].every(r =>
    (r.html.match(/\d{4}-\d{2}-\d{2}/g) || []).every(s => {
      const [y, m, d] = s.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, d));
      return t.getUTCFullYear() === y && t.getUTCMonth() + 1 === m && t.getUTCDate() === d;
    }));
})());

console.log("\n— 色調：已經過了跟還早不能長一樣 —");
/* 「已經過了」在這一區是真的有法律後果的狀態（無照駕駛、逾期未辦戶籍遷出），
   不是一個提醒。所以它必須跟「還有兩年」在視覺上分得開。 */
ok("期限已過 → bad", run("", "2026-01-01", N).tone === "bad", run("", "2026-01-01", N).tone);
ok("期限已過 → 說「已過」而不是「還有」",
  /已過/.test(run("", "2026-01-01", N).html));
/* 離台 2024-10-01 → 戶籍那條落在 2026-10-01，距 2026-08-17 是 45 天。 */
ok("90 天內到期 → warn",
  run("2024-10-01", "", N).tone === "warn", run("2024-10-01", "", N).tone);
ok("還很久 → ok", run("", "2026-08-01", [2026, 3, 1]).tone === "ok",
  run("", "2026-08-01", [2026, 3, 1]).tone);
ok("色調看最急的那一條，不是最遠的那一條", (function () {
  /* 駕照已經過期、戶籍還有一年多 → 整體必須是 bad。 */
  const r = run("2025-06-01", "2026-01-01", N);
  return r.tone === "bad";
})(), run("2025-06-01", "2026-01-01", N).tone);
/* PR 是過去式的人，DASP 那條一定顯示「已過」，整個面板就變紅。
   這一區的使用者很多屬於這一類（早就拿到 PR、也早就換好照），
   所以「已過」必須附帶「辦好的請忽略」，否則紅色會把可信度燒掉。 */
ok("有任何一條已過 → 要講明「已經辦好的請忽略」",
  run("", "2026-01-01", N).html.includes("已經辦好的那幾條請直接忽略"));
ok("這句話只在真的有過期時出現",
  !run("", "2026-08-01", [2026, 3, 1]).html.includes("已經辦好的那幾條請直接忽略"));
ok("而且要說清楚工具不知道你辦過什麼",
  run("", "2026-01-01", N).html.includes("不知道你辦過什麼"));

/* DASP 那一列的日期就是使用者填的 PR 核准日本身，所以 PR 一下來它永遠是過去式。
   它曾經被算進色調，結果是**每一個已經拿到 PR 的人都拿到紅色的「有期限已經過了」**
   ——包括換照倒數還有將近三個月、什麼都沒錯過的人。上面那條「90 天內 → warn」
   當初是靠「刻意只填一個欄位」才測得出來的，那個繞法就是這個缺陷的痕跡。 */
const prOnly = run("", "2026-08-11", N);   // PR 核准 6 天前 → 換照還有 85 天
ok("PR 剛下來（換照還有 85 天）→ warn，不准因為 DASP 那列變成 bad",
  prOnly.tone === "warn", prOnly.tone + "／" + prOnly.html.slice(0, 60));
ok("而且判語要指向換照那條，不是「有期限已經過了」",
  prOnly.html.includes("90 天內有期限到期") && !prOnly.html.includes("有期限已經過了"),
  prOnly.html.slice(0, 80));
ok("這種情況不該出現「已經辦好的請忽略」（沒有任何期限過去）",
  !prOnly.html.includes("已經辦好的那幾條請直接忽略"));
/* 右欄措辭：「已過 N 天」是「你遲到了」的講法，而這一格沒有人遲到得了。 */
ok("DASP 那一列右欄寫「已經發生」，不是「已過 N 天」",
  prOnly.html.includes("已經發生") && !/已過 \d/.test(prOnly.html),
  (prOnly.html.match(/已過 [^<]*/g) || []).join("｜"));
/* 但它仍然要在清單裡，而且仍然要講不可逆——降級的是色調，不是這件事的重要性。 */
ok("降級色調不等於把 DASP 藏起來",
  prOnly.html.includes("超級年金離境提領（DASP）資格消失") &&
  prOnly.html.includes("這一格不可逆"));
/* 真的有期限過去時照樣要紅：PR 8 個月前 → 換照已逾期 5 個月。 */
const bothPast = run("", "2025-12-16", N);
ok("真的逾期（換照已過）→ 照樣 bad",
  bothPast.tone === "bad" && bothPast.html.includes("有期限已經過了"), bothPast.tone);

console.log("\n— 期限不是辦理時間 —");
ok("要明說這些是法規期限，不是你辦得完的時間",
  both.html.includes("不是辦理時間"));

/* ================================================ 不可以退回舊版本的事實 */
console.log("\n— 三件在中文網路上普遍過期的事實 —");
const ALL = S.drive.concat(S.nhi, S.supr, S.flags).join("\n");

/* 這一段原本每一條都對 ALL（四個陣列串起來的字串）做 grep。
   突變測試證明那擋不住東西：把 nhi[0] 的「113 年 12 月 23 日」改成 115 年、
   把 supr[2] 的 65% 改成 15%，測試都照樣綠——因為別的 bullet 剛好也含那些 token，
   正則在串接字串上仍然命中。所以事實斷言一律綁**指定索引**。
   索引本身也要鎖：bullet 順序調動時要紅一次，讓人回來確認斷言還指著同一句。 */
const at = (arr, i, name) => {
  if (typeof arr[i] !== "string") throw new Error(name + "[" + i + "] 不存在——bullet 順序改了就回來對一次索引");
  return arr[i];
};
/* 有幾條要比的是「讀者眼睛看到的字」，而 <b> 會把詞切開
   （例：「退保 2 年<b>內</b>回去」直接 includes("2 年內") 永遠 false，
   結果是一條看起來很嚴格、其實測不到東西的斷言）。這種就先脫標籤再比。 */
const txt = s => s.replace(/<[^>]+>/g, "");
ok("bullet 數量固定（駕照 8／健保 7／超級年金 5／迷思 5）",
  S.drive.length === 8 && S.nhi.length === 7 && S.supr.length === 5 && S.flags.length === 5,
  [S.drive.length, S.nhi.length, S.supr.length, S.flags.length].join("／"));

ok("駕照：明講 2025-11-01 台灣被移出承認名單（釘 drive[2]）",
  /2025-11-01/.test(at(S.drive, 2, "drive")) && at(S.drive, 2, "drive").includes("承認名單"));
ok("駕照：附西澳公告原文，不是自己說的（釘 drive[2]）",
  at(S.drive, 2, "drive").includes("no longer exists") &&
  at(S.drive, 2, "drive").includes("pass a theory test and Practical Driving Assessment"));
ok("駕照：明講換照義務來自 PR 而不是落地（釘 drive[0]）",
  at(S.drive, 0, "drive").includes("PR 帶來的") &&
  at(S.drive, 0, "drive").includes("do not need to transfer your overseas licence"));
ok("駕照：附「3 個月後即使沒過期也不能開」的原文（釘 drive[1]）",
  at(S.drive, 1, "drive").includes("even if it is current and valid"));
/* 3 個月的**起點**官方沒有明文，站上是從「If you are an Australian citizen or
   permanent resident…」這個條件推出來的。整個 /settle 的 PR 時鐘都靠這個推論，
   所以推論本身必須寫在畫面上，不能只寫結論。 */
ok("駕照：3 個月的起點是推論，要自己承認（釘 drive[1]）",
  at(S.drive, 1, "drive").includes("If you are an Australian citizen or permanent resident") &&
  at(S.drive, 1, "drive").includes("官方沒有另外寫死"));
/* 這一條原本寫的是「官網查詢器還沒改乾淨，查 Taiwan 會跳出舊文案」。
   2026-08-17 實際去查：查詢器回的是 "Taiwan is not a recognised country or region"，
   舊字串雖然還在原始資料裡，但 widget 只在另一種分類下才會渲染它，畫面上看不到。
   一個照著站上說法去驗證的讀者會看到相反的東西——所以這條改成「去查，它跟我們一樣」。 */
ok("駕照：查詢器那條要引「畫面上真的看得到」的那句（釘 drive[3]）",
  at(S.drive, 3, "drive").includes("Taiwan is not a recognised country or region"),
  at(S.drive, 3, "drive").slice(0, 80));
ok("駕照：不得再宣稱查詢器會「跳出」舊文案（那是撈原始資料才看得到的殘留）",
  !/跳出舊文案|還沒改乾淨/.test(ALL) && at(S.drive, 3, "drive").includes("畫面上看不到"),
  (ALL.match(/跳出舊文案|還沒改乾淨/g) || []).join("｜"));

/* 這一條原本寫成「民國年 or 西元年 任一命中」。突變證明那是漏的:
   把民國 113 改成 115、西元不動,斷言照樣綠——而畫面上會同時印出
   兩個互相矛盾的年份,讀者只會相信前面那個。兩個都要在,而且要對得起來。 */
const nhi0 = txt(at(S.nhi, 0, "nhi"));
ok("健保：明講停保制度自 2024-12-23 起廢止（釘 nhi[0]）",
  nhi0.includes("113 年 12 月 23 日") && nhi0.includes("2024-12-23") &&
  nhi0.includes("不受理停保申請"), nhi0.slice(0, 90));
ok("健保：民國年與西元年要自己對得起來（差 1911）", (function () {
  const roc = nhi0.match(/(\d{2,3}) 年 (\d{1,2}) 月 (\d{1,2}) 日/);
  const ad = nhi0.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!roc || !ad) return false;
  return Number(roc[1]) + 1911 === Number(ad[1]) &&
    Number(roc[2]) === Number(ad[2]) && Number(roc[3]) === Number(ad[3]);
})(), nhi0.slice(0, 90));
ok("健保：附憲法法庭判決依據，不是「聽說改了」（釘 nhi[0]）",
  at(S.nhi, 0, "nhi").includes("憲法法庭") && at(S.nhi, 0, "nhi").includes("111 年憲判字第 19 號"));
ok("健保：把「停保」與「戶籍遷出」分開講（釘 nhi[2]）",
  at(S.nhi, 2, "nhi").includes("真正讓你停繳的是戶籍遷出"));
/* 戶籍法第 16 條第 3 項與第 5 項的原文（2026-08-17 自全國法規資料庫 D0030006 取得）。
   第 5 項是實務上真的會踩到的那一格：拿外國護照回台不算「入境」。 */
ok("健保：引戶籍法第 16 條原文，不是自己轉述（釘 nhi[2]）",
  at(S.nhi, 2, "nhi").includes("出境二年以上，應為遷出登記") &&
  at(S.nhi, 2, "nhi").includes("仍列入出境二年應為遷出登記期間之計算"),
  at(S.nhi, 2, "nhi").slice(0, 80));
ok("健保：講出回台加保的等待期規則與例外（釘 nhi[3]）",
  txt(at(S.nhi, 3, "nhi")).includes("滿 6 個月") &&
  txt(at(S.nhi, 3, "nhi")).includes("有一定雇主之受僱者"));
ok("健保：等待期要講出「2 年內／2 年後」這個分水嶺（釘 nhi[3]）",
  txt(at(S.nhi, 3, "nhi")).includes("2 年內") && txt(at(S.nhi, 3, "nhi")).includes("2 年後"));
/* 「返國初設戶籍」的人沒有戶籍可以「恢復」，那 6 個月是從設籍起算的。
   原文寫成「要等戶籍恢復滿 6 個月」，對這一支分岔講的是一個不存在的動作。 */
ok("健保：初設戶籍那一支不能寫成「恢復」（釘 nhi[3]）",
  !/返國初設戶籍[^。]*要等戶籍恢復滿/.test(txt(at(S.nhi, 3, "nhi"))) &&
  txt(at(S.nhi, 3, "nhi")).includes("恢復或初設"),
  txt(at(S.nhi, 3, "nhi")).slice(30, 130));
ok("健保：國外就醫核退要講清楚是有上限的補貼，不是保險（釘 nhi[5]）",
  at(S.nhi, 5, "nhi").includes("它是補貼，不是保險"));

ok("超級年金：明講 PR 核准那一刻 DASP 資格永久消失（釘 supr[0]）",
  at(S.supr, 0, "supr").includes("永久消失") &&
  at(S.supr, 0, "supr").includes("you're not an Australian or New Zealand citizen, or a permanent resident of Australia"));
ok("超級年金：講出 WHM 的 65% 與非 WHM 的 35%（釘 supr[2]）",
  /65%/.test(at(S.supr, 2, "supr")) && /35%/.test(at(S.supr, 2, "supr")) &&
  at(S.supr, 2, "supr").includes("WHM"), at(S.supr, 2, "supr").slice(0, 80));
ok("超級年金：明講這是整區唯一不可逆的一格（釘 supr[0]）",
  at(S.supr, 0, "supr").includes("不可逆"));
ok("超級年金：明講「趁還沒拿 PR 先領」不成立，因為要先離境（釘 supr[1]）",
  at(S.supr, 1, "supr").includes("你得先離境"));

ok("Medicare：明講台灣不在互惠協定名單裡，並把 11 國列出來（釘 flags[2]）",
  at(S.flags, 2, "flags").includes("沒有台灣") && at(S.flags, 2, "flags").includes("11 個國家") &&
  ["Belgium", "Finland", "Italy", "Malta", "Netherlands", "New Zealand",
   "Norway", "Ireland", "Slovenia", "Sweden", "United Kingdom"]
    .every(c => at(S.flags, 2, "flags").includes(c)));
/* flags[3] 原本把 nhi[3] 的分段規則壓成無條件的「回台要等 6 個月」，
   等於同一頁的兩個區塊互相矛盾——而且對「退保 2 年內就回台」的人，
   那 6 個月根本不存在，他會把一筆不存在的成本算進要不要遷戶籍的決定裡。 */
const f3 = txt(at(S.flags, 3, "flags"));
ok("迷思區要講出「2 年內／2 年後」這個分水嶺（釘 flags[3]）",
  f3.includes("2 年內") && f3.includes("2 年後"), f3.slice(0, 80));
/* 光是「有出現分水嶺」擋不住退化:突變把開頭改成
   「…也可能當天就加得了保。反正就是要等 6 個月。曾經的分水嶺是…」,
   後半段的分水嶺原封不動,上面那條照樣綠——而讀者只會看第一句。
   所以綁的是**開頭那一句的形狀**:兩種結果都要講,而且只准講一次 6 個月。 */
const f3head = f3.slice(0, f3.indexOf("分水嶺"));
ok("迷思區的第一句要同時給出兩種結果（釘 flags[3]）",
  f3head.includes("可能要等 6 個月") && f3head.includes("也可能當天就加得了保"),
  f3head);
ok("而且第一句不准再補一個無條件的 6 個月（釘 flags[3]）",
  (f3head.match(/6 個月/g) || []).length === 1,
  f3head);
/* 兩個分支的結論要各自綁在自己的條件上,不能只是「這些詞都有出現」。 */
const f3in = f3.slice(f3.indexOf("2 年內"), f3.indexOf("2 年後"));
const f3after = f3.slice(f3.indexOf("2 年後"));
ok("「2 年內」那一支不得出現 6 個月，要講當天就加保（釘 flags[3]）",
  !f3in.includes("6 個月") && /當天就加保|沒有等待期/.test(f3in), f3in);
ok("「2 年後」那一支才是要等 6 個月的那一支（釘 flags[3]）",
  f3after.includes("6 個月"), f3after.slice(0, 80));

console.log("\n— 這個站不做的事 —");
/* 這兩條是「不當移民代辦」與「不發佈會過期的數字」兩條紅線的唯一機械執行點，
   而它們原本只掃 DATA 的四個陣列。突變證明：往 #settle 的 markup 或答案面板的
   IIFE 字串注入「建議你趕快申請 PR」「核准率約 78%」，兩條都照樣綠——
   而那兩處正是使用者真正讀到的地方。掃描範圍改成「讀得到的全部」。 */
const SETTLE_MARKUP = (function () {
  const i = HTML.indexOf('id="settle"');
  if (i < 0) throw new Error("找不到 section#settle");
  const e = HTML.indexOf("</section>", i);
  if (e < 0) throw new Error("section#settle 沒有收尾");
  return HTML.slice(i, e);
})();
const SETTLE_JS = tailBlock.slice(tailBlock.indexOf(SETTLE_HEAD));
const READABLE = [ALL, SETTLE_MARKUP, SETTLE_JS].join("\n");
ok("掃描範圍真的涵蓋 markup 與答案面板，不是只有 DATA",
  SETTLE_MARKUP.includes("最後一次") && SETTLE_JS.includes("DASP") &&
  READABLE.length > ALL.length + 2000,
  "markup " + SETTLE_MARKUP.length + " / js " + SETTLE_JS.length);
ok("不得出現「建議你拿／不要拿 PR」這種替人決定的話",
  !/建議你(拿|申請|不要)|你應該(拿|申請)/.test(READABLE),
  (READABLE.match(/建議你[^。]{0,20}|你應該[^。]{0,20}/g) || []).join("｜"));
ok("不得寫出沒有來源的辦理天數或核准率",
  !/(核准率|通過率)\s*\d|大約\s*\d+\s*(天|週|個月)就|平均等待\s*\d/.test(READABLE),
  (READABLE.match(/(核准率|通過率)\s*\d[^。]{0,20}|平均等待\s*\d[^。]{0,20}/g) || []).join("｜"));
ok("明說每個數字都會變，並要求使用者自己點官方連結（釘 flags[4]）",
  at(S.flags, 4, "flags").includes("要做決定之前自己點進去看一次"));

console.log("\n— 戶籍那個時鐘的前提要講出來 —");
/* 24 個月是平加出來的，而法條要的是「連續 2 年未入境」（施行細則第 5 條的通報條件）。
   中間回過台灣的人，這個日期就不對——不講出來，工具會用一個他沒觸發的期限，
   把他推向遷出戶籍這個不可逆的行政動作。 */
ok("戶籍那條要講出「連續 2 年未入境」這個前提",
  out2.html.includes("連續 2 年未入境") && out2.html.includes("往後推"),
  out2.html.slice(0, 200));
ok("輸入欄位要問「最後一次」離台，不是「離台」",
  SETTLE_MARKUP.includes("你<b>最後一次</b>離開台灣的日期"));
ok("要講出逾期戶政事務所得逕行代辦，不是放著就沒事",
  out2.html.includes("逕行") && out2.html.includes("施行細則第 5 條"));
/* DASP 那一列是紅字倒數，很容易被讀成「還有 N 個月可以去領」。 */
ok("DASP 倒數旁邊要說清楚人還在澳洲時一天都領不了",
  pr3.html.includes("一天都領不了") && pr3.html.includes("你人已經離開澳洲"),
  pr3.html.slice(0, 200));

/* ================================================ 來源 */
console.log("\n— 來源 —");
ok("十筆來源，全部已核（每一筆都自己 curl 過 200）",
  S.src.length === 10 && S.src.every(s => s.v === true),
  `實得 ${S.src.length} 筆／待核 ${S.src.filter(s => s.v === false).length} 筆`);
/* `law.moj.gov.tw` 沒有 www 子網域（全國法規資料庫就是掛在裸網域上），
   所以這裡不能沿用「://www.<domain>/」那個寫法——寫死 www 會把一個
   真的官方來源判成不合格。改成比對 host 本身。 */
const DOMAINS = ["www.transport.wa.gov.au", "www.servicesaustralia.gov.au",
  "www.ato.gov.au", "www.nhi.gov.tw", "law.moj.gov.tw"];
const host = u => (u.match(/^https:\/\/([^/]+)\//) || [, ""])[1];
ok("來源都指向官方網域（含裸網域的 law.moj.gov.tw）",
  S.src.every(s => DOMAINS.includes(host(s.u))),
  S.src.filter(s => !DOMAINS.includes(host(s.u))).map(s => s.u).join("\n    "));
ok("全部走 https", S.src.every(s => s.u.startsWith("https://")));
ok("每一筆都有查核日期", S.src.every(s => /^\d{4}-\d{2}-\d{2}$/.test(s.as)));
/* 五個主題各要有自己的來源，缺一個就代表那一塊是沒有出處的。
   戶籍法是 2026-08-17 補的：在那之前整段戶籍規則沒有任何法源連結，
   而它是這一區唯一會把人推向不可逆行政動作的內容。 */
ok("駕照、健保、Medicare、超級年金、戶籍法五塊各自都有來源",
  S.src.some(s => s.u.includes("transport.wa.gov.au")) &&
  S.src.some(s => s.u.includes("nhi.gov.tw")) &&
  S.src.some(s => s.u.includes("servicesaustralia.gov.au")) &&
  S.src.some(s => s.u.includes("ato.gov.au")) &&
  S.src.some(s => /pcode=D0030006$/.test(s.u)) &&
  S.src.some(s => /pcode=D0030007$/.test(s.u)));
/* `includes("pcode=D0030007")` 會被 `pcode=D0030007x` 命中——突變證明過。
   pcode 是「一個英文字母 + 7 位數字」的固定形狀,錯一個字元就是另一部法規
   （或根本不存在的頁面）,而 v:true 宣稱的是「我 curl 過 200」。 */
ok("法規連結的 pcode 形狀要對（一個字母 + 7 位數字，不多不少）",
  S.src.filter(s => s.u.includes("law.moj.gov.tw"))
    .every(s => /[?&]pcode=[A-Z]\d{7}$/.test(s.u)),
  S.src.filter(s => s.u.includes("law.moj.gov.tw")).map(s => s.u).join("\n    "));

/* 頁尾那個 asOf 是整站唯一對外宣告「這些數字什麼時候查的」的地方。
   突變測試把它改成 2019-01-01，四支測試全綠——等於這個站可以在
   宣稱「2019 年查的」的狀態下印出 2026 年的法規，而沒有任何東西會紅。
   它至少要跟最新的那一筆來源一樣新，否則就是在低報自己的新鮮度。 */
const newest = S.src.map(s => s.as).sort().pop();
ok("頁尾的 asOf 不得比任何一筆來源的查核日還舊",
  /^\d{4}-\d{2}-\d{2}$/.test(sandbox.DATA.asOf) && sandbox.DATA.asOf >= newest,
  "asOf=" + sandbox.DATA.asOf + " 最新來源=" + newest);

/* ================================================ human()：距離要怎麼講給人聽 */
/* 這支函式在 2026-08-17 之前**一條斷言都沒有**，只靠 golden 快照間接看得到它。
   而它印的每一句都掛在法定期限旁邊：「還有 3 個月」講的是預約、考試、重考要塞進去的時間。
   舊版是「天數 ÷ 30.44 再四捨五入」，**會往多的方向多報最多 15 天**——
   多報剩餘時間就是叫人晚點再辦。改成走曆法只算已經滿的整月之後，
   下面這幾條釘的就是「永遠不會多講」這件事本身。 */
console.log("\n— human()：距離 —");
const H = sandbox.human, G = sandbox.dayGap;

ok("60 天以內講天數，不換算成月", H([2026, 8, 17], [2026, 10, 15]) === "59 天",
  H([2026, 8, 17], [2026, 10, 15]));
ok("剛好 60 天就換成月（而且是無條件捨去的 1 個月，不是 2）",
  H([2026, 8, 17], [2026, 10, 16]) === "1 個月", H([2026, 8, 17], [2026, 10, 16]));

/* 舊算式在這裡會說「3 個月」：80 / 30.44 = 2.63 → 四捨五入 3。
   實際只有 2 個月又 19 天，多報 19 天。 */
ok("80 天不准講成 3 個月（舊算式會，這是這次修法的原點）",
  H([2026, 8, 17], [2026, 11, 5]) === "2 個月",
  "80 天 → " + H([2026, 8, 17], [2026, 11, 5]));

ok("差一天就滿一個月時仍講上一個整月",
  H([2026, 8, 17], [2026, 11, 16]) === "2 個月", H([2026, 8, 17], [2026, 11, 16]));
ok("剛好滿三個月的當天就講 3 個月",
  H([2026, 8, 17], [2026, 11, 17]) === "3 個月", H([2026, 8, 17], [2026, 11, 17]));

ok("滿一年講「1 年」，不講「12 個月」也不講「1 年 0 個月」",
  H([2026, 8, 17], [2027, 8, 17]) === "1 年", H([2026, 8, 17], [2027, 8, 17]));
ok("差一天不滿一年時講 11 個月，不會冒出「0 年 11 個月」",
  H([2026, 8, 17], [2027, 8, 16]) === "11 個月", H([2026, 8, 17], [2027, 8, 16]));
ok("年與月一起講", H([2026, 8, 17], [2028, 2, 20]) === "1 年 6 個月",
  H([2026, 8, 17], [2028, 2, 20]));

/* 舊版是 Math.floor(days/365)：跨過 4 個閏年之後那個 365 會多算出一整天，
   在「剛好滿 N 年」的邊界上就會早一天說「滿了」。曆法版不會。 */
ok("跨閏年的整年邊界：差一天就是差一天",
  H([2020, 2, 29], [2024, 2, 28]) === "3 年 11 個月" && H([2020, 2, 29], [2024, 2, 29]) === "4 年",
  H([2020, 2, 29], [2024, 2, 28]) + " ／ " + H([2020, 2, 29], [2024, 2, 29]));

/* 呼叫端有「已過 N」與「還有 N」兩種語序，很容易把兩個日期填反。
   這支只回長度不回方向，所以填反了也要給同一個答案——不是印出負數天。 */
ok("兩個日期填反了給同一個答案", H([2027, 8, 17], [2026, 8, 17]) === H([2026, 8, 17], [2027, 8, 17]),
  H([2027, 8, 17], [2026, 8, 17]));
ok("同一天是 0 天", H([2026, 8, 17], [2026, 8, 17]) === "0 天", H([2026, 8, 17], [2026, 8, 17]));

/* 這一條是通則，不是逐格對答案：**任何**距離講出來的月數，
   都不准超過實際過掉的月數。掃三年份的每一天。 */
let overstated = null;
for (let k = 0; k <= 1100 && !overstated; k++) {
  const d = new Date(Date.UTC(2026, 7, 17 + k));
  const target = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  const txt = H([2026, 8, 17], target);
  const mm = txt.match(/(?:(\d+) 年)? ?(?:(\d+) 個月)?/);
  const months = (Number(mm[1] || 0) * 12) + Number(mm[2] || 0);
  if (!months) continue;
  /* 宣稱滿 N 個月 → 那個曆法日期必須真的已經到了 */
  const anniv = new Date(Date.UTC(2026, 7 + months, 17));
  if (G([anniv.getUTCFullYear(), anniv.getUTCMonth() + 1, anniv.getUTCDate()], target) < 0) {
    overstated = target.join("-") + " 說「" + txt + "」，但那個月份還沒到";
  }
}
ok("三年份逐日掃：沒有任何一天被多報月數", overstated === null, overstated);

/* ================================================ 版面 */
console.log("\n— 版面 —");
ok("nav 有 /settle 的入口", /href="#settle"/.test(HTML));
ok("section#settle 存在且五個掛載點都在",
  /<section class="tool" id="settle">/.test(HTML) &&
  ["sdrive", "snhi", "ssupr", "sflags", "settlesrc"].every(id => HTML.includes('id="' + id + '"')));
ok("兩個日期欄位要講清楚不會離開瀏覽器",
  /id="sout"/.test(HTML) && /id="spr"/.test(HTML) &&
  HTML.includes("日期只留在你自己的瀏覽器裡"));
ok("標題就講出「兩個時鐘」，不要讓人自己拼",
  HTML.includes("定居：兩個時鐘"));

console.log("\n" + (fail === 0 ? "全數通過" : "有失敗") + "：" + pass + " 過 / " + fail + " 失敗");
process.exit(fail === 0 ? 0 : 1);
