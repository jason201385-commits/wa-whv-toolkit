# 西澳打工度假 · 查核工具

**線上：https://wa-whv.pages.dev**

一個靜態單頁。給人在西澳（Perth 及周邊）的台灣打工度假者，在**付錢或答應之前**查清楚。

非營利。沒有廣告、沒有推薦回饋、沒有合作仲介、沒有任何導流分潤。

```
/regional  集二簽郵遞區號與 88 天，還有 condition 8547
/wage      時薪紅線（西澳有兩套勞資系統，地板不只一條）
/car       買車：沒有冷靜期、私人交易沒有保固
/rent      押金上限、分租雅房到底受不受保護、退租時程
/scam      換匯與付款：哪些付款軌道還追得回來
/after     已經被騙了，第一步該打給誰
/landing   剛落地：TFN、Medicare、稅
/ask       在群裡問之前，先問對問題
```

八個區塊各自的內容與設計理由在 [`public/README.md`](public/README.md)。

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
  _redirects          短網址（/scam、/wage …）
  _headers            安全標頭：CSP、HSTS、Referrer-Policy: no-referrer 等
  README.md           資料維護手冊：改資料的規則、複核日曆、已知的錯誤來源
  handoff.md          說明樁，不是文件（原因寫在裡面）
test/
  wage.test.js        時薪判定的回歸測試
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
```

零相依套件，28 個案例。它**直接從 `index.html` 挖出 `DATA` 與 `checkRate()` 用 `vm` 跑**，所以測到的一定是正式版程式碼，不是抄一份出來的副本（抄出來的副本會在你改了 `index.html` 之後繼續騙你說全過）。

**動過 `checkRate()` 或 `DATA.wage` 就一定要跑。**

涵蓋：輸入護欄、浮點數邊界、入門級分類的假指控情境、兩套勞資系統、計件三分支、剪貼簿文字必須與畫面判定同一個符號、每條路徑都要有退休金提醒。

### 語法與旗標檢查

```bash
node -e "const fs=require('fs');const m=fs.readFileSync('public/index.html','utf8').match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync('chk.js',m[1])" && node --check chk.js
grep -o 'v:false[},]' public/index.html | wc -l
```

第二條數的是「待核」旗標。**把它跟瀏覽器裡的 `document.querySelectorAll('.pending').length` 對一次**——兩邊對不上就代表有 renderer 讀不到旗標，畫面上會有一筆沒標「待核」的未查證資料。這個 bug 真的發生過。

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
