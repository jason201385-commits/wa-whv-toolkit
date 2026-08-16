#!/usr/bin/env node
/* 年齡時鐘與技術移民點數的回歸測試。
 *
 * 為什麼這一段特別需要測（比站上任何其他工具都更需要）：
 * checkAge() 印出來的是**具體日期**——「2029-03-14 你的年齡分數從 30 變 25」。
 * 人會拿這種日期去排整個人生的順序：什麼時候考英文、什麼時候辭職、要不要去讀書。
 * 算錯一天，錯的不是版面，是有人照著錯的日期把準備排晚了一年。
 *
 * 三個已知會出錯的地方，這裡逐一釘住：
 *   (a) 級距邊界。官方寫的是「at least 25 but less than 33」——生日當天就進新級距。
 *       用「25–32」回推的寫法會在生日當天差一天。
 *   (b) delta 的比較基準。24 歲的人在 33 歲那一格應該看到 −5（從 30 掉到 25），
 *       不是拿 25 去跟他現在的 25 相比得出 0。第一版就是這樣寫錯的。
 *   (c) 工作年資 20 分上限。海外 15 ＋ 澳洲 20 各自都合法，合計 35 卻超過上限。
 *       漏掉這個上限的試算工具會讓人以為自己多 15 分。
 *
 * 另外釘住兩句「不可以長回來」的話：
 *   - 積分測驗以受邀當下認定（不是送 EOI 那天）——這是整個工具存在的理由
 *   - 不得出現「幾分保證被邀請」的分數線，官方那張表上根本沒有這個數字
 *
 * 跑法：node test/pr.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

/* 與 cost.test.js 同一套大括號配對切法，同樣刻意複製而不共用。 */
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
/* esc / el 是單行 arrow，大括號配對切不到，照行抓。 */
function oneLine(needle) {
  const i = HTML.indexOf(needle);
  if (i < 0) throw new Error("在 index.html 找不到：" + needle);
  return HTML.slice(i, HTML.indexOf("\n", i));
}

/* PR 那一整段（含 checkAge、事件綁定、點數 IIFE）連著切，
   不逐個函式挑——挑漏一個就會在測試裡變成 ReferenceError 而不是紅字，很難查。 */
const PR_HEAD = "/* ================= 年齡時鐘與點數";
const prBlock = HTML.slice(HTML.indexOf(PR_HEAD), HTML.lastIndexOf("</script>"));
if (HTML.indexOf(PR_HEAD) < 0) throw new Error("找不到 PR 區塊");

const SRC = [slice("const DATA = {"), oneLine("const esc = s =>"), oneLine("const el = (t,c,h) =>"), prBlock].join(";\n");

/* ---- 極簡假 DOM ---- */
let NOW = [2026, 8, 17];
const RealDate = Date;
function FakeDate(...a) {
  if (a.length === 0) return new RealDate(NOW[0], NOW[1] - 1, NOW[2]);
  return new RealDate(...a);
}
FakeDate.UTC = RealDate.UTC;
FakeDate.now = () => new RealDate(NOW[0], NOW[1] - 1, NOW[2]).getTime();

const created = [];
function mkEl(tag) {
  const e = {
    tag, className: "", innerHTML: "", value: "", hidden: true,
    dataset: {}, children: [], _h: {},
    appendChild(c) { this.children.push(c); return c; },
    setAttribute() {},
    addEventListener(ev, fn) { this._h[ev] = fn; },
    dispatchEvent(ev) { const f = this._h[ev && ev.type]; if (f) f(); },
  };
  created.push(e);
  return e;
}
const boxes = {
  "#bans": mkEl("div"), "#prans": mkEl("div"),
  "#prq": mkEl("div"), "#bday": mkEl("input"), "#bgo": mkEl("button"),
};
const sandbox = {
  Math, Number, String, console, isFinite, parseFloat,
  Date: FakeDate,
  Event: function (t) { return { type: t }; },
  document: {
    createElement: mkEl,
    querySelector(sel) {
      const m = /\[data-pk="([^"]+)"\]/.exec(sel);
      if (m) return created.find(e => e.dataset.pk === m[1]) || null;
      return null;
    },
  },
  $: sel => boxes[sel] || mkEl("div"),
};
vm.createContext(sandbox);
vm.runInContext(SRC + ";\nglobalThis.DATA = DATA; globalThis.checkAge = checkAge;", sandbox);

