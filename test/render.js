/* 把答案面板渲染成純文字，用眼睛讀一遍。**這支不會判定對錯，它只印東西給人看。**

   為什麼需要它：斷言證明的是「該出現的字串有出現」，證明不了整段話讀起來對不對。
   2026-08-17 的實例——/settle 的 DASP 那一列寫「但這個倒數不是還可以動手的期間」，
   334 條斷言全綠，但 PR 已核准的人畫面上顯示的是「已過 N 個月」，根本沒有倒數，
   那句話指著一個不存在的東西。是把面板印成純文字讀過一遍才看見的。

   跑法：node test/render.js        （唯讀，不會動到 index.html）
   **改完任何文案都跑一次，然後真的把它讀完**——只跑不讀等於沒跑。

   日期一律用「相對今天」算，所以不管哪一年跑，四種狀態都還在。 */
const fs = require("fs"), vm = require("vm"), path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

/* 從 index.html 直接挖程式碼出來跑，測到的才是正式版本身。
   這個版本認得字串與註解，所以裡面的大括號不會把配對算歪。 */
function slice(p) {
  const i = HTML.indexOf(p);
  if (i < 0) throw new Error("找不到：" + p);
  let d = 0, q = null, esc = false;
  for (let j = HTML.indexOf("{", i); j < HTML.length; j++) {
    const c = HTML[j];
    if (q) { if (esc) { esc = false; continue; } if (c === "\\") { esc = true; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "/" && HTML[j + 1] === "*") { j = HTML.indexOf("*/", j) + 1; continue; }
    if (c === "{") d++; else if (c === "}") { d--; if (d === 0) return HTML.slice(i, j + 1); }
  }
  throw new Error("大括號沒配對：" + p);
}
function oneLine(n) { const i = HTML.indexOf(n); return HTML.slice(i, HTML.indexOf("\n", i)); }

/* 表格要在 td/th 之間補分隔、在 tr 收尾斷行，否則整張費用表會黏成一行看不出對應關係
   ——而那張表的重點正好是「哪個金額對到哪一條路」。 */
const plain = h => h
  .replace(/<\/t[dh]>/g, "　│　").replace(/<\/tr>/g, "\n")
  /* `.kv .n` 的 CSS 是 display:block，畫面上它自己一行。攤平時不補這個斷行，
     門檻總表會變成「IELTS AcademicProficient 7 / 7…」——名稱跟門檻黏在一起。
     這支的全部用途就是讓人讀，讀不出來就等於沒印。 */
  .replace(/<span class="n">/g, "\n")
  .replace(/<\/li>|<\/p>|<\/div>/g, "\n").replace(/<br\s*\/?>/g, "\n")
  .replace(/<[^>]+>/g, "").replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, "—")
  .split("\n").map(l => l.trim()).filter(Boolean).join("\n");

const TODAY = new Date();
const iso = d => d.toISOString().slice(0, 10);
const monthsAgo = n => { const d = new Date(TODAY); d.setMonth(d.getMonth() - n); return iso(d); };
const daysAgo = n => { const d = new Date(TODAY); d.setDate(d.getDate() - n); return iso(d); };

