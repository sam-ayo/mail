import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ComposeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var draft: ComposeDraft
    /// The draft as it opened. A reply has a recipient and a subject before the person types.
    private let initial: ComposeDraft

    init(draft: ComposeDraft) {
        _draft = State(initialValue: draft)
        initial = draft
    }
    @State private var showCcBcc = false
    @State private var sending = false
    @State private var error: String?
    @State private var importingFile = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var confirmDiscard = false
    @FocusState private var focus: Field?

    private enum Field { case to, cc, bcc, subject, body }

    private static let maxBytes = 25 * 1024 * 1024
    private var totalBytes: Int { draft.attachments.reduce(0) { $0 + $1.data.count } }
    private var canSend: Bool {
        !sending && !(draft.to + draft.cc + draft.bcc).trimmingCharacters(in: .whitespaces).isEmpty
    }
    private var isEmpty: Bool {
        draft.to == initial.to && draft.cc == initial.cc && draft.bcc == initial.bcc
            && draft.subject == initial.subject && draft.body == initial.body && draft.attachments.isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    addressField("To", text: $draft.to, field: .to)
                    if showCcBcc || !draft.cc.isEmpty || !draft.bcc.isEmpty {
                        addressField("Cc", text: $draft.cc, field: .cc)
                        addressField("Bcc", text: $draft.bcc, field: .bcc)
                    } else {
                        Button("Cc/Bcc, From: \(app.account(draft.accountId)?.email ?? "")") { showCcBcc = true }
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if showCcBcc && app.accounts.count > 1 && draft.reply == nil {
                        Picker("From", selection: $draft.accountId) {
                            ForEach(app.accounts) { Text($0.email).tag($0.id) }
                        }
                    }
                    TextField("Subject", text: $draft.subject)
                        .focused($focus, equals: .subject)
                }
                Section {
                    TextField("Message", text: $draft.body, axis: .vertical)
                        .lineLimit(10...)
                        .focused($focus, equals: .body)
                } footer: {
                    if draft.quoted != nil {
                        Text(draft.reply?.kind == .forward
                             ? "The forwarded message goes under your text."
                             : "The original message goes under your reply.")
                    }
                }
                if !draft.attachments.isEmpty {
                    Section("Attachments") {
                        ForEach(draft.attachments) { file in
                            HStack {
                                Image(systemName: "paperclip")
                                Text(file.filename).lineLimit(1)
                                Spacer()
                                Text(file.data.count.formatted(.byteCount(style: .file))).foregroundStyle(.secondary)
                            }
                        }
                        .onDelete { draft.attachments.remove(atOffsets: $0) }
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle(draft.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") {
                        if isEmpty { dismiss() } else { confirmDiscard = true }
                    }
                    .confirmationDialog("Discard this message?", isPresented: $confirmDiscard) {
                        Button("Discard", role: .destructive) { dismiss() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send", systemImage: "arrow.up") { Task { await send() } }
                        .buttonStyle(.glassProminent)
                        .disabled(!canSend)
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    PhotosPicker(selection: $photos, matching: .images) {
                        Label("Photos", systemImage: "photo")
                    }
                    Button("Files", systemImage: "paperclip") { importingFile = true }
                    Spacer()
                }
            }
            .fileImporter(isPresented: $importingFile, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                addFiles(result)
            }
            .onChange(of: photos) { _, items in
                Task { await addPhotos(items) }
            }
            .overlay { if sending { ProgressView("Sending…").padding().glassEffect() } }
            .interactiveDismissDisabled(!isEmpty)
            .onAppear { focus = draft.to.isEmpty ? .to : .body }
        }
    }

    private func addressField(_ label: String, text: Binding<String>, field: Field) -> some View {
        LabeledContent(label) {
            TextField("", text: text, prompt: Text(""))
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focus, equals: field)
        }
    }

    private func addFiles(_ result: Result<[URL], any Error>) {
        guard case .success(let urls) = result else { return }
        for url in urls {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            add(DraftAttachment(filename: url.lastPathComponent, mimeType: type, data: data))
        }
    }

    private func addPhotos(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        for (index, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let type = item.supportedContentTypes.first ?? .jpeg
            let ext = type.preferredFilenameExtension ?? "jpg"
            add(DraftAttachment(filename: "Photo \(draft.attachments.count + index + 1).\(ext)",
                                mimeType: type.preferredMIMEType ?? "image/jpeg", data: data))
        }
        photos = []
    }

    private func add(_ file: DraftAttachment) {
        if totalBytes + file.data.count > Self.maxBytes {
            error = "Attachments must be 25 MB or less in total."
            return
        }
        draft.attachments.append(file)
    }

    private func send() async {
        sending = true
        error = nil
        defer { sending = false }
        do {
            try await app.send(draft)
            app.show("Message sent")
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
