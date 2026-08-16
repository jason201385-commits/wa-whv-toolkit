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

/* `--count` 只印突變條數就退出，給 counts.js 對帳用。
   放在髒工作區檢查之前：只是數數、不寫檔，沒有需要備份的東西。 */
const COUNT_ONLY = process.argv.includes("--count");

/* 這支程式會真的覆寫 index.html，靠 finally 把 ORIG 寫回去還原。
   ORIG 是「開跑當下磁碟上的內容」——如果那份已經含有還沒 commit 的修改，
   還原是還原得回來的；但只要 finally 沒跑到（斷電、kill -9、磁碟滿），
   那些沒 commit 的修改就跟著突變一起沒了，而且沒有任何地方留著它們。
   乾淨的工作區有 git 當備份，髒的沒有。所以髒的就不跑。 */
const dirty = COUNT_ONLY ? { status: 0, stdout: "" }
  : cp.spawnSync("git", ["-C", ROOT, "status", "--porcelain", "--", "public/index.html"],
    { encoding: "utf8" });
if (dirty.status === 0 && dirty.stdout.trim()) {
  console.log("✗ public/index.html 有還沒 commit 的修改，不跑突變測試。");
  console.log("  這支會覆寫該檔再還原，萬一還原沒跑到，那些修改沒有任何地方救得回來。");
  console.log("  先 git commit（或 git stash）再跑。");
  process.exit(1);
}
if (dirty.status !== 0) {
  /* 不在 git 底下就沒有備份可言，更不該跑。「查不到」不等於「乾淨」。 */
  console.log("✗ 查不到 git 狀態（不是 git 工作區？），不跑突變測試——沒有備份就不覆寫檔案。");
  process.exit(1);
}

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
  /* 標的要挑「只出現一次」的寫法：光是 "2025-11-01 起" 在檔裡有 5 處
     （駕照說明、來源標題、警語各一），一次全改等於同時改壞五個地方，
     那樣哪一支紅了都證明不了是這一列被抓到。 */
  ["費用表兩行日期標籤對調", '2025-11-01 起（台灣現在走這條）', '2025-10-31 前（台灣現在走這條）'],
  ["flags[3] 退回無條件的 6 個月（補一句）", "分水嶺是<b>退保滿不滿 2 年</b>", "反正就是要等 6 個月。曾經的分水嶺"],
  ["flags[3] 拿掉「也可能當天就加得了保」", "，也可能當天就加得了保。</strong>", "。</strong>"],
  ["flags[3] 把 6 個月搬到 2 年內那一支", "恢復當天就加保、沒有等待期", "還是要等 6 個月"],
  ["nhi[0] 改西元不改民國（反方向）", "＝2024-12-23", "＝2026-12-23"],
  ["來源指到別部法規（pcode 形狀仍合法）", "pcode=D0030006", "pcode=D0030016"],
  ["戶籍列拿掉「連續 2 年未入境」前提", "連續 2 年未入境", "滿 2 年"],
  ["DASP 倒數拿掉「人已離境」警語",
    "所以人還在澳洲、簽證有效的那段時間，一天都領不了", "所以簽證還有效的時候就可以先領"],
  /* 這一條擋的是「DASP 那列被算回期限」——它一旦算進色調，每個有 PR 的人都會看到紅色。 */
  ["DASP 那列從狀態退回期限", "days:dayGap(now, norm(pr)), state:true", "days:dayGap(now, norm(pr))"],

  /* ↓↓ 以下這一批改的是**組裝**，不是 DATA 裡的常數。
     上面 16 條全部在改資料，所以它們證明的是「資料改了會被抓到」；
     真正在算錢的那幾行（levy 有沒有加進去、DASP 乘哪個比例、百分比除以誰）
     一條都沒被證明過——而 2026-08-17 這一輪抓到的三個錯全都在那裡。
     這批的標的是表達式，文案改動不會讓它們失效，只有邏輯被改才會。 */
  ["taxW 漏加 Medicare levy", "/ C.tax.weeksPerYear) + levyW;", "/ C.tax.weeksPerYear);"],
  ["levy 三段被壓成單一 2%", "if(annualCents <= hi) return Math.round((annualCents - lo) * L.phase);", ""],
  ["levy 下門檻從「以下不課」變成「以下全課」", "if(annualCents <= lo) return 0;", "if(annualCents <= lo) return Math.round(annualCents * L.rate);"],
  ["DASP 比例兩支對調（居民 65↔35）", "(isRes ? 0.65 : 0.35)", "(isRes ? 0.35 : 0.65)"],
  ["稅率百分比的分母改成年收", "const taxPct = pct(taxW, grossW);", "const taxPct = pct(taxW, annual);"],
  ["換簽年差額改用「週差額 × 52」（四捨五入會對不起來）",
    "const diffY = annualWhm - (residentTaxCents(annual) + medicareLevyCents(annual));",
    "const diffY = (whmW - taxW) * C.tax.weeksPerYear;"],
  ["剪貼簿的稅表標籤不跟著模式走（居民也印 WHM）",
    '                  : isRes ? "已換簽，用居民稅表，前 $" + whole(C.tax.res.free) + " 免稅"\n', ""],
  ["剪貼簿漏掉 Medicare levy 那一行", "const clipLevy = levyW > 0", "const clipLevy = false"],
  ["低於法定最低時不降級標題（畫面留 ✅）", 'if(tone === "ok"){\n      tone = "warn";', 'if(false){\n      tone = "warn";'],
  ["低於法定最低的門檻改用 nmw（漏掉 casual loading 那一段）",
    "const belowMin = rate < DATA.wage.casualMin;", "const belowMin = rate < DATA.wage.nmw;"],
  ["年度那一行退回「只有換簽差額不為零才印」", 'd += \'<p><small style="color:var(--muted)">這次算用到的稅表年度：\'', 'if(false) d += \'<p><small style="color:var(--muted)">這次算用到的稅表年度：\''],

  /* ↓↓ 2026-08-17 這一輪修掉的錯，一條一條把它改回去。
     修法本身不是證據——把錯改回來、看測試會不會紅，才是。
     前兩條是 QA 抓到的兩支紅旗（貼進 LINE 群的那份自我矛盾／印出兩組括號），
     它們當時躲在 golden 沒覆蓋的分支裡；現在有場景了，這裡再確認場景真的在看。 */
  ["剪貼簿房租行退回寫死的 rentPct（踩線時自打嘴巴）",
    '"／週，" + rentShare', '"／週，稅前的 " + rentPct + "%"'],
  ["未登記那條附註退回自己組括號（兩條附註時印出兩組）",
    'clipNotes.push("雇主未登記為 WHM 雇主，被扣 30%");',
    'clip += "（雇主未登記為 WHM 雇主，被扣 30%）";'],
  ["時薪上界失效（多打一個位數會安靜算完一整頁）", "if(rate > rateCap){", "if(false){"],
  ["負支出的擋門失效（退回安靜歸零，結餘偏高但看起來正常）", "if(neg.length){", "if(false){"],
  /* 這條改的是格式器本身：畫面與剪貼簿共用它，所以「兩邊千分位一致」那條
     通則斷言應該要紅。如果只有 golden 紅、cost 沒紅，代表那條通則沒真的在看。 */
  ["金額格式器退回 toFixed（四位數以上不分節）",
    'const fmt = cents => (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });',
    "const fmt = cents => (cents / 100).toFixed(2);"],
  ["居民模式的「兩筆合計預扣」不印（剪貼簿有的數字畫面查不到）",
    "      d += '<p><strong>兩筆合計預扣</strong>", "      if(false) d += '<p><strong>兩筆合計預扣</strong>"],
];

if (COUNT_ONLY) { console.log(String(M.length)); process.exit(0); }

const SUITES = ["settle", "cost", "pr", "flags", "wage", "golden"];
let missed = 0;
try {
  for (const [name, from, to] of M) {
    /* 找不到標的通常代表文案改過了——那條突變本身要跟著改，不是把它刪掉。 */
    const hits = ORIG.split(from).length - 1;
    if (hits === 0) { console.log("？ 找不到標的：" + name + "  ←— 突變本身寫錯了"); missed++; continue; }
    /* 標的出現不只一次時，split().join() 會把每一處都改掉——那就不是「改壞一個字」，
       而是同時改壞好幾個地方，於是「有測試紅了」證明不了是哪一處被抓到。
       實例：`* 0.65` 曾經同時出現在畫面與剪貼簿兩支，改一次會動到兩份輸出，
       任何一支紅了都會被記成「抓到了」，而另一份其實沒有任何斷言在看。
       這種突變比漏網更糟，因為它會回報綠燈。 */
    if (hits > 1) {
      console.log("？ 標的出現 " + hits + " 次：" + name + "  ←— 會一次改到多處，改寫成唯一的字串");
      missed++; continue;
    }
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