/* ================= /cost ================= */
(function () {
  const SRC = ["const DATA = " + slice("const DATA = {").replace(/^const DATA = /, ""),
    slice("function whmTaxCents("), slice("function residentTaxCents("),
    slice("function medicareLevyCents("), slice("function checkCost(")].join(";\n");
  const fields = {}, box = { hidden: true, className: "", innerHTML: "" };
  /* 剪貼簿以前是 `copyRow: () => {}`——整支人眼關卡看不到它。
     它是**唯一會被別人看到的那一份輸出**，而這一整個專案抓到的缺陷有一半
     是「畫面改了、剪貼簿沒跟上」。看不見的那一份才是要印出來讀的那一份。 */
  let clip = null;
  const sb = { isFinite, parseFloat, Math, Number, String, console,
    $: s => s === "#costans" ? box : (fields[s] || { value: "" }),
    copyRow: (_b, text) => { clip = text; } };
  vm.createContext(sb);
  vm.runInContext(SRC + ";globalThis.checkCost = checkCost;", sb);

  /* 以前這支只收 (rate, hours, mode)，支出欄一律留白——於是每週支出、房租判準、
     存錢目標、剪貼簿四整段從來沒有被人眼看過。房租那一格正好是這一頁「真正有用」
     的地方（畫面自己這樣寫），而它是盲區。改成收整包欄位。 */
  function show(label, o) {
    Object.assign(fields, {
      "#crate": { value: String(o.rate) }, "#chours": { value: String(o.hours) },
      "#ctax": { value: o.mode || "unknown" },
      "#crent": { value: o.rent == null ? "" : String(o.rent) },
      "#cbills": { value: o.bills || "inc" },
      "#ctrans": { value: o.trans || "walk" },
      "#ccar": { value: o.car == null ? "" : String(o.car) },
      "#cfood": { value: o.food == null ? "" : String(o.food) },
      "#cgoal": { value: o.goal == null ? "" : String(o.goal) } });
    box.innerHTML = ""; clip = null; sb.checkCost();
    console.log("\n═══ /cost　" + label + "　(年收 $" + (o.rate * o.hours * 52).toLocaleString() + ") ═══");
    console.log(plain(box.innerHTML));
    /* 剪貼簿另外印，而且標明它是貼進群組的那一份——讀的時候要用「別人只看得到這幾行」
       的眼光看，畫面上有的東西這裡沒有，才看得出來少了什麼。 */
    console.log("─── 剪貼簿（貼進群組的就只有這幾行） ───");
    console.log(clip === null ? "（沒有呼叫 copyRow——這一支提早 bail 了）" : clip);
  }
  /* 四種稅況各看一次：Medicare levy 的三段（免課／10% 過渡／全額 2%）都要走到。
     支出欄一律填——留白的話下面整個房租判準與剪貼簿的房租行都不會出現。 */
  show("居民・下門檻以下", { rate: 20, hours: 20, mode: "resident", rent: 150, food: 80 });
  show("居民・過渡段（只課超過部分的 10%）", { rate: 25, hours: 25, mode: "resident", rent: 180, food: 90, trans: "sr20" });
  show("居民・全額 2%", { rate: 35, hours: 38, mode: "resident", rent: 300, food: 120, trans: "cash", goal: 15000 });
  show("居民・高收入", { rate: 40, hours: 75, mode: "resident", rent: 400, food: 150, trans: "car", car: 60 });
  show("對照組：WHM 有登記", { rate: 35, hours: 38, mode: "reg", rent: 250, food: 120, goal: 8000 });
  show("對照組：雇主沒登記（走外國居民表）", { rate: 35, hours: 38, mode: "unreg", rent: 250, food: 120 });

  /* 下面五個是判準本身的分支，不是稅況的分支。四支剪貼簿標題（負／房租過重／未登記／✅）
     要各出現一次，房租三種狀態（超過／踩線／低於）也要各出現一次——
     踩線那兩側是同一個顯示值配相反的判定，兩邊都要用眼睛讀過。 */
  show("房租過重（overStress）＋存錢目標", { rate: 34, hours: 38, mode: "reg", rent: 450, food: 130, goal: 12000 });
  show("房租踩線・還沒超過（顯示 30.0%）", { rate: 34, hours: 38, mode: "reg", rent: 387.60, food: 130 });
  show("房租踩線・已經超過（顯示還是 30.0%）", { rate: 34, hours: 38, mode: "reg", rent: 387.61, food: 130 });
  show("負結餘＋支出時數逼近工時", { rate: 26.45, hours: 20, mode: "reg", rent: 450 });
  show("農場包吃住（從薪水扣）", { rate: 30, hours: 45, mode: "reg", rent: 180, bills: "farm", food: 40, goal: 20000 });
  show("不含水電網路＋SmartRider 無 Autoload", { rate: 28, hours: 30, mode: "unknown", rent: 220, bills: "exc", food: 110, trans: "sr" });
})();

