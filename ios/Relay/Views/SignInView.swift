import AuthenticationServices
import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    var addingAccount = false
    @State private var busy = false
    @State private var server = ""

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Image(systemName: "envelope.fill")
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 88, height: 88)
                .background(LinearGradient(colors: [.indigo, .purple], startPoint: .bottomLeading, endPoint: .topTrailing),
                            in: .rect(cornerRadius: 22))
            VStack(spacing: 8) {
                Text(addingAccount ? "Add an account" : "All your email, one fast inbox")
                    .font(.title2.bold())
                    .multilineTextAlignment(.center)
                Text("Connect Gmail and Outlook accounts. They all show in one unified inbox.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            VStack(spacing: 12) {
                providerButton(.google, systemImage: "g.circle.fill")
                providerButton(.microsoft, systemImage: "square.grid.2x2.fill")
                #if DEBUG
                Button {
                    run { await app.connectDemo() }
                } label: {
                    Label("Try a demo inbox", systemImage: "sparkles").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                #endif
            }
            .disabled(busy)
            #if DEBUG
            if !addingAccount {
                HStack {
                    Text("Server").foregroundStyle(.secondary)
                    TextField("Server", text: $server)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .onSubmit { app.serverURL = server }
                }
                .font(.footnote)
                .onAppear { server = app.serverURL }
            }
            #endif
            if addingAccount {
                Button("Sign Out", role: .destructive) { run { await app.signOut() } }
                    .font(.footnote)
            }
        }
        .padding(24)
        .frame(maxWidth: 440)
        .overlay { if busy { ProgressView() } }
    }

    private func providerButton(_ provider: OAuthProvider, systemImage: String) -> some View {
        Button {
            run { await app.connect(provider, session: webAuthenticationSession) }
        } label: {
            Label("Continue with \(provider.title)", systemImage: systemImage).frame(maxWidth: .infinity)
        }
        .buttonStyle(.glassProminent)
        .controlSize(.large)
    }

    private func run(_ work: @escaping () async -> Void) {
        #if DEBUG
        if !server.isEmpty, server != app.serverURL { app.serverURL = server }
        #endif
        busy = true
        Task {
            await work()
            busy = false
        }
    }
}
