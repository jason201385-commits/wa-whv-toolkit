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
vm.runInContext(SRC + ";\nglobalThis.DATA = DATA;", sandbox);

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
/* 離台 2024-10-01 → 戶籍那條落在 2026-10-01，距 2026-08-17 是 45 天。
   刻意只填一個欄位：兩個都填的話 DASP 那條會把色調拉走，測不到這個門檻。 */
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

console.log("\n— 期限不是辦理時間 —");
ok("要明說這些是法規期限，不是你辦得完的時間",
  both.html.includes("不是辦理時間"));

/* ================================================ 不可以退回舊版本的事實 */
console.log("\n— 三件在中文網路上普遍過期的事實 —");
const ALL = S.drive.concat(S.nhi, S.supr, S.flags).join("\n");

ok("駕照：明講 2025-11-01 台灣被移出承認名單",
  /2025-11-01/.test(ALL) && ALL.includes("承認名單"));
ok("駕照：附西澳公告原文，不是自己說的",
  ALL.includes("no longer exists") &&
  ALL.includes("pass a theory test and Practical Driving Assessment"));
ok("駕照：明講換照義務來自 PR 而不是落地",
  ALL.includes("PR 帶來的") && ALL.includes("do not need to transfer your overseas licence"));
ok("駕照：附「3 個月後即使沒過期也不能開」的原文",
  ALL.includes("even if it is current and valid"));
/* 官網的國家查詢器對台灣還顯示舊文案，但分類旗標是 0（未承認）。
   使用者會自己去點那個查詢器，所以這個矛盾必須由站上先講。 */
ok("駕照：主動揭露官網查詢器還沒改乾淨這件事",
  ALL.includes("experienced driver recognised country") && ALL.includes("以流程頁與公告為準"));

ok("健保：明講停保制度自 2024-12-23 起廢止",
  /113 年 12 月 23 日|2024-12-23/.test(ALL) && ALL.includes("不受理停保申請"));
ok("健保：附憲法法庭判決依據，不是「聽說改了」",
  ALL.includes("憲法法庭") && ALL.includes("111 年憲判字第 19 號"));
ok("健保：把「停保」與「戶籍遷出」分開講（這是兩件事）",
  ALL.includes("真正讓你停繳的是戶籍遷出"));
ok("健保：講出回台加保的 6 個月等待期與唯一例外",
  ALL.includes("滿 6 個月") && ALL.includes("有一定雇主之受僱者"));
ok("健保：國外就醫核退要講清楚是有上限的補貼，不是保險",
  ALL.includes("它是補貼，不是保險"));

ok("超級年金：明講 PR 核准那一刻 DASP 資格永久消失",
  ALL.includes("永久消失") &&
  ALL.includes("you're not an Australian or New Zealand citizen, or a permanent resident of Australia"));
ok("超級年金：講出 WHM 的 65% 稅率", /65%/.test(ALL) && ALL.includes("WHM"));
ok("超級年金：明講這是整區唯一不可逆的一格",
  ALL.includes("不可逆"));

ok("Medicare：明講台灣不在互惠協定名單裡，並把 11 國列出來",
  ALL.includes("沒有台灣") && ALL.includes("11 個國家") &&
  ["Belgium", "Finland", "Italy", "Malta", "Netherlands", "New Zealand",
   "Norway", "Ireland", "Slovenia", "Sweden", "United Kingdom"].every(c => ALL.includes(c)));

console.log("\n— 這個站不做的事 —");
/* 這一區最容易長出來的違規是「幫人決定要不要拿 PR」。
   它只能把交換條件擺出來，不能替人選。 */
ok("不得出現「建議你拿／不要拿 PR」這種替人決定的話",
  !/建議你(拿|申請|不要)|你應該(拿|申請)/.test(ALL),
  (ALL.match(/建議你[^。]{0,20}|你應該[^。]{0,20}/g) || []).join("｜"));
ok("不得寫出沒有來源的辦理天數或核准率",
  !/(核准率|通過率)\s*\d|大約\s*\d+\s*(天|週|個月)就/.test(ALL),
  (ALL.match(/(核准率|通過率)\s*\d[^。]{0,20}/g) || []).join("｜"));
ok("明說每個數字都會變，並要求使用者自己點官方連結",
  ALL.includes("要做決定之前自己點進去看一次"));

/* ================================================ 來源 */
console.log("\n— 來源 —");
ok("八筆來源，全部已核（每一筆都自己 curl 過 200）",
  S.src.length === 8 && S.src.every(s => s.v === true),
  `實得 ${S.src.length} 筆／待核 ${S.src.filter(s => s.v === false).length} 筆`);
const DOMAINS = ["transport.wa.gov.au", "servicesaustralia.gov.au", "ato.gov.au", "nhi.gov.tw"];
ok("來源都指向官方網域",
  S.src.every(s => DOMAINS.some(d => s.u.includes("://www." + d + "/"))),
  S.src.filter(s => !DOMAINS.some(d => s.u.includes("://www." + d + "/"))).map(s => s.u).join("\n    "));
ok("全部走 https", S.src.every(s => s.u.startsWith("https://")));
ok("每一筆都有查核日期", S.src.every(s => /^\d{4}-\d{2}-\d{2}$/.test(s.as)));
/* 四個主題各要有自己的來源，缺一個就代表那一塊是沒有出處的。 */
ok("駕照、健保、Medicare、超級年金四塊各自都有來源",
  S.src.some(s => s.u.includes("transport.wa.gov.au")) &&
  S.src.some(s => s.u.includes("nhi.gov.tw")) &&
  S.src.some(s => s.u.includes("servicesaustralia.gov.au")) &&
  S.src.some(s => s.u.includes("ato.gov.au")));

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
