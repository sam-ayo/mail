import AuthenticationServices
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var confirmSignOut = false

    var body: some View {
        @Bindable var app = app
        NavigationStack {
            Form {
                Section("Accounts") {
                    ForEach(app.accounts) { account in
                        NavigationLink {
                            AccountSettingsView(account: account)
                        } label: {
                            AccountRow(account: account)
                        }
                    }
                    Menu {
                        Button("Google") { Task { await app.connect(.google, session: webAuthenticationSession) } }
                        Button("Microsoft") { Task { await app.connect(.microsoft, session: webAuthenticationSession) } }
                        #if DEBUG
                        Button("Demo account") { Task { await app.connectDemo() } }
                        #endif
                    } label: {
                        Label("Add Account", systemImage: "plus")
                    }
                }
                Section("Appearance") {
                    Picker("Theme", selection: $app.appearance) {
                        ForEach(Appearance.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    Link("Privacy Policy", destination: app.api.url("privacy"))
                    Link("Terms of Service", destination: app.api.url("terms"))
                    Button("Sign Out", role: .destructive) { confirmSignOut = true }
                } footer: {
                    Text("Sign out removes the sign-in from this device. Your accounts stay connected on the web.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                }
            }
            .confirmationDialog("Sign out of Relay on this device?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) {
                    Task {
                        await app.signOut()
                        dismiss()
                    }
                }
            }
        }
    }
}

struct AccountRow: View {
    let account: AccountSummary

    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(account.tint).frame(width: 12, height: 12)
            VStack(alignment: .leading, spacing: 2) {
                Text(account.name.isEmpty ? account.email : account.name)
                Text("\(account.shownProvider.displayName) · \(account.email)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if account.needsReauth {
                Spacer()
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            }
        }
    }
}

struct AccountSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    let account: AccountSummary
    @State private var name = ""
    @State private var confirmRemove = false

    /// The newest copy of the account.
    private var current: AccountSummary { app.account(account.id) ?? account }

    var body: some View {
        Form {
            if current.needsReauth, current.provider == .google || current.provider == .microsoft {
                Section {
                    Button("Sign In Again", systemImage: "exclamationmark.triangle") {
                        Task {
                            await app.connect(current.provider == .google ? .google : .microsoft,
                                              hint: current.email, session: webAuthenticationSession)
                        }
                    }
                } footer: {
                    Text("The provider rejected the saved sign-in. Sign in again to get mail from this account.")
                }
            }
            Section("Name") {
                TextField("Name", text: $name)
                    .onSubmit { save() }
            }
            Section("Color") {
                HStack {
                    ForEach(accountColors, id: \.self) { color in
                        Button {
                            Task { await app.updateAccount(current, color: color) }
                        } label: {
                            Circle()
                                .fill(Color(hex: color))
                                .frame(width: 30, height: 30)
                                .overlay {
                                    if current.color == color {
                                        Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white)
                                    }
                                }
                        }
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            Section {
                LabeledContent("Email", value: current.email)
                LabeledContent("Provider", value: current.shownProvider.displayName)
            }
            Section {
                Button("Remove Account", role: .destructive) { confirmRemove = true }
            }
        }
        .navigationTitle(current.name.isEmpty ? current.email : current.name)
        .onAppear { name = current.name }
        .onDisappear { save() }
        .confirmationDialog("Remove \(current.email)?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove Account", role: .destructive) {
                Task {
                    await app.removeAccount(current)
                    dismiss()
                }
            }
        } message: {
            Text("Relay forgets this account. Your mail stays with the provider.")
        }
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard trimmed != current.name, app.account(account.id) != nil else { return }
        Task { await app.updateAccount(current, name: trimmed) }
    }
}
