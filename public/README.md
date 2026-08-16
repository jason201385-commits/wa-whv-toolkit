# 西澳打工度假 · 查核工具

一個靜態單頁。給人在西澳（Perth 及周邊）的台灣打工度假者，在**付錢或答應之前**查清楚。

非營利。沒有廣告、沒有推薦回饋、沒有合作仲介。

## 八個區塊

| 錨點 | 主題 | 這一段真正在防的事 |
|---|---|---|
| `/regional` | 集簽郵遞區號與天數 | 做完 88 天才發現郵遞區號不算、或同一雇主超過 6 個月（condition 8547）。送件截止時間用**東部時間**，Perth 的人以為還有兩小時。 |
| `/wage` | 時薪紅線 | **西澳同時跑兩套勞資系統**——雇主是獨資／非法人（很多小農場、家庭店）走州系統，地板比全國那條低（casual $32.84 vs $33.05）。另外**未滿 21 歲是 junior rate，不適用這條線**。**葡萄園是 Wine Award（MA000090）不是園藝 Award**，Wine Award 的計件工**沒有最低工資保障**，園藝有每日保底。工傷走的是**第三套系統 WorkCover WA**，Fair Work 管不到。 |
| `/car` | 買車 | 西澳**沒有冷靜期**、私人交易**沒有任何保固**。外加三個會讓整筆交易作廢的前置條件：領不領得到牌、保不保得到險、是不是公司名下的車。 |
| `/rent` | 押金 | 分租雅房很可能是 boarder/lodger，**不受租賃法保護**。押金只退到澳洲帳戶、租客只能紙本申請、人工要 4 週——離境前 6–8 週就要啟動。 |
| `/scam` | 換匯與付款 | 澳洲的即時支付（NPP／Osko）**最終且不可撤銷**。錢一出去就沒有「撤銷轉帳」這個動作。 |
| `/after` | 已經被騙了 | 分澳洲帳戶／台灣帳戶兩路走——**台灣的錢只有台灣凍得住**。含各行詐騙專線的 Perth 換算時段。 |
| `/landing` | 剛落地 | TFN、Medicare（沒有互惠協定）、救護車不免費、NDA 稅率台灣不適用。 |
| `/ask` | 在群裡問之前 | 一段可以直接複製的問句範本，用來把「還在嗎」變成可驗證的資訊。 |

---

## 這個站故意不做的事

這一段比功能清單重要。它是設計約束，不是免責聲明。

| 不做 | 為什麼 |
|---|---|
| **職缺表／房源表／任何「今日有效」清單** | 維運者一離開就變成幽靈刊登，害人白跑。看起來比 LINE 正式，所以傷害更大。**這種頁面不准上線，除非它能在 48 小時沒人更新時自動清空。** |
| **指名的詐騙黑名單** | 西澳與北領地是全澳洲唯二沒有採納 2021 年誹謗法改革的司法管轄區——沒有「重大損害門檻」、沒有法定公共利益抗辯。公開指名的風險在這裡最高。改用去識別化的「手法」與「交易守則」。 |
| **留言板／表單／登入／資料庫** | 任何可寫入的東西都需要審核。審核需要每天有人在。這個站的維運預算是每天 5 分鐘。 |
| **LINE bot** | 推播按收訊人數計費，一則摘要進 500 人的群＝計 500 則。而且一個群只能有一個 bot，需要管理員同意。 |
| **成為最終權威** | 每個數字旁邊都有生效日和官方連結。跟官方不一樣時，以官方為準。 |

技術上也鎖死：純靜態單檔、沒有 build step、沒有相依套件、沒有 API、沒有 `<form>`。
**想加功能時會先撞到架構，這是故意的。**

---

## 檔案

