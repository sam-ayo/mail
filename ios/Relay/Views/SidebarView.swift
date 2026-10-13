import SwiftUI

struct SidebarView: View {
    @Environment(AppModel.self) private var app
    @Binding var selection: Mailbox?
    @Binding var showSettings: Bool

    var body: some View {
        List(selection: $selection) {
            Section {
                row(.allInboxes, title: "All Inboxes", systemImage: "tray.2", count: app.unreadTotal)
                if app.accounts.count > 1 {
                    ForEach(app.accounts) { account in
                        row(Mailbox(scope: account.id, folder: .inbox), title: account.name.isEmpty ? account.email : account.name,
                            systemImage: "tray", count: app.counts[account.id] ?? 0, tint: account.tint,
                            warning: account.needsReauth)
                    }
                }
                ForEach(Folder.allCases.dropFirst(), id: \.self) { folder in
                    row(Mailbox(scope: "all", folder: folder), title: folder.label, systemImage: folder.systemImage)
                }
            } header: {
                Text("Mailboxes")
            }

            ForEach(app.accounts) { account in
                Section {
                    ForEach(Folder.allCases, id: \.self) { folder in
                        row(Mailbox(scope: account.id, folder: folder), title: folder.label, systemImage: folder.systemImage,
                            count: folder == .inbox ? app.counts[account.id] ?? 0 : 0, tint: account.tint)
                    }
                } header: {
                    HStack(spacing: 6) {
                        Circle().fill(account.tint).frame(width: 8, height: 8)
                        Text(account.email).textCase(nil)
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Relay")
        .refreshable { await app.refresh() }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Settings", systemImage: "gearshape") { showSettings = true }
            }
            ToolbarItem(placement: .bottomBar) {
                Spacer()
            }
            ToolbarItem(placement: .bottomBar) {
                ComposeButton()
            }
        }
    }

    private func row(_ mailbox: Mailbox, title: String, systemImage: String, count: Int = 0,
                     tint: Color? = nil, warning: Bool = false) -> some View {
        NavigationLink(value: mailbox) {
            HStack {
                Label {
                    Text(title).lineLimit(1)
                } icon: {
                    Image(systemName: systemImage).foregroundStyle(tint ?? .accentColor)
                }
                Spacer()
                if warning {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                } else if count > 0 {
                    Text(count, format: .number.notation(.compactName))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct ComposeButton: View {
    @Environment(AppModel.self) private var app
    var accountId: String?

    var body: some View {
        Button("Compose", systemImage: "square.and.pencil") {
            guard let account = accountId ?? app.accounts.first?.id else { return }
            app.compose = ComposeDraft(accountId: account)
        }
        .disabled(app.accounts.isEmpty)
    }
}
