import Foundation
import Observation

/// The conversations in one mailbox, with search, pages, and actions.
@Observable
final class MailboxModel {
    let mailbox: Mailbox
    private unowned let app: AppModel

    var query = ""
    private(set) var threads: [ThreadSummary] = []
    private(set) var errors: [AccountError] = []
    private(set) var loadError: String?
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var loadedAt: Date?
    private var nextCursor: String?
    /// The search of the shown list. A change to `query` applies when the person submits it.
    private(set) var appliedQuery = ""

    init(mailbox: Mailbox, app: AppModel) {
        self.mailbox = mailbox
        self.app = app
    }

    var hasMore: Bool { nextCursor != nil }

    func thread(_ key: String) -> ThreadSummary? { threads.first { $0.id == key } }

    /// Loads the first page. Data newer than `maxAge` stays, because each list load uses provider quota.
    func load(maxAge: TimeInterval = 0) async {
        if let loadedAt, Date.now.timeIntervalSince(loadedAt) < maxAge, appliedQuery == query { return }
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        let search = query.trimmingCharacters(in: .whitespaces)
        do {
            let page = try await fetch(cursor: nil, query: search)
            threads = page.threads
            errors = page.errors
            nextCursor = page.nextCursor
            appliedQuery = search
            loadError = nil
            loadedAt = .now
        } catch {
            if !error.isCancellation { loadError = error.localizedDescription }
        }
    }

    func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore, !isLoading else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await fetch(cursor: cursor, query: appliedQuery)
            let known = Set(threads.map(\.id))
            threads += page.threads.filter { !known.contains($0.id) }
            nextCursor = page.nextCursor
        } catch {
            app.show(error.localizedDescription)
        }
    }

    private func fetch(cursor: String?, query: String) async throws -> ThreadPage {
        try await app.api.get("api/v1/threads", query: [
            "scope": mailbox.scope,
            "folder": mailbox.folder.rawValue,
            "q": query.isEmpty ? nil : query,
            "cursor": cursor,
        ])
    }

    // MARK: Actions

    /// Changes the list at once, then asks the server. A failure puts the list back.
    func perform(_ action: ThreadAction, on thread: ThreadSummary, quiet: Bool = false) {
        let before = threads
        apply(action, to: thread.id)
        Task {
            do {
                let results = try await send(action, targets: thread.refs)
                if action == .read || action == .unread { await app.loadCounts() }
                guard !quiet else { return }
                app.show(action.pastTense) {
                    self.undo(action, on: thread, newRefs: results)
                }
            } catch {
                threads = before
                app.show(error.localizedDescription)
            }
        }
    }

    /// Updates the list for an action that another screen did, for example the reading pane.
    func apply(_ action: ThreadAction, to key: String) {
        guard let index = threads.firstIndex(where: { $0.id == key }) else { return }
        if action.removes(from: mailbox.folder) {
            threads.remove(at: index)
            return
        }
        switch action {
        case .star: threads[index].starred = true
        case .unstar: threads[index].starred = false
        case .read: threads[index].unread = false
        case .unread: threads[index].unread = true
        default: break
        }
    }

    private func undo(_ action: ThreadAction, on thread: ThreadSummary, newRefs: [ThreadRef]) {
        Task {
            do {
                // An IMAP move gives the message a new ID. The undo must use it.
                _ = try await send(action.inverse, targets: newRefs.isEmpty ? thread.refs : newRefs)
                await load()
                await app.loadCounts()
            } catch {
                app.show(error.localizedDescription)
            }
        }
    }

    /// Returns the IDs of the threads after the action.
    private func send(_ action: ThreadAction, targets: [ThreadRef]) async throws -> [ThreadRef] {
        struct Target: Encodable { let accountId, threadId: String }
        struct Body: Encodable { let action: ThreadAction; let targets: [Target] }
        struct Result: Decodable { let accountId, newThreadId: String }
        struct Failure: Decodable { let message: String }
        struct Response: Decodable { let results: [Result]; let errors: [Failure] }
        let data = try await app.api.json("POST", "api/threads", body: Body(
            action: action,
            targets: targets.map { Target(accountId: $0.accountId, threadId: $0.id) }
        ))
        let response = try JSONDecoder().decode(Response.self, from: data)
        if response.results.isEmpty, let failure = response.errors.first {
            throw APIError(status: 502, message: failure.message)
        }
        return response.results.map { ThreadRef(accountId: $0.accountId, id: $0.newThreadId) }
    }
}
