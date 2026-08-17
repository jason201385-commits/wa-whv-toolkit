#!/usr/bin/env node
/* README 裡的數字對帳。
 *
 * 為什麼需要它：README 寫著「28 個案例」「合計 340」「16 條突變全部被抓到」，
 * 那些數字是手打的。加了測試不會有人回頭改它們，於是它會**往少的方向腐壞**——
 * 而往少的方向腐壞最危險：接手的人看到「合計 340」，跑出 340 以外的數字時
 * 第一個念頭是「我這邊壞了」，不是「README 舊了」。
 * 2026-08-17 實測：cost 從 132 長到 147、突變從 16 長到 27，README 一個字都沒動。
 *
 * 它不猜也不改：只把**跑出來的數字**跟**README 寫的數字**擺在一起，對不上就 exit 1。
 * 要改的是 README，不是這支。
 *
 * 跑法：node test/counts.js      （會依序跑完七支測試，約十幾秒）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const README = fs.readFileSync(path.join(ROOT, "public", "README.md"), "utf8");
/* 有**兩份** README，而這支原本只看 public/ 那一份。
   2026-08-17 實測結果：被對帳的那份是準的，沒被對帳的那份三個數字全爛
   （合計還停在 340、cost 停在 132、突變停在 16）——正是這支程式寫來要擋的那種腐壞，
   只是它守的是另一扇門。**「有一支對帳程式」不等於「數字是對的」，要看它讀的是哪個檔。** */
const ROOT_README = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

let pass = 0, fail = 0;
function ok(name, actual, claimed) {
  if (String(actual) === String(claimed)) { pass++; console.log("✓ " + name + "：" + actual); }
  else {
    fail++;
    console.log("✗ " + name + "\n    跑出來是 " + actual + "，README 寫的是 " + claimed);
  }
}

/* README 寫的數字。抓不到 pattern 本身就是一種漂移（那一行被改寫過），
   所以回 null 而不是 0——0 會跟「真的是 0」混在一起。 */
function claim(re, label, src, where) {
  const m = (src || README).match(re);
  if (!m) {
    fail++;
    console.log("✗ " + (where || "public/README.md") + " 找不到「" + label
      + "」那一行 ←— 句型被改過，對帳規則要跟著改");
    return null;
  }
  return m[1];
}
const rootClaim = (re, label) => claim(re, label, ROOT_README, "README.md");

function runSuite(name) {
  const r = cp.spawnSync("node", [path.join(__dirname, name + ".test.js")], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 0) {
    fail++;
    console.log("✗ " + name + ".test.js 沒有全過——先修測試再來對帳");
    return null;
  }
  return out;
}

/* -------------------------------------------------- 六支斷言型測試的案例數 */
console.log("— 各支案例數 —");
const SUITES = [
  { file: "wage",   re: /wage\.test\.js\s+時薪判定的回歸測試（(\d+) 個案例）/ },
  { file: "cost",   re: /cost\.test\.js\s+生活成本試算的回歸測試（(\d+) 個案例）/ },
  { file: "pr",     re: /pr\.test\.js\s+年齡時鐘與點數試算的回歸測試（(\d+) 個案例）/ },
  { file: "settle", re: /settle\.test\.js\s+定居兩個時鐘與換照費用的回歸測試（(\d+) 個案例）/ },
  { file: "flags",  re: /flags\.test\.js\s+旗標對帳（(\d+) 個案例）/ },
  { file: "english", re: /english\.test\.js\s+英文門檻與兩個時鐘的回歸測試（(\d+) 個案例）/ },
];
let total = 0;
let flagsOut = null;
for (const s of SUITES) {
  const out = runSuite(s.file);
  if (out === null) continue;
  if (s.file === "flags") flagsOut = out;
  const m = out.match(/(\d+) 過 \/ (\d+) 失敗/);
  if (!m) { fail++; console.log("✗ " + s.file + " 的結尾行讀不出案例數"); continue; }
  total += Number(m[1]);
  ok(s.file + ".test.js", m[1], claim(s.re, s.file + " 的案例數"));
}
ok("合計", total, claim(/合計 (\d+) 個案例/, "合計 N 個案例"));

