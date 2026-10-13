import AuthenticationServices
import Foundation
import Observation
import SwiftUI

enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// A short message at the bottom of the screen, with an optional Undo.
struct Toast: Identifiable {
    let id = UUID()
    let text: String
    var undo: (() -> Void)?
}

/// The state of the whole app: the sign-in, the accounts, and the unread counts.
@Observable
final class AppModel {
    private static let tokenKey = "token"
    private static let serverKey = "serverURL"
    private static let appearanceKey = "appearance"

    let api: APIClient
    private(set) var isSignedIn: Bool
    private(set) var accounts: [AccountSummary] = []
    private(set) var counts: [String: Int] = [:]
    private(set) var hasLoadedAccounts = false
    var toast: Toast?
    var compose: ComposeDraft?
    var appearance: Appearance {
        didSet { UserDefaults.standard.set(appearance.rawValue, forKey: Self.appearanceKey) }
    }

    /// Mailbox models stay in memory, so a folder that you open again shows at once.
    private var mailboxes: [Mailbox: MailboxModel] = [:]

    /// The server from Info.plist. A debug build can change it on the sign-in screen.
    static var defaultServer: String {
        Bundle.main.object(forInfoDictionaryKey: "RelayServerURL") as? String ?? "https://mail.samayo.me"
    }

    var serverURL: String {
        get { api.baseURL.absoluteString }
        set {
            guard let url = URL(string: newValue.trimmingCharacters(in: .whitespaces)), url.scheme != nil else { return }
            api.baseURL = url
            UserDefaults.standard.set(url.absoluteString, forKey: Self.serverKey)
        }
    }

    init() {
        #if DEBUG
        let server = UserDefaults.standard.string(forKey: Self.serverKey) ?? Self.defaultServer
        // UI tests start signed out.
        if ProcessInfo.processInfo.arguments.contains("-UITestReset") { Keychain.write(nil, for: Self.tokenKey) }
        #else
        let server = Self.defaultServer
        #endif
        let token = Keychain.read(Self.tokenKey)
        api = APIClient(baseURL: URL(string: server)!, token: token)
        isSignedIn = token != nil
        appearance = Appearance(rawValue: UserDefaults.standard.string(forKey: Self.appearanceKey) ?? "") ?? .system
        api.onUnauthorized = { [weak self] in self?.clearSession() }
    }

    var unreadTotal: Int { counts.values.reduce(0, +) }

    func account(_ id: String) -> AccountSummary? { accounts.first { $0.id == id } }

    func model(for mailbox: Mailbox) -> MailboxModel {
        if let model = mailboxes[mailbox] { return model }
        let model = MailboxModel(mailbox: mailbox, app: self)
        mailboxes[mailbox] = model
        return model
    }

    func show(_ text: String, undo: (() -> Void)? = nil) {
        toast = Toast(text: text, undo: undo)
    }

    // MARK: Data

    func refresh() async {
        guard isSignedIn else { return }
        async let accounts: Void = loadAccounts()
        async let counts: Void = loadCounts()
        _ = await (accounts, counts)
    }

    func loadAccounts() async {
        struct Response: Decodable { let accounts: [AccountSummary] }
        do {
            accounts = try await api.get("api/v1/accounts", as: Response.self).accounts
            hasLoadedAccounts = true
            // Forget the folders of removed accounts.
            let ids = Set(accounts.map(\.id))
            mailboxes = mailboxes.filter { $0.key.isUnified || ids.contains($0.key.scope) }
        } catch {
            if isSignedIn && !error.isCancellation { show(error.localizedDescription) }
        }
    }

    func loadCounts() async {
        if let result = try? await api.get("api/counts", as: [String: Int?].self) {
            counts = result.compactMapValues { $0 }
        }
    }

    // MARK: Sign-in

    func connect(_ provider: OAuthProvider, hint: String? = nil, session: WebAuthenticationSession) async {
        do {
            let token = try await SignInFlow(api: api).run(provider, hint: hint, session: session)
            if let token { setToken(token) }
            await refresh()
        } catch {
            show(error.localizedDescription)
        }
    }

    /// Debug builds only. Adds a demo account that needs no OAuth.
    func connectDemo() async {
        struct Response: Decodable { let token: String? }
        struct Empty: Encodable {}
        do {
            let data = try await api.json("POST", "api/mobile/demo", body: Empty())
            if let token = try JSONDecoder().decode(Response.self, from: data).token { setToken(token) }
            await refresh()
        } catch {
            show(error.localizedDescription)
        }
    }

    func signOut() async {
        _ = try? await api.send(api.authorized(api.url("api/mobile/logout"), method: "POST"))
        clearSession()
    }

    private func setToken(_ token: String) {
        Keychain.write(token, for: Self.tokenKey)
        api.token = token
        isSignedIn = true
    }

    private func clearSession() {
        Keychain.write(nil, for: Self.tokenKey)
        api.token = nil
        isSignedIn = false
        accounts = []
        counts = [:]
        mailboxes = [:]
        hasLoadedAccounts = false
    }

    // MARK: Accounts

    func updateAccount(_ account: AccountSummary, name: String? = nil, color: String? = nil) async {
        struct Body: Encodable { let name: String?; let color: String? }
        struct Response: Decodable { let account: AccountSummary }
        do {
            let data = try await api.json("PATCH", "api/v1/accounts/\(account.id)", body: Body(name: name, color: color))
            let updated = try JSONDecoder().decode(Response.self, from: data).account
            if let index = accounts.firstIndex(where: { $0.id == updated.id }) { accounts[index] = updated }
        } catch {
            show(error.localizedDescription)
        }
    }

    func removeAccount(_ account: AccountSummary) async {
        do {
            try await api.send(api.authorized(api.url("api/v1/accounts/\(account.id)"), method: "DELETE"))
            await refresh()
        } catch {
            show(error.localizedDescription)
        }
    }
}

extension Error {
    /// True if a task or a request stopped because the view went away.
    var isCancellation: Bool {
        self is CancellationError || (self as? URLError)?.code == .cancelled
    }
}
