import XCTest

/// Runs against a dev server with demo accounts. Set RELAY_SERVER_URL to the server.
/// Set RELAY_SHOTS to a folder to keep a screenshot of each step.
@MainActor
final class RelayUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() async throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-UITestReset"]
        if let server = ProcessInfo.processInfo.environment["RELAY_SERVER_URL"] {
            app.launchArguments += ["-serverURL", server]
        }
        app.launch()
    }

    func testDemoInboxFlow() {
        shot("01-sign-in")
        app.buttons["Try a demo inbox"].tap()

        // The unified inbox shows after sign-in.
        let firstRow = app.cells.firstMatch
        XCTAssertTrue(firstRow.waitForExistence(timeout: 20))
        sleep(2)
        shot("02-inbox")

        firstRow.tap()
        XCTAssertTrue(app.buttons["Archive"].waitForExistence(timeout: 20))
        sleep(3)
        shot("03-thread")

        app.buttons["Reply"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Reply"].waitForExistence(timeout: 10))
        // The first keyboard can show a typing tip.
        if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
        sleep(1)
        shot("04-reply")
        app.buttons["Cancel"].tap()

        app.buttons["Archive"].tap()
        XCTAssertTrue(app.staticTexts["Archived"].waitForExistence(timeout: 10))
        shot("05-archived")

        app.buttons["Undo"].tap()
        sleep(3)
        shot("06-undo")

        // The sidebar has the folders.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        sleep(1)
        shot("07-sidebar")
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        shot("08-settings")
    }

    /// HTML mail in dark mode, the unsubscribe banner, and a new message.
    func testHtmlMailAndSend() {
        app.terminate()
        app.launchArguments += ["-appearance", "dark"]
        app.launch()
        app.buttons["Try a demo inbox"].tap()
        XCTAssertTrue(app.cells.firstMatch.waitForExistence(timeout: 20))

        app.staticTexts["Stripe"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Archive"].waitForExistence(timeout: 20))
        sleep(3)
        shot("11-html-dark")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        let newsletter = app.staticTexts["How the best teams run incident reviews"].firstMatch
        if !newsletter.waitForExistence(timeout: 3) { app.swipeUp() }
        newsletter.tap()
        XCTAssertTrue(app.buttons["Archive"].waitForExistence(timeout: 20))
        sleep(3)
        shot("12-newsletter")
        XCTAssertTrue(app.buttons["Unsubscribe"].waitForExistence(timeout: 5))
        app.swipeUp()
        shot("12b-newsletter-end")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        app.buttons["Compose"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["New Message"].waitForExistence(timeout: 10))
        if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
        app.typeText("maya@northwind.io")
        app.textFields["Subject"].tap()
        app.typeText("Hello from iOS")
        app.textFields["Message"].tap()
        app.typeText("This is **Markdown** from the app.")
        shot("13-compose")
        XCTAssertTrue(app.buttons["Send"].isEnabled)
        app.buttons["Send"].tap()
        sleep(1)
        shot("14-sent")
        // The sheet closes after the server accepts the message.
        XCTAssertTrue(app.navigationBars["New Message"].waitForNonExistence(timeout: 20))
    }

    private func shot(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let folder = ProcessInfo.processInfo.environment["RELAY_SHOTS"] {
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
        }
    }
}
