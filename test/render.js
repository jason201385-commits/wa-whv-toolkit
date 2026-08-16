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
  const sb = { isFinite, parseFloat, Math, Number, String, console,
    $: s => s === "#costans" ? box : (fields[s] || { value: "" }), copyRow: () => {} };
  vm.createContext(sb);
  vm.runInContext(SRC + ";globalThis.checkCost = checkCost;", sb);

  function show(label, rate, hours, mode) {
    Object.assign(fields, {
      "#crate": { value: String(rate) }, "#chours": { value: String(hours) }, "#ctax": { value: mode },
      "#crent": { value: "" }, "#cbills": { value: "inc" }, "#ctrans": { value: "walk" },
      "#ccar": { value: "" }, "#cfood": { value: "" }, "#cgoal": { value: "" } });
    box.innerHTML = ""; sb.checkCost();
    console.log("\n═══ /cost　" + label + "　(年收 $" + (rate * hours * 52).toLocaleString() + ") ═══");
    console.log(plain(box.innerHTML));
  }
  /* 四種稅況各看一次：Medicare levy 的三段（免課／10% 過渡／全額 2%）都要走到。 */
  show("居民・下門檻以下", 20, 20, "resident");
  show("居民・過渡段（只課超過部分的 10%）", 25, 25, "resident");
  show("居民・全額 2%", 35, 38, "resident");
  show("居民・高收入", 40, 75, "resident");
  show("對照組：WHM 有登記", 35, 38, "reg");
  show("對照組：雇主沒登記（走外國居民表）", 35, 38, "unreg");
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