const P = sandbox.DATA.pr;

/* ---- 驅動器 ---- */
function runAge(birth, now) {
  if (now) NOW = now;
  boxes["#bday"].value = birth == null ? "" : birth;
  const box = boxes["#bans"];
  box.className = ""; box.innerHTML = ""; box.hidden = true;
  sandbox.checkAge();
  return {
    tone: box.className.replace("ans", "").trim(),
    verdict: (box.innerHTML.match(/<div class="verdict">([\s\S]*?)<\/div>/) || [, ""])[1],
    html: box.innerHTML,
  };
}
function pick(k, v) {
  const sel = created.find(e => e.dataset.pk === k);
  if (!sel) throw new Error("找不到欄位 " + k);
  sel.value = String(v);
  sel._h.change();
}
function runPoints(answers) {
  Object.keys(answers).forEach(k => pick(k, answers[k]));
  const box = boxes["#prans"];
  return {
    total: parseInt((box.innerHTML.match(/<div class="verdict">(\d+) 分/) || [, "-1"])[1], 10),
    html: box.innerHTML,
  };
}
/* 題目選項是照 DATA 的順序，用分數反查 index，測試才不會被選項排序綁死。 */
const idxOf = (k, points) => P.q.find(q => q.k === k).o.findIndex(o => o[1] === points);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + (extra ? "\n    " + extra : "")); }
}

/* ================================================ 官方點數表本身 */
console.log("\n— 年齡級距要逐字對上 immi 189 積分表 —");
ok("四個級距的邊界與分數與官方一致",
  JSON.stringify(P.age.map(x => [x.lo, x.hi, x.p])) === JSON.stringify([[18,25,25],[25,33,30],[33,40,25],[40,45,15]]),
  JSON.stringify(P.age.map(x => [x.lo, x.hi, x.p])));
ok("級距首尾相接，沒有空隙也沒有重疊",
  P.age.every((x, i) => i === 0 || P.age[i-1].hi === x.lo));
ok("級距文字用「至少 N 歲、未滿 M 歲」的官方寫法，不寫成 18–24",
  P.age.every(x => x.t.includes("至少") && x.t.includes("未滿")),
  "官方原文是 at least X but less than Y——寫成區間會在生日當天差一天");

console.log("\n— 提名加分（immi 與西澳兩個獨立來源都確認過）—");
const visaOpts = P.q.find(q => q.k === "visa").o;
ok("189 加 0 分、190 加 5 分、491 加 15 分",
  visaOpts.find(o => o[0].startsWith("189"))[1] === 0 &&
  visaOpts.find(o => o[0].startsWith("190"))[1] === 5 &&
  visaOpts.find(o => o[0].startsWith("491"))[1] === 15,
  JSON.stringify(visaOpts));
ok("英文三級是 0 / 10 / 20",
  JSON.stringify(P.q.find(q => q.k === "eng").o.map(o => o[1])) === "[0,10,20]");
ok("澳洲工作年資最高 20 分、海外最高 15 分",
  Math.max(...P.q.find(q => q.k === "aus").o.map(o => o[1])) === 20 &&
  Math.max(...P.q.find(q => q.k === "ovs").o.map(o => o[1])) === 15);
ok("工作年資合計上限是 20", P.empCap === 20);
ok("所有選項的分數都是非負整數",
  P.q.every(q => q.o.every(o => Number.isInteger(o[1]) && o[1] >= 0)));

/* ================================================ 年齡時鐘 */
console.log("\n— 級距邊界：生日當天就換級距 —");
const N = [2026, 8, 17];
ok("生日當天滿 25 → 30 分（不是隔天才算）", runAge("2001-08-17", N).html.includes("<b>30 分</b>"),
  runAge("2001-08-17", N).verdict);
ok("生日前一天仍是 24 歲 → 25 分", runAge("2001-08-18", N).html.includes("<b>25 分</b>"));
ok("生日當天滿 33 → 掉到 25 分", runAge("1993-08-17", N).html.includes("<b>25 分</b>"));
ok("生日前一天仍是 32 歲 → 還是 30 分", runAge("1993-08-18", N).html.includes("<b>30 分</b>"));
ok("生日當天滿 40 → 15 分", runAge("1986-08-17", N).html.includes("<b>15 分</b>"));

