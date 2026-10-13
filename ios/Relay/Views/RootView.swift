import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var app = app
        Group {
            if !app.isSignedIn {
                SignInView()
            } else if app.hasLoadedAccounts && app.accounts.isEmpty {
                // The person removed the last account.
                SignInView(addingAccount: true)
            } else {
                MailView()
            }
        }
        .task(id: app.isSignedIn) { await app.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await app.loadCounts() } }
        }
        .sheet(item: $app.compose) { draft in
            ComposeView(draft: draft)
        }
        .overlay(alignment: .bottom) {
            if let toast = app.toast {
                ToastView(toast: toast)
                    .id(toast.id)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: app.toast?.id)
    }
}

struct MailView: View {
    @Environment(AppModel.self) private var app
    @State private var mailbox: Mailbox? = .allInboxes
    @State private var selection: String?
    @State private var showSettings = false

    var body: some View {
        NavigationSplitView {
            SidebarView(selection: $mailbox, showSettings: $showSettings)
        } content: {
            if let mailbox {
                ThreadListView(model: app.model(for: mailbox), selection: $selection)
                    .id(mailbox)
            } else {
                ContentUnavailableView("No Mailbox", systemImage: "tray")
            }
        } detail: {
            NavigationStack {
                if let mailbox, let key = selection, let thread = app.model(for: mailbox).thread(key) {
                    ThreadDetailView(summary: thread, model: app.model(for: mailbox), selection: $selection)
                } else {
                    ContentUnavailableView("No Conversation Selected", systemImage: "envelope")
                }
            }
        }
        .onChange(of: mailbox) { selection = nil }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }
}

struct ToastView: View {
    @Environment(AppModel.self) private var app
    let toast: Toast

    var body: some View {
        HStack(spacing: 16) {
            Text(toast.text)
                .font(.subheadline.weight(.medium))
                .lineLimit(2)
            if let undo = toast.undo {
                Button("Undo") {
                    undo()
                    app.toast = nil
                }
                .font(.subheadline.weight(.semibold))
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .glassEffect(.regular, in: .capsule)
        .padding(.bottom, 64)
        .padding(.horizontal)
        .task {
            try? await Task.sleep(for: .seconds(toast.undo == nil ? 3 : 5))
            if app.toast?.id == toast.id { app.toast = nil }
        }
    }
}
