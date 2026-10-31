const button = document.getElementById('open');
const status = document.getElementById('status');
let opening = false;

function isDashboard(candidate, dashboardURL) {
  if (typeof candidate !== 'string') return false;
  try {
    const current = new URL(candidate);
    const expected = new URL(dashboardURL);
    // The dashboard uses hash links such as #saved. Reuse that tab too.
    return current.protocol === expected.protocol && current.host === expected.host && current.pathname === expected.pathname;
  } catch { return false; }
}

function setBusy(value) {
  opening = value;
  for (const id of ['open','save-snapshot','ai-organise','refresh-tabs']) {
    const control = document.getElementById(id);
    if (control) control.disabled = value;
  }
}
async function currentWindow() {
  const api = globalThis.browser;
  if (!api?.windows?.getCurrent || !api?.runtime?.getURL) throw new Error('Open this popup from the enabled Safari extension.');
  const win = await api.windows.getCurrent();
  if (win.incognito) throw new Error('Use a normal Safari window. Private browsing is excluded.');
  if (!Number.isInteger(win.id) || (win.type && win.type !== 'normal')) throw new Error('Open a normal Safari window, then try again.');
  return win;
}
async function send(type, values) {
  const response = await browser.runtime.sendMessage({channel:'workspace',type,...values});
  if (!response?.ok) throw new Error(response?.error || 'Safari could not complete this action. Try refreshing tabs.');
  return response;
}
async function action(work) {
  if (opening) return;
  setBusy(true);
  try { await work(); }
  catch (error) { status.textContent = error.message || 'Could not complete this action. Try again.'; }
  finally { setBusy(false); }
}
async function openManager(ai = false) {
  status.textContent = ai ? 'Opening AI organise. Review the tabs and data sharing before requesting suggestions…' : 'Opening your workspace manager…';
  const win = await currentWindow(), api = globalThis.browser;
  const url = api.runtime.getURL('dashboard.html');
  const existing = (await api.tabs.query({windowId:win.id})).find(tab => Number.isInteger(tab.id) && isDashboard(tab.url,url));
  if (existing) {
    if (ai) {
      let response;
      try { response = await api.runtime.sendMessage({channel:'workspace-dashboard',type:'ai-organise',windowId:win.id}); } catch {}
      if (!response?.ok) { await api.tabs.update(existing.id,{active:true,url:url+'#ai'}); return; }
    }
    await api.tabs.update(existing.id,{active:true});
  } else await api.tabs.create({windowId:win.id,url:url + (ai ? '#ai' : ''),active:true});
  status.textContent = 'Workspace manager opened.';
}
button.addEventListener('click', () => action(() => openManager()));
document.getElementById('ai-organise')?.addEventListener?.('click', () => action(() => openManager(true)));
async function refreshTabs() {
  const win = await currentWindow();
  status.textContent = 'Refreshing tabs…';
  const result = await send('scan',{windowId:win.id});
  const eligible = result.tabs.filter(tab => tab.eligible).length;
  document.getElementById('tab-count').textContent = `${result.tabs.length} tabs · ${eligible} available to organise`;
  document.getElementById('scan-time').textContent = `Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
  // A loaded manager merges fresh metadata without replacing the user's grouping.
  await browser.runtime.sendMessage({channel:'workspace-dashboard',type:'refresh-inventory',windowId:win.id}).catch(() => {});
  status.textContent = 'Tabs refreshed. No data sent to AI.';
}
document.getElementById('refresh-tabs')?.addEventListener?.('click', () => action(refreshTabs));
let snapshotRequestId;
document.getElementById('save-snapshot')?.addEventListener?.('click', () => action(async () => {
  const win = await currentWindow();
  snapshotRequestId ||= crypto.randomUUID();
  status.textContent = 'Saving this window…';
  const {workspace} = await send('snapshot-window',{windowId:win.id,name:`Window ${new Date().toLocaleString()}`.slice(0,80),requestId:snapshotRequestId});
  status.textContent = `Saved ${workspace.tabs.length} tabs. All tabs remain open.`;
  snapshotRequestId = undefined;
}));
// Refresh on popup opening, locally only. The manager refreshes every five minutes.
if (globalThis.browser?.runtime?.sendMessage && document.getElementById('refresh-tabs')?.addEventListener) action(refreshTabs);

// The toolbar popup uses the same durable import/restore operation as the dashboard.
// Safari may dismiss this popup when the new window is focused; the background
// coordinator owns the operation and its recovery journal, not this page.
const dropArea = document.getElementById('backup-drop');
const isFileDrag = transfer => Array.from(transfer?.types || []).includes('Files');
document.body.addEventListener('dragover', event => {
  event.preventDefault();
  const allowed = !opening && isFileDrag(event.dataTransfer);
  dropArea.classList.toggle('is-over', allowed);
  if (event.dataTransfer) event.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
});
document.body.addEventListener('dragleave', event => {
  if (!event.relatedTarget) dropArea.classList.toggle('is-over', false);
});
document.body.addEventListener('drop', async event => {
  event.preventDefault();
  dropArea.classList.toggle('is-over', false);
  if (opening || !isFileDrag(event.dataTransfer)) return;
  setBusy(true);
  try {
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length !== 1) throw new Error('Drop one Safari Workspaces JSON backup at a time.');
    const file = files[0];
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a backup smaller than 10 MB.');
    const api = globalThis.browser;
    if (!api?.windows?.getCurrent || !api?.runtime?.sendMessage) throw new Error('Open this popup from the enabled Safari extension.');
    const win = await api.windows.getCurrent();
    if (win.incognito || !Number.isInteger(win.id) || (win.type && win.type !== 'normal')) throw new Error('Use a normal Safari window. Private browsing is excluded.');
    status.textContent = 'Checking and saving backup, then opening a new window…';
    const json = await file.text();
    const response = await api.runtime.sendMessage({channel:'workspace', type:'drop-backup', json, requestId:crypto.randomUUID(), windowId:win.id});
    if (!response?.ok) throw new Error(response?.error || 'Could not restore this backup. Check Saved workspaces for recovery before trying again.');
    const records = response.workspaces || [];
    const total = records.reduce((count, record) => count + record.tabs.length, 0);
    const opened = records.reduce((count, record) => count + Object.values(record.restore.results).filter(result => result.state === 'opened').length, 0);
    status.textContent = `${opened}/${total} saved URLs opened. Snapshots kept in Saved workspaces.${opened < total ? ' Open the manager to review recovery.' : ''}`;
  } catch (error) {
    status.textContent = error.message || 'Backup could not be restored. Open Saved workspaces to check recovery.';
  } finally {
    setBusy(false);
  }
});