```
public/               ← 部署目錄。只有這裡面的東西會上線。
  index.html          整個站。所有事實集中在檔案底部 <script> 裡的 DATA 物件。
  _redirects          Cloudflare Pages 短網址（/scam、/wage …）。
  _headers            安全標頭：CSP、Referrer-Policy: no-referrer、X-Frame-Options 等。
  README.md           這份。
  handoff.md          說明樁，不是真的交接文件（原因寫在裡面）。
test/
  wage.test.js        時薪判定的回歸測試。`node test/wage.test.js`，零相依套件。
                      它直接從 index.html 挖出 DATA 與 checkRate() 來跑，所以測到的
                      一定是正式版程式碼，不是抄一份出來的副本。
README.md             給接手者的公開說明：為什麼會有這個站、怎麼跑測試、怎麼部署。
LICENSE               MIT。
handoff.md            維運者的私人工作筆記。**不上線，也不進版控**（見 .gitignore）。
                      對接手者有用的部分都已經整理進 README.md 與這一份。
.gitignore            擋掉 .wrangler/（裡面有 Cloudflare account id 與帳號 email）
                      與 handoff.md。
```

**分界線就是 `public/`**：要公開的放進去，不公開的放外面。
`.assetsignore` 對 `wrangler pages deploy` **無效**（實測會照樣上傳），所以只能靠目錄隔離。

## 改資料

只改 `public/index.html` 底部的 `DATA` 物件。每一條都有：

```js
{ t:"名稱", u:"https://…官方網址", as:"YYYY-MM-DD", v:true }
```

- `as` — 生效日或查證日。**一定要跟著改**，這是使用者判斷資料新不新鮮的唯一依據。
  ⚠️ **兩種意思共用一個欄位，所以「舊日期」不一定等於「過期」**：來源本身有生效日的
  （公報、Bulletin、判決、pay guide）填**它自己的生效日**，`2022-07-20` 是那份文件的日期，不是疏漏；
  只有沒有生效日的一般網頁才填**查證日**。看到舊日期先分清楚是哪一種再決定要不要重查。
- `v` — 是否真的打開**官方**頁面確認過。`false` 會在畫面上顯示「待核」標籤。
  **民間智庫、媒體、論壇一律是 `false`**，內容再對也一樣——`v` 標的是「有沒有官方背書」，不是「我信不信」。
  **寧可標待核，不要填一個看起來合理的數字。**

`DATA.asOf` 是全站的資料生效日，顯示在頁首。

## 部署

**已上線：https://wa-whv.pages.dev**（Cloudflare Pages，專案名 `wa-whv`）。

```bash
npx wrangler pages deploy ./public --project-name=wa-whv --branch=main
```

要在 Cloudflare Pages 上直接接 GitHub repo 自動部署的話：build command **留空**、
**output directory 設成 `public`**。

本機預覽：用瀏覽器直接開 `public/index.html` 就可以，不需要 server。
（短網址 `/scam` 只有在 Cloudflare Pages 上才會生效，本機請用 `index.html#scam`。）

要用自動化工具測的話，多數無頭瀏覽器**擋 `file:` 協定**，起一個本機 server 比較省事：

```bash
python -m http.server 8787 --bind 127.0.0.1 --directory public
```

### 部署後的驗收（不要只看 wrangler 說成功）

wrangler 回報成功只證明它上傳完了，不證明邊緣吐出來的是新版。**用外部通道核對**：

```bash
curl -s https://wa-whv.pages.dev/ | sha256sum
```

拿它跟 `sha256sum public/index.html` 對，一樣才算真的上線。另外抽驗兩件事：
`curl -sI https://wa-whv.pages.dev/scam` 要回 **302**（`_redirects` 生效），
同一個回應裡要看得到 `content-security-policy` 與 `x-frame-options`（`_headers` 生效）。
**`_headers` 寫錯不會讓部署失敗，它會靜默地不生效**——所以這一步不能省。

### 部署時會咬人的兩件事

1. **`.assetsignore` 對 `wrangler pages deploy` 無效。**實測（wrangler 4.123.0）列在裡面的檔案
   照樣被上傳並公開提供。**唯一可靠的排除方式是把檔案放在部署目錄外面。**
2. **刪掉檔案不會清掉邊緣快取。**Pages 的資產帶 `Cache-Control: public, s-maxage=604800`，
   把來源檔刪掉之後，該路徑仍會從邊緣吐出舊副本，**最長七天**。
   **要蓋掉只能在同一個路徑放上新內容。**`public/handoff.md` 那個說明樁就是為此存在。