/* ================= /settle ================= */
(function () {
  const tail = HTML.slice(HTML.indexOf("/* ================= 年齡時鐘與點數"), HTML.lastIndexOf("</script>"));
  const SRC = [slice("const DATA = {"), oneLine("const esc = s =>"), oneLine("const el = (t,c,h) =>"), tail].join(";\n");

  function mkEl(tag) {
    return { tag, className: "", innerHTML: "", value: "", hidden: true, max: "", dataset: {}, children: [], _h: {},
      appendChild(c) { this.children.push(c); return c; }, setAttribute() {},
      addEventListener(ev, fn) { this._h[ev] = fn; }, dispatchEvent(ev) { const f = this._h[ev && ev.type]; if (f) f(); } };
  }
  const boxes = {};
  ["#sans", "#sgo", "#sout", "#spr", "#sfee"].forEach(k => { boxes[k] = mkEl("div"); });
  const sb = { Math, Number, String, console, isFinite, parseFloat, Date,
    Event: function (t) { return { type: t }; },
    document: { createElement: mkEl, querySelector() { return null; } },
    $: s => boxes[s] || mkEl("div") };
  vm.createContext(sb); vm.runInContext(SRC, sb);

  function show(label, out, pr) {
    boxes["#sout"].value = out || ""; boxes["#spr"].value = pr || "";
    const b = boxes["#sans"]; b.className = ""; b.innerHTML = ""; b.hidden = true;
    boxes["#sgo"]._h.click();
    console.log("\n═══ /settle　" + label + "　[" + b.className.replace("ans", "").trim() + "] ═══");
    console.log(plain(b.innerHTML));
  }
  /* 費用表是用 el()+appendChild 疊出來的，不是 HTML 字串，所以攤平時沒有 </li> 可以斷行。
     要自己按 tag 補：每個 li 一行、li 裡的兩個 span 是「項目 │ 金額」。
     不補的話整張表會黏成一行，而那張表的重點正好是哪個金額對到哪一條路。 */
  function flat(n) {
    const kids = n.children.map(flat);
    const inner = (n.innerHTML || "") + (n.tag === "li" ? kids.join("　│　") : kids.join(""));
    return (n.tag === "li" || n.tag === "p") ? inner + "\n" : inner;
  }
  console.log("\n═══ /settle　費用表（開檔就渲染） ═══");
  console.log(plain(flat(boxes["#sfee"])));

  /* 兩個時鐘各自的「還在倒數」與「已經過了」四種組合都要看一次——
     文案在其中一種狀態下讀起來會怪，是常見的退化方式。 */
  show("只填離台日（18 個月前）", monthsAgo(18), "");
  show("只填 PR 核准日（6 天前）", "", daysAgo(6));
  show("兩個都填，都還在倒數", monthsAgo(18), daysAgo(6));
  show("兩個都過期了（離台 40 個月、PR 8 個月前）", monthsAgo(40), monthsAgo(8));
})();

/* ================= /english =================
   /english 的 IIFE 跟 /settle 同在一段 tail 裡（它共用 ymd／dayGap／human），
   所以這裡切的是同一段程式碼，只是換一組掛載點來看它自己的輸出。 */
