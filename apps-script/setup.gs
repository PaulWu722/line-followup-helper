/**
 * 建立一份空白的「客戶回訪表」。
 *
 * 用法：到 script.google.com 新增專案，貼上這個檔案，執行 setup()。
 * 第一次執行會要求授權。完成後在「執行記錄」會看到新試算表的連結。
 */

const HEADER_BG = '#1f3864';
const HEADER_FG = '#ffffff';
const AUTO_BG = '#efefef';     // 自動計算欄位
const OVERDUE_BG = '#f4cccc';  // 逾期
const TODAY_BG = '#fff2cc';    // 今天要聯絡
const PAUSED_BG = '#d9d9d9';   // 暫停
const SETTING_BG = '#ffff00';  // 可以改的設定值

const ROLES = ['福音朋友', '小羊', '家內', '聖徒'];
const STATUSES = ['不回訊息', '有回覆', '好聊天', '可約出來', '牧養中', '成全中', '暫停'];

function setup() {
  const ss = SpreadsheetApp.create('客戶回訪表');

  const settings = ss.getSheets()[0].setName('設定');
  const todo = ss.insertSheet('今日待辦', 0);
  const clients = ss.insertSheet('客戶名單', 1);
  const log = ss.insertSheet('聯絡紀錄', 2);

  buildSettings(settings);
  buildClients(clients);
  buildLog(log);
  buildTodo(todo);

  ss.setActiveSheet(todo);
  Logger.log('客戶回訪表：' + ss.getUrl());
}

function writeHeader(sheet, headers, widths) {
  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setBackground(HEADER_BG)
    .setFontColor(HEADER_FG)
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

function rowRule(sheet, formula, color, numCols) {
  return SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground(color)
    .setRanges([sheet.getRange(2, 1, sheet.getMaxRows() - 1, numCols)])
    .build();
}

function buildSettings(sheet) {
  writeHeader(sheet, ['項目', '數值', '說明'], [160, 70, 360]);
  sheet.getRange('A2:C3').setValues([
    ['回訪間隔（天）', 3, '上次聯絡後幾天要再回訪。3 天大約等於一週 2 次'],
    ['每週目標次數', 2, '每位客戶每週（週一到週日）至少回訪幾次'],
  ]);
  sheet.getRange('B2:B3').setBackground(SETTING_BG);

  sheet.getRange('A5:A11').setValues([
    ['使用方式'],
    ['1. 在「客戶名單」新增客戶，填 LINE 名稱、身份、狀態。灰底欄位會自動計算，不用填。'],
    ['2. 每次在 LINE 和客戶聊完，到「聯絡紀錄」加一列：日期、LINE 名稱（用下拉選單）、聊了什麼。'],
    ['3. 每天早上打開「今日待辦」，會列出今天該聯絡和已經逾期的客戶。'],
    ['4. 關係有進展時，記得更新客戶的狀態。暫時不追的人，狀態設成「暫停」。'],
    ['5. 想改回訪頻率，只要改上面黃色格子的數字。'],
    ['顏色：紅色列是逾期，黃色列是今天要聯絡，灰色列是暫停。'],
  ]);
  sheet.getRange('A5').setFontWeight('bold');
}

function buildClients(sheet) {
  writeHeader(
    sheet,
    ['LINE 名稱', '身份', '狀態', '上次聯絡日', '下次回訪日', '提醒', '本週已回訪', '本週目標', '備註', '學校', '系級', '認識時間'],
    [140, 120, 90, 110, 110, 110, 110, 110, 280, 100, 100, 100]
  );

  const rows = sheet.getMaxRows() - 1;
  sheet.getRange(2, 2, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ROLES, true).setAllowInvalid(false).build()
  );
  sheet.getRange(2, 3, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build()
  );

  sheet.getRange(2, 4, rows, 5).setBackground(AUTO_BG);
  sheet.getRange('D2:H2').setFormulas([[
    // 上次聯絡日：聯絡紀錄裡這個人最新的日期
    "=MAP(A2:A,LAMBDA(n,IF(n=\"\",\"\",LET(d,MAXIFS('聯絡紀錄'!A:A,'聯絡紀錄'!B:B,n),IF(d=0,\"\",d)))))",
    // 下次回訪日：上次聯絡日 + 回訪間隔；沒聯絡過就是今天
    "=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF(D2:D=\"\",TODAY(),D2:D+'設定'!B2)))",
    // 提醒
    "=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF(C2:C=\"暫停\",\"暫停\",IF(E2:E<TODAY(),\"逾期 \"&(TODAY()-E2:E)&\" 天\",IF(E2:E=TODAY(),\"今天聯絡\",\"還有 \"&(E2:E-TODAY())&\" 天\")))))",
    // 本週已回訪：從本週一開始算
    "=ARRAYFORMULA(IF(A2:A=\"\",\"\",COUNTIFS('聯絡紀錄'!B:B,A2:A,'聯絡紀錄'!A:A,\">=\"&(TODAY()-WEEKDAY(TODAY(),2)+1))))",
    // 本週目標
    "=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF(G2:G>='設定'!B3,\"已達成\",\"還差 \"&('設定'!B3-G2:G)&\" 次\")))",
  ]]);
  sheet.getRange(2, 4, rows, 2).setNumberFormat('yyyy/mm/dd');
  sheet.getRange(2, 12, rows, 1).setNumberFormat('yyyy/mm/dd');

  sheet.setConditionalFormatRules([
    rowRule(sheet, '=AND($A2<>"",$C2="暫停")', PAUSED_BG, 9),
    rowRule(sheet, '=AND($A2<>"",$C2<>"暫停",$E2<TODAY())', OVERDUE_BG, 9),
    rowRule(sheet, '=AND($A2<>"",$C2<>"暫停",$E2=TODAY())', TODAY_BG, 9),
  ]);
}

function buildLog(sheet) {
  writeHeader(sheet, ['日期', 'LINE 名稱', '聊了什麼', '下次要提的事', '回覆狀態'], [110, 140, 280, 280, 100]);

  const rows = sheet.getMaxRows() - 1;
  sheet.getRange(2, 1, rows, 1)
    .setNumberFormat('yyyy/mm/dd')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().build());
  sheet.getRange(2, 2, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(sheet.getParent().getRange("'客戶名單'!$A$2:$A"), true)
      .build()
  );
  sheet.getRange(2, 3, rows, 2).setWrap(true);
}

function buildTodo(sheet) {
  writeHeader(sheet, ['LINE 名稱', '身份', '下次回訪日', '提醒', '本週已回訪', '本週目標'], [120, 120, 120, 120, 120, 120]);

  sheet.getRange('A2').setFormula(
    "=IFERROR(SORT(FILTER({'客戶名單'!A2:B,'客戶名單'!E2:H},'客戶名單'!A2:A<>\"\",'客戶名單'!C2:C<>\"暫停\",'客戶名單'!E2:E<=TODAY()),3,TRUE),\"今天沒有要回訪的客戶\")"
  );
  sheet.getRange(2, 3, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy/mm/dd');

  sheet.setConditionalFormatRules([
    rowRule(sheet, '=AND(ISNUMBER($C2),$C2<TODAY())', OVERDUE_BG, 6),
  ]);
}