---

## 複核日曆

澳洲多數規則在**每年 7 月 1 日**換版。

**負責人：Jason（本站唯一維運者）。** 沒有第二個人，所以下面每一列的「誰」都是同一個答案；
哪天有人接手，**第一件要改的就是這一行**。沒有具名負責人的複核日曆等於沒有複核日曆。

| 日期 | 誰 | 要查什麼 | 去哪裡看 |
|---|---|---|---|
| **2026-07-02**（已過，本版即為此次結果） | Jason | 全國最低工資、casual loading、退休金提撥率、各 Award 時薪 | `fairwork.gov.au` 的 minimum wages 頁；州系統看 `commerce.wa.gov.au` Wageline |
| **2026-07-02**（同上，2026-08-16 補入） | Jason | ⭐ **入門級分類費率**（`DATA.wage.entry`）——它才是計算機敢不敢下「違法」的地板 | 兩份官方 pay guide PDF，**`curl` 抓得到，WebFetch 會 timeout**：<br>`calculate.fairwork.gov.au/Download/AwardSummary?awardCode=ma000028&fileType=pdf`<br>`calculate.fairwork.gov.au/Download/AwardSummary?awardCode=ma000090&fileType=pdf` |
| **2027-07-02** | Jason | 同上（含入門級），外加 AIS 驗車費率、RAC 檢查費 | 同上 ＋ `wa.gov.au` 的 vehicle inspection 費率頁 |
| **2027-01-05** | Jason | 集簽指定區域郵遞區號、指定工作類別定義；順便看**入門級分類的時間上限有沒有再改**（2025-04-01 改過一次） | `immi.homeaffairs.gov.au` 的 specified work 頁；`awards.fairwork.gov.au/MA000028.html` 的 Schedule A（全文，`curl` 可讀） |
| **每次動 `DATA` 時** | 改的人 | 手上這一條的 `as` 有沒有跟著改 | 就在你正在編的那一行 |
| **每次動 `checkRate()` 時** | 改的人 | `node test/wage.test.js` 有沒有全過 | 就在專案根目錄 |

⚠️ **入門級費率跟最低工資是兩件事，不能只更新一個。**award 的入門級分類（園藝 MA000028 Level 1、
酒莊 MA000090 Grade 1）**合法低於全國最低工資**，而這兩格正好是集二簽人口最常被歸進去的。
`DATA.wage.nmw` 跟 `DATA.wage.entry` 每年都要各抓各的來源，抄一個去推另一個必錯。

`v:false` 不是排程項目，是待辦清單——**下一次打開這個檔案時就處理**，不要等到 7 月。

### 目前仍待官方確認的項目（`v:false`）

```bash
grep -o 'v:false[},]' public/index.html | wc -l
```

**現在是 19**（2026-08-16 更新）。⚠️ 不要用 `grep -o 'v:false'`（少了後面那個字元類）——它會連**註解裡提到
`v:false` 這個字串**的行一起算進去。後面的 `[},]` 就是用來只取真正的旗標。
另外這條 `grep` **只抓 `v:false` 這種沒有空格的寫法**：`DATA` 裡還有幾個區塊級旗標寫成 `v: true`（有空格），
那些不是來源條目，本來就不該進這個計數。
這 19 筆的組成（可在瀏覽器 console 走一次 `DATA` 驗證）：
**16 筆是帶官方網址的來源條目**（另有 100 筆 `v:true`，合計 116 筆來源全都帶旗標），
**3 筆是沒有網址的內容卡片**——`Fair Work 口譯服務`、`退租還要先給通知期`、`所以離開西澳前 6–8 週就要開始跑`。

集中在這幾類：

- **PPSR 的「付了現金車還是可能被拖走」這個後果** — `ppsr.gov.au` 擋 bot（HTTP 200 但回 challenge 頁），
  無法取得原文。實務結論成立，但引不到官方句子。
