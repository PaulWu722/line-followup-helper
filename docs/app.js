/**
 * 回訪小幫手（GitHub Pages 畫面）
 * 快的原因：
 *   1. 打開時先用手機上記住的資料（localStorage）畫出來，再到背景向 Apps Script 拿最新的
 *   2. 按按鈕時畫面立刻更新，寫入試算表排隊在背景做，不用等
 *   3. 一次請求就拿回今日待辦、等待回覆、總名單全部資料
 */

// 「傳 LINE」帶入的問候文字，{name} 會換成對方的 LINE 名稱
const GREETING = '嗨 {name}，最近好嗎？';
const REFRESH_AFTER_MS = 30 * 1000; // 切回 App 時，超過這麼久沒更新就重新拿資料

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 無痕模式存不了也沒關係 */ } }
};

let CFG = store.get('cfg');
let DATA = store.get('data');
let pending = 0;        // 還在背景排隊的寫入數
let queue = Promise.resolve();
let lastLoad = 0;
let openReply = null;   // 正在填「已回覆」表單的那個人，背景更新時先不重畫等待回覆，免得打的字不見
let waitDirty = false;

// ---------- 與 Apps Script 溝通 ----------

async function api(action, args) {
  // 不設 Content-Type（預設 text/plain），瀏覽器才不會先送 OPTIONS，Apps Script 不支援
  const res = await fetch(CFG.api, { method: 'POST', body: JSON.stringify({ token: CFG.token, action, args }) });
  const out = await res.json();
  if (out.auth === false) { openSetup(); throw new Error('密碼不對，請重新輸入'); }
  if (!out.ok) throw new Error(out.error || '發生錯誤');
  return out;
}

function setData(d) {
  DATA = d;
  store.set('data', d);
  lastLoad = Date.now();
  renderAll();
}

async function refresh() {
  if (!CFG) return;
  setSync('同步中…');
  try {
    const out = await api('load');
    if (!pending) setData(out.data); // 還有寫入在排隊就等它們回來再用最新的
    setSync('');
  } catch (err) {
    setSync('離線');
    toast(err.message === 'Failed to fetch' ? '連不上試算表，先顯示上次的資料' : err.message);
  }
}

/** 先改畫面，再把寫入排進背景佇列；全部寫完後用試算表回傳的最新資料取代 */
function write(action, args, optimistic, doneMsg) {
  optimistic(DATA);
  store.set('data', DATA);
  renderAll();
  pending++;
  setSync('同步中…');
  queue = queue.then(async () => {
    try {
      const out = await api(action, args);
      pending--;
      if (doneMsg) toast(doneMsg);
      if (!pending) { setData(out.data); setSync(''); }
    } catch (err) {
      pending--;
      toast('沒有存到：' + err.message);
      setSync('離線');
      if (!pending) refresh(); // 還原成試算表上真正的樣子
    }
  });
}

function setSync(text) {
  document.getElementById('sync').textContent = (text || (pending ? '同步中…' : '')) + ' ⚙';
}

// ---------- 畫面 ----------

function renderAll() {
  if (!DATA) return;
  renderToday();
  if (openReply) waitDirty = true; else renderWaiting();
  renderGroups();
  setDefaults();
}

function renderToday() {
  const list = DATA.today;
  const box = document.getElementById('today');
  if (!list.length) { box.innerHTML = '<div class="empty">今天沒有要回訪的人 🎉</div>'; return; }
  box.innerHTML = '<p class="meta">今天要回訪 ' + list.length + ' 位</p>' + list.map((p, i) => `
    <div class="card">
      <div class="row">
        <div>
          <div class="name">${esc(p.name)}</div>
          <div class="meta">${[p.identity, p.school].filter(Boolean).map(esc).join('・')}</div>
        </div>
        ${p.hint ? `<span class="tag ${p.hint.indexOf('逾期') === 0 ? 'late' : ''}">${esc(p.hint)}</span>` : ''}
      </div>
      <div class="meta">${esc(p.status)}${p.weekGoal ? '・本週' + esc(p.weekGoal) : ''}</div>
      ${p.note ? '<div class="meta">📝 ' + esc(p.note) + '</div>' : ''}
      <div class="row" style="margin-top:10px;justify-content:flex-end">
        <button class="btn small line" onclick="openMsg(${i})">傳 LINE</button>
        <button class="btn small" onclick="markContacted(${i})">已聯絡</button>
      </div>
    </div>`).join('');
}

