const button = document.getElementById('open');
const status = document.getElementById('status');
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const api = globalThis.browser;
    if (!api?.tabs) throw new Error('Open this popup from the enabled Safari extension.');
    const win = await api.windows.getCurrent();
    if (win.incognito) throw new Error('Use a normal Safari window. Private browsing is excluded.');
    const url = api.runtime.getURL('dashboard.html');
    const existing = (await api.tabs.query({windowId: win.id})).find(tab => tab.url === url);
    if (existing) await api.tabs.update(existing.id, {active: true});
    else await api.tabs.create({windowId: win.id, url});
    window.close();
  } catch (error) { status.textContent = error.message; button.disabled = false; }
});
