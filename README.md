# line-followup-helper（回訪小幫手）

用 LINE 追蹤客戶回訪，每位客戶一週至少聯絡 2 次、不漏掉人。

- **畫面**：`docs/`，用 GitHub Pages 發布 → https://paulwu722.github.io/line-followup-helper/
- **資料**：Google 試算表「客戶回訪表」，透過 `apps-script/Code.gs`（Apps Script 網頁應用程式）讀寫
- **安裝與使用**：見 [guide/安裝步驟.md](guide/安裝步驟.md)

## 建立空白回訪表（`apps-script/setup.gs`）

1. 打開 [script.google.com](https://script.google.com)，按「新專案」。
2. 把 [`apps-script/setup.gs`](apps-script/setup.gs) 的內容整個貼上，取代原本的程式碼。
3. 上方選 `setup`，按「執行」，第一次會要求授權。
4. 執行完，在「執行記錄」點連結，就是你的新回訪表。這個 Apps Script 專案之後可以刪掉。

### 四個分頁

| 分頁 | 用途 |
| --- | --- |
| 今日待辦 | 自動列出今天要聯絡、已經逾期的人，依回訪日排序。逾期的列是紅色。 |
| 客戶名單 | 每個人一列。灰底欄位是公式，不用填。 |
| 聯絡紀錄 | 每次聊完加一列：日期、LINE 名稱（下拉選單）、聊了什麼、下次要提的事。 |
| 設定 | 回訪間隔（預設 3 天）和每週目標次數（預設 2 次）。 |

#### 客戶名單欄位

| 欄位 | 填法 |
| --- | --- |
| LINE 名稱 | 手動填，聯絡紀錄的下拉選單會用到 |
| 身份 | 福音朋友／小羊／家內／聖徒 |
| 狀態 | 不回訊息 → 有回覆 → 好聊天 → 可約出來 → 牧養中 → 成全中；暫時不追的設成「暫停」 |
| 上次聯絡日 | 自動：聯絡紀錄裡最新的日期 |
| 下次回訪日 | 自動：上次聯絡日 + 回訪間隔，沒聯絡過就是今天 |
| 提醒 | 自動：逾期 N 天／今天聯絡／還有 N 天／暫停 |
| 本週已回訪 | 自動：這週一到今天的聯絡次數 |
| 本週目標 | 自動：已達成，或還差幾次 |
| 備註、學校、系級、認識時間 | 手動填 |

顏色：紅色是逾期，黃色是今天要聯絡，灰色是暫停。

`setup.gs` 是獨立的一次性腳本，跟回訪小幫手的 `Code.gs` 不要放在同一個 Apps Script 專案（兩個都有 `setup()`）。

## 檔案
| 路徑 | 內容 |
| --- | --- |
| `docs/index.html`、`app.js`、`style.css` | 手機 App 畫面（今日待辦、等待回覆中、總名單、＋新增名單） |
| `docs/manifest.json`、圖示 | 加到手機主畫面用 |
| `apps-script/Code.gs` | 資料 API（`doPost`）、每天 8 點 Email 提醒 |
| `apps-script/appsscript.json` | Apps Script 設定 |
| `apps-script/setup.gs` | 建立一份空白「客戶回訪表」（含公式、下拉選單、顏色） |
| `guide/` | 安裝步驟 |

## 安全
repo 是公開的，只放表格結構和程式，不放任何人的名字或聊天內容，也**沒有**試算表 ID、Apps Script 網址或密碼。
密碼存在 Apps Script 的指令碼屬性 `API_TOKEN`，手機第一次打開時輸入，只存在那支手機上。

## 用 clasp 從電腦同步 Apps Script（選用）
```bash
npm install -g @google/clasp
clasp login
# 先到 https://script.google.com/home/usersettings 開啟「Google Apps Script API」
clasp clone <腳本ID> --rootDir apps-script   # 腳本ID 在 Apps Script → 專案設定
git checkout -- apps-script                   # 以 GitHub 版本為準
clasp push                                    # 推到 Apps Script
clasp deploy -i <部署ID>                      # 更新現有部署（網址不變）
```
`.clasp.json` 已被 `.gitignore` 排除。
