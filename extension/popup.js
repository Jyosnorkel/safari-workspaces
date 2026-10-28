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

button.addEventListener('click', async () => {
  if (opening) return;
  opening = true;
  button.disabled = true;
  status.textContent = 'Opening your workspace manager…';
  try {
    const api = globalThis.browser;
    if (!api?.tabs || !api?.windows || !api?.runtime?.getURL) throw new Error('Open this popup from the enabled Safari extension.');
    const win = await api.windows.getCurrent();
    if (win.incognito) throw new Error('Use a normal Safari window. Private browsing is excluded.');
    if (!Number.isInteger(win.id) || (win.type && win.type !== 'normal')) throw new Error('Open a normal Safari window, then try again.');
    const url = api.runtime.getURL('dashboard.html');
    const existing = (await api.tabs.query({windowId: win.id})).find(tab => Number.isInteger(tab.id) && isDashboard(tab.url, url));
    if (existing) await api.tabs.update(existing.id, {active: true});
    else await api.tabs.create({windowId: win.id, url});
    window.close();
  } catch (error) {
    status.textContent = error.message || 'Could not open the workspace manager. Try again.';
    button.disabled = false;
    opening = false;
  }
});
