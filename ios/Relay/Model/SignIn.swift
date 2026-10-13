import AuthenticationServices
import SwiftUI
import CryptoKit
import Foundation
import UIKit

enum OAuthProvider: String {
    case google, microsoft

    var title: String { self == .google ? "Google" : "Microsoft" }
}

/// The OAuth flow for the app. The server runs the provider sign-in in a browser
/// sheet, then returns to "relaymail://auth" with a one-time code. The app
/// trades the code and its PKCE verifier for a token.
struct SignInFlow {
    static let callbackScheme = "relaymail"

    let api: APIClient

    /// Signs in, or adds an account when the app has a token. Returns a new token, or nil.
    func run(_ provider: OAuthProvider, hint: String?, session: WebAuthenticationSession) async throws -> String? {
        let verifier = Self.randomToken()
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        var query: [String: String?] = ["client": "ios", "challenge": challenge, "hint": hint]
        if api.token != nil {
            struct Ticket: Decodable { let ticket: String }
            let data = try await api.send(api.authorized(api.url("api/mobile/link"), method: "POST"))
            query["link"] = try JSONDecoder().decode(Ticket.self, from: data).ticket
        }

        let callback: URL
        do {
            callback = try await session.authenticate(
                using: api.url("auth/\(provider.rawValue)", query: query),
                callbackURLScheme: Self.callbackScheme,
                preferredBrowserSession: .ephemeral
            )
        } catch ASWebAuthenticationSessionError.canceledLogin {
            return nil
        }

        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let error = items.first(where: { $0.name == "error" })?.value {
            throw APIError(status: 400, message: error)
        }
        guard let code = items.first(where: { $0.name == "code" })?.value else {
            throw APIError(status: 400, message: "The sign-in did not finish. Try again.")
        }
        // The server added the account to the signed-in user. The app keeps its token.
        if api.token != nil { return nil }

        struct Body: Encodable { let code, verifier, deviceName: String }
        struct Token: Decodable { let token: String }
        let data = try await api.json("POST", "api/mobile/token",
                                      body: Body(code: code, verifier: verifier, deviceName: UIDevice.current.name))
        return try JSONDecoder().decode(Token.self, from: data).token
    }

    static func randomToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return base64URL(Data(bytes))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
