import Foundation
import SwiftUI

// These types match the JSON of the server. See app/lib/mail.ts.

enum ProviderKind: String, Codable, Hashable {
    case google, microsoft, imap, demo

    var displayName: String {
        switch self {
        case .google: "Gmail"
        case .microsoft: "Outlook"
        case .imap: "IMAP"
        case .demo: "Demo"
        }
    }
}

struct AccountSummary: Codable, Hashable, Identifiable {
    let id: String
    let provider: ProviderKind
    let email: String
    let name: String
    let color: String
    let status: String
    let look: ProviderKind?

    /// The provider that the app shows. A demo account can look like a Gmail account.
    var shownProvider: ProviderKind { look ?? provider }
    var needsReauth: Bool { status == "reauth_required" }
    var tint: Color { Color(hex: color) }
}

/// The colors that the server accepts for an account.
let accountColors = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6"]

enum Folder: String, Codable, CaseIterable, Hashable {
    case inbox, starred, sent, drafts, archive, spam, trash

    var label: String {
        switch self {
        case .inbox: "Inbox"
        case .starred: "Starred"
        case .sent: "Sent"
        case .drafts: "Drafts"
        case .archive: "Archive"
        case .spam: "Spam"
        case .trash: "Trash"
        }
    }

    var systemImage: String {
        switch self {
        case .inbox: "tray"
        case .starred: "star"
        case .sent: "paperplane"
        case .drafts: "doc"
        case .archive: "archivebox"
        case .spam: "xmark.bin"
        case .trash: "trash"
        }
    }

    /// Sent and Drafts show the recipients, not the sender.
    var showsRecipients: Bool { self == .sent || self == .drafts }
}

/// A folder in one account, or in all accounts when `scope` is "all".
struct Mailbox: Hashable, Codable {
    var scope: String
    var folder: Folder

    static let allInboxes = Mailbox(scope: "all", folder: .inbox)
    var isUnified: Bool { scope == "all" }
}

struct Address: Codable, Hashable {
    var name: String?
    var email: String

    var displayName: String {
        if let name, !name.isEmpty { return name }
        return String(email.split(separator: "@").first ?? Substring(email))
    }

    var formatted: String {
        if let name, !name.isEmpty { return "\(name) <\(email)>" }
        return email
    }
}

struct ThreadRef: Codable, Hashable {
    let accountId: String
    let id: String
}

struct ThreadSummary: Codable, Hashable, Identifiable {
    let accountId: String
    let threadId: String
    var subject: String
    var snippet: String
    var participants: [Address]
    var date: Date
    var unread: Bool
    var starred: Bool
    var messageCount: Int
    var hasAttachments: Bool
    var copies: [ThreadRef]?

    enum CodingKeys: String, CodingKey {
        case accountId, threadId = "id", subject, snippet, participants, date, unread, starred
        case messageCount, hasAttachments, copies
    }

    var id: String { "\(accountId):\(threadId)" }

    /// The conversation and its copies in other accounts. Actions go to all of them.
    var refs: [ThreadRef] { [ThreadRef(accountId: accountId, id: threadId)] + (copies ?? []) }
}

struct Attachment: Codable, Hashable, Identifiable {
    let id: String
    let filename: String
    let mimeType: String
    let size: Int
    let contentId: String?
    let inline: Bool
}

struct Unsubscribe: Codable, Hashable {
    let url: String?
    let mailto: String?
    let oneClick: Bool
}

struct Message: Codable, Hashable, Identifiable {
    let id: String
    let threadId: String
    let from: Address
    let to: [Address]
    let cc: [Address]
    let bcc: [Address]
    let replyTo: [Address]
    let subject: String
    let date: Date
    let snippet: String
    /// A full, sanitized HTML document.
    let html: String?
    let text: String?
    var unread: Bool
    var starred: Bool
    let attachments: [Attachment]
    let messageIdHeader: String?
    let references: [String]?
    let unsubscribe: Unsubscribe?
    let hasQuote: Bool
}

struct MailThread: Codable, Hashable {
    let accountId: String
    let id: String
    let subject: String
    var messages: [Message]
    var starred: Bool
    var unread: Bool
}

struct AccountError: Codable, Hashable {
    let accountId: String
    let email: String
    let message: String
    let reauth: Bool
}

struct ThreadPage: Codable {
    let threads: [ThreadSummary]
    let nextCursor: String?
    let errors: [AccountError]
}

enum ThreadAction: String, Codable {
    case archive, inbox, trash, spam, star, unstar, read, unread

    /// The action that undoes this action.
    var inverse: ThreadAction {
        switch self {
        case .archive, .trash, .spam: .inbox
        case .inbox: .archive
        case .star: .unstar
        case .unstar: .star
        case .read: .unread
        case .unread: .read
        }
    }

    /// The text for a confirmation, for example "Archived".
    var pastTense: String {
        switch self {
        case .archive: "Archived"
        case .inbox: "Moved to Inbox"
        case .trash: "Moved to Trash"
        case .spam: "Marked as spam"
        case .star: "Starred"
        case .unstar: "Unstarred"
        case .read: "Marked as read"
        case .unread: "Marked as unread"
        }
    }

    /// True if the action takes the thread out of the folder.
    func removes(from folder: Folder) -> Bool {
        switch self {
        case .archive: folder != .archive
        case .trash: folder != .trash
        case .spam: folder != .spam
        case .inbox: folder != .inbox
        case .unstar: folder == .starred
        default: false
        }
    }
}

extension Color {
    /// Makes a color from "#rrggbb".
    init(hex: String) {
        let value = UInt64(hex.dropFirst(), radix: 16) ?? 0x6366f1
        self.init(
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255
        )
    }
}

extension JSONDecoder {
    /// The server sends ISO 8601 dates, with or without fractions of a second.
    static let relay: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = try? Date(text, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)) {
                return date
            }
            if let date = try? Date(text, strategy: .iso8601) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(text)"))
        }
        return decoder
    }()
}