- **WA ScamNet 的購車詐騙手法頁** — 同上，未逐字核對。
- **西澳水電費轉嫁條件、煙霧偵測器與 RCD 義務** — 條文方向確認，頁面未逐字核對。
- **Fair Work 的 Record My Hours、不合法扣款頁、UnionsWA 是否為西澳唯一 ATP** — 未逐字核對。
- **退租通知期的天數** — ⚠️ **站上有寫死的數字**：`/rent` 的離境時程卡寫著「週期性租約至少 **21 天**
  書面通知（Form 22）；固定期租約須在到期前至少 **30 天**通知」。這兩個數字**沒有逐字核對過官方頁**，
  所以整張卡掛 `v:false`。**清掉這個旗標的時候，要回頭核對並改這兩個數字本身，不是只把 `false` 翻成 `true`。**
  原始碼那一行上面有同樣內容的註解（搜 `退租還要先給通知期`）。
- **Fair Work 的 junior pay rates 頁** — 該頁 WebFetch 兩次都 ECONNRESET／timeout，內容由
  `WebSearch` 限定 `fairwork.gov.au` 取得。**站上只寫結構規則，不寫任何 junior 金額**
  ——來源只拿得到「按年齡打折」這個結構，拿不到逐格金額，補一個看起來合理的數字就是編造。
- **2021 誹謗法改革（西澳與北領地未採納）** — 出處是 Rule of Law Institute，**民間智庫不是官方**。
  2026-08-16 從 `v:true` 改回 `v:false`。要清這個旗標，得找到西澳司法部或國會的官方頁面，
  不是再找一篇說法一致的文章。
- **WorkCover WA 的 7 天／14 天程序時限** — `workcover.wa.gov.au` 對 WebFetch 回 403（頁面與 PDF 都是）。
  站上已就這幾個天數寫明「未親自逐字確認，以官方頁為準」。**受傷資格那句與 1300 794 744 是從
  `wa.gov.au` 鏡像頁逐字確認過的**，只有天數待核。

### 已知的錯誤來源（不要再引）

- **Tenants Bulletin 36（2022-07-20）** — 「超收押金是刑事犯罪」的原文出處，但同一頁還留著
  已被 2024 年改革取代的「六個月才能漲一次租」。**只能引那一句，不能當現行法源用。**
- **「離開西澳會讓 Commissioner 失去押金爭議管轄權」** — 方向是反的。官方例外只列
  NSW/QLD/SA/TAS/VIC 五州；回台灣不觸發。真正的風險是人在海外收不到 10 天期限的通知信。
- **A$13,100／A$10,400 兩個租屋詐騙個案** — 出自 2022-07-12 的公告，不是 2026-01-29 的統計聲明。
- **「DoT 過戶送件後約需 21 天處理」** — 兩個官方頁都查無此述，已刪。
- **正時皮帶／鏈條的車款對照** — 原始出處是 RAC **英國**。實務建議保留，已改標為通則、不引用出處。
- **Assurance Protocol** — **已因兩項試辦計畫而暫停**。現行機制是 Strengthening Reporting
  Protections Pilot 與 Workplace Justice Visa（408）。寫成「現在還有 Assurance Protocol」是錯的。

**如果你看到頁首的生效日已經是去年，代表這個站沒人在維護了。** 請直接用頁面上的官方連結，
或是自己接手——這就是它做成靜態單檔的原因。

---

## 接手

沒有帳號、沒有資料庫、沒有金鑰、沒有月費。

**原始碼在 https://github.com/jason201385-commits/wa-whv-toolkit（MIT 授權）。**
fork 下來、改 `public/index.html` 底部的 `DATA`、丟到任何靜態託管（Cloudflare Pages、
Netlify、GitHub Pages 都行）就是你的了。

不想碰 git 也行：在瀏覽器按「另存新檔」把這個站存成一個 `.html` 檔，你手上就有完整的
原始碼了——所有事實都在檔案底部 `<script>` 的 `DATA` 物件裡。短網址要自己補一個
`_redirects`（規則在本檔「檔案」段）。

**接手的話第一件要改的是上面複核日曆裡的「誰」。**

原作者不保證持續維護。這是設計，不是託辭。
