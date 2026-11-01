import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        var result: [String: Any] = ["ok": false]
        // Never log backup contents, titles, URLs or incoming native messages.
        if let message = request?.userInfo?["message"] as? [String: Any],
           message["action"] as? String == "export-backup",
           let json = message["json"] as? String,
           let data = json.data(using: .utf8), data.count <= 10 * 1024 * 1024 {
            do {
                guard let backup = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      backup["format"] as? String == "safari-workspaces-backup",
                      backup["version"] as? Int == 1,
                      let workspaces = backup["workspaces"] as? [[String: Any]], !workspaces.isEmpty,
                      let directory = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
                else { throw NSError(domain: "TabbyExport", code: 1) }
                let filename = "tabby-snapshot-\(UUID().uuidString.lowercased()).json"
                let destination = directory.appendingPathComponent(filename, isDirectory: false)
                try data.write(to: destination, options: [.withoutOverwriting])
                guard try Data(contentsOf: destination) == data else { throw NSError(domain: "TabbyExport", code: 2) }
                result = ["ok": true, "filename": filename]
            } catch {
                result = ["ok": false, "error": "Could not save JSON to Downloads."]
            }
        }
        let response = NSExtensionItem()
        response.userInfo = ["message": result]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