/* -------------------------------------------------- 來源對帳表的每一列 */
/* ⚠️ 這張表是本 session 找到的**第二張**手打表格，而它腐壞的方式跟第一張不一樣：
   render.js 那三個數字是「寫小了」，這張是**整整少一列**——`/english` 上線之後
   `eng` 那 8 筆從來沒被加進去。少列比少數字更難發現：合計短報 8 看起來只是算錯，
   而缺的那一區是最新的，看起來反而最像「這區還沒有來源」。
   所以這裡不是只對合計（只對合計會被兩個方向相反的錯誤互相抵銷），
   而是**逐列對，並且兩邊的鍵集合要一模一樣**。 */
console.log("\n— 來源對帳表 —");
if (flagsOut === null) {
  fail++;
  console.log("✗ 拿不到 flags.test.js 的輸出，來源對帳表這一節整個沒跑");
} else {
  const live = new Map();
  for (const m of flagsOut.matchAll(/^\s*來源明細 (\w+) (\d+) (\d+)$/gm)) {
    live.set(m[1], [Number(m[2]), Number(m[3])]);
  }
  /* README 的表：從表頭那一行之後一路吃到 `**合計**` 為止。
     `\w+` 認得出 `**合計**` 之外的每一列，粗體那一列另外抓。 */
  const table = README.match(/\| 區塊 \| 來源 \| 待核 \|[\s\S]*?\n\n/);
  const claimed = new Map();
  if (!table) {
    fail++;
    console.log("✗ public/README.md 找不到「| 區塊 | 來源 | 待核 |」那張表 ←— 表頭被改過");
  } else {
    for (const m of table[0].matchAll(/^\| (\w+) \| (\d+) \| (\d+) \|$/gm)) {
      claimed.set(m[1], [Number(m[2]), Number(m[3])]);
    }
  }
  if (live.size === 0) {
    fail++;
    console.log("✗ flags.test.js 沒印出任何「來源明細」←— 那段被拿掉了，這一節等於空轉");
  }
  const only = (a, b) => [...a.keys()].filter(k => !b.has(k));
  const missing = only(live, claimed), extra = only(claimed, live);
  if (missing.length || extra.length) {
    fail++;
    console.log("✗ 表上的區塊跟實際對不上"
      + (missing.length ? "\n    表上少了：" + missing.join("、") : "")
      + (extra.length ? "\n    表上多了：" + extra.join("、") : ""));
  } else pass++, console.log("✓ 表上的區塊剛好是這 " + live.size + " 區，不多不少");

  let sumS = 0, sumP = 0, bad = 0;
  for (const [k, [s, p]] of live) {
    sumS += s; sumP += p;
    const c = claimed.get(k);
    if (!c) continue;                       /* 上面那條已經報過了，不重複計分 */
    if (c[0] !== s || c[1] !== p) {
      bad++;
      console.log("    ✗ " + k + "：實際 " + s + "/" + p + "，表上寫 " + c[0] + "/" + c[1]);
    }
  }
  if (bad) { fail++; console.log("✗ 有 " + bad + " 列的數字對不上（實際 來源/待核）"); }
  else if (missing.length === 0 && extra.length === 0) {
    pass++; console.log("✓ 每一列的來源數與待核數都對得上");
  }
  const totRe = /\| \*\*合計\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/;
  const tm = README.match(totRe);
  if (!tm) { fail++; console.log("✗ 找不到那張表的 **合計** 那一列 ←— 句型被改過"); }
  else {
    ok("來源合計", sumS, tm[1]);
    ok("待核合計", sumP, tm[2]);
  }
}

/* -------------------------------------------------- golden 快照 */
console.log("\n— golden 快照 —");
const g = runSuite("golden");
if (g !== null) {
  const m = g.match(/（(\d+) 個場景，(\d+) 行）/);
  if (!m) { fail++; console.log("✗ golden 的結尾行讀不出場景數"); }
  else {
    ok("場景數", m[1], claim(/(\d+) 個場景（\/cost/, "golden 的場景數"));
    ok("行數", m[2], claim(/(\d+) 行的純文字快照/, "golden 的行數"));
    /* ⚠️ 上面那個總數對得上，**不代表底下的拆分對得上**。
       README 那一行寫的是「72 個場景（/cost 27、/settle 9、/english 35）」——
       27+9+35=71，跟前面那個 72 差 1，而總數那條斷言完全看不到這件事。
       這是本 session 第三張腐壞的手打數字，而且它腐壞的方式最陰：
       總數被對帳程式盯著、所以會被改對，沒被盯的拆分就在同一行裡繼續錯下去，
       看起來還特別可信（旁邊那個數字明明是對的）。
       分母直接數 golden.txt 的場景標題行（`/區塊　標題`）。 */
    const G = fs.readFileSync(path.join(__dirname, "golden.txt"), "utf8");
    const seen = (k) => (G.match(new RegExp("^/" + k + "　", "gm")) || []).length;
    ok("golden 的 /cost 格數", seen("cost"), claim(/個場景（\/cost (\d+) 種/, "golden 的 /cost 格數"));
    ok("golden 的 /settle 格數", seen("settle"), claim(/\/settle (\d+) 種時鐘組合/, "golden 的 /settle 格數"));
    ok("golden 的 /english 格數", seen("english"),
      claim(/\/english (\d+) 種成績與兩個時鐘的組合/, "golden 的 /english 格數"));
  }
}

