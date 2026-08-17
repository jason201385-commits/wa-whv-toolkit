# 西澳打工度假 · 查核工具

**線上：https://wa-whv.pages.dev**

一個靜態單頁。給人在西澳（Perth 及周邊）的台灣人，在**付錢或答應之前**查清楚。
主要讀者是打工度假者；`/pr` 與 `/settle` 那兩段是給已經開始想「要不要留下來」的人用的。

非營利。沒有廣告、沒有推薦回饋、沒有合作仲介、沒有任何導流分潤。

```
/regional  集二簽郵遞區號與 88 天，還有 condition 8547
/wage      時薪紅線（西澳有兩套勞資系統，地板不只一條）
/cost      活不活得下去：扣完稅付完房租還剩什麼、怎麼判斷貴不貴
           （三張稅表：打工度假、雇主沒登記、已換簽的居民＋Medicare levy）
/car       買車：沒有冷靜期、私人交易沒有保固
/rent      押金上限、分租雅房到底受不受保護、退租時程
/scam      換匯與付款：哪些付款軌道還追得回來
/after     已經被騙了，第一步該打給誰
/landing   剛落地：TFN、Medicare、稅
/ask       在群裡問之前，先問對問題
/pr        留下來：年齡時鐘與技術移民點數試算
/english   英文哪一級：成績單對回官方那張表（換表當天分界、成績效期兩個時鐘）
/settle    定居的兩個時鐘：離台日算戶籍與健保，PR 核准日算駕照與超級年金
```

十二個區塊各自的內容與設計理由在 [`public/README.md`](public/README.md)。

---

## 為什麼會有這個東西

起點是一個在 Perth 的台灣打工度假 LINE 群。群裡每天都在重複同一批問題——這家換匯商可不可信、這個時薪合不合法、押金收這麼多正不正常——而答案總是散在幾百則訊息裡，翻不到、也無從驗證。偶爾有人被騙，事後才發現前幾週群裡就有人踩過同一個坑。

**LINE 不擅長的事有兩件：讓資訊被找到，和讓資訊被查證。**這個站只補這兩件，其他都留在群裡。

所以它的形態是刻意的：每一條規則旁邊都有生效日和澳洲政府官方連結，你可以不相信這個站，直接點過去看原文。每一段結尾都有一顆「複製這段貼回群組」的按鈕——目的是讓群裡的回答**帶著出處**，而不是取代群組。

## 這個站故意不做的事

