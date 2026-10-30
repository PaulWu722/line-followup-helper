/**
 * 回訪小幫手（資料 API）
 * 畫面放在 GitHub Pages，這支 Apps Script 只負責讀寫「客戶回訪表」：
 *   1. doPost 收到 { token, action, args }，驗證密碼後執行，回傳最新的全部資料
 *   2. 每天早上寄 Email 提醒今天要回訪誰
 * 試算表 ID、密碼都不寫在程式裡（repo 是公開的）。
 */

const SHEET_PEOPLE = '客戶名單';
const SHEET_LOG = '聯絡紀錄';
const STATUSES = ['不回訊息', '有回覆', '好聊天', '可約出來', '牧養中', '成全中'];
const IDENTITIES = ['福音朋友', '小羊', '家內', '聖徒'];
const REMINDER_HOUR = 8; // 每天幾點寄提醒（台北時間）

// 客戶名單欄位（1 起算）。A 欄 LINE 名稱是辨識每個人的鍵。D~H 是公式自動算，App 絕對不寫入。
const COL = { name: 1, identity: 2, status: 3, nextDate: 5, hint: 6, weekGoal: 8,
              note: 9, school: 10, dept: 11, metDate: 12 };
const NEW_HEADERS = ['學校', '系級', '認識時間']; // 放在 J~L，不動到原本的欄位與公式

// 聯絡紀錄：A 日期, B LINE 名稱, C 聊了什麼, D 下次要提的事, E 回覆狀態（等待回覆 / 已回覆 / 暫時沒有反應）
const LOG_HEADERS = ['回覆狀態'];
const WAITING = '等待回覆';
const NO_REACTION = '暫時沒有反應';

const PROPS = PropertiesService.getScriptProperties();

// 這支程式綁在試算表上（擴充功能 → Apps Script），直接用所在的試算表；獨立專案才需要設 SPREADSHEET_ID 屬性
let ss__;
function ss_() {
  if (!ss__) {
    const id = PROPS.getProperty('SPREADSHEET_ID');
    ss__ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  }
  return ss__;
}

/** 第一次使用時手動執行一次：補上 J~L 欄標題、建立每日提醒、產生 App 密碼。 */
function setup() {
  const sheet = ss_().getSheetByName(SHEET_PEOPLE);
  sheet.getRange(1, COL.school, 1, NEW_HEADERS.length).setValues([NEW_HEADERS]).setFontWeight('bold');
  sheet.getRange(2, COL.metDate, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy/mm/dd');
  ss_().getSheetByName(SHEET_LOG).getRange(1, 5, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendDailyReminder')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendDailyReminder').timeBased().everyDays(1).atHour(REMINDER_HOUR).create();

  if (!PROPS.getProperty('API_TOKEN')) PROPS.setProperty('API_TOKEN', Utilities.getUuid().replace(/-/g, ''));

  Logger.log('設定完成：每天 %s 點會寄提醒到 %s', REMINDER_HOUR, Session.getEffectiveUser().getEmail());
  Logger.log('App 密碼：%s（手機第一次打開 App 時輸入，也可以在 專案設定 → 指令碼屬性 → API_TOKEN 查到）', PROPS.getProperty('API_TOKEN'));
}

/** 想換密碼時執行：舊密碼立刻失效，手機要重新輸入 */
function resetToken() {
  PROPS.setProperty('API_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('新的 App 密碼：%s', PROPS.getProperty('API_TOKEN'));
}

function doGet() {
  return json_({ ok: true, app: '回訪小幫手 API' });
}

/**
 * 畫面用 fetch 送 text/plain 的 JSON（避免瀏覽器先送 OPTIONS，Apps Script 不支援）。
 * 每個動作完成後都回傳最新的全部資料，畫面直接用它取代手機上的快取。
 */
function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '格式錯誤' });
  }
  const token = PROPS.getProperty('API_TOKEN');
  if (!token || req.token !== token) return json_({ ok: false, error: '密碼不對', auth: false });

  const actions = { load: null, addPerson: addPerson_, logContact: logContact_,
                    markReply: markReply_, markScreenshot: markScreenshot_ };
  if (!(req.action in actions)) return json_({ ok: false, error: '不認得的動作：' + req.action });

  const lock = LockService.getScriptLock();
  try {
    let result = null;
    if (actions[req.action]) {
      lock.waitLock(20000);
      result = actions[req.action](req.args || {});
      SpreadsheetApp.flush(); // 讓 D~H 公式重算完再讀
    }
    return json_({ ok: true, result, data: loadAll_() });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** 一次讀完兩個分頁，算出畫面需要的全部資料（今日待辦、等待回覆、總名單） */
function loadAll_() {
  const people = readPeople_();
  const log = readLog_();
  return {
    options: { statuses: STATUSES, identities: IDENTITIES },
    today: todayList_(people, log),
    waiting: waitingList_(people, log),
    groups: groups_(people, log),
    at: new Date().toISOString()
  };
}

function readPeople_() {
  const sheet = ss_().getSheetByName(SHEET_PEOPLE);
  return sheet.getRange(2, 1, sheet.getMaxRows() - 1, COL.metDate).getValues()
    .filter(r => String(r[COL.name - 1]).trim() !== '');
}

function readLog_() {
  const sheet = ss_().getSheetByName(SHEET_LOG);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 5).getValues()
    .map((r, i) => ({ r, row: i + 2 }))
    .filter(x => String(x.r[1]).trim() !== '');
}