function renderWaiting() {
  const list = DATA.waiting;
  waitDirty = false;
  const box = document.getElementById('wait');
  document.getElementById('tab-wait').textContent = '等待回覆中' + (list.length ? ' ' + list.length : '');
  if (!list.length) { box.innerHTML = '<div class="empty">目前沒有在等誰回覆</div>'; return; }
  box.innerHTML = '<p class="meta">等待 ' + list.length + ' 位回覆</p>' + list.map((w, i) => `
    <div class="card">
      <div class="row">
        <div class="name">${esc(w.name)}</div>
        <span class="tag">${esc(w.date)} 聯絡</span>
      </div>
      <div class="meta">${esc(w.status)}</div>
      <div class="row" style="margin-top:10px;justify-content:flex-end">
        <button class="btn small gray" onclick="noReaction(${i})">沒反應</button>
        <button class="btn small" onclick="toggleReply(${i})">已回覆</button>
      </div>
      <form class="log" id="reply-${i}" onsubmit="submitReply(event, ${i})">
        <label>聊了什麼</label><textarea name="talk" required></textarea>
        <label>下次要提的事</label><textarea name="next"></textarea>
        <label>更新狀態</label><select name="status">${options(DATA.options.statuses, w.status)}</select>
        <button class="btn" type="submit">儲存聯絡紀錄</button>
        <button class="btn gray" type="button" onclick="markScreenshot(${i})">已上傳截圖</button>
      </form>
    </div>`).join('');
}

function renderGroups() {
  const groups = DATA.groups;
  const col = (g, list) => `
    <div class="group">
      <h3>${esc(g)}（${list.length}）</h3>
      ${list.map(p => `<div class="person" title="${esc(p.status)}"><span>${esc(p.name)}</span>` +
        `<span class="count ${p.count ? '' : 'zero'}">${p.count}</span></div>`).join('') || '<div class="meta" style="text-align:center">—</div>'}
    </div>`;
  const main = DATA.options.identities.map(g => col(g, groups[g] || [])).join('');
  const other = (groups['未分類'] || []).length
    ? '<p class="meta" style="margin-top:16px">還沒選身份的人</p><div class="groups" style="grid-template-columns:1fr">' + col('未分類', groups['未分類']) + '</div>' : '';
  document.getElementById('all').innerHTML =
    '<p class="meta">數字是聯絡次數，多的在上面；紅色 0 是還沒聯絡過</p><div class="groups">' + main + '</div>' + other;
}

function show(id) {
  ['today', 'wait', 'all'].forEach(s => {
    document.getElementById(s).style.display = s === id ? '' : 'none';
    document.getElementById('tab-' + s).classList.toggle('on', s === id);
  });
}

// ---------- 按鈕動作（都是先改畫面再背景寫入） ----------

function markContacted(i) {
  const p = DATA.today[i];
  write('logContact', { name: p.name }, d => {
    d.today.splice(i, 1);
    d.waiting.push({ row: 0, name: p.name, date: shortDate(new Date()), status: p.status });
    bumpCount(d, p.name);
  }, p.name + ' 已移到等待回覆中');
}

function toggleReply(i) {
  const f = document.getElementById('reply-' + i);
  const open = f.style.display !== 'block';
  f.style.display = open ? 'block' : 'none';
  openReply = open ? DATA.waiting[i].name : null;
  if (!open && waitDirty) renderWaiting();
}

function submitReply(e, i) {
  e.preventDefault();
  const w = DATA.waiting[i], f = formData(e.target);
  openReply = null;
  write('markReply', { row: w.row, name: w.name, replied: true, talk: f.talk, next: f.next, status: f.status }, d => {
    d.waiting.splice(i, 1);
    setStatus(d, w.name, f.status);
  }, '已記下和 ' + w.name + ' 聊的內容');
}

function markScreenshot(i) {
  const w = DATA.waiting[i];
  openReply = null;
  write('markScreenshot', { row: w.row, name: w.name }, d => d.waiting.splice(i, 1), w.name + '：已用截圖記錄');
}

function noReaction(i) {
  const w = DATA.waiting[i];
  openReply = null;
  write('markReply', { row: w.row, name: w.name, replied: false }, d => d.waiting.splice(i, 1), w.name + '：暫時沒有反應');
}

