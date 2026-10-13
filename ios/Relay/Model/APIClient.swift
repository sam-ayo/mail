import Foundation

struct APIError: LocalizedError {
    let status: Int
    let message: String
    /// The mail provider rejected the account credentials.
    var reauth = false

    var errorDescription: String? { message }
}

/// Calls the Relay server. Each request sends the bearer token.
final class APIClient {
    var baseURL: URL
    var token: String?
    /// Runs when the server rejects the token.
    var onUnauthorized: (() -> Void)?

    init(baseURL: URL, token: String?) {
        self.baseURL = baseURL
        self.token = token
    }

    func url(_ path: String, query: [String: String?] = [:]) -> URL {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
        if !items.isEmpty { components.queryItems = items.sorted { $0.name < $1.name } }
        return components.url!
    }

    func authorized(_ url: URL, method: String = "GET") -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }

    @discardableResult
    func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw error(status: status, data: data) }
        return data
    }

    private func error(status: Int, data: Data) -> APIError {
        struct Body: Decodable {
            let error: String?
            let reauth: Bool?
        }
        let body = try? JSONDecoder().decode(Body.self, from: data)
        // A 401 with no JSON body means that the token is not valid.
        if status == 401, body == nil, token != nil { onUnauthorized?() }
        let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let message = body?.error ?? (text?.isEmpty == false && text!.count < 200 ? text! : "The server sent an error (HTTP \(status)).")
        return APIError(status: status, message: message, reauth: body?.reauth ?? false)
    }

    func get<T: Decodable>(_ path: String, query: [String: String?] = [:], as type: T.Type = T.self) async throws -> T {
        let data = try await send(authorized(url(path, query: query)))
        return try JSONDecoder.relay.decode(T.self, from: data)
    }

    @discardableResult
    func json(_ method: String, _ path: String, body: some Encodable) async throws -> Data {
        var request = authorized(url(path), method: method)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }
}

/// A multipart/form-data body, for /api/send.
struct MultipartForm {
    let boundary = "relay-\(UUID().uuidString)"
    private(set) var body = Data()

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    mutating func add(_ name: String, _ value: String) {
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
    }

    mutating func add(_ name: String, filename: String, mimeType: String, data: Data) {
        let safeName = filename.replacingOccurrences(of: "\"", with: "'")
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(safeName)\"\r\nContent-Type: \(mimeType)\r\n\r\n")
        body.append(data)
        body.append("\r\n")
    }

    func finished() -> Data {
        var result = body
        result.append("--\(boundary)--\r\n")
        return result
    }
}

private extension Data {
    mutating func append(_ text: String) { append(Data(text.utf8)) }
}