/** 今天（含逾期）該回訪的人，逾期最久的排前面 */
function todayList_(people, log) {
  const today = startOfToday_();
  const last = lastNotes_(log);
  return people
    .filter(r => r[COL.nextDate - 1] instanceof Date && r[COL.nextDate - 1] <= today)
    .sort((a, b) => a[COL.nextDate - 1] - b[COL.nextDate - 1])
    .map(r => {
      const name = String(r[COL.name - 1]).trim();
      return {
        name,
        identity: String(r[COL.identity - 1]),
        status: String(r[COL.status - 1]),
        hint: String(r[COL.hint - 1]),
        weekGoal: String(r[COL.weekGoal - 1]),
        school: [r[COL.school - 1], r[COL.dept - 1]].filter(String).join(' '),
        note: String(r[COL.note - 1]),
        lastNext: (last[name] || {}).next || '',
        lastDate: (last[name] || {}).date || ''
      };
    });
}

/** 每個人最近一筆有寫「下次要提的事」的聯絡紀錄 */
function lastNotes_(log) {
  const out = {};
  log.forEach(({ r }) => {
    const name = String(r[1]).trim();
    if (!String(r[3]).trim()) return;
    const prev = out[name];
    if (!prev || !(r[0] instanceof Date) || r[0] >= prev.at) {
      out[name] = { at: r[0], next: String(r[3]), date: fmt_(r[0]) };
    }
  });
  return out;
}

/** 等待回覆中的聯絡紀錄，最早聯絡的排前面 */
function waitingList_(people, log) {
  const status = {};
  people.forEach(r => status[String(r[COL.name - 1]).trim()] = String(r[COL.status - 1]));
  return log
    .filter(x => x.r[4] === WAITING)
    .sort((a, b) => a.r[0] - b.r[0])
    .map(x => {
      const name = String(x.r[1]).trim();
      return { row: x.row, name, date: fmt_(x.r[0]), status: status[name] || '' };
    });
}

/** 總名單：依身份分組，每組依聯絡次數由多到少排序 */
function groups_(people, log) {
  const counts = {};
  log.forEach(({ r }) => {
    const n = String(r[1]).trim();
    counts[n] = (counts[n] || 0) + 1;
  });
  const groups = {};
  IDENTITIES.concat(['未分類']).forEach(g => groups[g] = []);
  people.forEach(r => {
    const name = String(r[COL.name - 1]).trim();
    const g = IDENTITIES.includes(r[COL.identity - 1]) ? r[COL.identity - 1] : '未分類';
    groups[g].push({ name, status: String(r[COL.status - 1]), count: counts[name] || 0 });
  });
  Object.values(groups).forEach(list => list.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name, 'zh-TW')));
  return groups;
}

/** 新增一位認識的人到客戶名單 */
function addPerson_(p) {
  const name = String(p.name || '').trim();
  if (!name) throw new Error('請填 LINE 名稱');

  const sheet = ss_().getSheetByName(SHEET_PEOPLE);
  const names = sheet.getRange(2, COL.name, sheet.getMaxRows() - 1, 1).getValues().map(r => String(r[0]).trim());
  if (names.includes(name)) throw new Error('名單裡已經有「' + name + '」了，同名請加註記（例如：' + name + '-資工）');

  // D~H 有 ARRAYFORMULA，getLastRow 不準，所以自己找 A 欄第一個空列
  let idx = names.indexOf('');
  if (idx === -1) {
    sheet.insertRowsAfter(sheet.getMaxRows(), 50);
    idx = names.length;
  }
  const row = idx + 2;

  sheet.getRange(row, COL.name, 1, 3).setValues([[name, IDENTITIES.includes(p.identity) ? p.identity : '', p.status || '有回覆']]);
  sheet.getRange(row, COL.note, 1, 4).setValues([[
    String(p.note || '').trim(),
    String(p.school || '').trim(),
    String(p.dept || '').trim(),
    p.metDate ? parseDate_(p.metDate) : new Date()
  ]]);
  return name;
}