/* -------------------------------------------------- 突變條數 */
console.log("\n— 突變 —");
const mc = cp.spawnSync("node", [path.join(__dirname, "mutate.js"), "--count"], { encoding: "utf8" });
if (mc.status !== 0) { fail++; console.log("✗ mutate.js --count 跑不起來"); }
else {
  ok("突變條數", mc.stdout.trim(), claim(/目前 (\d+) 條突變全部被抓到/, "N 條突變全部被抓到"));
  ok("突變條數（根目錄 README）", mc.stdout.trim(),
    rootClaim(/看測試會不會紅（目前 (\d+) 條全被抓到）/, "N 條全被抓到"));
}

/* -------------------------------------------------- render.js 的格數 */
/* ⚠️ render.js 的三個格數是這份 README 裡**唯一沒被對帳**的手打數字，
   於是它照著這支程式檔頭寫的那條路腐壞了：寫「六種稅況」時實際 12 格、
   寫「十八種」時實際 30 格——都漂了將近一倍，而且是往少的方向。
   往少的方向最傷：接手的人會以為「用眼睛讀一遍」是十幾格的事，
   讀到一半覺得夠了就停，而這支測試的唯一失效方式就是只跑不讀。
   分母直接數原始碼裡的 `show(`，不跑 render.js——它會印幾百行到 stdout。 */