console.log("\n— 45 歲：不是 0 分，是不在表上 —");
const over = runAge("1981-08-17", N);
ok("滿 45 當天就出局", over.tone === "bad" && over.verdict.includes("45 歲以上"), over.verdict);
ok("明說是「不在這張表的範圍內」而不是 0 分", over.html.includes("不在這張表的範圍內"));
ok("出局時給出下一步（官方連結或 MARA），不是只說不行", /MARA|移民代理/.test(over.html));
const almost = runAge("1981-08-18", N);
ok("差一天滿 45 → 仍是 15 分，但色調是 bad",
  almost.html.includes("<b>15 分</b>") && almost.tone === "bad", almost.tone);

console.log("\n— 天數與掉分日期 —");
const soon = runAge("2001-08-18", N);
ok("明天生日 → 顯示「還有 1 天」", soon.html.includes("還有 1 天"), soon.html.slice(0, 400));
ok("24 歲的人下一個生日是加分，不該被標成警告",
  soon.tone === "ok" && !soon.verdict.includes("掉分"), soon.tone + " / " + soon.verdict);
ok("24 歲的人在 25 歲那格看到 +5", soon.html.includes("（+5）"));
/* 第一版的 bug：delta 拿現在的級距當基準，33 歲那格會印成 0。 */
ok("24 歲的人在 33 歲那格看到 −5，不是 0",
  soon.html.includes("滿 33 歲 — 年齡分數變 25 分（-5）"),
  (soon.html.match(/滿 33 歲[^<]*/) || [""])[0]);
ok("24 歲的人在 40 歲那格看到 −10",
  soon.html.includes("滿 40 歲 — 年齡分數變 15 分（-10）"),
  (soon.html.match(/滿 40 歲[^<]*/) || [""])[0]);
ok("任何未滿 45 的人都會看到 45 歲關門那一行",
  ["2001-08-18", "1993-08-17", "1986-08-17", "1981-08-18"]
    .every(b => runAge(b, N).html.includes("滿 45 歲 — 年齡分數表關門")));
const dropSoon = runAge("1993-08-18", N);
ok("一年內會掉分 → 色調 warn 且說出來",
  dropSoon.tone === "warn" && dropSoon.verdict.includes("一年內會掉分"),
  dropSoon.tone + " / " + dropSoon.verdict);

console.log("\n— 輸入的邊角 —");
ok("沒填 → 提示而不是算出東西", runAge("", N).verdict.includes("先填出生日期"));
ok("亂填 → 不當成 0 歲", runAge("abc", N).verdict.includes("先填出生日期"));
ok("未滿 18 → 告訴他哪一天開始起算",
  runAge("2015-03-09", N).html.includes("2033-03-09"), runAge("2015-03-09", N).html);
ok("2/29 出生 → 明說這裡不猜非閏年怎麼認定",
  runAge("2000-02-29", N).html.includes("不猜"));
ok("非 2/29 出生 → 不出現那段閏年說明",
  !runAge("2000-03-01", N).html.includes("非閏年的生日"));

console.log("\n— 這個工具存在的理由，不可以被改掉 —");
const anyone = runAge("1996-01-15", N);
ok("每次都要講「以受邀當下認定」",
  anyone.html.includes("受邀當下") && anyone.html.includes("time of invitation"));
ok("要標明官方原文寫的是 most 不是 all",
  anyone.html.includes("most，不是 all"),
  "原文有例外（婚姻狀況那項），寫成 all 就是把官方的保留條款吃掉");
ok("要明說 EOI 掛著等的期間年齡照走", anyone.html.includes("EOI"));

/* ================================================ 點數試算 */
console.log("\n— 點數試算 —");
const base = {
  age: 30, visa: idxOf("visa", 0), eng: idxOf("eng", 0), edu: idxOf("edu", 15),
  ovs: idxOf("ovs", 0), aus: idxOf("aus", 0), stem: idxOf("stem", 0),
  study: idxOf("study", 0), py: idxOf("py", 0), naati: idxOf("naati", 0),
  reg: idxOf("reg", 0), ptn: idxOf("ptn", 10),
};
ok("最小完整組合：30（年齡）+15（學士）+10（單身）= 55", runPoints(base).total === 55,
  String(runPoints(base).total));
ok("英文從 Competent 換成 Superior → +20", runPoints({ eng: idxOf("eng", 20) }).total === 75);
ok("加上 491 提名 → +15", runPoints({ visa: idxOf("visa", 15) }).total === 90);

