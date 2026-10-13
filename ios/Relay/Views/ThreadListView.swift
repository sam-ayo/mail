import AuthenticationServices
import SwiftUI

struct ThreadListView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @Bindable var model: MailboxModel
    @Binding var selection: String?

    private var title: String {
        if model.mailbox.isUnified {
            return model.mailbox.folder == .inbox ? "All Inboxes" : model.mailbox.folder.label
        }
        return model.mailbox.folder == .inbox ? (app.account(model.mailbox.scope)?.name ?? "Inbox") : model.mailbox.folder.label
    }

    var body: some View {
        List(selection: $selection) {
            ForEach(model.errors, id: \.accountId) { error in
                errorRow(error)
            }
            ForEach(model.threads) { thread in
                ThreadRow(thread: thread, folder: model.mailbox.folder,
                          account: model.mailbox.isUnified && app.accounts.count > 1 ? app.account(thread.accountId) : nil)
                    .tag(thread.id)
                    .swipeActions(edge: .leading) {
                        Button {
                            model.perform(thread.unread ? .read : .unread, on: thread, quiet: true)
                        } label: {
                            Label(thread.unread ? "Read" : "Unread",
                                  systemImage: thread.unread ? "envelope.open" : "envelope.badge")
                        }
                        .tint(.blue)
                    }
                    .swipeActions(edge: .trailing) {
                        primaryAction(for: thread)
                        Button(role: .destructive) {
                            model.perform(.trash, on: thread)
                        } label: {
                            Label("Trash", systemImage: "trash")
                        }
                        .tint(.red)
                        .disabled(model.mailbox.folder == .trash)
                        Button {
                            model.perform(thread.starred ? .unstar : .star, on: thread, quiet: true)
                        } label: {
                            Label(thread.starred ? "Unstar" : "Star", systemImage: thread.starred ? "star.slash" : "star")
                        }
                        .tint(.yellow)
                    }
                    .contextMenu { menu(for: thread) }
                    .onAppear {
                        if thread.id == model.threads.last?.id { Task { await model.loadMore() } }
                    }
            }
            if model.isLoadingMore {
                HStack { Spacer(); ProgressView(); Spacer() }
                    .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .overlay { emptyState }
        .navigationTitle(title)
        .searchable(text: $model.query, prompt: "Search")
        .onSubmit(of: .search) { Task { await model.load() } }
        .onChange(of: model.query) { _, query in
            if query.isEmpty, !model.appliedQuery.isEmpty { Task { await model.load() } }
        }
        .refreshable {
            await model.load()
            await app.loadCounts()
        }
        .task { await model.load(maxAge: 30) }
        .toolbar {
            ToolbarItem(placement: .bottomBar) { Spacer() }
            ToolbarItem(placement: .bottomBar) {
                ComposeButton(accountId: model.mailbox.isUnified ? nil : model.mailbox.scope)
            }
        }
    }

    @ViewBuilder
    private func primaryAction(for thread: ThreadSummary) -> some View {
        switch model.mailbox.folder {
        case .archive, .spam, .trash:
            Button { model.perform(.inbox, on: thread) } label: { Label("Inbox", systemImage: "tray.and.arrow.down") }
                .tint(.indigo)
        default:
            Button { model.perform(.archive, on: thread) } label: { Label("Archive", systemImage: "archivebox") }
                .tint(.indigo)
        }
    }

    @ViewBuilder
    private func menu(for thread: ThreadSummary) -> some View {
        Button(thread.unread ? "Mark as Read" : "Mark as Unread", systemImage: thread.unread ? "envelope.open" : "envelope.badge") {
            model.perform(thread.unread ? .read : .unread, on: thread, quiet: true)
        }
        Button(thread.starred ? "Unstar" : "Star", systemImage: thread.starred ? "star.slash" : "star") {
            model.perform(thread.starred ? .unstar : .star, on: thread, quiet: true)
        }
        Divider()
        if model.mailbox.folder != .archive {
            Button("Archive", systemImage: "archivebox") { model.perform(.archive, on: thread) }
        }
        if model.mailbox.folder != .inbox {
            Button("Move to Inbox", systemImage: "tray.and.arrow.down") { model.perform(.inbox, on: thread) }
        }
        if model.mailbox.folder != .spam {
            Button("Report Spam", systemImage: "xmark.bin") { model.perform(.spam, on: thread) }
        }
        if model.mailbox.folder != .trash {
            Button("Move to Trash", systemImage: "trash", role: .destructive) { model.perform(.trash, on: thread) }
        }
    }

    private func errorRow(_ error: AccountError) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 4) {
                Text("Could not load \(error.email)").font(.subheadline.weight(.semibold))
                Text(error.message).font(.caption).foregroundStyle(.secondary)
                if error.reauth, let account = app.account(error.accountId) {
                    Button("Sign in again") {
                        Task {
                            await app.connect(account.provider == .microsoft ? .microsoft : .google,
                                              hint: account.email, session: webAuthenticationSession)
                            await model.load()
                        }
                    }
                    .font(.caption.weight(.semibold))
                    .disabled(account.provider != .google && account.provider != .microsoft)
                }
            }
        }
        .padding(.vertical, 4)
        .selectionDisabled()
    }

    @ViewBuilder
    private var emptyState: some View {
        if model.threads.isEmpty {
            if model.isLoading && model.loadedAt == nil {
                ProgressView()
            } else if let error = model.loadError {
                ContentUnavailableView {
                    Label("Could Not Load Mail", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try Again") { Task { await model.load() } }
                }
            } else if model.loadedAt != nil && model.errors.isEmpty {
                if model.appliedQuery.isEmpty {
                    ContentUnavailableView("No Conversations", systemImage: model.mailbox.folder.systemImage)
                } else {
                    ContentUnavailableView.search(text: model.appliedQuery)
                }
            }
        }
    }
}

