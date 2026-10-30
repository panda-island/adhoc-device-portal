# 小島測試室 · iOS Ad Hoc 測試裝置入口

繁體中文、可在 Windows 開發與執行的完整專案。Node.js 24，無第三方執行套件，不需 npm install。

## 兩種執行方式

| 方式 | 內容 | 資料位置 |
| --- | --- | --- |
| GitHub Pages（預設） | 裝置資料 → 訂單 → 付款示範 → 待審核；離線模擬 | 只在瀏覽器記憶體，重新整理清除，不送出 UDID |
| Windows Node 後端 | 真實申請保存、人工審核、mock/live Apple 介面、授權下載、管理工作區 | 後端 SQLite 與私有 profiles 目錄 |

「我已付款」只跳過付款頁。`paymentStatus` 永遠為 `unverified`。本專案沒有收款、帳務驗證、自動通過審核、P12 核發或任意 IPA 簽署功能。

## Windows 快速開始

1. 安裝 Node.js 24 或更新版本及 Git。解壓縮後，在此專案資料夾開啟 PowerShell。
2. 建立本機設定：

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
notepad .env
```

把剛產生的隨機字串填入 `ADMIN_TOKEN`，保留 `APPLE_MODE=mock`。不要使用範例預設值，且不要將密鑰貼到聊天或儲存庫。

3. 執行：

```powershell
npm test
npm start
```

4. 開啟 http://localhost:3000 ，按「填入示範資料」，勾選授權確認，完成四個步驟。
5. 展開頁面下方「管理員工作區」，輸入 `.env` 的管理密鑰：載入申請 → 提供理由 → 通過審核 → 註冊裝置 → 建立描述檔。mock 會顯示模擬完成，不會產生或下載真實描述檔。另開一個頁籤當管理員，原申請頁按「更新進度」。
6. 停止服務：Ctrl+C。資料保存在 `data/`；重啟後仍保留。申請者的存取 token 只留在頁面記憶體，重新整理後無法復原；管理員仍能管理申請。

本機後端預設只監聽 127.0.0.1。前端 localhost 自動連接同來源後端；其他主機預設進入純示範模式。

## 發布到 github.io

已附 `.github/workflows/pages.yml`：推送 `main` 後執行測試、建立 `dist/`、部署 Pages。只上傳 `public/` 的副本，後端與資料均不發布。靜態資源採相對路徑，適用 `https://帳號.github.io/儲存庫/`。

1. 建立 GitHub 公開儲存庫，上傳專案（不要上傳 `.env`、`data/`、P8、P12）。
2. 儲存庫 Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。
3. 推送 main 或在 Actions 手動執行 Publish demo to GitHub Pages。
4. 等待成功後開啟工作流程顯示的網址。純示範不需要後端或任何密鑰。

```powershell
git init -b main
git add .
git commit -m "Create Ad Hoc testing portal demo"
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

**GitHub Pages 是靜態主機，不能執行 Node.js、SQLite 或保存密鑰。GitHub 限制將 Pages 作為經營線上交易或商業 SaaS 的免費主機；這裡發布的是零元、無真實金流的教育示範。正式商業或敏感資料服務應另選合適主機，不要把公開 Pages 當成售證平台。**

## 分開部署 Windows 後端

1. 在 Windows 主機安裝 Node.js 24，複製專案，依快速開始建立 `.env`。
2. 設定 `ALLOWED_ORIGIN=https://YOUR_ACCOUNT.github.io`（只填 origin，不包含儲存庫路徑），設定 `DATA_DIR` 為主機私有的持久目錄。
3. 使用 IIS/ARR 或其他受維護的反向代理，透過 HTTPS 網域（如 `https://api.example.com`）轉送至 `127.0.0.1:3000`。使用受限 Windows 服務帳號和服務管理工具執行 Node，設置重啟、備份、容量監控；不要直接公開本機開發服務。
4. 修改 `public/config.js` 的 `apiBase` 為你的 HTTPS API origin，再部署前台。這會讓該前台開始提交真實資料；請先準備隱私政策、測試者登入及適當的託管環境。不要在 config.js 中加入秘密。
5. CORS 不是登入；後端以 Bearer token 保護申請和管理介面。反向代理應加上請求速率與連線限制；應用程式的簡易限制以連線位址計數，代理後可能是共同位址。

## Apple App Store Connect API

尚未設定時預設 `mock`，無外部呼叫。`APPLE_MODE=live` 必須明確設定；缺欄位即啟動失敗，不會偷偷轉回 mock。mock 模式若存在 Apple 密鑰欄位也會失敗，避免誤用。

1. 使用有 Certificates, Identifiers & Profiles 權限、符合 Apple 要求的 **Team API Key**。不要使用 Apple ID 密碼或 Individual API Key 取代。
2. 將 `.p8` 存在儲存庫外的私有目錄，限制只有後端服務帳號可讀。Windows 的檔案 ACL 需由管理員設定；程式的 POSIX mode 不能替代 Windows ACL。
3. 設定 `.env`：

