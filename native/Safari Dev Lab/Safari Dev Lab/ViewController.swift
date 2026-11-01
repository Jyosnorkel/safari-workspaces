import Cocoa
import SafariServices
import Security

let extensionBundleIdentifier = "com.local.safaridevlab.Extension"

private class SetupDocumentView: NSView {
    override var isFlipped: Bool { true }
}

// All credentials remain in native memory/Keychain; no key crosses a web view.
class ViewController: NSViewController {
    private let keyField = NSSecureTextField()
    private let enabled = NSButton(checkboxWithTitle: "Enable Meta AI on this Mac", target: nil, action: nil)
    private let status = NSTextField(wrappingLabelWithString: "AI is off. Manual groups and backups work without AI.")
    private let safariStatus = NSTextField(wrappingLabelWithString: "Checking Safari extension…")
    private let start = NSButton(title: "Save & start AI", target: nil, action: nil)
    private let stop = NSButton(title: "Stop AI", target: nil, action: nil)
    private let copy = NSButton(title: "Copy connection token", target: nil, action: nil)
    private var process: Process?
    private var childInput: FileHandle?
    private var token: String?
    private var output = Data()
    private var timeout: Timer?
    private let service = "com.local.safaridevlab.meta-api"
    private let account = "META_API_KEY"

