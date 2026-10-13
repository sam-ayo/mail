import SwiftUI
import UIKit

/// Photos and company logos from /api/avatar. The cache keeps misses too.
@Observable
final class AvatarCache {
    static let shared = AvatarCache()
    private var images: [String: UIImage?] = [:]
    private var pending: [String: Task<UIImage?, Never>] = [:]

    func image(for email: String, api: APIClient) async -> UIImage? {
        let key = email.lowercased()
        if let cached = images[key] { return cached }
        if let task = pending[key] { return await task.value }
        let task = Task<UIImage?, Never> {
            let request = api.authorized(api.url("api/avatar", query: ["email": key]))
            guard let data = try? await api.send(request) else { return nil }
            return UIImage(data: data)
        }
        pending[key] = task
        let image = await task.value
        images[key] = image
        pending[key] = nil
        return image
    }
}

struct AvatarView: View {
    @Environment(AppModel.self) private var app
    let address: Address?
    var size: CGFloat = 36
    @State private var image: UIImage?

    private var initials: String {
        guard let address else { return "?" }
        let words = address.displayName.split(whereSeparator: { $0 == " " || $0 == "." || $0 == "_" })
        return words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }

    private var color: Color {
        let key = address?.email.lowercased() ?? ""
        let hash = key.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xffff }
        return Color(hex: accountColors[hash % accountColors.count])
    }

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill().background(.white)
            } else {
                color.opacity(0.85)
                Text(initials)
                    .font(.system(size: size * 0.4, weight: .semibold))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .task(id: address?.email) {
            guard let email = address?.email else { return }
            image = await AvatarCache.shared.image(for: email, api: app.api)
        }
    }
}
