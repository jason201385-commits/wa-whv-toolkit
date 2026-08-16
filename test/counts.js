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
 * 跑法：node test/counts.js      （會依序跑完六支測試，約十幾秒）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const README = fs.readFileSync(path.join(ROOT, "public", "README.md"), "utf8");

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
function claim(re, label) {
  const m = README.match(re);
  if (!m) { fail++; console.log("✗ README 找不到「" + label + "」那一行 ←— 句型被改過，對帳規則要跟著改"); return null; }
  return m[1];
}

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

/* -------------------------------------------------- 五支斷言型測試的案例數 */
console.log("— 各支案例數 —");
const SUITES = [
  { file: "wage",   re: /wage\.test\.js\s+時薪判定的回歸測試（(\d+) 個案例）/ },
  { file: "cost",   re: /cost\.test\.js\s+生活成本試算的回歸測試（(\d+) 個案例）/ },
  { file: "pr",     re: /pr\.test\.js\s+年齡時鐘與點數試算的回歸測試（(\d+) 個案例）/ },
  { file: "settle", re: /settle\.test\.js\s+定居兩個時鐘與換照費用的回歸測試（(\d+) 個案例）/ },
  { file: "flags",  re: /flags\.test\.js\s+旗標對帳（(\d+) 個案例）/ },
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
else ok("突變條數", mc.stdout.trim(), claim(/目前 (\d+) 條突變全部被抓到/, "N 條突變全部被抓到"));

/* -------------------------------------------------- 有沒有測試沒被寫進 README */
/* 數字對得上，不代表清單是完整的：新增一支測試而忘了寫進檔案樹，
   README 會安靜地少描述一整支。這條擋的是那個。 */
console.log("\n— 檔案樹 —");
const files = fs.readdirSync(__dirname).filter(f => f.endsWith(".js")).sort();
const missing = files.filter(f => !README.includes(f));
ok("test/ 底下每一支都寫進 README 了", missing.length ? "少了 " + missing.join("、") : 0, 0);

console.log("\n" + (fail === 0 ? "全數通過：" : "") + pass + " 過 / " + fail + " 失敗");
process.exit(fail === 0 ? 0 : 1);
