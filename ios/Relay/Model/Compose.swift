import Foundation

struct ReplyContext: Codable, Hashable {
    enum Kind: String, Codable { case reply, forward }

    let kind: Kind
    let threadId: String
    let messageId: String
    let messageIdHeader: String?
    let references: [String]?
}

struct DraftAttachment: Identifiable, Hashable {
    let id = UUID()
    let filename: String
    let mimeType: String
    let data: Data
}

/// A message that the person writes. The body is Markdown, as in the web app.
struct ComposeDraft: Identifiable {
    let id = UUID()
    var accountId: String
    var to = ""
    var cc = ""
    var bcc = ""
    var subject = ""
    var body = ""
    var reply: ReplyContext?
    /// The quoted original. The server adds it under the body.
    var quoted: (html: String, text: String)?
    var attachments: [DraftAttachment] = []

    var title: String {
        switch reply?.kind {
        case .reply: "Reply"
        case .forward: "Forward"
        case nil: "New Message"
        }
    }
}

enum ReplyMode {
    case reply, replyAll, forward
}

/// Builds a reply, reply-all, or forward draft. This is a port of `draftFor` in app/lib/compose.ts.
func draft(_ mode: ReplyMode, for message: Message, account: AccountSummary) -> ComposeDraft {
    let reply = ReplyContext(
        kind: mode == .forward ? .forward : .reply,
        threadId: message.threadId,
        messageId: message.id,
        messageIdHeader: message.messageIdHeader,
        references: message.references
    )
    var draft = ComposeDraft(accountId: account.id, reply: reply)
    let date = message.date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year().hour().minute())
    let quoteBody = message.html.map(documentBody) ?? textToHtml(message.text ?? message.snippet)

    if mode == .forward {
        let header = [
            "---------- Forwarded message ---------",
            "From: \(message.from.formatted)",
            "Date: \(date)",
            "Subject: \(message.subject)",
            "To: \(message.to.map(\.formatted).joined(separator: ", "))",
        ]
        draft.subject = withPrefix("Fwd", message.subject)
        draft.quoted = (
            html: "<div class=\"gmail_quote\">\(header.map(escapeHtml).joined(separator: "<br>"))<br><br>\(quoteBody)</div>",
            text: "\(header.joined(separator: "\n"))\n\n\(message.text ?? message.snippet)"
        )
        return draft
    }

    let me = account.email.lowercased()
    let fromMe = message.from.email.lowercased() == me
    let primary = fromMe ? message.to : (message.replyTo.isEmpty ? [message.from] : message.replyTo)
    var cc: [Address] = []
    if mode == .replyAll {
        var seen = Set(primary.map { $0.email.lowercased() })
        seen.insert(me)
        for address in message.to + message.cc where seen.insert(address.email.lowercased()).inserted {
            cc.append(address)
        }
    }

    let attribution = "On \(date), \(message.from.formatted) wrote:"
    let quotedText = (message.text ?? message.snippet).split(separator: "\n", omittingEmptySubsequences: false)
        .map { "> \($0)" }.joined(separator: "\n")
    draft.to = primary.map(\.formatted).joined(separator: ", ")
    draft.cc = cc.map(\.formatted).joined(separator: ", ")
    draft.subject = withPrefix("Re", message.subject)
    draft.quoted = (
        html: "<div class=\"gmail_quote\"><div>\(escapeHtml(attribution))</div><blockquote style=\"margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex\">\(quoteBody)</blockquote></div>",
        text: "\(attribution)\n\(quotedText)"
    )
    return draft
}

private func withPrefix(_ prefix: String, _ subject: String) -> String {
    let pattern = prefix == "Re" ? "^re:" : "^(fwd?|fw):"
    let trimmed = subject.trimmingCharacters(in: .whitespaces)
    return trimmed.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil ? subject : "\(prefix): \(subject)"
}

func escapeHtml(_ text: String) -> String {
    text.replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
        .replacingOccurrences(of: "\"", with: "&quot;")
}

private func textToHtml(_ text: String) -> String {
    escapeHtml(text).replacingOccurrences(of: "\n", with: "<br>")
}

/// Returns the inner body of a document that the server rendered.
private func documentBody(_ html: String) -> String {
    guard let start = html.range(of: "<body[^>]*>", options: [.regularExpression, .caseInsensitive]),
          let end = html.range(of: "</body>", options: [.caseInsensitive, .backwards]),
          start.upperBound <= end.lowerBound else { return html }
    return String(html[start.upperBound..<end.lowerBound])
}

extension AppModel {
    func send(_ draft: ComposeDraft) async throws {
        var form = MultipartForm()
        form.add("accountId", draft.accountId)
        form.add("to", draft.to)
        form.add("cc", draft.cc)
        form.add("bcc", draft.bcc)
        form.add("subject", draft.subject)
        form.add("markdown", draft.body)
        if let quoted = draft.quoted {
            form.add("quotedHtml", quoted.html)
            form.add("quotedText", quoted.text)
        }
        if let reply = draft.reply, let json = try? JSONEncoder().encode(reply) {
            form.add("reply", String(decoding: json, as: UTF8.self))
        }
        for file in draft.attachments {
            form.add("attachments", filename: file.filename, mimeType: file.mimeType, data: file.data)
        }
        var request = api.authorized(api.url("api/send"), method: "POST")
        request.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = form.finished()
        try await api.send(request)
    }
}