```ini
APPLE_MODE=live
APPLE_KEY_ID=your-key-id
APPLE_ISSUER_ID=your-issuer-id
APPLE_PRIVATE_KEY_PATH=C:/PrivateKeys/AuthKey_YOURKEY.p8
APPLE_BUNDLE_ID_RESOURCE=your-apple-bundle-resource-id
APPLE_CERTIFICATE_RESOURCE=your-existing-distribution-certificate-resource-id
```

這兩個 resource ID 是 Apple API 的資源 ID，並非文字 Bundle ID 或 Team ID。JWT 使用 ES256、120 秒效期，只在伺服器記憶體產生。程式不提供任何 API 讓瀏覽器讀取 P8、P12、JWT 或環境變數。

4. 申請人提交 → 管理員確認 App/測試裝置授權並記錄理由 → 註冊裝置（`POST /v1/devices`，先查同 UDID 避免重複）→ Apple 裝置必須 `ENABLED` → 建立 `IOS_APP_ADHOC` 描述檔（`POST /v1/profiles`）→ 管理員另行授權下載。
5. 描述檔從 Apple API 回應的 `profileContent` 取出，必須 ACTIVE 且未到期；儲存在非靜態目錄。下載端點再驗證申請 token、審核、授權、live 模式及到期日。撤回下載或拒絕審核會立刻阻擋之後的下載，但不能撤回使用者已下載的副本。

本專案每筆申請建立一份只含該裝置的描述檔，**不修改、不刪除既有描述檔或憑證**。如需共用多裝置描述檔，請擴充獨立 profile version/裝置關聯模型。Apple 啟用延遲、年度裝置額度、權限、協議或憑證問題會阻擋作業；不承諾即時啟用。遠端寫入與本機儲存不能保證跨系統交易，網路結果不明時先在 Apple 後台確認，尤其建立描述檔不要盲目重試。

## 後端介面

JSON 請求使用 `Content-Type: application/json`。除建立申請/health 外都需 `Authorization: Bearer ...`，token 不接受 query string。

| 方法 / 路徑 | 授權 | 功能 |
| --- | --- | --- |
| GET /api/health | 無 | 健康狀態與 mock/live |
| POST /api/orders | 無 | `{ deviceName, udid, consent: true }`，回傳 order 與隨機 accessToken |
| GET /api/orders/:id | 該申請 token | 讀取遮罩後資訊 |
| POST /api/orders/:id/demo-skip | 該申請 token | `{}`，draft → pending，付款仍未驗證 |
| GET /api/orders/:id/download | 該申請 token | 通過所有門檻才回傳描述檔 |
| GET /api/admin/orders | 管理 token | 最近 200 筆申請 |
| POST /api/admin/orders/:id/review | 管理 token | `{ decision: "approved" 或 "rejected", reason: "..." }` |
| POST /api/admin/orders/:id/register | 管理 token | `{}`，註冊/重新查詢裝置 |
| POST /api/admin/orders/:id/profile | 管理 token | `{}`，建立描述檔 |
| POST /api/admin/orders/:id/authorize-download | 管理 token | `{ authorized: true 或 false }` |
| GET /api/admin/orders/:id/audit | 管理 token | 操作時間與事件（不記秘密） |

## 測試與限制

`npm test` 覆蓋 UDID、設定失敗關閉、付款跳過、跨申請存取、未審核操作、mock 下載禁止、正式模式授權/撤回下載及稽核。正式模式測試採注入 stub，**不表示已驗證真實 Apple 帳號或可安裝檔案**。`npm run build` 只複製前台到 dist。

這是可執行的參考專案，不是完成營運驗收的託管服務。正式上線前應擴充：測試者帳號登入與復原、管理員 MFA/角色與個別稽核、加密磁碟/資料庫備份、資料刪除與保存期限、濫用防護/容量上限、正式金流 provider 的伺服器簽章驗證（若另有合規需求）、Apple 回應的定期狀態同步與可觀測性。單一程序 SQLite 和本機鎖不適用多實例同時寫入。`paymentStatus` 不參與測試授權判定，管理員依實際測試授權審核。

## Apple 合約與官方來源

Ad Hoc 是有限的註冊裝置分發，不是任意對公眾分發的授權。Apple Developer Program License Agreement 第 2.8 節限制分享/出售/轉售帳號及其服務，第 7.3 節規範 Ad Hoc 與符合資格的 Registered Devices。不要把技術上能註冊 UDID 解讀為能轉售憑證、名額、私鑰或向陌生人提供任意 App 簽署服務。實際適用內容以您簽署的最新協議與 Apple 審核為準。此專案不隸屬 Apple。

- [Apple Developer Program License Agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)
- [Devices overview](https://developer.apple.com/help/account/devices/devices-overview/)
- [JWT 驗證](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests)
- [註冊裝置 API](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-devices)
- [Profiles API](https://developer.apple.com/documentation/appstoreconnectapi/profiles)
- [GitHub Pages 使用限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## 專案結構

```text
public/             繁體中文靜態前台與公開設定
server/app.mjs      HTTP、SQLite、審核與授權下載
server/apple.mjs    可替換 Apple adapter，mock / live
server/index.mjs    Windows / Node 啟動入口
tests/              安全流程整合測試
scripts/build.mjs   建立 Pages 靜態成品
.github/workflows/  GitHub Pages 自動部署
.env.example        只含設定範本
```