/** 按「已聯絡」：在聯絡紀錄加一列並標成等待回覆，公式會自動更新上次聯絡日與下次回訪日 */
function logContact_(c) {
  const name = String(c.name || '').trim();
  if (!name) throw new Error('缺少 LINE 名稱');
  const sheet = ss_().getSheetByName(SHEET_LOG);
  const colA = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), 1).getValues();
  let idx = colA.findIndex(r => r[0] === '' || r[0] === null);
  if (idx === -1) {
    sheet.insertRowsAfter(sheet.getMaxRows(), 50);
    idx = colA.length;
  }
  sheet.getRange(idx + 2, 1, 1, 5).setValues([[startOfToday_(), name, '', '', WAITING]]);
  return name;
}

/**
 * 找這個人等待回覆中的那一列。畫面是先顯示、背景才寫入，剛按「已聯絡」的人畫面上還不知道列號，
 * 所以 row 對不上時改用名字找最近一筆等待回覆。
 */
function waitingRow_(sheet, row, name) {
  if (row) {
    const r = sheet.getRange(row, 1, 1, 5).getValues()[0];
    if (String(r[1]).trim() === name && r[4] === WAITING) return row;
  }
  const found = readLog_().filter(x => String(x.r[1]).trim() === name && x.r[4] === WAITING).pop();
  return found ? found.row : 0;
}

/** 標記回覆結果：replied=true 寫入聊了什麼、下次要提的事並更新狀態；false 寫「暫時沒有反應」 */
function markReply_(a) {
  const name = String(a.name || '').trim();
  const sheet = ss_().getSheetByName(SHEET_LOG);
  const row = waitingRow_(sheet, a.row, name);
  if (!row) throw new Error(name + ' 已經不在等待回覆中了');
  if (!a.replied) {
    sheet.getRange(row, 5).setValue(NO_REACTION);
    return name;
  }
  const talk = String(a.talk || '').trim();
  if (!talk) throw new Error('請寫下聊了什麼');
  sheet.getRange(row, 3, 1, 3).setValues([[talk, String(a.next || '').trim(), '已回覆']]);
  if (a.status && STATUSES.includes(a.status)) updateStatus_(name, a.status);
  return name;
}

/** 按「已上傳截圖」：內容已經用截圖（Claude skill）記好了，這筆只標成已回覆 */
function markScreenshot_(a) {
  const name = String(a.name || '').trim();
  const sheet = ss_().getSheetByName(SHEET_LOG);
  const row = waitingRow_(sheet, a.row, name);
  if (!row) return name; // skill 已經寫好了
  const talk = String(sheet.getRange(row, 3).getValue()).trim();
  sheet.getRange(row, 3).setValue(talk || '已用截圖記錄');
  sheet.getRange(row, 5).setValue('已回覆');
  return name;
}

function updateStatus_(name, status) {
  const sheet = ss_().getSheetByName(SHEET_PEOPLE);
  const names = sheet.getRange(2, COL.name, sheet.getMaxRows() - 1, 1).getValues();
  const i = names.findIndex(r => String(r[0]).trim() === name);
  if (i > -1) sheet.getRange(i + 2, COL.status).setValue(status);
}

/** 每日觸發：寄出今天要回訪的名單 */
function sendDailyReminder() {
  const list = todayList_(readPeople_(), readLog_());
  if (!list.length) return; // 沒人要回訪就不吵你

  const url = PROPS.getProperty('APP_URL'); // GitHub Pages 網址，在指令碼屬性設定
  const rows = list.map(p =>
    '<tr><td style="padding:6px 10px"><b>' + esc_(p.name) + '</b></td>' +
    '<td style="padding:6px 10px">' + esc_(p.identity) + '</td>' +
    '<td style="padding:6px 10px">' + esc_(p.school) + '</td>' +
    '<td style="padding:6px 10px">' + esc_(p.status) + '</td>' +
    '<td style="padding:6px 10px">' + esc_(p.hint) + '</td>' +
    '<td style="padding:6px 10px">' + esc_(p.weekGoal) + '</td></tr>'
  ).join('');

  const html =
    '<p>今天有 <b>' + list.length + '</b> 位要回訪：</p>' +
    '<table border="1" style="border-collapse:collapse;font-size:14px">' +
    '<tr><th>LINE 名稱</th><th>身份</th><th>學校系級</th><th>狀態</th><th>提醒</th><th>本週</th></tr>' + rows + '</table>' +
    (url ? '<p><a href="' + esc_(url) + '">打開回訪小幫手</a>，聊完記得按「已聯絡」。</p>' : '');

  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: '回訪小幫手：今天要回訪 ' + list.length + ' 位',
    htmlBody: html
  });
}

function startOfToday_() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmt_(d) {
  return d instanceof Date ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'M/d') : String(d);
}

function parseDate_(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
