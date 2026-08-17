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
for (const s of SUITES) {
  const out = runSuite(s.file);
  if (out === null) continue;
  const m = out.match(/(\d+) 過 \/ (\d+) 失敗/);
  if (!m) { fail++; console.log("✗ " + s.file + " 的結尾行讀不出案例數"); continue; }
  total += Number(m[1]);
  ok(s.file + ".test.js", m[1], claim(s.re, s.file + " 的案例數"));
}
ok("合計", total, claim(/合計 (\d+) 個案例/, "合計 N 個案例"));

/* -------------------------------------------------- golden 快照 */
console.log("\n— golden 快照 —");
const g = runSuite("golden");
if (g !== null) {
  const m = g.match(/（(\d+) 個場景，(\d+) 行）/);
  if (!m) { fail++; console.log("✗ golden 的結尾行讀不出場景數"); }
  else {
    ok("場景數", m[1], claim(/(\d+) 個場景（\/cost/, "golden 的場景數"));
    ok("行數", m[2], claim(/(\d+) 行的純文字快照/, "golden 的行數"));
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