(function () {
  const tail = HTML.slice(HTML.indexOf("/* ================= 年齡時鐘與點數"), HTML.lastIndexOf("</script>"));
  const SRC = [slice("const DATA = {"), oneLine("const esc = s =>"), oneLine("const el = (t,c,h) =>"), tail].join(";\n");

  function mkEl(tag) {
    return { tag, className: "", innerHTML: "", value: "", hidden: true, max: "", dataset: {}, children: [], _h: {},
      appendChild(c) { this.children.push(c); return c; }, setAttribute() {},
      addEventListener(ev, fn) { this._h[ev] = fn; }, dispatchEvent(ev) { const f = this._h[ev && ev.type]; if (f) f(); } };
  }
  /* `#etest` 要當成真的 <select>：指定選項以外的值會靜默變成 ""。
     用普通屬性的假 DOM 印出來的是「這支塞進去的值」，不是使用者看得到的值，
     於是這份「用眼睛讀」的輸出會替一條瀏覽器上走不到的路背書。 */
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
  const sb = { Math, Number, String, console, isFinite, parseFloat, Date,
    Event: function (t) { return { type: t }; },
    document: { createElement: mkEl, querySelector() { return null; } },
    $: s => boxes[s] || mkEl("div") };
  vm.createContext(sb); vm.runInContext(SRC, sb);

  function flat(n) {
    const kids = n.children.map(flat);
    const inner = (n.innerHTML || "") + (n.tag === "li" ? kids.join("　│　") : kids.join(""));
    return (n.tag === "li" || n.tag === "p") ? inner + "\n" : inner;
  }
  console.log("\n═══ /english　門檻總表（開檔就渲染） ═══");
  console.log(plain(flat(boxes["#etbl"])));

  /* 每一格都要單獨看一次：選單換表、四項沒填滿、剛好差一項、過期、
     兩個時鐘誰先關——文案在其中一種狀態下讀起來會怪，是常見的退化方式。 */
  function show(label, o) {
    /* 每一格當成重新開一次頁面：選單的 value 與 dataset.was 會跨格殘留。 */
    boxes["#etest"].innerHTML = ""; boxes["#etest"].value = ""; boxes["#etest"].dataset.was = "";
    boxes["#edate"].value = o.date || "";
    boxes["#edate"]._h.change && boxes["#edate"]._h.change();   /* 換表 */
    if (o.test) boxes["#etest"].value = o.test;
    /* `o.redate` ＝ 填完之後回頭改日期（年份打錯很常見）。畫面上 #edate 排在 #etest 前面，
       所以正序是安全的那一個，只跑正序等於沒在看換表。 */
    if (o.redate) { boxes["#edate"].value = o.redate; boxes["#edate"]._h.change && boxes["#edate"]._h.change(); }
    ["#el", "#er", "#ew", "#es"].forEach((k, i) => { boxes[k].value = o.sc ? String(o.sc[i]) : ""; });
    boxes["#esa"].value = o.sa || "";
    boxes["#edelay"].value = o.delay === undefined ? "" : String(o.delay);
    const b = boxes["#eans"]; b.className = ""; b.innerHTML = ""; b.hidden = true;
    boxes["#ego"]._h.click();
    console.log("\n═══ /english　" + label + "　[" + b.className.replace("ans", "").trim() + "] ═══");
    console.log(plain(b.innerHTML));
  }
  show("什麼都沒填", {});
  show("四項只填了兩項", { date: monthsAgo(6), test: "ieltsA", sc: [7, 7, "", ""] });
  show("IELTS A 7/7/7/7・沒填技術評估", { date: monthsAgo(6), test: "ieltsA", sc: [7, 7, 7, 7] });
  show("IELTS A 8/8/7.5/8・寫作差 0.5 就 Superior", { date: monthsAgo(6), test: "ieltsA", sc: [8, 8, 7.5, 8] });
  show("MET 頂到 Proficient 就沒有更高的了", { date: monthsAgo(6), test: "met", sc: [70, 70, 80, 70] });
  show("PTE 舊制・成績已過期（4 年前）", { date: monthsAgo(48), test: "pte", sc: [65, 65, 65, 65] });
  show("TOEFL 落在 2023-07-26～2024-05-04 不承認區間", { date: "2024-01-15", test: "toefl", sc: [30, 30, 30, 30] });
  show("C1 舊制・落在只認紙筆版的區間", { date: "2024-06-01", test: "c1", sc: [200, 200, 200, 200] });
  /* ⚠️ 這一格本來寫 monthsAgo(30)，那是 2024 年、落在舊制表，而舊制表上沒有 ieltsA，
        於是它一路走進「這張表上沒有這個考試」——標籤寫著要看兩個時鐘，實際上一個都沒印。
        要看兩個時鐘就得用新制表的日期（≥ 2025-08-07）。 */
  show("兩個時鐘都填・英文先關", { date: "2025-09-01", test: "ieltsA", sc: [7, 7, 7, 7], sa: monthsAgo(2), delay: 30 });
  show("兩個時鐘都填・技術評估先關", { date: monthsAgo(2), test: "ieltsA", sc: [7, 7, 7, 7], sa: monthsAgo(30) });
  show("兩扇門剛好同一天關", { date: "2025-09-01", test: "ieltsA", sc: [7, 7, 7, 7], sa: "2025-09-01", delay: 0 });
  /* 這兩格看的是技術評估那半邊的「算得出來 ≠ 還在未來」。英文那一邊本來就有守，
     技評那一邊漏到 2026-08-17 才補——只守一半比兩邊都不守更危險，
     因為守住的那一邊會讓人更相信另一邊。 */
  show("技術評估的 3 年早就走完（不准擺在「最晚」的位置）",
    { date: "2025-09-01", test: "ieltsA", sc: [7, 7, 7, 7], sa: monthsAgo(55) });
  show("技術評估剩不到 3 個月（重做要跑機構流程）",
    { date: "2025-09-01", test: "ieltsA", sc: [7, 7, 7, 7], sa: monthsAgo(34), delay: 10 });
  show("舊制成績剩不到 3 個月就到期", { date: "2023-10-01", test: "pte", sc: [65, 65, 65, 65] });
  show("遞件天數填 0（跟留空不一樣）", { date: monthsAgo(6), test: "ieltsA", sc: [7, 7, 7, 7], sa: monthsAgo(6), delay: 0 });
  show("遞件天數填 90（超過 60 天邀請期）", { date: monthsAgo(6), test: "ieltsA", sc: [7, 7, 7, 7], sa: monthsAgo(6), delay: 90 });
  show("四項連 Competent 都沒到", { date: monthsAgo(6), test: "ieltsA", sc: [5, 5.5, 5, 6] });
  /* 換表的三種下場，全部走「填完再回頭改日期」——不是硬塞 value。
     真的 <select> 選不到不存在的選項，硬塞出來的那條路使用者走不到。 */
  show("改日期換到舊制表・那張表沒有 CELPIP",
    { date: "2026-03-01", test: "celpip", redate: "2024-03-01", sc: [9, 9, 10, 9] });
  show("改日期換到新制表・IELTS 被拆成兩張（成績沒作廢，要重選）",
    { date: "2024-03-01", test: "ielts", redate: "2026-03-01", sc: [7, 7, 7, 7] });
  show("改日期換到舊制表・ieltsA 合併回 ielts 照常算分",
    { date: "2026-03-01", test: "ieltsA", redate: "2024-03-01", sc: [7, 7, 7, 7] });
  show("完全沒選考試種類", { date: "2026-03-01", sc: [7, 7, 7, 7] });
  /* 這兩格是「排不出日期 ≠ 來不及」。英文剩不到 60 天的時候，往回推的邀請日已成過去式，
     而結論句原本照樣寫「先關的是：英文，最晚 <過去的日期>」——
     讀起來像門關了，實際上成績還能用。方向是「誤以為來不及」，代價是白花錢重考。 */
  show("英文排不出邀請日、技評還開著（排不出 ≠ 來不及）",
    { date: "2023-10-01", test: "pte", sc: [65, 65, 65, 65], sa: monthsAgo(19) });
  show("兩邊都排不出來（技評也關了）",
    { date: "2023-10-01", test: "pte", sc: [65, 65, 65, 65], sa: monthsAgo(55) });
  show("遞件天數填負數", { date: monthsAgo(6), test: "ieltsA", sc: [7, 7, 7, 7], delay: -5 });
  show("遞件天數填小數（不能靜默捨去）", { date: monthsAgo(6), test: "ieltsA", sc: [7, 7, 7, 7], delay: 30.7 });
  show("技評核發日填在未來", { date: monthsAgo(6), test: "ieltsA", sc: [7, 7, 7, 7], sa: daysAgo(-120) });
  /* ⚠️ 2026-08-17 這一輪錯的不是句子是算式：英文的 3 年原本一律「量到遞件那天」，
     對 2025-08-07（含）以後考的成績是錯的——那一支量到「收到邀請」那天，
     效期那天本身就是最晚邀請日。這四格把兩支的長相攤開讀，
     重點是兩支的**理由段**要各自說得通，不是只有日期對。
     舊制的考試日寫死 2025-08-01（cutover 前一週）：既落在表二，效期又還很遠，
     不會跟「剩不到 3 個月」那一格的守混在一起。 */
  show("新制・填了遞件天數（那個數字不會改變邀請日）",
    { date: monthsAgo(6), test: "ieltsA", sc: [7, 7, 7, 7], sa: monthsAgo(2), delay: 14 });
  show("舊制・填了遞件天數（終點被壓到遞件那天）",
    { date: "2025-08-01", test: "pte", sc: [65, 65, 65, 65], sa: monthsAgo(2), delay: 14 });
  show("舊制・沒填遞件天數（給區間＋保守值）",
    { date: "2025-08-01", test: "pte", sc: [65, 65, 65, 65], sa: monthsAgo(2) });
  show("cutover 前一天考的（仍走舊制那一支）",
    { date: "2025-08-06", test: "pte", sc: [65, 65, 65, 65], sa: monthsAgo(2), delay: 0 });
  /* 這兩格要讀的是**順序**跟**用字**，不是日期對不對：
     ① 「考試日期還沒到」的但書原本印在面板最底下，排在粗體結論句後面——
        讀者讀到結論就停了，讀到最後也只是替一句已經印出去的話道歉。
     ② 「你填的那 N 天」原本用夾到 60 的值去複述使用者自己打的字，
        填 90 的人會看到「你填的那 60 天」，而那一整句正是在解釋他的輸入。 */
  show("考試日還沒到（但書要黏在最上面那個日期後面）",
    { date: daysAgo(-106), test: "ieltsA", sc: [7, 7, 7, 7], sa: monthsAgo(19) });
  show("排不出邀請日＋遞件天數填 90（複述輸入不准用夾完的 60）",
    { date: "2023-09-01", test: "pte", sc: [65, 65, 65, 65], delay: 90 });
})();
