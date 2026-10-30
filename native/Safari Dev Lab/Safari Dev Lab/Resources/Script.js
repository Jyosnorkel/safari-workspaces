function show(enabled, useSettingsInsteadOfPreferences) {
    if (useSettingsInsteadOfPreferences) {
        document.getElementsByClassName('state-on')[0].innerText = "Safari Workspaces’ extension is currently on. You can turn it off in the Extensions section of Safari Settings.";
        document.getElementsByClassName('state-off')[0].innerText = "Safari Workspaces’ extension is currently off. You can turn it on in the Extensions section of Safari Settings.";
        document.getElementsByClassName('state-unknown')[0].innerText = "You can turn on Safari Workspaces’ extension in the Extensions section of Safari Settings.";
        document.getElementsByClassName('open-preferences')[0].innerText = "Quit and Open Safari Settings…";
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);

function showStateError() {
    show(undefined, true);
    document.getElementsByClassName('state-unknown')[0].innerText = "Safari couldn’t confirm this extension’s status. Open Safari Settings → Extensions to check Safari Workspaces. If you just rebuilt the app, reload the extension and try again.";
}

function showSettingsError() {
    show(undefined, true);
    document.getElementsByClassName('state-unknown')[0].innerText = "Safari couldn’t open the extension settings. Open Safari Settings → Extensions manually and select Safari Workspaces.";
}
