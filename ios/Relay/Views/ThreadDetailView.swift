import QuickLook
import SwiftUI

struct ThreadDetailView: View {
    @Environment(AppModel.self) private var app
    let summary: ThreadSummary
    let model: MailboxModel
    @Binding var selection: String?

    @State private var thread: MailThread?
    @State private var error: String?
    @State private var expanded: Set<String> = []

    private var account: AccountSummary? { app.account(summary.accountId) }
    private var folder: Folder { model.mailbox.folder }

    var body: some View {
        ScrollView {
            if let thread {
                VStack(alignment: .leading, spacing: 12) {
                    Text(thread.subject.isEmpty ? "(no subject)" : thread.subject)
                        .font(.title2.bold())
                        .textSelection(.enabled)
                        .padding(.horizontal)
                        .padding(.top, 8)
                    LazyVStack(spacing: 10) {
                        ForEach(thread.messages) { message in
                            MessageCard(
                                message: message,
                                thread: thread,
                                account: account,
                                isExpanded: expanded.contains(message.id),
                                toggle: { toggle(message.id) }
                            )
                        }
                    }
                    .padding(.horizontal, 10)
                }
                .padding(.bottom, 24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .overlay {
            if thread == nil {
                if let error {
                    ContentUnavailableView {
                        Label("Could Not Load the Conversation", systemImage: "exclamationmark.bubble")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try Again") { Task { await load() } }
                    }
                } else {
                    ProgressView()
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .task(id: summary.id) {
            if thread?.id != summary.threadId {
                thread = nil
                error = nil
            }
            await load()
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button(summary.starred ? "Unstar" : "Star", systemImage: summary.starred ? "star.fill" : "star") {
                act(summary.starred ? .unstar : .star)
            }
            .tint(summary.starred ? .yellow : nil)
            Menu("More", systemImage: "ellipsis") {
                Button("Mark as Unread", systemImage: "envelope.badge") {
                    act(.unread)
                    selection = nil
                }
                if folder != .spam {
                    Button("Report Spam", systemImage: "xmark.bin") { act(.spam) }
                }
                if folder != .inbox {
                    Button("Move to Inbox", systemImage: "tray.and.arrow.down") { act(.inbox) }
                }
            }
        }
        ToolbarItemGroup(placement: .bottomBar) {
            if folder == .archive || folder == .spam || folder == .trash {
                Button("Move to Inbox", systemImage: "tray.and.arrow.down") { act(.inbox) }
            } else {
                Button("Archive", systemImage: "archivebox") { act(.archive) }
            }
            if folder != .trash {
                Button("Trash", systemImage: "trash") { act(.trash) }
            }
        }
        ToolbarSpacer(.flexible, placement: .bottomBar)
        ToolbarItemGroup(placement: .bottomBar) {
            if let message = thread?.messages.last, let account {
                Menu("Reply", systemImage: "arrowshape.turn.up.left") {
                    Button("Reply", systemImage: "arrowshape.turn.up.left") {
                        app.compose = draft(.reply, for: message, account: account)
                    }
                    Button("Reply All", systemImage: "arrowshape.turn.up.left.2") {
                        app.compose = draft(.replyAll, for: message, account: account)
                    }
                    Button("Forward", systemImage: "arrowshape.turn.up.right") {
                        app.compose = draft(.forward, for: message, account: account)
                    }
                } primaryAction: {
                    app.compose = draft(.reply, for: message, account: account)
                }
            }
            ComposeButton(accountId: summary.accountId)
        }
    }

    private func act(_ action: ThreadAction) {
        let removes = action.removes(from: folder)
        model.perform(action, on: summary, quiet: !removes)
        if action == .star || action == .unstar { thread?.starred = action == .star }
        // The conversation left the list, so go back to the list.
        if removes { selection = nil }
    }

    private func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    private func load() async {
        struct Response: Decodable { let thread: MailThread }
        do {
            let loaded = try await app.api.get(
                "api/v1/threads/\(summary.accountId)/\(summary.threadId)", as: Response.self
            ).thread
            // Open the unread messages and the newest message. Older messages show as one line.
            expanded = Set(loaded.messages.filter(\.unread).map(\.id))
            if let last = loaded.messages.last { expanded.insert(last.id) }
            thread = loaded
            error = nil
            if summary.unread { model.perform(.read, on: summary, quiet: true) }
        } catch {
            // A cancelled load means that the view went away. The next appearance loads again.
            if !error.isCancellation { self.error = error.localizedDescription }
        }
    }
}

struct MessageCard: View {
    @Environment(AppModel.self) private var app
    let message: Message
    let thread: MailThread
    let account: AccountSummary?
    let isExpanded: Bool
    let toggle: () -> Void

    /// Nil until the email reports its height.
    @State private var webHeight: CGFloat?
    @State private var showQuotes = false
    @State private var showDetails = false
    @State private var unsubscribed = false
    @State private var preview: URL?
    @State private var downloading: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .contentShape(.rect)
                .onTapGesture(perform: toggle)
                .padding(14)
            if isExpanded {
                if showDetails { details.padding(.horizontal, 14).padding(.bottom, 10) }
                if let unsubscribe = message.unsubscribe, !unsubscribed {
                    unsubscribeBanner(unsubscribe)
                }
                content.padding(.horizontal, 14)
                if message.hasQuote {
                    Button(showQuotes ? "Hide quoted text" : "Show quoted text", systemImage: "ellipsis") {
                        showQuotes.toggle()
                    }
                    .font(.caption)
                    .buttonStyle(.bordered)
                    .padding(.horizontal, 14)
                    .padding(.top, 6)
                }
                if !message.attachments.isEmpty { attachments.padding(.top, 10) }
                Spacer().frame(height: 14)
            }
        }
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
        .quickLookPreview($preview)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(address: message.from, size: 38)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(message.from.displayName).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Spacer()
                    Text(listDate(message.date)).font(.caption).foregroundStyle(.secondary)
                }
                if isExpanded {
                    Button {
                        showDetails.toggle()
                    } label: {
                        HStack(spacing: 2) {
                            Text("to \((message.to + message.cc).map(\.displayName).joined(separator: ", "))")
                                .lineLimit(1)
                            Image(systemName: showDetails ? "chevron.up" : "chevron.down").font(.caption2)
                        }
                    }
                    .buttonStyle(.plain)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                } else {
                    Text(message.snippet).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
    }

    private var details: some View {
        Grid(alignment: .leading, horizontalSpacing: 8, verticalSpacing: 4) {
            detailRow("From", [message.from])
            if !message.to.isEmpty { detailRow("To", message.to) }
            if !message.cc.isEmpty { detailRow("Cc", message.cc) }
            if !message.bcc.isEmpty { detailRow("Bcc", message.bcc) }
            GridRow {
                Text("Date").foregroundStyle(.secondary)
                Text(message.date.formatted(date: .complete, time: .shortened))
            }
        }
        .font(.caption)
        .textSelection(.enabled)
    }

    private func detailRow(_ label: String, _ addresses: [Address]) -> some View {
        GridRow(alignment: .top) {
            Text(label).foregroundStyle(.secondary)
            Text(addresses.map(\.formatted).joined(separator: ", "))
        }
    }

    @ViewBuilder
    private var content: some View {
        if let html = message.html {
            EmailWebView(html: html, showQuotes: showQuotes, height: $webHeight, api: app.api) { url in
                app.compose = mailtoDraft(url)
            }
            .frame(height: webHeight ?? 60)
            .opacity(webHeight == nil ? 0 : 1)
            .overlay { if webHeight == nil { ProgressView() } }
        } else {
            Text(message.text ?? message.snippet)
                .font(.callout)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func unsubscribeBanner(_ unsubscribe: Unsubscribe) -> some View {
        HStack {
            Image(systemName: "bell.slash").foregroundStyle(.secondary)
            Text("This message is from a mailing list.").font(.caption)
            Spacer()
            Button("Unsubscribe") { Task { await runUnsubscribe() } }
                .font(.caption.weight(.semibold))
        }
        .padding(10)
        .background(Color(.tertiarySystemGroupedBackground), in: .rect(cornerRadius: 10))
        .padding(.horizontal, 14)
        .padding(.bottom, 10)
    }

    private var attachments: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(message.attachments) { file in
                    Button {
                        Task { await open(file) }
                    } label: {
                        HStack(spacing: 8) {
                            if downloading == file.id {
                                ProgressView().controlSize(.small)
                            } else {
                                Image(systemName: icon(for: file.mimeType))
                            }
                            VStack(alignment: .leading, spacing: 0) {
                                Text(file.filename).font(.caption.weight(.medium)).lineLimit(1)
                                Text(file.size.formatted(.byteCount(style: .file))).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .frame(maxWidth: 220, alignment: .leading)
                        .background(Color(.tertiarySystemGroupedBackground), in: .rect(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14)
        }
    }

    private func icon(for mimeType: String) -> String {
        if mimeType.hasPrefix("image/") { return "photo" }
        if mimeType == "application/pdf" { return "doc.richtext" }
        if mimeType.hasPrefix("text/") { return "doc.text" }
        return "doc"
    }

    /// Downloads the attachment to a temporary file, then shows it in Quick Look.
    private func open(_ file: Attachment) async {
        downloading = file.id
        defer { downloading = nil }
        let url = app.api.url("api/attachments/\(thread.accountId)", query: ["m": message.id, "a": file.id, "download": "1"])
        do {
            let data = try await app.api.send(app.api.authorized(url))
            let folder = FileManager.default.temporaryDirectory.appending(path: file.id, directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let name = file.filename.replacingOccurrences(of: "/", with: "_")
            let target = folder.appending(path: name.isEmpty ? "attachment" : name)
            try data.write(to: target)
            preview = target
        } catch {
            app.show(error.localizedDescription)
        }
    }

    private func runUnsubscribe() async {
        struct Body: Encodable { let accountId, threadId, messageId: String }
        struct Result: Decodable { let method: String; let url: String? }
        do {
            let data = try await app.api.json("POST", "api/unsubscribe",
                                              body: Body(accountId: thread.accountId, threadId: thread.id, messageId: message.id))
            let result = try JSONDecoder().decode(Result.self, from: data)
            if result.method == "website", let link = result.url.flatMap(URL.init(string:)) {
                await UIApplication.shared.open(link)
            } else {
                app.show("Unsubscribed")
            }
            unsubscribed = true
        } catch {
            app.show(error.localizedDescription)
        }
    }

    private func mailtoDraft(_ url: URL) -> ComposeDraft {
        var draft = ComposeDraft(accountId: account?.id ?? thread.accountId)
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        draft.to = components?.path.removingPercentEncoding ?? ""
        for item in components?.queryItems ?? [] {
            switch item.name.lowercased() {
            case "subject": draft.subject = item.value ?? ""
            case "body": draft.body = item.value ?? ""
            case "cc": draft.cc = item.value ?? ""
            default: break
            }
        }
        return draft
    }
}