這一段比功能清單重要。它是設計約束，不是免責聲明。完整版在 [`public/README.md`](public/README.md#這個站故意不做的事)，摘要：

| 不做 | 為什麼 |
|---|---|
| 職缺表／房源表／任何「今日有效」清單 | 維運者一離開就變成幽靈刊登。因為看起來比 LINE 正式，害人白跑的傷害**更大**。 |
| 「Perth 一週菜錢大約 $XXX」這種生活費行情 | 同上。`/cost` 的做法是**金額由使用者自己填，站上只提供判準**——稅是法定算式、車資是官方公告價、貴不貴用比例（房租佔稅前收入幾成、這筆錢要工作幾小時）。三種都不會因為沒人維護就變錯。 |
| 指名的詐騙黑名單 | 西澳與北領地是全澳唯二沒有採納 2021 年誹謗法改革的司法管轄區。這裡只寫手法，不寫人。 |
| 留言板／表單／登入／資料庫 | 任何可寫入的東西都要每天有人審核。這個站的維運預算是每天五分鐘。 |
| LINE bot | 推播按收訊人數計費；一則摘要進 500 人的群＝計 500 則。而且一個群只能有一個 bot。 |
| 成為最終權威 | 跟官方頁面不一樣時，以官方為準。 |

技術上也鎖死：**純靜態單檔、沒有 build step、沒有相依套件、沒有 API、沒有 `<form>`、零外部請求**（連字型和 favicon 都內嵌）。想加功能時會先撞到架構，這是故意的。

零外部請求換到的具體好處：可以掛 `Content-Security-Policy: default-src 'none'`，代價是零；以及 `Referrer-Policy: no-referrer`——會來這個站的人有一部分正在被騙或正在跟雇主起衝突，不該讓他們點去官方網站時把來源帶過去。

---

## 開發

```
public/               ← 部署目錄。只有這裡面的東西會上線。
  index.html          整個站。所有事實集中在檔案底部 <script> 裡的 DATA 物件。
  _redirects          短網址（/scam、/wage、/cost …）
  _headers            安全標頭：CSP、HSTS、Referrer-Policy: no-referrer 等
  README.md           資料維護手冊：改資料的規則、複核日曆、已知的錯誤來源
  handoff.md          說明樁，不是文件（原因寫在裡面）
test/
  wage.test.js        時薪判定的回歸測試
  cost.test.js        生活成本試算的回歸測試（稅級距、房租佔比、單位價格）
  pr.test.js          年齡時鐘與點數試算的回歸測試（官方點數表逐格對照）
  settle.test.js      定居兩個時鐘的回歸測試（換照費用、期限算術、四句不准退版的事實）
  flags.test.js       旗標對帳：標了「待核」的資料一定要真的印得出「待核」
  english.test.js     英文門檻與兩個時鐘的回歸測試（新舊兩張表、效期、邀請日換算）
  golden.test.js      整段面板的純文字快照比對（含剪貼簿那一份），72 個場景
  golden.txt          上面那 72 個場景的預期輸出，1407 行。**這份要用眼睛讀**：
                      它是唯一一個「話說得對不對」看得出來的地方，diff 變了就要逐行看過
  contrast.test.js    對比度對帳：色票從 index.html 現挖，兩個主題逐組算 WCAG AA
  mutate.js           突變測試：故意改壞 index.html 一個字，看測試會不會紅
  render.js           把答案面板印成純文字給人讀（唯讀）
  counts.js           對帳：這兩份 README 寫的數字與清單，跟實際跑出來的對不對得上
```

沒有 `package.json`，因為沒有相依套件。要跑的只有 Node（測試用）跟一個瀏覽器。

### 本機看

直接用瀏覽器開 `public/index.html` 就可以。短網址 `/scam` 只在 Cloudflare Pages 上生效，本機請用 `index.html#scam`。

要用自動化工具測的話，多數無頭瀏覽器擋 `file:` 協定，起一個本機 server：

```bash
python -m http.server 8787 --bind 127.0.0.1 --directory public
```

### 測試

```bash
node test/wage.test.js
node test/cost.test.js
node test/pr.test.js
node test/settle.test.js
node test/flags.test.js
node test/english.test.js
```

零相依套件，合計 796 個案例（時薪 28、生活成本 388、點數 71、定居 106、旗標對帳 27、英文 176）。六支都**直接從 `index.html` 挖出 `DATA` 與要測的函式用 `vm` 跑**，所以測到的一定是正式版程式碼，不是抄一份出來的副本（抄出來的副本會在你改了 `index.html` 之後繼續騙你說全過）。

另外五支不算進上面的數字。其中四支驗的不是網站，是**上面那六支到底有沒有在測東西**；
`contrast.test.js` 驗的是另一件斷言碰不到的東西——顏色：

```bash
node test/golden.test.js   # 快照：72 個場景的答案面板逐字比對（含剪貼簿那一份）
node test/mutate.js        # 突變測試：改壞一個字，看測試會不會紅（目前 100 條全被抓到）
node test/render.js        # 把答案面板印成純文字，用眼睛讀一遍（唯讀）
node test/counts.js        # 對帳：這兩份 README 寫的數字跟實際跑出來的對不對得上
node test/contrast.test.js # 對比度：兩個主題每一組前景╱背景都要算得過 WCAG AA
```

`contrast.test.js` 是 2026-08-17 換暖色調時補的。**顏色是「看起來對」跟「真的對」差最遠的東西**，
因為判斷的人已經知道那行字寫什麼了：那一輪分享圖底下的出處小字算出來 3.90，用眼睛完全看不出來。
同一輪還挖出一個更早就在的——`.copybtn.done` 的字色寫死 `#fff`，深色主題下 `--ok` 是亮綠，
白字壓上去只剩 1.75，而那顆按鈕是全站唯一會回報「複製成功了」的地方。
這支**不自己抄一份色票**（抄過去就會跟 `index.html` 分家，然後它守的是它自己那份），
三個 token 區塊、分享圖 canvas 寫死的色、`DATA.cards` 的三個 accent 全部現挖，
另外釘住三件手改容易漏的事：兩個深色區塊要逐鍵相同、token 區塊以外不准出現任何色碼、
**定義了卻沒有任何 `var()` 引用的 token 要被抓出來**（`--accent-soft` 就是這樣白算了三個區塊的對比度）。

這兩支的存在理由是同一天的同一件事。2026-08-17 之前，`/settle` 那批「事實不准退版」的斷言
是對四個陣列串起來的長字串做 `grep`——看起來很嚴格，實測把停保廢止的民國年改掉、
把 DASP 稅率 65% 改成 15%，**測試照樣全綠**（別的段落剛好也含那些字）。
`mutate.js` 就是把這件事變成可重跑的檢查：**沒有被突變證明過的斷言，等於沒有被驗收過**。
⚠️ 它會真的寫 `index.html`（跑完自動還原並讀回比對），跑之前先確認工作區乾淨。

`render.js` 補的是另一個洞：斷言只證明「該出現的字串有出現」，證明不了**整段話讀起來對不對**。
同一天在當時那 340 條全綠的狀態下，讀渲染輸出抓到兩個缺陷——`/settle` 有一句話指著一個
在「PR 已核准」那個狀態下根本不存在的倒數；`/cost` 的「這筆 有機會整筆免掉」中間有個孤兒空格。
**改完文案跑一次，然後真的把它讀完**；只跑不讀等於沒跑。

**動過 `checkRate()` 或 `DATA.wage` 一定要跑 `wage.test.js`；動過 `checkCost()`、`whmTaxCents()`、`comparePrice()` 或 `DATA.cost` 一定要跑 `cost.test.js`；動過 `checkAge()`、點數試算或 `DATA.pr` 一定要跑 `pr.test.js`；動過 `/settle` 的任何日期算術或文案、或 `DATA.settle` 一定要跑 `settle.test.js`；動過 `/english` 的門檻、效期、邀請日換算或 `DATA.eng` 一定要跑 `english.test.js`；動過任何 renderer 或加了新的來源清單一定要跑 `flags.test.js`。**

前四支對應的是會主動對使用者說出改變他行為的話的路徑：

- `wage.test.js` — 「你的雇主違法」。涵蓋輸入護欄、浮點數邊界、入門級分類的假指控情境、兩套勞資系統、計件三分支、剪貼簿文字必須與畫面判定同一個符號、每條路徑都要有退休金提醒。
- `cost.test.js` — 「你的雇主沒登記所以你每週被多扣 $XXX」「你的房租超過官方判準」「存到目標要 N 週」。涵蓋 ATO **三張稅表**（打工度假、外國居民、居民）的級距邊界、未登記雇主改用外國居民稅率的分支、**Medicare levy 的三段**（下門檻以下不課／中間只課超過部分的 10%／全額 2%，**不准壓成 `min()`**）、30/40 rule 的踩線與越線、票價必須來自 `DATA.cost.fares` 不能寫死、支出剛好等於收入時不得印出 `$-0.00`、以及「這一區不得出現寫死的生活費金額」這條設計約束本身。<br>三張表**官方公布的年度並不一致**（居民表已到 2026–27，其餘還在 2025–26），所以 `DATA` 裡各自帶年度欄、畫面上各自印出來——**算得出答案不等於官方已公布**。
  另外三組是 2026-08-16 事故後補的，都是**回歸測試而不是新功能的測試**：
  **①邊際稅率掃描**——從 $1,000 掃到 $260,000，兩張稅表都不准出現高於法定最高 45% 的邊際稅率，也不准出現「多賺反而少拿」（這裡曾經是 100%，見 `public/README.md`）。
  **②placeholder 守門**——`#crent`、`#cfood` 的 placeholder 不得是數字，`#crate` 不得在 markup 寫死法定時薪、必須由 `DATA.wage.casualMin` 灌進去。
  **③無來源宣稱守門**——不得宣稱任何具名連鎖店不受 Unit Pricing Code 規範。
  ①②③ 三組都自帶 canary（故意餵它應該要紅的字串，確認守門正則不是永遠通過的假斷言）。
  ③ 同時掃 `index.html` 與 `public/README.md`——同一句錯話在兩邊都活過一次，守則只守一半等於沒守。
  README 那半有例外規則：「已知的錯誤來源」那一節**可以**引用錯句，但整句要包在「」裡，
  以引號當「這是標本不是主張」的機械證據。
- `pr.test.js` — 「你的年齡分數還剩 N 天」。逐格對照移民部 189 的官方點數表（`lo` 含、`hi` 不含，
  照抄「至少 18 歲、未滿 25 歲」的邊界寫法），加上 190 提名 5 分、491 提名或親屬擔保 15 分、
  受僱年資合計上限 20 分。年齡那一段測的是生日當天、跨檔當天、45 歲以上不在表內、2 月 29 日出生不猜，
  以及**分數變動的正負號**——24 歲的人下一個生日是 +5 不是掉分，這個 bug 寫的時候真的犯過。
  另有兩組守門。**無來源宣稱**：站上不得出現任何「幾分會被邀請／保證上」的分數線，
  而且要明說這張表沒有告訴你幾分會被邀請——**官方點數表上就是沒有及格線**（整頁搜 `65` 零命中，
  所以站上一個字都不寫）；技術年資、西澳 ABN／自僱排除、491 免僱傭合約三件事都必須附上官方原文；
  WASMOL／GOL 的職業清單不准抄進站裡（清單會變，抄了就是製造過期資訊）。
  **不可以被改掉的三句**：每次試算都要講「以受邀當下認定」、要標明官方原文寫的是 most 不是 all、
  要明說 EOI 掛著等的期間年齡照走。
  另有一組 2026-08-17 補的：**EOI 門檻 65 分**是官方頁面白紙黑字寫的**投件必要條件**
  （`migration.wa.gov.au` 的 Step 1：*"A score of at least 65 points in the Home Affairs points test"*），
  測試釘住「算出來低於 65 要說還差幾分、而且要說這是不符合必要條件不是機率低」、
  「65 分以上不得暗示就會被邀請」、以及**這兩件事必須在同一段裡被區分開來**——
  投件門檻與獲邀分數線是兩條線，網路上幾乎都寫成同一條。
- `settle.test.js` — 「你的台灣駕照 N 天後在西澳失效」「你出境滿 2 年了」。
  這一區的錯不是算得不準，是**無照上路**或**永久失去一筆錢**，所以測試連文案都鎖
  （**鎖的是指定索引的那一句**，不是整段 grep——差別與代價見上面 `mutate.js` 那一段）：
  Transport WA 的七格費用逐格對表並驗算出 A$109.70 的差額、
  兩個時鐘的起點不准混（離台日 +24 個月只出戶籍那條，PR 核准日 +3 個月只出駕照那條）、
  月底夾值（11-30 加 3 個月）必須夾到當月最後一天**並且在畫面上承認這是夾出來的**、
  印出來的每個日期都要在曆法上真的存在、以及四句**不准退回舊版本**的事實
  （2025-11-01 台灣被移出承認名單、2024-12-23 台灣停保制度廢止、
  台灣不在 Medicare 互惠協定的 11 國內、DASP 資格在 PR 核准當天消失）。
  還有一條是給已經拿到 PR 一段時間的人用的：只要有任何一條顯示「已過」，
  畫面必須同時說「已經辦好的請忽略、這個工具不知道你辦過什麼」——
  否則一個早就換好照的人會被自己的紅色嚇一跳，然後就不信這個站了。
  同一個理由還有一條 2026-08-17 補的：**DASP 那一列是狀態，不是期限**。
  它的日期就是使用者填的 PR 核准日本身，所以 PR 一下來它永遠是過去式；
  曾經被算進色調，結果是**每個拿到 PR 的人都看到紅色的「有期限已經過了」**，
  連換照還有將近三個月、什麼都沒錯過的人也一樣。現在它標 `state:true` 不進色調，
  右欄寫「已經發生」而不是「已過 N 天」，而測試釘住「PR 剛下來 → warn 不准是 bad」。

`flags.test.js` 是橫向的，不管算得對不對，只管旗標印不印得出來——說明在上面「語法與旗標檢查」。

### 語法與旗標檢查

```bash
node -e "const fs=require('fs');const m=fs.readFileSync('public/index.html','utf8').match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync('chk.js',m[1])" && node --check chk.js
node test/flags.test.js
```

**旗標不要用 `grep` 數。**站上有兩種標記法——`v:false` 標單一來源，`pending:true` 標整張卡
（`/cost` 的卡片渲染器已經把 `v` 用在別的地方，所以卡層另開一個旗標）——而且 `grep -c 'v:false'`
會回 25，其中 4 次出現在**註解裡**（那幾行正好在解釋這個機制）。2026-08-17 就有一次因為
25 對不上 22 而誤判「記錄寫錯了」，追下去發現記錄是對的、grep 才是錯的工具。

`flags.test.js` 算的是會真的渲染出來的數，並釘住這條等式：

```js
document.querySelectorAll('.pending').length   // 要等於 18（來源）+ 3（沒有網址的資料列）+ 1（pending:true）= 22
```

對不上就代表有 renderer 讀不到旗標，畫面上會有一筆沒標「待核」的未查證資料。這個 bug 真的發生過
（換匯合法路徑那一段）。所以這支測試不只比總數：它解析出**五個**會印「待核」的 renderer
各自吃哪些陣列，再檢查每一筆帶旗標的資料都落在其中。**加了第六個 renderer 而忘了讓它吃 `v`，測試會紅**
——這件事以前只寫在 README 裡拜託下一個人記得，現在是機械擋的。

### 部署

```bash
npx wrangler pages deploy ./public --project-name=<你的專案名> --branch=main
```

**不要相信 wrangler 說成功。**它回報成功只證明上傳完了，不證明邊緣吐出來的是新版：

```bash
curl -s https://<你的網域>/ | sha256sum   # 要跟 sha256sum public/index.html 一樣
curl -sI https://<你的網域>/scam          # 要回 302
```

同一個回應裡要看得到 `content-security-policy` 與 `x-frame-options`。**`_headers` 寫錯不會讓部署失敗，它會靜默地不生效**，所以這一步不能省。

部署時會咬人的兩件事（`.assetsignore` 無效、刪檔不會清邊緣快取）寫在 [`public/README.md`](public/README.md#部署時會咬人的兩件事)。

### 改這個檔案會踩到的兩個地雷

1. **`esc()` 不能套在自己寫的 HTML 上。**`DATA` 裡有些欄位是自己寫的說明文字，允許 `<b>`，所以不 escape；同一個物件裡的**標題**欄位仍然要 escape。搞混的話畫面上會出現字面的 `<b>`。改完在 console 跑一次，結果必須是 `0`：

   ```js
   (document.body.innerText.match(/<\/?(b|i|strong|a|br|small)[ >]/g)||[]).length
   ```

2. **`DATA` 裡重複的 key 會靜默覆蓋。**曾經有一個 7 條的陣列被同一層後面那個同名的 9 條陣列無聲蓋掉。加東西之前先確認同一層沒有同名 key。

---

## 資料的準確性

每一條事實都帶 `as`（生效日或查證日）與 `v`（有沒有真的打開**官方**頁面逐字確認過）。`v:false` 會在畫面上顯示「待核」標籤——**站上看得到自己哪裡還沒查證**。

寫這份的時候刻意採用的兩條規則：

- **民間智庫、媒體、論壇一律 `v:false`**，內容再對也一樣。`v` 標的是「有沒有官方背書」，不是「我信不信」。
- **寧可標待核，不要填一個看起來合理的數字。**

⚠️ **這些數字會過期。**澳洲多數規則在每年 **7 月 1 日** 換版。複核日曆、要去哪裡抓新數字、以及一份「已知的錯誤來源，不要再引」清單，都在 [`public/README.md`](public/README.md#複核日曆)。

**如果你看到站上頁首的生效日已經是去年，代表這個站沒人在維護了。**請直接用頁面上的官方連結，或是自己接手——這就是它做成靜態單檔的原因。

## 接手 / fork

沒有帳號、沒有資料庫、沒有金鑰、沒有月費。fork 下來、改 `public/index.html` 底部的 `DATA`、丟到任何靜態託管（Cloudflare Pages、Netlify、GitHub Pages 都行）就是你的了。

**接手的話第一件要改的是 [`public/README.md`](public/README.md#複核日曆) 複核日曆裡的「誰」。**沒有具名負責人的複核日曆等於沒有複核日曆。

改資料的完整規則在 [`public/README.md`](public/README.md#改資料)。

歡迎 issue 與 PR，尤其是：**指出過期或錯誤的數字**（附官方連結最好）、**清掉 `v:false` 的旗標**（要附官方原文出處，不是再找一篇說法一致的文章）。

原作者不保證持續維護。這是設計，不是託辭。

## 免責

**這個站不是法律或財務建議，也不是最終權威。**它做的事只有一件：把你需要的那一條規則指出來，並把你送到澳洲政府的官方頁面。任何數字如果跟官方頁面不一樣，**以官方頁面為準**。

## 授權

[MIT](LICENSE)——程式碼與文字內容都適用。可以自由 fork、修改、重新發佈，包含商業用途。

⚠️ MIT 的「不附任何擔保」在這裡是字面意思：**這份資料會過期，而過期的法規資訊有真實的傷害。**要拿去用，請先自己重新核對一次數字，並更新複核日曆裡的負責人。

---

## In English

A single-page static site helping Taiwanese working-holiday makers in Western Australia check the rules before they pay or agree to something — regional-work postcodes, minimum wage floors, car purchases, rental bonds, currency-exchange scams, and what to do after being scammed. Every claim carries an effective date and a link to the official Australian government source; unverified claims are visibly flagged on the page itself.

Not for profit, no ads, no referral fees. Static single file, no build step, no dependencies, zero external requests. Content is in Traditional Chinese. MIT licensed — fork it and take over; the maintenance calendar in [`public/README.md`](public/README.md) tells you what expires and when.
