const $ = s => document.querySelector(s);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const configured = window.PORTAL_CONFIG?.apiBase || '';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const apiBase = configured || (local ? location.origin : '');
const demo = !apiBase;
let step = 0, order, accessToken = '', adminToken = '', busy = false;
const input = { deviceName: '', udid: '', consent: false };
const stateNames = { draft: '尚未提交', pending: '等待人工審核', approved: '審核通過', rejected: '未通過審核' };
const profileNames = { none: '尚未建立', mock: '模擬完成（無真實描述檔）', ready: '描述檔已備妥' };
if (!demo) $('#mode-banner').textContent = '後端模式 · 付款未接入金流；Apple 是否為 mock 以申請進度顯示為準。重新整理將清除本頁存取憑據。';
async function api(path, { method = 'GET', body, token = accessToken } = {}) {
  if (demo) throw Error('公開網站目前為離線示範，管理功能需要獨立後端。');
  const url = new URL(apiBase);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('正式後端必須使用 HTTPS');
  const response = await fetch(`${apiBase}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw Error(data.error || '服務暫時無法使用'); }
  return response.json();
}
function showError(e, target = '#flow') {
  $(target).querySelector('.error')?.remove();
  const el = document.createElement('p'); el.className = 'error'; el.setAttribute('role', 'alert'); el.textContent = e.message || '發生錯誤，請稍後再試'; $(target).append(el);
}
async function run(fn, target) {
  if (busy) return; busy = true;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await fn(); } catch (e) { showError(e, target); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
function details() {
  return `<dl class="summary-list"><div><dt>測試項目</dt><dd>iOS Ad Hoc 裝置申請</dd></div><div><dt>裝置名稱</dt><dd>${escapeHtml(order.deviceName)}</dd></div><div><dt>UDID（部分隱藏）</dt><dd>${escapeHtml(order.udid)}</dd></div><div><dt>示範金額</dt><dd>NT$ 0 <span class="badge">無收費</span></dd></div><div><dt>付款狀態</dt><dd>未驗證</dd></div></dl>`;
}
function render() {
  document.querySelectorAll('[data-step]').forEach(e => { const active = Number(e.dataset.step) === step; e.classList.toggle('active', active); if (active) e.setAttribute('aria-current', 'step'); else e.removeAttribute('aria-current'); });
  if (step === 0) {
    $('#flow').innerHTML = `<span class="eyebrow">STEP 01 / DEVICE INFORMATION</span><h2>先認識你的測試裝置</h2><p class="sub">填寫裝置資訊，建立一筆測試申請。</p><form id="device-form"><label for="device-name">裝置名稱</label><input id="device-name" maxlength="60" required placeholder="例如：小島的 iPhone" value="${escapeHtml(input.deviceName)}"><div class="label-row"><label for="udid">裝置 UDID</label><button class="text-btn" id="sample" type="button">填入示範資料 ↗</button></div><input id="udid" required maxlength="40" spellcheck="false" autocomplete="off" placeholder="00008110-001234567890001E" value="${escapeHtml(input.udid)}"><p class="hint">支援 40 碼十六進位或 8 碼－16 碼 UDID 格式。</p><label class="checkbox"><input id="consent" type="checkbox" required ${input.consent ? 'checked' : ''}><span>我確認這是獲授權的測試裝置，並了解此服務僅供開發測試用途。</span></label><div class="actions"><small>01 / 共 4 個步驟</small><button type="submit">繼續，查看訂單 <span aria-hidden="true">→</span></button></div></form>`;
    $('#sample').onclick = () => { $('#device-name').value = 'Demo iPhone'; $('#udid').value = '00008110-001234567890001E'; };
    $('#device-form').onsubmit = e => { e.preventDefault(); run(async () => {
      input.deviceName = $('#device-name').value.trim(); input.udid = $('#udid').value.trim(); input.consent = $('#consent').checked;
      if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{8}-[a-fA-F0-9]{16})$/.test(input.udid)) throw Error('UDID 格式不正確，請檢查長度與字元。');
      if (demo) order = { id: crypto.randomUUID(), deviceName: input.deviceName, udid: `${input.udid.slice(0, 8)}…${input.udid.slice(-4)}`, paymentStatus: 'unverified', reviewStatus: 'draft', profileStatus: 'none', downloadAuthorized: false, appleMode: 'mock' };
      else { const r = await api('/api/orders', { method: 'POST', body: input, token: '' }); order = r.order; accessToken = r.accessToken; }
      step = 1; render();
    }); };
  } else if (step === 1) {
    $('#flow').innerHTML = `<span class="eyebrow">STEP 02 / ORDER OVERVIEW</span><h2>確認這次測試申請</h2><p class="sub">請確認裝置資訊。此訂單為零元流程示範。</p>${details()}<div class="actions"><button class="secondary" id="back">返回修改</button><button id="next">前往付款示範 →</button></div>`;
    $('#back').onclick = () => { step = 0; render(); }; $('#next').onclick = () => { step = 2; render(); };
  } else if (step === 2) {
    $('#flow').innerHTML = `<span class="eyebrow">STEP 03 / PAYMENT DEMO</span><h2>付款頁面 · 流程示範</h2><p class="sub">無需轉帳，也不需要提供任何信用卡資訊。</p>${details()}<div class="callout">按下「我已付款」會直接進入待審核流程。這是示範跳轉，不代表真實付款完成，也不會自動註冊裝置或核發憑證。</div><div class="actions"><button class="secondary" id="back">返回訂單</button><button id="skip">我已付款</button></div>`;
    $('#back').onclick = () => { step = 1; render(); };
    $('#skip').onclick = () => run(async () => {
      if (demo) { order.reviewStatus = 'pending'; } else order = await api(`/api/orders/${order.id}/demo-skip`, { method: 'POST', body: {} });
      step = 3; render();
    });
  } else {
    const ready = order.downloadAuthorized && order.profileStatus === 'ready' && order.reviewStatus === 'approved';
    $('#flow').innerHTML = `<div class="status-icon">✓</div><span class="eyebrow">STEP 04 / APPLICATION STATUS</span><h2>${escapeHtml(stateNames[order.reviewStatus])}</h2><p class="sub">付款狀態：未驗證 · Apple：${escapeHtml(order.appleMode)}</p><p class="status-id">申請編號 ${escapeHtml(order.id)}</p><ol class="timeline"><li>裝置資訊已提交<small>${escapeHtml(order.deviceName)} · ${escapeHtml(order.udid)}</small></li><li>${escapeHtml(stateNames[order.reviewStatus])}<small>${escapeHtml(order.reviewReason || '管理員將確認測試資格，不因示範按鈕而自動通過。')}</small></li><li>${escapeHtml(profileNames[order.profileStatus])}<small>${order.downloadAuthorized ? '下載已另行授權' : '待完成註冊、描述檔處理及下載授權'}</small></li></ol><div class="callout">${demo ? '此公開示範不會建立真實後端申請。重新整理後資料即清除。' : '請保持此頁開啟。重新整理會失去存取憑據；正式系統應擴充帳號登入與申請復原流程。'}</div><div class="actions"><button class="secondary" id="refresh">更新進度</button>${ready ? '<button id="download">下載授權描述檔</button>' : '<small>尚無可下載的授權描述檔</small>'}</div>`;
    $('#refresh').onclick = () => run(async () => { if (!demo) order = await api(`/api/orders/${order.id}`); render(); });
    if (ready) $('#download').onclick = () => run(async () => {
      const response = await fetch(`${apiBase}/api/orders/${order.id}/download`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw Error('尚未獲授權，或描述檔已過期');
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = 'AdHoc.mobileprovision'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
}
async function loadAdmin() {
  const orders = await api('/api/admin/orders', { token: adminToken });
  $('#admin-results').innerHTML = orders.length ? '' : '<p>目前沒有申請。</p>';
  for (const o of orders) {
    const article = document.createElement('article');
    article.innerHTML = `<strong>${escapeHtml(o.deviceName)}</strong><p>${escapeHtml(o.id)}<br>${escapeHtml(o.udid)} · ${escapeHtml(stateNames[o.reviewStatus])}<br>付款：未驗證 · Apple：${escapeHtml(o.appleMode)} · ${escapeHtml(profileNames[o.profileStatus])}<br>下載授權：${o.downloadAuthorized ? '是' : '否'}</p><label>審核理由<input class="reason" maxlength="500" placeholder="請記錄測試授權依據" value="${escapeHtml(o.reviewReason || '')}"></label><div class="admin-actions"><button data-action="approve">通過審核</button><button data-action="reject" class="secondary">拒絕</button><button data-action="register">註冊裝置</button><button data-action="profile">建立描述檔</button><button data-action="authorize-download">授權下載</button><button data-action="revoke" class="secondary">撤回下載</button><button data-action="audit" class="secondary">查看稽核</button></div><div class="audit"></div>`;
    article.querySelectorAll('button').forEach(button => button.onclick = () => run(async () => {
      const action = button.dataset.action;
      if (action === 'audit') { const records = await api(`/api/admin/orders/${o.id}/audit`, { token: adminToken }); article.querySelector('.audit').textContent = records.map(x => `${x.at} ${x.action}`).join(' / '); return; }
      let route = action, body = {};
      if (action === 'approve' || action === 'reject') { route = 'review'; body = { decision: action === 'approve' ? 'approved' : 'rejected', reason: article.querySelector('.reason').value }; }
      if (action === 'authorize-download' || action === 'revoke') { route = 'authorize-download'; body = { authorized: action !== 'revoke' }; }
      await api(`/api/admin/orders/${o.id}/${route}`, { method: 'POST', body, token: adminToken }); await loadAdmin();
    }, '#admin-results'));
    $('#admin-results').append(article);
  }
}
$('#admin-login').onsubmit = e => { e.preventDefault(); adminToken = $('#admin-token').value; $('#admin-token').value = ''; run(loadAdmin, '#admin-results'); };
$('#admin-logout').onclick = () => { adminToken = ''; $('#admin-token').value = ''; $('#admin-results').textContent = '已登出'; };
render();
