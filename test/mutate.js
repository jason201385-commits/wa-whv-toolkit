/* 突變測試：故意改壞 public/index.html 的一個字，看五支測試會不會紅。
   全綠代表那條斷言是裝飾品——這是「測試有沒有在測東西」的唯一機械檢查。

   為什麼需要它：2026-08-17 之前 settle.test.js 的事實斷言是對「四個陣列串起來的
   長字串」做 grep，看起來很嚴格，實際上把 nhi[0] 的民國年改掉、把 supr[2] 的
   65% 改成 15%，測試照樣全綠（別的 bullet 剛好也含那些字）。是這支程式把它抓出來的。

   跑法：node test/mutate.js      （會依序改壞→跑測試→還原，約需數分鐘）
   注意：它會**真的寫** public/index.html。跑之前先確認工作區是乾淨的，
   中途 Ctrl+C 也會還原（finally），但還是先 commit 比較安全。 */
const fs = require("fs"), cp = require("child_process"), path = require("path");
const ROOT = path.join(__dirname, "..");
const F = path.join(ROOT, "public", "index.html");
const ORIG = fs.readFileSync(F, "utf8");

/* 每一條都對應一個「曾經漏掉」或「很容易漏掉」的類別，不是隨機改字。
   加新斷言時順手加一條突變進來——沒有突變證明過的斷言，等於沒有被驗收過。 */
const M = [
  ["nhi[0] 停保廢止年份 113→115", "自 113 年 12 月 23 日起", "自 115 年 12 月 23 日起"],
  ["supr[2] DASP 稅率 65%→15%", "taxable component <b>65%</b>", "taxable component <b>15%</b>"],
  ["drive[2] 名單移出日 2025-11-01→2026-11-01", "台灣在 2025-11-01 被移出承認名單", "台灣在 2026-11-01 被移出承認名單"],
  ["asOf 倒退回 2019", 'asOf: "2026-08-17"', 'asOf: "2019-01-01"'],
  ["來源少一筆（砍掉戶籍法施行細則）", "pcode=D0030007", "pcode=D0030007x"],
  ["往 markup 注入替人決定的話", "<h2>定居：兩個時鐘", "<h2>建議你申請 PR。定居：兩個時鐘"],
  ["往答案面板注入沒有來源的核准率", "不是辦理時間", "核准率 78%，不是辦理時間"],
  ["費用表兩行日期標籤對調", "2025-11-01 起", "2025-10-31 前起"],
  ["flags[3] 退回無條件的 6 個月（補一句）", "分水嶺是<b>退保滿不滿 2 年</b>", "反正就是要等 6 個月。曾經的分水嶺"],
  ["flags[3] 拿掉「也可能當天就加得了保」", "，也可能當天就加得了保。</strong>", "。</strong>"],
  ["flags[3] 把 6 個月搬到 2 年內那一支", "恢復當天就加保、沒有等待期", "還是要等 6 個月"],
  ["nhi[0] 改西元不改民國（反方向）", "＝2024-12-23", "＝2026-12-23"],
  ["來源指到別部法規（pcode 形狀仍合法）", "pcode=D0030006", "pcode=D0030016"],
  ["戶籍列拿掉「連續 2 年未入境」前提", "連續 2 年未入境", "滿 2 年"],
  ["DASP 倒數拿掉「人已離境」警語", "一天都領不了", "隨時可以領"],
  /* 這一條擋的是「DASP 那列被算回期限」——它一旦算進色調，每個有 PR 的人都會看到紅色。 */
  ["DASP 那列從狀態退回期限", "days:dayGap(now, norm(pr)), state:true", "days:dayGap(now, norm(pr))"],
];

const SUITES = ["settle", "cost", "pr", "flags", "wage"];
let missed = 0;
try {
  for (const [name, from, to] of M) {
    /* 找不到標的通常代表文案改過了——那條突變本身要跟著改，不是把它刪掉。 */
    if (!ORIG.includes(from)) { console.log("？ 找不到標的：" + name + "  ←— 突變本身寫錯了"); missed++; continue; }
    fs.writeFileSync(F, ORIG.split(from).join(to), "utf8");
    const red = SUITES.filter(s => cp.spawnSync("node", [path.join(__dirname, s + ".test.js")], { encoding: "utf8" }).status !== 0);
    if (red.length) console.log("✓ 抓到 [" + red.join(",") + "]  " + name);
    else { console.log("✗ 沒抓到          " + name); missed++; }
  }
} finally {
  /* 還原後讀回比對——寫檔成功不等於檔案是對的（行為者不得自證）。 */
  fs.writeFileSync(F, ORIG, "utf8");
  console.log("\n還原" + (fs.readFileSync(F, "utf8") === ORIG ? "成功" : "失敗 ←— 立刻處理"));
}
console.log("漏網 " + missed + " / " + M.length);
process.exit(missed === 0 ? 0 : 1);