    override func viewDidLoad() {
        super.viewDidLoad()
        preferredContentSize = NSSize(width: 620, height: 680)
        view.subviews.forEach { $0.removeFromSuperview() }
        let title = NSTextField(labelWithString: "Safari Workspaces")
        title.font = .systemFont(ofSize: 28, weight: .bold)
        let subtitle = label("Keep useful tabs together. Save a window, then return to it later.")
        let safariHeading = heading("1. Turn on the Safari extension")
        let settings = NSButton(title: "Open Safari Extensions Settings…", target: self, action: #selector(openSettings))
        let refresh = NSButton(title: "Check again", target: self, action: #selector(checkSafari))
        let safariButtons = NSStackView(views: [settings, refresh])
        safariButtons.spacing = 10
        let safariHelp = label("Enable Safari Workspaces, then use its toolbar button. Your current windows and tabs stay open.")
        let aiHeading = heading("2. Set up AI suggestions (optional)")
        let privacy = label("Enter your own Meta API key below. It is stored in macOS Keychain, never in the extension. Each suggestion still asks before sharing selected tab titles and sanitized URLs. Titles and paths can be sensitive. Your provider account may incur charges.")
        keyField.placeholderString = "Meta API key — leave blank to keep the saved key"
        keyField.setAccessibilityLabel("Meta API key")
        enabled.state = UserDefaults.standard.bool(forKey: "desktopAIEnabled") ? .on : .off
        enabled.target = self; enabled.action = #selector(toggleEnabled)
        let limits = label("Limits: one request at a time, two outbound attempts per minute, twenty per UTC day. A suggestion normally uses two attempts. No automatic inference or retries.")
        start.target = self; start.action = #selector(saveAndStart)
        stop.target = self; stop.action = #selector(stopAI)
        copy.target = self; copy.action = #selector(copyToken)
        stop.isEnabled = false; copy.isEnabled = false
        let actions = NSStackView(views: [start, stop, copy]); actions.spacing = 10
        let pairHelp = label("Once AI is ready: copy the connection token, open AI organise in Safari, and paste it into Local AI connection. This is a separate local token, not your Meta API key. Keep this app running for AI; closing this window keeps it available. Quitting stops only the AI service started by this app.")
        let forget = NSButton(title: "Remove saved API key…", target: self, action: #selector(forgetKey))
        let stack = NSStackView(views: [title, subtitle, safariHeading, safariStatus, safariButtons, safariHelp, aiHeading, privacy, keyField, enabled, limits, actions, status, pairHelp, forget])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true; scroll.autohidesScrollers = true
        scroll.drawsBackground = false; scroll.translatesAutoresizingMaskIntoConstraints = false
        let document = SetupDocumentView(); document.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = document; document.addSubview(stack); view.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: view.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            stack.leadingAnchor.constraint(equalTo: document.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: document.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: document.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: document.bottomAnchor, constant: -24),
            keyField.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(willQuit), name: NSApplication.willTerminateNotification, object: nil)
        checkSafari()
        if enabled.state == .on { startSavedService() }
    }
    override func viewDidAppear() {
        super.viewDidAppear()
        view.window?.title = "Safari Workspaces"
        view.window?.setContentSize(preferredContentSize)
    }
    private func label(_ text: String) -> NSTextField { NSTextField(wrappingLabelWithString: text) }
    private func heading(_ text: String) -> NSTextField {
        let field = label(text); field.font = .systemFont(ofSize: 17, weight: .semibold); return field
    }
    @objc private func checkSafari() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { [weak self] state, _ in
            DispatchQueue.main.async {
                self?.safariStatus.stringValue = state.map { $0.isEnabled ? "✓ Safari Workspaces is enabled." : "Safari Workspaces is off. Enable it in Safari Settings → Extensions." } ?? "Safari could not confirm extension status. Check Safari Settings → Extensions."
            }
        }
    }
    @objc private func openSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { [weak self] error in
            DispatchQueue.main.async {
                if error != nil { self?.safariStatus.stringValue = "Open Safari Settings → Extensions manually and select Safari Workspaces." }
                else { self?.checkSafari() }
            }
        }
    }
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
    private func savedKey() -> String? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    private func storeKey(_ key: String) -> Bool {
        let data = Data(key.utf8)
        let result = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if result == errSecItemNotFound {
            var q = query; q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
        }
        return result == errSecSuccess
    }
    @objc private func saveAndStart() {
        guard process == nil else { return }
        guard enabled.state == .on else {
            UserDefaults.standard.set(false, forKey: "desktopAIEnabled")
            status.stringValue = "AI is off. Turn on Enable Meta AI to start it."; return
        }
        let entered = keyField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if !entered.isEmpty {
            guard entered.utf8.count <= 8192, !entered.contains("\n"), !entered.contains("\r"), storeKey(entered) else {
                status.stringValue = "Could not save the API key in Keychain. Check access and try again."; return
            }
            keyField.stringValue = ""
        }
        UserDefaults.standard.set(true, forKey: "desktopAIEnabled")
        startSavedService()
    }
    private func startSavedService() {
        guard process == nil else { return }
        guard let key = savedKey(), !key.isEmpty else { status.stringValue = "Enter your Meta API key and choose Save & start AI. Keychain may need to be unlocked."; return }
        guard let resources = Bundle.main.resourceURL else { return }
        let base = resources.appendingPathComponent("AIService")
        let executable = base.appendingPathComponent("runtime/node")
        let script = base.appendingPathComponent("server/start-desktop.mjs")
        guard FileManager.default.isExecutableFile(atPath: executable.path), FileManager.default.fileExists(atPath: script.path) else {
            status.stringValue = "This build does not include its AI runtime. Install a complete release build; manual groups and backups are available."; return
        }
        let child = Process(), input = Pipe(), stdout = Pipe()
        child.executableURL = executable; child.arguments = [script.path]
        // Do not inherit provider credentials, alternate budgets or Node injection flags.
        child.environment = ["HOME": NSHomeDirectory(), "PATH": "/usr/bin:/bin", "TMPDIR": NSTemporaryDirectory()]
        child.standardInput = input; child.standardOutput = stdout; child.standardError = FileHandle.nullDevice
        output = Data(); token = nil; copy.isEnabled = false
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async { self?.receive(data, child: child) }
        }
        child.terminationHandler = { [weak self] _ in
            stdout.fileHandleForReading.readabilityHandler = nil
            DispatchQueue.main.async {
                guard let self = self, self.process === child else { return }
                self.timeout?.invalidate(); try? self.childInput?.close(); self.childInput = nil; self.process = nil; self.token = nil
                self.start.isEnabled = true; self.stop.isEnabled = false; self.copy.isEnabled = false
                self.status.stringValue = "AI service stopped. If another service already uses port 8788, stop that service yourself before starting here. Your usage and pairing files are preserved."
            }
        }
        do {
            try child.run(); process = child
            let config: [String: Any] = ["apiKey": key, "liveEnabled": true]
            let data = try JSONSerialization.data(withJSONObject: config)
            try input.fileHandleForWriting.write(contentsOf: data + Data([10]))
            childInput = input.fileHandleForWriting
            status.stringValue = "Starting local AI…"; start.isEnabled = false; stop.isEnabled = true
            timeout = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { [weak self] _ in
                guard let self = self, self.process === child, self.token == nil else { return }
                child.terminate()
            }
        } catch {
            stdout.fileHandleForReading.readabilityHandler = nil
            if child.isRunning { child.terminate() }
            process = nil; status.stringValue = "Could not start local AI. Reinstall a complete release or check macOS permission prompts."
        }
    }
    private func receive(_ data: Data, child: Process) {
        guard process === child else { return }
        output.append(data)
        guard output.count <= 16384 else { child.terminate(); return }
        while let newline = output.firstIndex(of: 10) {
            let line = output.prefix(upTo: newline); output.removeSubrange(...newline)
            guard let value = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any], value["type"] as? String == "ready", let valueToken = value["token"] as? String,
                  valueToken.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { continue }
            timeout?.invalidate(); token = valueToken; copy.isEnabled = true
            status.stringValue = "✓ Local AI is running. Connect in Safari with the connection token. No Meta request has been made."
        }
    }
    @objc private func copyToken() {
        guard let token = token else { return }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(token, forType: .string)
        status.stringValue = "Connection token copied. Paste it into Safari’s Local AI connection field. Keep it private."
    }
    @objc private func toggleEnabled() {
        if enabled.state == .off { stopAI() }
        else { status.stringValue = "Choose Save & start AI to enable local AI. No data is sent automatically." }
    }
    @objc private func stopAI() {
        UserDefaults.standard.set(false, forKey: "desktopAIEnabled"); enabled.state = .off
        timeout?.invalidate(); copy.isEnabled = false; token = nil
        try? childInput?.close(); childInput = nil
        if let child = process, child.isRunning { child.terminate() }
        else { status.stringValue = "AI is off. Manual groups and backups remain available." }
    }
    @objc private func willQuit() {
        timeout?.invalidate()
        try? childInput?.close(); childInput = nil
        if let child = process, child.isRunning { child.terminate() }
    }
    @objc private func forgetKey() {
        let alert = NSAlert(); alert.messageText = "Remove your saved Meta API key?"
        alert.informativeText = "This stops this app’s local AI service. Your workspaces, pairing and usage history stay saved."
        alert.addButton(withTitle: "Remove key"); alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let result = SecItemDelete(query as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { status.stringValue = "Could not remove the key. Check Keychain access and try again."; return }
        keyField.stringValue = ""; stopAI()
    }
}