/* 這一條是漏掉最貴的：海外 15 ＋ 澳洲 20 各自都合法，合計 35 卻超過官方 20 分上限。 */
const capped = runPoints({ ovs: idxOf("ovs", 15), aus: idxOf("aus", 20) });
ok("工作年資合計 35 → 砍到 20", capped.total === 90 + 20, String(capped.total));
ok("被砍的時候要說出來，不是靜靜砍掉",
  capped.html.includes("20 分上限") && capped.html.includes("35 分"));
const under = runPoints({ ovs: idxOf("ovs", 5), aus: idxOf("aus", 5) });
ok("合計 10 分沒到上限 → 不出現砍分說明", !under.html.includes("上限"), String(under.total));

console.log("\n— 沒填完就不給總分 —");
{
  /* 重跑一次 IIFE 拿到乾淨的欄位，才不會被上面填過的值汙染。 */
  const sel = created.find(e => e.dataset.pk === "eng");
  sel.value = ""; sel._h.change();
  const box = boxes["#prans"];
  ok("少一題 → 不印總分，並說少幾題",
    !/<div class="verdict">\d+ 分/.test(box.innerHTML) && box.innerHTML.includes("1</b> 題沒填"),
    box.innerHTML.slice(0, 200));
  sel.value = String(idxOf("eng", 20)); sel._h.change();
}
ok("算完要說這是自己宣稱的分數，不是移民部認可的",
  boxes["#prans"].innerHTML.includes("不是移民部認可的分數"));

/* ================================================ 不可以長回來的宣稱 */
console.log("\n— 無來源宣稱守門 —");
/* 官方 189 積分表頁面上沒有任何及格分數。任何「N 分保證上」都是猜測，
   而這個站的規則是只給判斷基準、不給會過期的數字。 */
ok("不得寫出任何「幾分會被邀請／保證上」的分數線",
  !/(\d{2})\s*分[^。]{0,12}(保證|一定|穩)[^。]{0,6}(上|邀|過)/.test(HTML),
  (HTML.match(/(\d{2})\s*分[^。]{0,12}(保證|一定|穩)[^。]{0,6}(上|邀|過)/) || [])[0]);
ok("要明說這張表沒有寫幾分會被邀請",
  HTML.includes("沒有寫幾分會被邀請") || HTML.includes("沒有告訴你幾分會被邀請"));
/* WHV 的時數與職業條件是 grok 提出、我回官方原文查證後才寫上去的，
   兩句原文都要留著——沒有原文，這幾條就退化成「聽說」。 */
ok("技術年資的兩句官方原文都在站上",
  HTML.includes("closely related skilled occupation") && HTML.includes("at least 20 hours a week"));
ok("西澳 ABN／自僱排除要附官方原文",
  HTML.includes("do not meet the above requirements"));
ok("491 免僱傭合約要附官方原文",
  HTML.includes("not applicable to visa 491 applicants"));
ok("不得把 WASMOL／GOL 的職業清單抄進站裡（清單會變）",
  !/Schedule 1 (包含|清單如下|職業：)/.test(HTML) && HTML.includes("這個站不抄清單"));

console.log("\n— 來源 —");
ok("四筆來源，全部已核（點數表與西澳州擔保頁都是自己 curl 過的）",
  P.src.length === 4 && P.src.every(s => s.v === true),
  `實得 ${P.src.length} 筆／待核 ${P.src.filter(s => s.v === false).length} 筆`);
ok("來源都指向官方網域（immi.homeaffairs.gov.au 或 migration.wa.gov.au）",
  P.src.every(s => /^https:\/\/(immi\.homeaffairs|migration\.wa)\.gov\.au\//.test(s.u)),
  P.src.map(s => s.u).join("\n    "));

console.log("\n— 版面 —");
ok("nav 有 /pr 的入口", HTML.includes('href="#pr"'));
ok("section#pr 存在且四個掛載點都在",
  ['id="pr"', 'id="bans"', 'id="prq"', 'id="prans"', 'id="prwhv"', 'id="prwa"', 'id="prflags"', 'id="prsrc"']
    .every(s => HTML.includes(s)));
ok("出生日期欄位要講清楚不會離開瀏覽器", HTML.includes("只留在你自己的瀏覽器裡"));

console.log(`\n${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