function submitPerson(e) {
  e.preventDefault();
  const form = e.target, p = formData(form);
  p.name = p.name.trim();
  if (allNames().includes(p.name)) { toast('名單裡已經有「' + p.name + '」了，同名請加註記'); return; }
  form.reset();
  closeAdd();
  write('addPerson', p, d => {
    const g = d.options.identities.includes(p.identity) ? p.identity : '未分類';
    (d.groups[g] = d.groups[g] || []).push({ name: p.name, status: p.status, count: 0 });
    d.today.push({ name: p.name, identity: p.identity, status: p.status, hint: '', weekGoal: '',
                   school: [p.school, p.dept].filter(Boolean).join(' '), note: p.note, lastNext: '', lastDate: '' });
  }, '已加入 ' + p.name);
}

function bumpCount(d, name) {
  Object.values(d.groups).forEach(list => list.forEach(p => { if (p.name === name) p.count++; }));
}

function setStatus(d, name, status) {
  if (!status) return;
  Object.values(d.groups).forEach(list => list.forEach(p => { if (p.name === name) p.status = status; }));
  d.waiting.forEach(w => { if (w.name === name) w.status = status; });
  d.today.forEach(t => { if (t.name === name) t.status = status; });
}

function allNames() {
  return DATA ? Object.values(DATA.groups).flat().map(p => p.name) : [];
}

// ---------- 傳 LINE ----------

// 個人 LINE 不能由程式代發：先跳出輸入框寫好訊息，再打開 LINE 帶入文字，你選對方按送出
function openMsg(i) {
  const p = DATA.today[i];
  document.getElementById('msgTitle').textContent = '傳 LINE 給 ' + p.name;
  const hint = document.getElementById('msgHint');
  hint.style.display = p.lastNext ? 'block' : 'none';
  hint.innerHTML = '<b>上次的建議' + (p.lastDate ? '（' + esc(p.lastDate) + '）' : '') + '</b>' + esc(p.lastNext);
  document.getElementById('msgText').value = GREETING.replace('{name}', p.name);
  openSheet('msg');
  document.getElementById('msgText').focus();
}

function closeMsg() { closeSheet('msg'); }

function sendLine(e) {
  e.preventDefault();
  const text = document.getElementById('msgText').value.trim();
  if (!text) { toast('請先寫訊息'); return; }
  window.open('https://line.me/R/share?text=' + encodeURIComponent(text), '_blank');
  closeMsg();
}

// ---------- 設定 ----------

function openSetup() {
  document.getElementById('cfgApi').value = CFG ? CFG.api : '';
  document.getElementById('cfgToken').value = CFG ? CFG.token : '';
  document.getElementById('setupClose').style.display = CFG ? '' : 'none';
  openSheet('setup');
}

function closeSetup() { closeSheet('setup'); }

function saveSetup(e) {
  e.preventDefault();
  const f = formData(e.target);
  CFG = { api: f.api.trim(), token: f.token.trim() };
  store.set('cfg', CFG);
  closeSetup();
  refresh();
}

// ---------- 小工具 ----------

function openAdd() { openSheet('add'); }
function closeAdd() { closeSheet('add'); }

function openSheet(id) {
  document.getElementById(id).style.display = 'block';
  document.getElementById('fab').style.display = 'none';
}

function closeSheet(id) {
  document.getElementById(id).style.display = 'none';
  document.getElementById('fab').style.display = '';
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.style.display = 'none', 2500);
}

function esc(s) {
  const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML;
}

function options(list, selected) {
  return list.map(s => '<option' + (s === selected ? ' selected' : '') + '>' + esc(s) + '</option>').join('');
}

function formData(form) {
  const o = {}; new FormData(form).forEach((v, k) => o[k] = v); return o;
}

function shortDate(d) {
  return (d.getMonth() + 1) + '/' + d.getDate();
}

let defaultsSet = false;
function setDefaults() {
  if (defaultsSet || !DATA) return;
  defaultsSet = true;
  const d = new Date();
  document.getElementById('metDate').value =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  document.getElementById('statusSelect').innerHTML = options(DATA.options.statuses, '有回覆');
  document.getElementById('identitySelect').innerHTML = options(DATA.options.identities, '福音朋友');
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !pending && Date.now() - lastLoad > REFRESH_AFTER_MS) refresh();
});

// 開始：先畫手機上記住的資料，再背景拿最新的
if (DATA) renderAll();
setSync('');
if (CFG) refresh(); else openSetup();