struct ThreadRow: View {
    let thread: ThreadSummary
    let folder: Folder
    /// Set in a unified list, to show which account has the conversation.
    let account: AccountSummary?

    private var people: String {
        let names = thread.participants.map(\.displayName)
        if names.isEmpty { return folder.showsRecipients ? "(no recipients)" : "(unknown sender)" }
        if names.count == 1 { return names[0] }
        return names.map { String($0.split(separator: " ").first ?? Substring($0)) }.joined(separator: ", ")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack(alignment: .topLeading) {
                AvatarView(address: thread.participants.first, size: 40)
                if thread.unread {
                    Circle().fill(Color.accentColor).frame(width: 10, height: 10)
                        .offset(x: -6, y: -2)
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if folder.showsRecipients {
                        Text("To:").foregroundStyle(.secondary)
                    }
                    Text(people)
                        .fontWeight(thread.unread ? .semibold : .regular)
                        .lineLimit(1)
                    if thread.messageCount > 1 {
                        Text("\(thread.messageCount)").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 4)
                    if let account {
                        Circle().fill(account.tint).frame(width: 7, height: 7)
                            .accessibilityLabel(account.email)
                    }
                    Text(listDate(thread.date))
                        .font(.footnote)
                        .foregroundStyle(thread.unread ? Color.accentColor : .secondary)
                }
                HStack(spacing: 4) {
                    Text(thread.subject.isEmpty ? "(no subject)" : thread.subject)
                        .font(.subheadline)
                        .fontWeight(thread.unread ? .semibold : .regular)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if thread.hasAttachments {
                        Image(systemName: "paperclip").font(.caption).foregroundStyle(.secondary)
                    }
                    if thread.starred {
                        Image(systemName: "star.fill").font(.caption).foregroundStyle(.yellow)
                    }
                }
                Text(thread.snippet)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }
}

/// "9:41 AM" today, "Oct 3" this year, "10/3/24" before.
func listDate(_ date: Date, now: Date = .now) -> String {
    let calendar = Calendar.current
    if calendar.isDate(date, inSameDayAs: now) { return date.formatted(date: .omitted, time: .shortened) }
    if calendar.isDateInYesterday(date) { return "Yesterday" }
    if calendar.isDate(date, equalTo: now, toGranularity: .year) {
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
    return date.formatted(date: .numeric, time: .omitted)
}