console.log("\n— render.js 的格數 —");
{
  const R = fs.readFileSync(path.join(__dirname, "render.js"), "utf8").split("\n");
  /* 三個區段各自數。段界用 render.js 自己的分隔註解，不是行號。 */
  const marks = { cost: -1, settle: -1, english: -1 };
  R.forEach((l, i) => {
    Object.keys(marks).forEach(k => {
      if (marks[k] < 0 && l.includes("= /" + k + " =")) marks[k] = i;
    });
  });
  const missing = Object.keys(marks).filter(k => marks[k] < 0);
  if (missing.length) {
    fail++;
    console.log("✗ render.js 裡找不到 " + missing.join("、") + " 的分段註解 ←— 段界被改過");
  } else {
    const order = Object.keys(marks).sort((a, b) => marks[a] - marks[b]);
    const count = k => {
      const i = order.indexOf(k);
      const end = i + 1 < order.length ? marks[order[i + 1]] : R.length;
      return R.slice(marks[k], end).filter(l => /^ {2}show\(/.test(l)).length;
    };
    ok("render.js 的 /cost 格數", count("cost"), claim(/\/cost (\d+) 格、/, "render.js 的 /cost 格數"));
    ok("render.js 的 /settle 格數", count("settle"),
      claim(/\/settle 費用表＋(\d+) 格時鐘組合/, "render.js 的 /settle 格數"));
    ok("render.js 的 /english 格數", count("english"),
      claim(/\/english 門檻總表＋(\d+) 格成績/, "render.js 的 /english 格數"));
  }
}

/* -------------------------------------------------- 根目錄 README 的同一組數字 */
/* 這一節跟上面對的是同一批事實，只是寫在另一個檔裡。兩份都要對，
   否則「有對帳」只保護得了其中一份，另一份繼續往少的方向爛。 */
console.log("\n— 根目錄 README —");
ok("合計（根目錄 README）", total, rootClaim(/合計 (\d+) 個案例（時薪/, "合計 N 個案例"));
ok("cost 案例數（根目錄 README）",
  Number((README.match(/cost\.test\.js\s+生活成本試算的回歸測試（(\d+) 個案例）/) || [0, 0])[1]),
  rootClaim(/（時薪 \d+、生活成本 (\d+)、/, "括號裡的 cost 案例數"));
if (g !== null) {
  const m = g.match(/（(\d+) 個場景，(\d+) 行）/);
  if (m) ok("golden 場景數（根目錄 README）", m[1], rootClaim(/快照：(\d+) 個場景的答案面板/, "golden 的場景數"));
}

/* -------------------------------------------------- 有沒有測試沒被寫進 README */
/* 數字對得上，不代表清單是完整的：新增一支測試而忘了寫進檔案樹，
   README 會安靜地少描述一整支。這條擋的是那個。 */
/* 兩份都要檢查。2026-08-17 實測：根目錄那份寫著「另外兩支」，
   而 test/ 底下有四支不算進案例數的工具（golden、mutate、render、counts），
   少描述的那兩支就是這一條原本看不到的東西。 */
console.log("\n— 檔案樹 —");
/* 掃 test/ 底下**每一個檔**，不是只掃 .js：golden.txt 是 golden.test.js 的預期輸出，
   一份沒有人描述的 1300 行快照，接手的人不會知道它是要用眼睛讀的。 */
const files = fs.readdirSync(__dirname).sort();
/* public/README.md 有真的檔案樹（縮排兩格 + 檔名 + 說明），所以對它要求樹狀條目，
   不是全檔 includes——`node test/foo.js` 這種指令列在別的地方出現過就會讓
   includes 通過，於是「有沒有描述它」跟「有沒有提到它」被混成同一件事。 */
{
  const missing = files.filter(f =>
    !new RegExp("^ {2}" + f.replace(/\./g, "\\.") + " {2,}\\S", "m").test(README));
  ok("test/ 底下每一支都在 public/README.md 的檔案樹裡",
     missing.length ? "少了 " + missing.join("、") : 0, 0);
}
/* 根 README 也有一棵樹（在它第二個 ``` 區塊裡），所以用同一個門檻。
   2026-08-17 之前這裡是全檔 includes，於是 golden.test.js 與 counts.js
   靠著下面「怎麼跑」那幾行的 `node test/xxx.js` 指令通過了檢查——
   **被指令提到，跟被描述過，是兩件事**，而檔案樹要的是後者。 */
{
  const missing = files.filter(f =>
    !new RegExp("^ {2}" + f.replace(/\./g, "\\.") + " {2,}\\S", "m").test(ROOT_README));
  ok("test/ 底下每一支都在 README.md 的檔案樹裡",
     missing.length ? "少了 " + missing.join("、") : 0, 0);
}

/* -------------------------------------------------- 區塊清單有沒有漏 */
/* 根 README 開頭那個 ``` 區塊是「這個站有哪幾段」的門面，而它是手打的。
   2026-08-17 實測：`/english` 上線之後那份清單從頭到尾沒被加上去，
   還留著「十一個區塊」——站上是十二個。數字對帳守得住案例數，
   守不住「有一整段不見了」，因為那一段的測試案例全都好好的。
   分母用 _redirects：那是部署真的會生效的檔，不是敘述。 */
console.log("\n— 區塊清單 —");
{
  const REDIR = fs.readFileSync(path.join(ROOT, "public", "_redirects"), "utf8");
  const real = [...REDIR.matchAll(/^\/([a-z]+)\s+\/#([a-z]+)\s/gm)]
    .filter(m => m[1] === m[2]).map(m => m[1]);
  const block = ROOT_README.split("```")[1] || "";
  const listed = [...block.matchAll(/^\/([a-z]+)/gm)].map(m => m[1]);
  if (real.length < 5) fail++, console.log("✗ 從 _redirects 只挖到 " + real.length + " 個區塊，這條等於沒在對");
  else {
    const miss = real.filter(x => !listed.includes(x));
    const extra = listed.filter(x => !real.includes(x));
    ok("根 README 的區塊清單", miss.length || extra.length
      ? (miss.length ? "少列 " + miss.join("、") : "") + (extra.length ? " 多列 " + extra.join("、") : "")
      : real.length, real.length);
    /* 清單旁邊那句「N 個區塊」是另一個手打的數字，會跟清單各自腐壞。 */
    const CN = "零一二三四五六七八九十";
    const w = (ROOT_README.match(/([一二三四五六七八九十]+)個區塊/) || [])[1];
    const n = w === undefined ? null
      : w.length === 1 ? CN.indexOf(w)
      : w[0] === "十" ? 10 + CN.indexOf(w[1])
      : CN.indexOf(w[0]) * 10 + (w[2] ? CN.indexOf(w[2]) : 0);
    ok("根 README 寫的「N 個區塊」", real.length, n);
  }
}

console.log("\n" + (fail === 0 ? "全數通過：" : "") + pass + " 過 / " + fail + " 失敗");
process.exit(fail === 0 ? 0 : 1);
