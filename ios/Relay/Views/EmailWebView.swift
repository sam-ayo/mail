import OSLog
import SwiftUI
import WebKit

private let log = Logger(subsystem: "me.samayo.relay", category: "EmailWebView")

/// Shows one sanitized email document. The view grows to the height of the
/// email, and a wide email scales down to fit. Links open outside the app.
struct EmailWebView: UIViewRepresentable {
    static let scheme = "relay-attachment"

    let html: String
    var showQuotes = false
    @Binding var height: CGFloat?
    let api: APIClient
    var onMailto: (URL) -> Void = { _ in }
    @Environment(\.colorScheme) private var colorScheme

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Inline images use relative URLs, for example /api/attachments/<id>. They load with the token.
        configuration.setURLSchemeHandler(AttachmentSchemeHandler(api: api), forURLScheme: Self.scheme)
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let controller = configuration.userContentController
        controller.add(context.coordinator, contentWorld: .defaultClient, name: "height")
        controller.addUserScript(WKUserScript(source: Self.fitScript, injectionTime: .atDocumentEnd,
                                              forMainFrameOnly: true, in: .defaultClient))

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.loadHTMLString(html, baseURL: URL(string: "\(Self.scheme)://mail/"))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.applyState(webView)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
    }

    // The script runs in its own world, so the email's content security policy does not block it.
    private static let fitScript = """
    (() => {
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1';
      document.head.appendChild(meta);
      const style = document.createElement('style');
      // "flow-root" keeps the margins of the last element inside the body, so the height includes them.
      style.textContent = 'html.dark{background:transparent !important} body{padding:0 !important;display:flow-root}';
      document.head.appendChild(style);
      let last = 0;
      const fit = () => {
        const body = document.body;
        if (!body) return;
        body.style.zoom = '';
        const width = document.documentElement.scrollWidth, view = window.innerWidth;
        if (width > view + 2) body.style.zoom = String(view / width);
        // The bounding box already includes the zoom.
        const height = Math.ceil(body.getBoundingClientRect().height) + 8;
        if (Math.abs(height - last) > 1) {
          last = height;
          window.webkit.messageHandlers.height.postMessage(height);
        }
      };
      window.relayFit = fit;
      new ResizeObserver(fit).observe(document.body);
      for (const image of document.images) image.addEventListener('load', fit);
      fit();
    })();
    """

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var parent: EmailWebView
        private var loaded = false
        private var shownDark: Bool?
        private var shownQuotes: Bool?

        init(_ parent: EmailWebView) { self.parent = parent }

        func applyState(_ webView: WKWebView) {
            guard loaded else { return }
            let dark = parent.colorScheme == .dark
            let quotes = parent.showQuotes
            guard dark != shownDark || quotes != shownQuotes else { return }
            shownDark = dark
            shownQuotes = quotes
            webView.evaluateJavaScript("""
            document.documentElement.classList.toggle('dark', \(dark));
            document.body.classList.toggle('hide-quotes', \(!quotes));
            window.relayFit && window.relayFit();
            """, in: nil, in: .defaultClient)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            log.debug("finished load")
            loaded = true
            applyState(webView)
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            log.debug("height \(String(describing: message.body), privacy: .public)")
            guard let value = message.body as? Double else { return }
            let height = CGFloat(value)
            if abs((parent.height ?? 0) - height) > 1 { parent.height = height }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .cancel }
            log.debug("navigation \(url.absoluteString, privacy: .public) type \(action.navigationType.rawValue)")
            if url.scheme == EmailWebView.scheme || url.scheme == "about" {
                return action.navigationType == .linkActivated ? .cancel : .allow
            }
            open(url)
            return .cancel
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
            log.error("load failed: \(error.localizedDescription, privacy: .public)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
            log.error("provisional load failed: \(error.localizedDescription, privacy: .public)")
        }

        /// Links have target="_blank", so they ask for a new window.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { open(url) }
            return nil
        }

        private func open(_ url: URL) {
            switch url.scheme?.lowercased() {
            case "mailto": parent.onMailto(url)
            case "http", "https", "tel": UIApplication.shared.open(url)
            default: break
            }
        }
    }
}

/// Loads "relay-attachment://mail/<path>" from the server with the token.
final class AttachmentSchemeHandler: NSObject, WKURLSchemeHandler {
    private let api: APIClient
    private var tasks: [ObjectIdentifier: Task<Void, Never>] = [:]

    init(api: APIClient) { self.api = api }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        let id = ObjectIdentifier(urlSchemeTask)
        guard let url = urlSchemeTask.request.url,
              url.path.hasPrefix("/api/attachments/"),
              var components = URLComponents(url: api.baseURL, resolvingAgainstBaseURL: false) else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        components.path = url.path
        components.query = url.query
        let request = api.authorized(components.url!)
        tasks[id] = Task { [weak self] in
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard self?.tasks[id] != nil, !Task.isCancelled else { return }
                urlSchemeTask.didReceive(URLResponse(url: url, mimeType: response.mimeType,
                                                     expectedContentLength: data.count, textEncodingName: nil))
                urlSchemeTask.didReceive(data)
                urlSchemeTask.didFinish()
            } catch {
                if self?.tasks[id] != nil { urlSchemeTask.didFailWithError(error) }
            }
            self?.tasks[id] = nil
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        tasks.removeValue(forKey: ObjectIdentifier(urlSchemeTask))?.cancel()
    }
}
