import XCTest

/// 시뮬레이터에서 실제로 탭·스크롤·길게 누르기를 해서 동작을 확인한다.
///
/// 준비(맥): 시험용 tmux 세션 `pitest` + 시험용 브리지(포트 8799)
///   - 창 0: 긴 대화가 있는 pi(채팅 화면 확인용)
///   - 창 1: 새 pi(Haiku, 보내기 확인용)
///   - 창 2~4: 닫기 확인용 셸
/// 실행: TEST_RUNNER_PI_REMOTE_TOKEN=<토큰> xcodebuild test ...
final class PiRemoteUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        let env = ProcessInfo.processInfo.environment
        app.launchEnvironment["PI_REMOTE_TOKEN"] = env["PI_REMOTE_TOKEN"] ?? ""
        app.launchEnvironment["PI_REMOTE_PORT"] = env["PI_REMOTE_PORT"] ?? "8799"
        // 맥 주소는 짝짓기 QR 로 받는 값 → 시험에서는 이 맥(시험 브리지)을 바로 가리킴(자동 발견에 기대지 않게)
        app.launchEnvironment["PI_REMOTE_HOSTS"] = env["PI_REMOTE_HOSTS"] ?? "127.0.0.1"
        app.launchEnvironment["PI_REMOTE_PERF"] = "1"
        app.launchEnvironment["PI_REMOTE_RESET_SENDMODE"] = "1"
        app.launchEnvironment["PI_REMOTE_NO_PUSH"] = "1"   // 알림 권한 창이 화면을 가리지 않게
        app.launch()
    }

    private func el(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func waitGone(_ e: XCUIElement, _ timeout: TimeInterval = 5) -> Bool {
        let exp = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: e)
        return XCTWaiter().wait(for: [exp], timeout: timeout) == .completed
    }

    /// 왼쪽 서랍 열기(☰ 버튼)
    private func openDrawer() {
        if el("drawer").exists { return }
        let b = el("drawerButton")
        XCTAssertTrue(b.waitForExistence(timeout: 20), "서랍 버튼이 보여야 함")
        b.tap()
        XCTAssertTrue(el("drawer").waitForExistence(timeout: 5), "서랍이 열려야 함")
    }

    /// 서랍 오른쪽 어두운 막을 눌러 닫기
    private func closeDrawer() {
        guard el("drawer").exists else { return }
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.94, dy: 0.5)).tap()
        _ = waitGone(el("drawer"), 5)
    }

    private func openTab(_ index: Int) {
        openDrawer()
        let tab = el("tab-\(index)")
        XCTAssertTrue(tab.waitForExistence(timeout: 20), "탭 \(index) 이 보여야 함")
        tab.tap()
        _ = waitGone(el("drawer"), 5)
        sleep(2)
    }

    /// 앞 시험이 답하지 않고 남긴 질문 카드가 있으면 정지 버튼으로 치움(뒤 시험이 그 질문에 답해 버리지 않게)
    private func clearPendingQuestion() {
        guard el("questionCard").waitForExistence(timeout: 2) else { return }
        if el("stopButton").exists { el("stopButton").tap() }
        _ = waitGone(el("questionCard"), 10)
        if el("stopButton").waitForExistence(timeout: 2) { _ = waitGone(el("stopButton"), 30) }
    }

    /// 탭 개수(☰ 버튼 값)
    private func tabCount() -> Int {
        let b = el("drawerButton")
        _ = b.waitForExistence(timeout: 10)
        return Int(b.value as? String ?? "") ?? 0
    }

    /// 1. 키보드가 올라온 상태에서 대화를 탭하면 키보드가 내려가야 한다
    func test1_TapChatDismissesKeyboard() {
        openTab(0)
        XCTAssertTrue(el("chatScroll").waitForExistence(timeout: 10), "채팅 화면이어야 함")
        el("composerInput").tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "입력창을 누르면 키보드가 올라와야 함")
        el("chatScroll").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(waitGone(app.keyboards.firstMatch), "대화를 탭하면 키보드가 내려가야 함")
    }

    /// 2. 위로 스크롤하면 ↓ 버튼이 뜨고, 누르면 맨 아래로 가서 버튼이 사라져야 한다
    func test2_ScrollUpShowsJumpButton() {
        openTab(0)
        let chat = el("chatScroll")
        XCTAssertTrue(chat.waitForExistence(timeout: 10))
        XCTAssertFalse(el("scrollToBottom").exists, "맨 아래에선 ↓ 버튼이 없어야 함")
        chat.swipeDown(velocity: .fast)
        chat.swipeDown(velocity: .fast)
        XCTAssertTrue(el("scrollToBottom").waitForExistence(timeout: 5), "위로 올리면 ↓ 버튼이 떠야 함")
        el("scrollToBottom").tap()
        XCTAssertTrue(waitGone(el("scrollToBottom")), "↓ 를 누르면 맨 아래로 가서 버튼이 사라져야 함")
    }

    /// 3. 서랍에서 탭을 길게 눌러 한글 이름으로 바꾸면 한글이 그대로 보여야 한다
    func test3_RenameTabKorean() {
        openDrawer()
        let tab = el("tab-1")
        XCTAssertTrue(tab.waitForExistence(timeout: 20))
        tab.press(forDuration: 1.0)
        let menuRename = app.buttons["이름 바꾸기"]
        XCTAssertTrue(menuRename.waitForExistence(timeout: 5), "길게 누르면 메뉴에 이름 바꾸기가 있어야 함")
        menuRename.tap()
        let alert = app.alerts["창 이름 바꾸기"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "이름 바꾸기 창이 떠야 함")
        let field = alert.textFields.firstMatch
        field.tap()
        if let old = field.value as? String {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count + 2))
        }
        field.typeText("테스트창")
        alert.buttons["바꾸기"].tap()
        let renamed = NSPredicate(format: "label CONTAINS '테스트창'")
        let exp = expectation(for: renamed, evaluatedWith: el("tab-1"))
        XCTAssertEqual(XCTWaiter().wait(for: [exp], timeout: 6), .completed,
                       "탭 이름이 '테스트창'으로 보여야 함(현재: \(el("tab-1").label))")
        closeDrawer()
    }

    /// 4. 서랍에서 길게 눌러 창 닫기를 세 번 연달아 해도 매번 닫혀야 한다
    func test4_CloseTabsByLongPress() {
        openDrawer()
        XCTAssertTrue(el("tab-0").waitForExistence(timeout: 20))
        sleep(2)
        for round in 1...3 {
            let before = tabCount()
            let lastIndex = (0..<10).reversed().first { el("tab-\($0)").exists } ?? 0
            XCTAssertGreaterThan(lastIndex, 1, "닫을 시험 창이 남아 있어야 함")
            el("tab-\(lastIndex)").press(forDuration: 1.0)
            let menuClose = app.buttons["창 닫기"]
            XCTAssertTrue(menuClose.waitForExistence(timeout: 5), "\(round)번째: 길게 누르면 메뉴에 창 닫기가 있어야 함")
            menuClose.tap()
            let confirm = app.buttons.matching(identifier: "창 닫기").firstMatch
            XCTAssertTrue(confirm.waitForExistence(timeout: 5), "\(round)번째: 닫기 확인창이 떠야 함")
            confirm.tap()
            let exp = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: el("tab-\(lastIndex)"))
            XCTAssertEqual(XCTWaiter().wait(for: [exp], timeout: 6), .completed, "\(round)번째: 창이 닫혀야 함")
            XCTAssertEqual(tabCount(), before - 1, "\(round)번째: 탭이 하나 줄어야 함")
        }
        closeDrawer()
    }

    /// 5. pi 가 작업 중일 때 보내도 1초 안에 입력창이 비고 내 말풍선이 떠야 한다
    func test5_SendWhileWorkingIsImmediate() {
        openTab(1)
        XCTAssertTrue(el("chatScroll").waitForExistence(timeout: 10), "채팅 화면이어야 함")
        let input = el("composerInput")
        input.tap()
        input.typeText("Write the numbers 1 to 40, one per line, each followed by a short fruit name.")
        el("sendButton").tap()
        XCTAssertTrue(el("stopButton").waitForExistence(timeout: 15), "pi 가 작업을 시작해야 함(정지 버튼)")
        sleep(2)
        input.tap()
        input.typeText("thanks")
        let start = Date()
        el("sendButton").tap()
        let cleared = NSPredicate(format: "NOT (value CONTAINS 'thanks')")
        let exp = expectation(for: cleared, evaluatedWith: input)
        XCTAssertEqual(XCTWaiter().wait(for: [exp], timeout: 8), .completed, "입력창이 비어야 함")
        let clearTime = Date().timeIntervalSince(start)
        // 대기 말풍선이 떴다가 pi 가 바로 대화에 넣으면 진짜 말풍선으로 바뀌므로, 어느 쪽이든 "thanks" 말풍선이 보이면 통과
        let mine = app.staticTexts.matching(NSPredicate(format: "label == 'thanks'")).firstMatch
        XCTAssertTrue(mine.waitForExistence(timeout: 8), "보낸 메시지가 대화에 보여야 함")
        let bubbleTime = Date().timeIntervalSince(start)
        print("측정: 입력창 비움 \(String(format: "%.2f", clearTime))초, 말풍선 \(String(format: "%.2f", bubbleTime))초")
        // 정리: 작업 중지
        if el("stopButton").exists { el("stopButton").tap() }
    }

    /// 6. 끝난 답변 아래 복사 버튼을 누르면 "복사됨"으로 바뀌어야 한다
    func test6_CopyAnswer() {
        openTab(0)
        let copy = el("copyAnswer")
        XCTAssertTrue(copy.waitForExistence(timeout: 10), "끝난 답변 아래에 복사 버튼이 있어야 함")
        copy.tap()
        let done = expectation(for: NSPredicate(format: "label == '복사됨'"), evaluatedWith: copy)
        XCTAssertEqual(XCTWaiter().wait(for: [done], timeout: 3), .completed, "누르면 '복사됨'으로 바뀌어야 함")
    }

    /// 7. 쓰던 글은 앱을 껐다 켜도 남아 있어야 한다
    func test7_DraftPersists() {
        openTab(1)
        let input = el("composerInput")
        input.tap()
        input.typeText("draft keep test")
        app.terminate()
        app.launch()
        let kept = expectation(for: NSPredicate(format: "value CONTAINS 'draft keep test'"), evaluatedWith: el("composerInput"))
        XCTAssertEqual(XCTWaiter().wait(for: [kept], timeout: 15), .completed, "다시 켜도 쓰던 글이 남아야 함")
        el("composerInput").tap()
        el("composerInput").typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20))
    }

    /// 8. 연결이 안 된 동안엔 보내기 버튼이 막히고, 쓴 글은 그대로 남아야 한다
    func test8_SendBlockedWhenDisconnected() {
        app.terminate()
        app.launchEnvironment["PI_REMOTE_PORT"] = "8790"   // 아무것도 없는 포트 → 연결 안 됨
        app.launch()
        let input = el("composerInput")
        XCTAssertTrue(input.waitForExistence(timeout: 15), "저장된 대화와 입력창이 보여야 함")
        input.tap()
        input.typeText("offline test")
        XCTAssertTrue(el("sendButtonDisabled").waitForExistence(timeout: 3), "연결 전엔 보내기 버튼이 막혀야 함")
        XCTAssertFalse(el("sendButton").exists, "보내기 버튼이 눌리면 안 됨")
        XCTAssertTrue((input.value as? String ?? "").contains("offline test"), "쓴 글은 남아 있어야 함")
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20))
    }

    /// 9. 작업 중에 보낸 메시지는 바로 "다음 단계에서 전달돼요"로 보이고, 실제로 들어가면 표시가 사라지며
    ///    한 번만 보여야 한다. 이어서 코드 복사, 새 대화까지 확인.
    func test9_QueuedMessageThenNewChat() {
        openTab(1)
        let input = el("composerInput")
        input.tap()
        input.typeText("Run bash 'sleep 6; echo a', then run 'sleep 6; echo b'. Finally reply with a short python code block that prints hello.")
        el("sendButton").tap()
        XCTAssertTrue(el("stopButton").waitForExistence(timeout: 15), "pi 가 작업을 시작해야 함")
        sleep(3)
        el("sendModeMenu").tap()
        app.buttons["바로 반영"].tap()
        let note = "note \(Int(Date().timeIntervalSince1970) % 100000)"   // 실행마다 다른 글(이전 대화와 안 겹치게)
        input.tap()
        input.typeText(note)
        el("sendButton").tap()
        let caption = app.staticTexts["다음 단계에서 전달돼요"]
        XCTAssertTrue(caption.waitForExistence(timeout: 3), "보내자마자 '다음 단계에서 전달돼요'가 보여야 함")
        XCTAssertTrue(waitGone(caption, 30), "pi 가 넣으면 대기 표시가 사라져야 함")
        let mine = app.staticTexts.matching(NSPredicate(format: "label == %@", note))
        XCTAssertEqual(mine.count, 1, "보낸 메시지는 한 번만 보여야 함(중복 없음)")
        XCTAssertTrue(waitGone(el("stopButton"), 90), "작업이 끝나야 함")
        // 끼워 넣은 말에 따라 모델이 원래 일을 그만둘 수 있으므로(정상), 코드 블록은 따로 요청
        input.tap()
        input.typeText("Reply only with a short python code block that prints hello.")
        el("sendButton").tap()
        sleep(2)
        XCTAssertTrue(waitGone(el("stopButton"), 60), "답이 끝나야 함")
        // 같은 대화의 앞선 코드 블록(화면 위쪽에 가려진 것)이 아니라 방금 받은 마지막 코드 블록의 복사 버튼
        let codes = app.buttons.matching(identifier: "copyCode")
        XCTAssertTrue(codes.firstMatch.waitForExistence(timeout: 10), "코드 블록에 복사 버튼이 있어야 함")
        // 답이 끝난 직후 마지막 메시지를 최종본으로 다시 그리는 순간에 누르면 버튼이 새로 만들어져 '복사됨'이 사라질 수 있음 → 잠깐 기다리고, 안 되면 한 번 더
        sleep(1)
        var copiedOK = false
        for _ in 1...2 where !copiedOK {
            let code = codes.element(boundBy: codes.count - 1)
            code.tap()
            let copied = expectation(for: NSPredicate(format: "label == '복사됨'"), evaluatedWith: code)
            copiedOK = XCTWaiter().wait(for: [copied], timeout: 2) == .completed
        }
        XCTAssertTrue(copiedOK, "코드 복사 후 '복사됨'")
        // 새 대화
        el("moreMenu").tap()
        app.buttons["새 대화"].tap()
        let start = app.buttons["새 대화 시작"]
        XCTAssertTrue(start.waitForExistence(timeout: 5), "새 대화 확인창이 떠야 함")
        start.tap()
        XCTAssertTrue(waitGone(app.staticTexts[note].firstMatch, 15), "새 대화를 시작하면 이전 대화가 사라져야 함")
        // 새 대화는 기본 모델로 돌아가므로, 메뉴로 Haiku·생각 끄기를 다시 고른다(모델·생각 메뉴 확인도 겸함)
        el("modelMenu").tap()
        menuItem("Haiku 4.5").tap()   // 모델 메뉴는 한 목록(자동 계정)
        let haiku = expectation(for: NSPredicate(format: "label CONTAINS 'Haiku'"), evaluatedWith: el("modelMenu"))
        XCTAssertEqual(XCTWaiter().wait(for: [haiku], timeout: 8), .completed, "모델 칩이 Haiku 로 바뀌어야 함")
        el("thinkingMenu").tap()
        app.buttons["끄기"].tap()
        let off = expectation(for: NSPredicate(format: "label CONTAINS 'off'"), evaluatedWith: el("thinkingMenu"))
        XCTAssertEqual(XCTWaiter().wait(for: [off], timeout: 8), .completed, "생각 깊이 칩이 off 로 바뀌어야 함")
    }

    private func relaunch(test: String) {
        app.terminate()
        app.launchEnvironment["PI_REMOTE_TEST"] = test
        app.launch()
    }

    /// A. 사진을 붙이면 입력창에 썸네일(올리는 중→완료), 보내면 말풍선에 썸네일로 보이고 경로 글자는 안 보여야 한다
    func testA_AttachAndSend() {
        relaunch(test: "attach")
        openTab(1)   // 모델 호출은 Haiku 창(탭 1)에서만
        let thumb = el("attachmentThumb")
        XCTAssertTrue(thumb.waitForExistence(timeout: 15), "붙인 사진이 입력창에 보여야 함")
        let ready = expectation(for: NSPredicate(format: "value == 'ready'"), evaluatedWith: thumb)
        XCTAssertEqual(XCTWaiter().wait(for: [ready], timeout: 15), .completed, "사진이 맥에 올라가 완료돼야 함(현재: \(thumb.value ?? "-"))")
        let input = el("composerInput")
        input.tap()
        input.typeText("photo check")
        el("sendButton").tap()
        XCTAssertTrue(waitGone(thumb), "보내면 입력창 썸네일이 사라져야 함")
        XCTAssertTrue(el("bubbleThumb").waitForExistence(timeout: 5), "말풍선에 사진 썸네일이 보여야 함")
        XCTAssertTrue(app.staticTexts["photo check"].waitForExistence(timeout: 5), "글은 말풍선으로 보여야 함")
        let pathText = app.staticTexts.matching(NSPredicate(format: "label CONTAINS '.cache/pi-remote'"))
        XCTAssertEqual(pathText.count, 0, "사진 경로 글자는 보이면 안 됨")
        if el("stopButton").waitForExistence(timeout: 3) { _ = waitGone(el("stopButton"), 60) }
    }

    /// B. 붙인 사진은 x 로 뺄 수 있어야 한다
    func testB_RemoveAttachment() {
        relaunch(test: "attach")
        let thumb = el("attachmentThumb")
        XCTAssertTrue(thumb.waitForExistence(timeout: 15))
        el("attachmentRemove").tap()
        XCTAssertTrue(waitGone(thumb), "x 를 누르면 사진이 빠져야 함")
        XCTAssertTrue(el("sendButtonDisabled").exists, "보낼 게 없으면 보내기 버튼이 막혀야 함")
    }

    /// C. 작업 중엔 실행 시점 칩이 보이고, '끝나고 실행'으로 보내면 그 안내가 떠야 한다
    func testC_SendModeFollowUp() {
        relaunch(test: "")
        openTab(1)   // 모델 호출은 Haiku 창(탭 1)에서만
        let input = el("composerInput")
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        input.tap()
        input.typeText("Run bash 'sleep 8; echo done' and then say finished.")
        el("sendButton").tap()
        XCTAssertTrue(el("stopButton").waitForExistence(timeout: 15), "작업이 시작돼야 함")
        let mode = el("sendModeMenu")
        XCTAssertTrue(mode.waitForExistence(timeout: 5), "작업 중엔 실행 시점 칩이 보여야 함")
        mode.tap()
        app.buttons["끝나고 실행"].tap()
        input.tap()
        input.typeText("say later")
        el("sendButton").tap()
        XCTAssertTrue(app.staticTexts["작업이 끝나면 실행돼요"].waitForExistence(timeout: 4), "'작업이 끝나면 실행돼요' 안내가 보여야 함")
        XCTAssertTrue(waitGone(el("stopButton"), 90), "작업이 끝나야 함")
        // 다음 시험을 위해 기본(바로 반영)으로 되돌림
        input.tap()
        input.typeText("x")
        input.typeText(XCUIKeyboardKey.delete.rawValue)
    }

    /// D. 자동: 모델이 답을 쓰는 중에 보내면 기다리지 않고 바로 들어가야 한다(쓰던 답은 멈춤)
    func testD_AutoWhileGenerating() {
        relaunch(test: "")
        openTab(1)
        let input = el("composerInput")
        input.tap()
        input.typeText("Write a long 400 word story about the sea. Do not use any tools.")
        el("sendButton").tap()
        XCTAssertTrue(el("stopButton").waitForExistence(timeout: 15), "작업이 시작돼야 함")
        sleep(3)   // 답을 쓰는 중
        input.tap()
        input.typeText("auto now: just say OK")
        let start = Date()
        el("sendButton").tap()
        // 대화에 진짜로 들어간 말풍선(대기 표시 없이)이 몇 초 안에 보여야 함
        let delivered = app.staticTexts["auto now: just say OK"]
        XCTAssertTrue(delivered.waitForExistence(timeout: 8), "보낸 메시지가 보여야 함")
        XCTAssertTrue(waitGone(app.staticTexts["곧 전달돼요"], 10), "자동이면 곧 대화에 들어가 대기 표시가 사라져야 함")
        print("측정: 자동(답 쓰는 중) 전달까지 \(String(format: "%.1f", Date().timeIntervalSince(start)))초")
        XCTAssertTrue(waitGone(el("stopButton"), 90), "작업이 끝나야 함")
    }

    /// E. 자동: 명령 실행 중에 보내면 명령은 끊지 않고, 끝나는 즉시 들어가야 한다
    func testE_AutoWhileTool() {
        relaunch(test: "")
        openTab(1)
        let input = el("composerInput")
        input.tap()
        input.typeText("Run bash 'sleep 10; echo tool-finished' and report the output.")
        el("sendButton").tap()
        XCTAssertTrue(el("stopButton").waitForExistence(timeout: 15), "작업이 시작돼야 함")
        sleep(5)   // sleep 10 실행 중
        input.tap()
        input.typeText("auto during tool")
        el("sendButton").tap()
        XCTAssertTrue(app.staticTexts["다음 단계에서 전달돼요"].waitForExistence(timeout: 5),
                      "명령 실행 중이면 끊지 않고 대기해야 함(다음 단계에서 전달)")
        XCTAssertTrue(waitGone(app.staticTexts["다음 단계에서 전달돼요"], 30), "명령이 끝나면 바로 들어가야 함")
        XCTAssertTrue(waitGone(el("stopButton"), 90), "작업이 끝나야 함")
    }

    /// F. 채팅 속 사진을 탭하면 전체화면으로 열리고, 두 손가락 확대·두 번 탭 확대/원래대로·닫기가 돼야 한다
    func testF_ImageViewerZoom() {
        relaunch(test: "attach")
        openTab(1)
        let thumb = el("attachmentThumb")
        XCTAssertTrue(thumb.waitForExistence(timeout: 15))
        let ready = expectation(for: NSPredicate(format: "value == 'ready'"), evaluatedWith: thumb)
        XCTAssertEqual(XCTWaiter().wait(for: [ready], timeout: 15), .completed)
        el("composerInput").tap()
        el("composerInput").typeText("viewer test: say ok")
        el("sendButton").tap()
        let bubble = app.descendants(matching: .any).matching(identifier: "bubbleThumb").firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 8), "말풍선에 사진이 보여야 함")
        bubble.tap()
        let viewer = el("imageViewer")
        XCTAssertTrue(viewer.waitForExistence(timeout: 5), "사진을 탭하면 전체화면이 열려야 함")
        XCTAssertEqual(viewer.value as? String, "1.0", "처음엔 원래 크기")
        viewer.pinch(withScale: 3, velocity: 2)
        let zoomed = expectation(for: NSPredicate(format: "value != '1.0'"), evaluatedWith: viewer)
        XCTAssertEqual(XCTWaiter().wait(for: [zoomed], timeout: 3), .completed, "두 손가락으로 확대돼야 함(현재 \(viewer.value ?? "-"))")
        viewer.doubleTap()
        let reset = expectation(for: NSPredicate(format: "value == '1.0'"), evaluatedWith: viewer)
        XCTAssertEqual(XCTWaiter().wait(for: [reset], timeout: 3), .completed, "확대 중 두 번 탭하면 원래 크기로")
        viewer.doubleTap()
        let dbl = expectation(for: NSPredicate(format: "value == '2.5'"), evaluatedWith: viewer)
        XCTAssertEqual(XCTWaiter().wait(for: [dbl], timeout: 3), .completed, "원래 크기에서 두 번 탭하면 2.5배")
        el("viewerClose").tap()
        XCTAssertTrue(waitGone(viewer), "X 를 누르면 닫혀야 함")
        if el("stopButton").waitForExistence(timeout: 2) { _ = waitGone(el("stopButton"), 60) }
    }

    /// G. 전체화면에서 좌우로 밀면 이전·다음 사진, 아래로 쓸어내리면 닫혀야 한다
    /// (SwiftUI 는 화면에 보이는 사진만 시험 도구에 알려주므로, 두 번째 사진은 보낸 직후 보일 때 연다)
    func testG_ViewerPagingAndSwipeDown() {
        for i in 1...2 {   // 대화에 사진 2장 이상 만들기
            relaunch(test: "attach")
            openTab(1)
            let thumb = el("attachmentThumb")
            XCTAssertTrue(thumb.waitForExistence(timeout: 15))
            let ready = expectation(for: NSPredicate(format: "value == 'ready'"), evaluatedWith: thumb)
            XCTAssertEqual(XCTWaiter().wait(for: [ready], timeout: 15), .completed)
            el("composerInput").tap()
            el("composerInput").typeText("gallery \(i): say ok")
            el("sendButton").tap()
            if i == 1 {
                if el("stopButton").waitForExistence(timeout: 4) { _ = waitGone(el("stopButton"), 60) }
            }
        }
        // 방금 보낸(마지막) 사진을 바로 연다
        let bubble = app.descendants(matching: .any).matching(identifier: "bubbleThumb").firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 8), "방금 보낸 사진이 보여야 함")
        bubble.tap()
        let idx = el("viewerIndex")
        XCTAssertTrue(idx.waitForExistence(timeout: 5), "여러 장이면 위치 표시가 보여야 함")
        let total = idx.label.components(separatedBy: " / ").last ?? ""
        XCTAssertEqual(idx.label, "\(total) / \(total)", "마지막 사진을 열었으니 마지막 위치여야 함")
        app.swipeRight()
        let prev = expectation(for: NSPredicate(format: "label == %@", "\((Int(total) ?? 2) - 1) / \(total)"), evaluatedWith: idx)
        XCTAssertEqual(XCTWaiter().wait(for: [prev], timeout: 4), .completed, "오른쪽으로 밀면 이전 사진(현재 \(idx.label))")
        app.swipeLeft()
        let next = expectation(for: NSPredicate(format: "label == %@", "\(total) / \(total)"), evaluatedWith: idx)
        XCTAssertEqual(XCTWaiter().wait(for: [next], timeout: 4), .completed, "왼쪽으로 밀면 다음 사진")
        app.swipeDown(velocity: .fast)
        XCTAssertTrue(waitGone(idx, 5), "아래로 쓸어내리면 닫혀야 함")
        if el("stopButton").waitForExistence(timeout: 2) { _ = waitGone(el("stopButton"), 60) }
    }

    /// H. 캡처해서 복사한 사진이 있으면 '복사한 사진 붙이기' 칩이 뜨고, 누르면 첨부돼야 한다
    func testH_PasteFromClipboard() {
        // 시험 도구가 클립보드에 사진을 넣어 둠(캡처 후 복사한 상황)
        let r = UIGraphicsImageRenderer(size: CGSize(width: 900, height: 600))
        UIPasteboard.general.image = r.image { ctx in
            UIColor.systemTeal.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 900, height: 600))
        }
        relaunch(test: "")
        openTab(1)
        let chip = el("clipboardChip")
        XCTAssertTrue(chip.waitForExistence(timeout: 8), "복사한 사진이 있으면 제안 칩이 떠야 함")
        chip.tap()
        // iOS 붙여넣기 허용 확인창이 뜨면 허용
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["붙여넣기 허용", "Allow Paste"] {
            let b = springboard.buttons[label]
            if b.waitForExistence(timeout: 2) { b.tap(); break }
        }
        let thumb = el("attachmentThumb")
        XCTAssertTrue(thumb.waitForExistence(timeout: 10), "붙인 사진이 입력창에 보여야 함")
        let ready = expectation(for: NSPredicate(format: "value == 'ready'"), evaluatedWith: thumb)
        XCTAssertEqual(XCTWaiter().wait(for: [ready], timeout: 15), .completed, "맥에 올라가 완료돼야 함")
        XCTAssertFalse(chip.exists, "붙인 뒤엔 제안 칩이 사라져야 함")
        el("attachmentRemove").tap()
    }

    /// I. 입력창에 / 를 치면 명령 제안이 뜨고, 걸러지고, 고르면 채우기·터미널 전환이 돼야 한다
    func testI_SlashCommands() {
        relaunch(test: "")
        openTab(1)
        let input = el("composerInput")
        input.tap()
        input.typeText("/")
        XCTAssertTrue(el("slashPanel").waitForExistence(timeout: 5), "/ 를 치면 명령 제안이 떠야 함")
        XCTAssertTrue(el("slash-compact").exists, "기본 명령이 보여야 함")
        input.typeText("skill")
        XCTAssertTrue(el("slash-skill:jira").waitForExistence(timeout: 5), "스킬 명령(확장이 보내준 목록)도 보여야 함")
        el("slash-skill:jira").tap()
        let filled = expectation(for: NSPredicate(format: "value == '/skill:jira '"), evaluatedWith: input)
        XCTAssertEqual(XCTWaiter().wait(for: [filled], timeout: 3), .completed, "뒤에 입력이 필요한 명령은 입력창에 채워야 함(현재 \(input.value ?? "-"))")
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 14))
        input.typeText("/co")
        XCTAssertTrue(el("slash-compact").waitForExistence(timeout: 3))
        XCTAssertFalse(el("slash-new").exists, "맞지 않는 명령은 걸러져야 함")
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3))
        input.typeText("/sess")
        el("slash-session").tap()
        let toggle = el("viewToggle")
        let term = expectation(for: NSPredicate(format: "value == 'terminal'"), evaluatedWith: toggle)
        XCTAssertEqual(XCTWaiter().wait(for: [term], timeout: 5), .completed, "선택 화면이 필요한 명령이면 터미널 보기로 바뀌어야 함")
        toggle.tap()   // 채팅으로 되돌림
    }

    /// J. + 메뉴의 '복사한 사진 붙여넣기'는 클립보드에 사진이 있을 때만 보여야 한다
    func testJ_PasteMenuOnlyWithImage() {
        UIPasteboard.general.items = []
        relaunch(test: "")
        openTab(1)
        el("plusMenu").tap()
        XCTAssertTrue(app.buttons["사진 보관함"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.buttons["복사한 사진 붙여넣기"].exists, "사진이 없으면 붙여넣기가 안 보여야 함")
        app.buttons["사진 보관함"].coordinate(withNormalizedOffset: CGVector(dx: 0, dy: -3)).tap()   // 메뉴 닫기
        let r = UIGraphicsImageRenderer(size: CGSize(width: 400, height: 300))
        UIPasteboard.general.image = r.image { ctx in UIColor.systemPink.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 400, height: 300)) }
        relaunch(test: "")
        openTab(1)
        el("plusMenu").tap()
        XCTAssertTrue(app.buttons["복사한 사진 붙여넣기"].waitForExistence(timeout: 3), "사진이 있으면 붙여넣기가 보여야 함")
        UIPasteboard.general.items = []
    }

    /// 화면을 맥 /tmp 에 저장(눈으로 확인용)
    private func shot(_ name: String) {
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/\(name).png"))
    }

    /// K. 단계 줄 → 아래에서 단계 창, 단계 → 상세(바뀐 줄·생각·명령 출력), 읽은 사진은 대화에 보여야 한다
    /// (시험 파일을 만들고 Haiku 창에 '명령 실행 → 사진 읽기 → 파일 수정'을 직접 시킨 뒤 확인)
    func testK_StepsSheet() {
        let r = UIGraphicsImageRenderer(size: CGSize(width: 640, height: 400))
        let png = r.pngData { ctx in
            UIColor(red: 0.16, green: 0.35, blue: 0.78, alpha: 1).setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 640, height: 400))
            UIColor.systemYellow.setFill(); ctx.cgContext.fillEllipse(in: CGRect(x: 220, y: 100, width: 200, height: 200))
        }
        try? png.write(to: URL(fileURLWithPath: "/tmp/pitest-img.png"))
        try? "첫 줄\nhello 세상\n마지막 줄\n".write(toFile: "/tmp/pitest-edit.txt", atomically: true, encoding: .utf8)

        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        send("다음을 순서대로 해줘. 1) bash로 date 실행 2) read 도구로 /tmp/pitest-img.png 를 읽고 무엇이 보이는지 한 문장 3) edit 도구로 /tmp/pitest-edit.txt 의 hello 를 world 로 바꾸기. 마지막에 한 줄로 요약.")
        if el("stopButton").waitForExistence(timeout: 5) { _ = waitGone(el("stopButton"), 120) }
        sleep(1)
        if !el("toolImage").exists { app.swipeDown() }   // 답이 길면 사진이 위로 밀려 있을 수 있음
        XCTAssertTrue(el("toolImage").waitForExistence(timeout: 10), "읽은 사진이 대화에 보여야 함")
        shot("steps-chat")
        if !app.buttons.matching(NSPredicate(format: "identifier == 'toolGroup' AND label CONTAINS '수정'")).firstMatch.exists { app.swipeUp() }

        // 수정 단계 → (목록이면 '수정됨' 행) → 바뀐 줄
        // 같은 창에 이전 시험 기록이 남아 있으니 가장 최근(마지막) 줄을 고른다
        let editGroups = app.buttons.matching(NSPredicate(format: "identifier == 'toolGroup' AND label CONTAINS '수정'"))
        XCTAssertTrue(editGroups.firstMatch.waitForExistence(timeout: 5), "수정 단계 줄이 보여야 함")
        let editGroup = editGroups.element(boundBy: editGroups.count - 1)
        editGroup.tap()
        if el("stepsList").waitForExistence(timeout: 3) {
            shot("steps-list")
            app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'stepRow-' AND label CONTAINS '수정됨'")).firstMatch.tap()
        }
        XCTAssertTrue(el("diffView").waitForExistence(timeout: 5), "수정 단계는 바뀐 줄(diff)을 보여야 함")
        // 모델이 줄 전체('hello 세상')나 단어('hello')만 바꿀 수 있어 diff 안에 world 가 있는지만 본다
        XCTAssertTrue(el("diffView").descendants(matching: .any).matching(NSPredicate(format: "identifier == 'diffAdd' AND label CONTAINS 'world'")).firstMatch
                        .waitForExistence(timeout: 3), "바뀐 뒤 내용(+ world)이 diff 에 보여야 함")
        XCTAssertTrue(el("diffView").descendants(matching: .any).matching(NSPredicate(format: "identifier == 'diffDel' AND label CONTAINS 'hello'")).firstMatch
                        .exists, "바뀌기 전 내용(− hello)도 보여야 함")
        shot("steps-diff")
        el("stepsClose").tap()
        XCTAssertTrue(waitGone(el("stepDetail")), "닫으면 창이 사라져야 함")

        // 명령 단계 → 출력
        let bashGroups = app.buttons.matching(NSPredicate(format: "identifier == 'toolGroup' AND (label CONTAINS '명령어' OR label CONTAINS '실행됨')"))
        if !bashGroups.firstMatch.exists { app.swipeDown() }
        XCTAssertTrue(bashGroups.firstMatch.waitForExistence(timeout: 5), "명령 단계 줄이 보여야 함")
        let bashGroup = bashGroups.element(boundBy: bashGroups.count - 1)
        bashGroup.tap()
        if el("stepsList").waitForExistence(timeout: 3) {
            // 같은 목록의 생각 단계도 열어 봄
            let think = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'stepRow-' AND label CONTAINS '생각함'")).firstMatch
            if think.exists {
                think.tap()
                XCTAssertTrue(el("thinkingText").waitForExistence(timeout: 5), "생각 단계는 생각 내용을 보여야 함")
                shot("steps-thinking")
                app.navigationBars.buttons.element(boundBy: 0).tap()   // 뒤로
            }
            app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'stepRow-' AND label CONTAINS '실행됨'")).firstMatch.tap()
        }
        let out = el("stepOutput")
        XCTAssertTrue(out.waitForExistence(timeout: 5), "명령 출력 칸이 보여야 함")
        let kst = expectation(for: NSPredicate(format: "label CONTAINS 'KST'"), evaluatedWith: out)
        XCTAssertEqual(XCTWaiter().wait(for: [kst], timeout: 5), .completed, "date 출력이 보여야 함")
        shot("steps-bash")
        el("stepsClose").tap()
    }

    /// 앱 입력창으로 보내기
    /// 메뉴 항목(같은 이름의 칩 버튼은 빼고). 지금 모델이 Haiku 면 칩 이름도 'Haiku 4.5' 라 겹친다
    private func menuItem(_ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@ AND identifier != 'modelMenu'", label)).firstMatch
    }

    private func send(_ text: String) {
        let input = el("composerInput")
        input.tap()
        input.typeText(text)
        el("sendButton").tap()
    }

    /// L. 예외 상황: 실행 중 단계를 열어 두면 끝난 뒤 결과가 채워짐 / 오류 단계 ⚠ / 도구 없는 답의 '생각함' 줄 /
    ///    생각 중 상태 줄을 누르면 지금 생각이 보임 (Haiku 창, 생각 깊이 medium)
    func testL_StepsEdgeCases() {
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        // 앞선 시험이 새 대화를 열어 기본 모델(Opus)로 남겼을 수 있어 Haiku 로(Opus 는 쉬운 질문엔 생각을 건너뜀)
        if !((el("modelMenu").label).contains("Haiku")) {
            el("modelMenu").tap()
            menuItem("Haiku 4.5").tap()
            let haiku = expectation(for: NSPredicate(format: "label CONTAINS 'Haiku'"), evaluatedWith: el("modelMenu"))
            XCTAssertEqual(XCTWaiter().wait(for: [haiku], timeout: 8), .completed, "모델 칩이 Haiku 로 바뀌어야 함")
        }
        // 앞선 시험(9번)이 생각을 꺼 둘 수 있어 보통으로 맞춤('생각함' 줄·생각 중 확인용)
        el("thinkingMenu").tap()
        app.buttons["보통 (medium)"].tap()
        let medium = expectation(for: NSPredicate(format: "label CONTAINS 'medium'"), evaluatedWith: el("thinkingMenu"))
        XCTAssertEqual(XCTWaiter().wait(for: [medium], timeout: 8), .completed, "생각 깊이 칩이 medium 으로 바뀌어야 함")

        // 1) 실행 중인 단계
        send("bash로 sleep 8; echo 끝났음 을 실행해줘. 다른 말은 하지 마.")
        let running = app.buttons.matching(NSPredicate(format: "identifier == 'toolGroup' AND label CONTAINS '실행 중'")).firstMatch
        XCTAssertTrue(running.waitForExistence(timeout: 30), "실행 중인 단계 줄이 '실행 중'으로 보여야 함")
        shot("edge-running")
        running.tap()
        if el("stepsList").waitForExistence(timeout: 3) {
            let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'stepRow-'"))
            rows.element(boundBy: rows.count - 1).tap()   // 마지막 단계(명령)
        }
        XCTAssertTrue(el("stepDetail").waitForExistence(timeout: 5), "단계 상세가 떠야 함")
        XCTAssertTrue(el("stepOutput").waitForExistence(timeout: 30), "열어 둔 상세에 명령이 끝난 뒤 결과 칸이 생겨야 함")
        let filled = expectation(for: NSPredicate(format: "label CONTAINS '끝났음'"), evaluatedWith: el("stepOutput"))
        XCTAssertEqual(XCTWaiter().wait(for: [filled], timeout: 10), .completed, "결과 칸에 실제 출력이 채워져야 함")
        shot("edge-running-done")
        el("stepsClose").tap()
        if el("stopButton").waitForExistence(timeout: 2) { _ = waitGone(el("stopButton"), 60) }

        // 2) 오류 단계
        send("bash로 ls /없는경로 를 실행해줘. 결과는 한 줄로만.")
        let errLine = app.buttons.matching(NSPredicate(format: "identifier == 'toolGroup' AND label CONTAINS '오류 있음'")).firstMatch
        XCTAssertTrue(errLine.waitForExistence(timeout: 40), "실패한 단계 줄엔 ⚠(오류 있음)가 보여야 함")
        if el("stopButton").waitForExistence(timeout: 2) { _ = waitGone(el("stopButton"), 60) }

        // 3) 도구 없이 바로 답 → 답 앞에 '생각함' 줄
        let before = app.buttons.matching(NSPredicate(format: "identifier == 'toolGroup' AND label BEGINSWITH '생각함'")).count
        send("3 더하기 4는? 숫자만.")
        sleep(3)
        if el("stopButton").waitForExistence(timeout: 2) { _ = waitGone(el("stopButton"), 60) }
        let thinkLines = app.buttons.matching(NSPredicate(format: "identifier == 'toolGroup' AND label BEGINSWITH '생각함'"))
        let more = expectation(for: NSPredicate(format: "count > \(before)"), evaluatedWith: thinkLines)
        XCTAssertEqual(XCTWaiter().wait(for: [more], timeout: 15), .completed, "도구 없이 답한 생각은 '생각함' 줄로 보여야 함")
        thinkLines.element(boundBy: thinkLines.count - 1).tap()
        XCTAssertTrue(el("thinkingText").waitForExistence(timeout: 5), "'생각함' 줄을 누르면 생각 내용이 보여야 함")
        shot("edge-thinking-line")
        el("stepsClose").tap()

        // 4) 생각 중 상태 줄 → 지금 하는 생각
        send("1부터 60까지의 수 중 소수를 하나씩 따져 보고, 마지막에 개수만 말해줘.")
        let status = el("statusRow")
        let thinkingNow = expectation(for: NSPredicate(format: "label CONTAINS '생각 중'"), evaluatedWith: status)
        XCTAssertEqual(XCTWaiter().wait(for: [thinkingNow], timeout: 30), .completed, "생각 중 상태 줄이 보여야 함")
        status.tap()
        XCTAssertTrue(el("thinkingText").waitForExistence(timeout: 6), "생각 중 상태 줄을 누르면 지금 생각이 보여야 함")
        shot("edge-live-thinking")
        el("stepsClose").tap()
        if el("stopButton").waitForExistence(timeout: 2) { _ = waitGone(el("stopButton"), 90) }
    }

    /// 모델 메뉴로 Haiku, 생각 깊이 끄기
    private func useHaikuNoThinking() {
        // 새 대화 직후엔 pi 가 새 대화를 만드는 중이라 고른 값이 덮일 수 있어 한 번 더 고른다
        for attempt in 1...2 {
            el("modelMenu").tap()
            menuItem("Haiku 4.5").tap()   // 모델 메뉴는 한 목록(자동 계정)
            let haiku = expectation(for: NSPredicate(format: "label CONTAINS 'Haiku'"), evaluatedWith: el("modelMenu"))
            if XCTWaiter().wait(for: [haiku], timeout: 8) == .completed { break }
            XCTAssertLessThan(attempt, 2, "모델 칩이 Haiku 로 바뀌어야 함")
        }
        el("thinkingMenu").tap()
        app.buttons["끄기"].tap()
        let off = expectation(for: NSPredicate(format: "label CONTAINS 'off'"), evaluatedWith: el("thinkingMenu"))
        XCTAssertEqual(XCTWaiter().wait(for: [off], timeout: 8), .completed, "생각 깊이 칩이 off 로 바뀌어야 함")
    }

    /// M. 지난 대화: 대화를 '새 대화'로 닫은 뒤 '지난 대화'에서 고르면 새 탭에서 이어지고,
    ///    다시 열면 '지금 대화'로 표시되며 탭이 늘지 않아야 한다. /resume 도 같은 화면을 연다.
    func testM_PastSessions() {
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        // 목록 제목은 대화의 첫 메시지라서, 새 대화로 시작해 표식이 첫 메시지가 되게 한다
        el("moreMenu").tap()
        app.buttons["새 대화"].tap()
        app.buttons["새 대화 시작"].tap()
        sleep(3)
        useHaikuNoThinking()   // 새 대화는 기본 모델(Opus)로 돌아가므로 시험은 늘 Haiku 로
        let mark = "지난대화시험 \(Int(Date().timeIntervalSince1970) % 100000)"
        send("숫자 2만 답해 (\(mark))")
        if el("stopButton").waitForExistence(timeout: 5) { _ = waitGone(el("stopButton"), 60) }
        let markText = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", mark)).firstMatch
        XCTAssertTrue(markText.waitForExistence(timeout: 10))

        // 새 대화 → 방금 대화는 닫힌 지난 대화가 됨
        el("moreMenu").tap()
        app.buttons["새 대화"].tap()
        app.buttons["새 대화 시작"].tap()
        XCTAssertTrue(waitGone(markText, 15), "새 대화를 시작하면 이전 대화가 사라져야 함")
        XCTAssertTrue(el("chatScroll").waitForExistence(timeout: 15), "새 대화 화면이 다시 떠야 함")
        sleep(1)
        useHaikuNoThinking()   // 이 탭을 쓰는 다른 시험을 위해 Haiku 로 되돌려 둠
        let tabsBefore = tabCount()

        el("moreMenu").tap()
        app.buttons["지난 대화"].tap()
        let row = app.buttons.matching(NSPredicate(format: "identifier == 'pastSession' AND label CONTAINS %@", mark)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "방금 닫은 대화가 지난 대화 목록에 보여야 함")
        XCTAssertFalse(row.label.contains("열린 탭") || row.label.contains("지금 대화"), "닫은 대화엔 열림 표시가 없어야 함: \(row.label)")
        shot("sessions-list")
        row.tap()
        // 방금 쓴 대화라 '다른 곳에서 열려 있을 수 있음' 확인이 한 번 뜬다
        let confirm = app.buttons["새 탭에서 열기"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "방금까지 쓰이던 대화는 열기 전에 확인을 물어야 함")
        shot("sessions-confirm")
        confirm.tap()

        XCTAssertTrue(markText.waitForExistence(timeout: 30), "새 탭에 그 대화가 이어져 보여야 함")
        XCTAssertEqual(tabCount(), tabsBefore + 1, "새 탭이 하나 생겨야 함")
        sleep(1)
        shot("sessions-opened")

        el("moreMenu").tap()
        app.buttons["지난 대화"].tap()
        let again = app.buttons.matching(NSPredicate(format: "identifier == 'pastSession' AND label CONTAINS %@ AND label CONTAINS '지금 대화'", mark)).firstMatch
        XCTAssertTrue(again.waitForExistence(timeout: 10), "지금 보는 대화는 '지금 대화'로 표시돼야 함")
        shot("sessions-current")
        again.tap()
        sleep(2)
        XCTAssertEqual(tabCount(), tabsBefore + 1, "이미 열린 대화는 탭을 더 만들지 않아야 함")

        let input = el("composerInput")
        input.tap()
        input.typeText("/resum")
        XCTAssertTrue(el("slash-resume").waitForExistence(timeout: 5))
        el("slash-resume").tap()
        XCTAssertTrue(el("sessionsList").waitForExistence(timeout: 10), "/resume 은 지난 대화 화면을 열어야 함")
        el("sessionsClose").tap()
    }

    /// N. 컨텍스트 게이지: 입력창에 사용률이 보이고, 누르면 사용량 창(자동 압축 지점),
    ///    작업 중엔 압축 버튼이 꺼져 있고, 쉬는 중 '지금 압축하기' → '대화를 압축하는 중' → 요약이 들어감
    ///    (Haiku 탭. 압축할 거리가 되도록 긴 명령 출력을 한 번 만든다)
    func testN_ContextGauge() {
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        let gauge = el("contextGauge")
        XCTAssertTrue(gauge.waitForExistence(timeout: 10), "입력창에 컨텍스트 게이지가 보여야 함")

        // 앞 실행과 같은 명령이면 모델이 실행 없이 답할 수 있어 매번 범위를 바꾼다
        let base = Int(Date().timeIntervalSince1970) % 90000 * 10
        send("bash로 sleep 8; seq \(base) \(base + 6000) | sed 's/$/ quick brown fox jumps over the lazy dog/' 를 실행해줘. 설명 없이 완료라고만 답해.")
        XCTAssertTrue(el("stopButton").waitForExistence(timeout: 10))
        gauge.tap()
        XCTAssertTrue(el("compactNow").waitForExistence(timeout: 5), "게이지를 누르면 사용량 창이 떠야 함")
        XCTAssertFalse(el("compactNow").isEnabled, "작업 중엔 압축 버튼이 꺼져 있어야 함")
        shot("context-working")
        el("contextClose").tap()
        _ = waitGone(el("stopButton"), 60)
        // 압축은 최근 2만 토큰을 남기고 그 앞을 요약하므로, 긴 출력을 두 번 더 만들어 압축할 거리를 준비
        for k in 1...2 {
            send("bash로 seq \(base + k * 10000) \(base + k * 10000 + 6000) | sed 's/$/ quick brown fox jumps over the lazy dog/' 를 실행해줘. 설명 없이 완료라고만 답해.")
            if el("stopButton").waitForExistence(timeout: 5) { _ = waitGone(el("stopButton"), 60) }
        }

        let pct = expectation(for: NSPredicate(format: "label MATCHES '.*[0-9]+%.*'"), evaluatedWith: gauge)
        XCTAssertEqual(XCTWaiter().wait(for: [pct], timeout: 10), .completed, "쉬는 중엔 사용률이 숫자로 보여야 함(현재 \(gauge.label))")
        gauge.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS '에서 시작'")).firstMatch.waitForExistence(timeout: 5),
                      "자동 압축 지점이 보여야 함")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS '토큰'")).firstMatch.exists, "사용 중 토큰이 보여야 함")
        sleep(1)
        shot("context-sheet")
        XCTAssertTrue(el("compactNow").isEnabled, "쉬는 중엔 압축 버튼이 켜져 있어야 함")
        el("compactNow").tap()

        let status = el("statusRow")
        let compactingNow = expectation(for: NSPredicate(format: "label CONTAINS '압축하는 중'"), evaluatedWith: status)
        XCTAssertEqual(XCTWaiter().wait(for: [compactingNow], timeout: 10), .completed, "압축하는 동안 '대화를 압축하는 중'이 보여야 함")
        shot("context-compacting")
        XCTAssertTrue(waitGone(status, 90), "압축이 끝나면 상태 줄이 사라져야 함")
        let summary = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS '이전 대화를 요약했어요'")).firstMatch
        XCTAssertTrue(summary.waitForExistence(timeout: 10), "압축 뒤 요약 줄이 보여야 함")
        shot("context-done")
    }

    /// O. 맥 pi 가 예전 확장이면 입력창 위에 '다시 불러오기' 띠가 뜨고, 누르면 다시 불러와져 띠가 사라져야 한다
    ///    (Haiku 창은 /tmp/pitest-fake-old 파일이 있는 동안 예전 판인 척한다.
    ///     시험 환경에서 Haiku 창의 pi 를 PI_REMOTE_FAKE_OLD_FILE=/tmp/pitest-fake-old 로 띄워야 함)
    func testO_ReloadBanner() {
        FileManager.default.createFile(atPath: "/tmp/pitest-fake-old", contents: nil)
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("reloadBanner").waitForExistence(timeout: 10), "예전 확장이면 다시 불러오기 띠가 보여야 함")
        XCTAssertTrue(el("reloadPi").isEnabled, "쉬는 중이면 다시 불러오기 버튼이 켜져 있어야 함")
        shot("reload-banner")
        try? FileManager.default.removeItem(atPath: "/tmp/pitest-fake-old")
        el("reloadPi").tap()
        XCTAssertTrue(waitGone(el("reloadBanner"), 15), "다시 불러오면 띠가 사라져야 함")
        XCTAssertTrue(el("contextGauge").waitForExistence(timeout: 10), "다시 불러온 뒤 게이지가 보여야 함")
        shot("reload-done")
    }

    /// P. '7초 · 생각 중'의 경과 시간은 앱을 연 때가 아니라 맥 pi 가 작업을 시작한 때부터 세야 한다
    ///    (작업 중에 앱을 껐다 켜도 이어서 셈)
    func testP_WorkingElapsedFromPi() {
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        send("bash로 sleep 30 실행하고 끝이라고만 답해")
        XCTAssertTrue(el("stopButton").waitForExistence(timeout: 10), "작업이 시작돼야 함")
        sleep(10)
        relaunch(test: "")   // 앱을 새로 열어도
        openTab(1)
        let status = el("statusRow")
        XCTAssertTrue(status.waitForExistence(timeout: 10), "작업 중 상태 줄이 보여야 함")
        sleep(1)
        let secs = Int(status.label.prefix(while: { $0.isNumber })) ?? 0
        shot("elapsed-after-relaunch")
        XCTAssertGreaterThanOrEqual(secs, 12, "경과 시간이 pi 가 시작한 때부터여야 함(현재 '\(status.label)')")
        _ = waitGone(el("stopButton"), 60)
    }

    /// Q. 보내기 승인: 맥 pi 가 보내기 전에 멈추면 폰 입력창 위에 승인 카드가 뜨고,
    ///    거부하면 안 보내지고 허용하면 보내진다(시험 pi 는 가짜 Slack 에 연결, 보낸 것은 /tmp/pitest-proj/sent.log 에 기록)
    func testQ_ApprovalCard() throws {
        // 진짜 Slack 이 연결된 pi 에서 돌면 실제로 보내기를 시도하게 되므로, 가짜 Slack 시험 환경에서만 실행
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/pitest-proj/ACTIVE"), "가짜 Slack 시험 환경에서만 실행")
        let log = "/tmp/pitest-proj/sent.log"
        let mark = "\(Int(Date().timeIntervalSince1970) % 100000)"
        relaunch(test: "")
        openTab(0)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))

        send("slack MCP 도구로 채널 C9 에 \"폰 거부 시험 \(mark)\" 을 보내줘. 규칙대로 해.")
        let card = el("approvalCard")
        XCTAssertTrue(card.waitForExistence(timeout: 40), "보내기 전에 폰에 승인 카드가 떠야 함")
        XCTAssertTrue(app.staticTexts["보내기 전에 승인이 필요해요"].exists)
        sleep(1)
        shot("approval-card")
        el("approvalDeny").tap()
        XCTAssertTrue(waitGone(card, 10), "답하면 카드가 사라져야 함")
        _ = waitGone(el("stopButton"), 60)
        XCTAssertFalse(((try? String(contentsOfFile: log)) ?? "").contains("폰 거부 시험 \(mark)"), "거부하면 보내지면 안 됨")

        send("이번 것은 보내도 돼. 규칙대로 slack MCP 도구로 채널 C9 에 \"폰 허용 시험 \(mark)\" 을 보내줘.")
        XCTAssertTrue(card.waitForExistence(timeout: 40), "승인 카드가 다시 떠야 함")
        el("approvalAllow").tap()
        // 보내질 때까지(한 번 더 물으면 또 허용)
        var sent = false
        for _ in 0..<40 {
            if ((try? String(contentsOfFile: log)) ?? "").contains("폰 허용 시험 \(mark)") { sent = true; break }
            if card.exists, el("approvalAllow").isHittable { el("approvalAllow").tap() }
            sleep(1)
        }
        XCTAssertTrue(sent, "허용하면 보내져야 함")
        _ = waitGone(el("stopButton"), 60)
    }

    /// 시험 pi 대화 기록(/tmp/pitest-sessions)에 글이 들어갔는지(답이 pi 에 실제로 닿았는지)
    private func sessionLogContains(_ s: String, timeout: TimeInterval = 15) -> Bool {
        let root = "/tmp/pitest-sessions"
        let end = Date().addingTimeInterval(timeout)
        repeat {
            if let files = FileManager.default.enumerator(atPath: root) {
                for case let p as String in files where p.hasSuffix(".jsonl") {
                    if ((try? String(contentsOfFile: "\(root)/\(p)")) ?? "").contains(s) { return true }
                }
            }
            sleep(1)
        } while Date() < end
        return false
    }

    /// 시험 pi 대화 기록에 글이 몇 번 들어 있는지
    private func sessionLogCount(_ s: String) -> Int {
        let root = "/tmp/pitest-sessions"
        var n = 0
        if let files = FileManager.default.enumerator(atPath: root) {
            for case let p as String in files where p.hasSuffix(".jsonl") {
                n += ((try? String(contentsOfFile: "\(root)/\(p)")) ?? "").components(separatedBy: s).count - 1
            }
        }
        return n
    }

    /// S. 긴 질문·긴 선택지: 카드가 화면을 넘지 않고(키보드가 있으면 낮게), 카드 안에서 스크롤해 마지막 선택지를 고를 수 있고,
    ///    답한 뒤 단계 상세에 질문 전체와 답이 보여야 한다(시험 문구는 한글 자판 조합 오류를 피하려 영어)
    func testS_LongQuestion() {
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        clearPendingQuestion()
        let before = sessionLogCount("사용자가 고른 답:")
        send("Call the ask_user tool now. The question must be in Korean, at least 4 sentences, with line breaks, about choosing " +
             "a weekend plan. Give exactly 4 options. Each option label must be one long Korean sentence of at least 60 characters. " +
             "After the answer, reply with only the chosen option number.")
        let card = el("questionCard")
        XCTAssertTrue(card.waitForExistence(timeout: 60), "긴 질문 카드가 떠야 함")
        sleep(1)
        XCTAssertGreaterThan(el("questionText").label.count, 60, "긴 질문이 잘리지 않고 들어있어야 함")
        XCTAssertGreaterThan(el("questionOption-0").label.count, 40, "긴 선택지가 잘리지 않아야 함")
        // 키보드가 올라온 상태: 카드가 낮아 입력창이 보여야 함
        shot("question-long-kb")
        let kbHeight = card.frame.height
        XCTAssertTrue(el("composerInput").isHittable, "키보드가 있어도 입력창이 가려지면 안 됨")
        // 키보드를 내리면 카드가 넓어지되 화면을 넘지 않음(가운데엔 단계 줄이 올 수 있어 대화 맨 위를 누름)
        el("chatScroll").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)).tap()
        sleep(1)
        shot("question-long")
        XCTAssertGreaterThan(card.frame.height, kbHeight, "키보드를 내리면 카드가 넓어져야 함")
        XCTAssertLessThan(card.frame.height, app.frame.height * 0.75, "카드가 화면을 다 덮으면 안 됨")
        XCTAssertTrue(el("composerInput").isHittable, "입력창이 보여야 함")
        // 카드 안에서 스크롤: 넘친 끝부분(기타 줄)까지 내려가야 함
        let otherRow = el("questionOther")
        XCTAssertFalse(otherRow.isHittable, "긴 질문이면 끝부분(기타 줄)은 처음엔 카드 밖에 있어야 함(스크롤 시험 전제)")
        for _ in 0..<6 where !otherRow.isHittable { card.swipeUp() }
        XCTAssertTrue(otherRow.isHittable, "카드 안에서 스크롤하면 끝부분까지 보여야 함")
        shot("question-long-scrolled")
        let last = el("questionOption-3")
        for _ in 0..<3 where !last.isHittable { card.swipeDown() }
        XCTAssertTrue(last.isHittable, "마지막 선택지를 누를 수 있어야 함")
        last.tap()
        XCTAssertTrue(waitGone(card, 10), "고르면 카드가 사라져야 함")
        let reached = expectation(for: NSPredicate { _, _ in self.sessionLogCount("사용자가 고른 답:") > before }, evaluatedWith: nil)
        XCTAssertEqual(XCTWaiter().wait(for: [reached], timeout: 15), .completed, "긴 선택지 답이 pi 에 닿아야 함")
        _ = waitGone(el("stopButton"), 60)
        // 단계 상세: 질문 전체(번호 붙은 선택지)와 답
        let asked = app.buttons.matching(NSPredicate(format: "identifier == 'toolGroup' AND label CONTAINS '물어봄'"))
        XCTAssertTrue(asked.firstMatch.waitForExistence(timeout: 15), "'물어봄' 단계 줄이 있어야 함")
        asked.element(boundBy: asked.count - 1).tap()
        if el("stepsList").waitForExistence(timeout: 3) {
            let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'stepRow-'"))
            rows.element(boundBy: rows.count - 1).tap()
        }
        XCTAssertTrue(el("stepDetail").waitForExistence(timeout: 5), "단계 상세가 떠야 함")
        let question = el("stepSection")
        let full = expectation(for: NSPredicate(format: "label CONTAINS '4. '"), evaluatedWith: question)
        XCTAssertEqual(XCTWaiter().wait(for: [full], timeout: 10), .completed, "상세의 질문 칸에 번호 붙은 선택지 전체가 있어야 함")
        XCTAssertGreaterThan(el("stepOutput").label.count, 30, "상세의 답 칸에 고른 긴 선택지가 있어야 함")
        shot("question-long-detail")
        el("stepsClose").tap()
    }

    /// R. 고르는 질문: pi 가 ask_user 로 물으면 입력창 위에 질문 카드가 뜨고,
    ///    하나 고르기는 누르면 바로 답, 여러 개 고르기는 체크 후 보내기, 기타는 입력창에 써서 답한다
    ///    (시험 pi: Haiku 창에 ask-user 확장을 -e 로 불러 둠)
    func testR_QuestionCard() {
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        clearPendingQuestion()
        let mark = "\(Int(Date().timeIntervalSince1970) % 100000)"
        let card = el("questionCard")

        // 1) 하나 고르기: 누르면 바로 답
        send("ask_user 도구로 '과일 \(mark)' 이라는 질문을 해줘. 선택지는 사과, 배 두 개. 답을 받으면 고른 과일 이름만 말해.")
        XCTAssertTrue(card.waitForExistence(timeout: 40), "질문 카드가 떠야 함")
        XCTAssertTrue(el("questionOption-1").exists && el("questionOther").exists, "선택지와 기타가 보여야 함")
        XCTAssertFalse(el("questionSubmit").exists, "하나 고르기엔 보내기 버튼이 없어야 함")
        let waitingAnswer = expectation(for: NSPredicate(format: "label CONTAINS '답을 기다리는 중'"), evaluatedWith: el("statusRow"))
        XCTAssertEqual(XCTWaiter().wait(for: [waitingAnswer], timeout: 5), .completed, "상태 줄이 '답을 기다리는 중'이어야 함")
        sleep(1)
        shot("question-single")
        el("questionOption-1").tap()   // 배
        XCTAssertTrue(waitGone(card, 10), "고르면 카드가 사라져야 함")
        XCTAssertTrue(sessionLogContains("사용자가 고른 답: 배"), "고른 답(배)이 pi 에 닿아야 함")
        _ = waitGone(el("stopButton"), 60)
        let asked = app.buttons.matching(NSPredicate(format: "identifier == 'toolGroup' AND label CONTAINS '물어봄' AND label CONTAINS '→ 배'")).firstMatch
        XCTAssertTrue(asked.waitForExistence(timeout: 15), "답한 뒤 단계 줄이 '물어봄 질문 → 배'로 보여야 함")

        // 2) 여러 개 고르기: 체크 후 보내기
        send("ask_user 도구를 multiSelect true 로 불러 '색 \(mark)' 질문을 해줘. 선택지는 노랑, 파랑, 초록. 답을 받으면 고른 색만 말해.")
        XCTAssertTrue(card.waitForExistence(timeout: 40), "여러 개 고르기 질문 카드가 떠야 함")
        let submit = el("questionSubmit")
        XCTAssertTrue(submit.waitForExistence(timeout: 3) && !submit.isEnabled, "고르기 전엔 보내기가 꺼져 있어야 함")
        el("questionOption-0").tap()
        el("questionOption-2").tap()
        let two = expectation(for: NSPredicate(format: "label CONTAINS '2개'"), evaluatedWith: submit)
        XCTAssertEqual(XCTWaiter().wait(for: [two], timeout: 5), .completed, "보내기 버튼에 고른 개수가 보여야 함")
        shot("question-multi")
        submit.tap()
        XCTAssertTrue(waitGone(card, 10), "보내면 카드가 사라져야 함")
        XCTAssertTrue(sessionLogContains("사용자가 고른 답: 노랑, 초록"), "고른 두 개가 선택지 순서대로 pi 에 닿아야 함")
        _ = waitGone(el("stopButton"), 60)

        // 3) 기타: 입력창에 써서 답
        send("ask_user 도구로 '동물 \(mark)' 질문을 해줘. 선택지는 개, 고양이. 답을 받으면 그대로 따라 말해.")
        XCTAssertTrue(card.waitForExistence(timeout: 40), "질문 카드가 다시 떠야 함")
        el("questionOther").tap()
        sleep(1)
        shot("question-other")
        el("composerInput").typeText("토끼 \(mark)")
        el("sendButton").tap()
        XCTAssertTrue(waitGone(card, 10), "직접 쓴 답을 보내면 카드가 사라져야 함")
        XCTAssertTrue(sessionLogContains("사용자가 직접 쓴 답: 토끼 \(mark)"), "직접 쓴 답이 pi 에 닿아야 함")
        _ = waitGone(el("stopButton"), 60)
        shot("question-done")
    }

    /// T. 탭 상태: 다른 탭에서 pi 가 일하면 서랍을 닫아 둬도 ☰ 버튼(상태 점)과 서랍 목록에 '답을 기다림 → 끝남'이 보이고,
    ///    그 탭을 보면 '끝남'이 꺼져야 한다. 알림을 누른 것처럼 켜면 그 탭으로 옮겨져야 한다.
    ///    (시험 pi 는 tmux 탭 상태 확장을 함께 불러 둠, 시험 문구는 한글 자판 조합 오류를 피하려 영어)
    func testT_TabStatusAndNotificationJump() {
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        clearPendingQuestion()
        let mark = "\(Int(Date().timeIntervalSince1970) % 100000)"
        // 1) 명령만(모델이 순서를 건너뛰지 못하게 질문과 따로 보냄) → 다른 탭에서 보면 '작업 중'
        send("Run bash 'sleep 12; echo ok' and then reply with only OK.")
        sleep(1)
        openTab(0)
        let button = el("drawerButton")
        let working = expectation(for: NSPredicate(format: "label CONTAINS '작업 중'"), evaluatedWith: button)
        XCTAssertEqual(XCTWaiter().wait(for: [working], timeout: 15), .completed, "다른 탭이 일하면 알림 점이 '작업 중'이어야 함(현재: \(button.label))")
        shot("badge-working")
        let idle = expectation(for: NSPredicate(format: "NOT (label CONTAINS '작업 중')"), evaluatedWith: button)
        _ = XCTWaiter().wait(for: [idle], timeout: 40)
        // 2) 질문 → 다른 탭에서 보면 '답을 기다림'
        openTab(1)
        send("Call the ask_user tool now. Question: 'status \(mark)'. Options: 'yes' and 'no'. After the answer, reply with only OK.")
        sleep(1)
        openTab(0)
        let asking = expectation(for: NSPredicate(format: "label CONTAINS '답을 기다림'"), evaluatedWith: button)
        XCTAssertEqual(XCTWaiter().wait(for: [asking], timeout: 40), .completed, "서랍을 닫아 둬도 ☰ 버튼에 '답을 기다림'이 보여야 함(현재: \(button.label))")
        shot("tabs-asking-closed")
        openDrawer()
        let row1 = el("tab-1")
        XCTAssertTrue(row1.label.contains("답을 기다려요"), "서랍 목록에 '답을 기다려요'가 보여야 함(현재: \(row1.label))")
        shot("tabs-asking-drawer")
        row1.tap()   // 그 탭으로 가서 답하기
        _ = waitGone(el("drawer"), 5)
        XCTAssertTrue(el("questionCard").waitForExistence(timeout: 10), "그 탭의 질문 카드가 보여야 함")
        el("questionOption-0").tap()
        if el("stopButton").waitForExistence(timeout: 3) { _ = waitGone(el("stopButton"), 60) }
        sleep(2)
        openTab(0)   // 다른 탭으로 나와서 보면 '끝났어요'
        openDrawer()
        let done = expectation(for: NSPredicate(format: "label CONTAINS '끝났어요'"), evaluatedWith: el("tab-1"))
        XCTAssertEqual(XCTWaiter().wait(for: [done], timeout: 20), .completed, "작업이 끝나면 '끝났어요'가 보여야 함(현재: \(el("tab-1").label))")
        shot("tabs-done-drawer")
        el("tab-1").tap()   // 그 탭을 보면 '끝남'이 꺼짐(맥 tmux 와 같은 규칙)
        _ = waitGone(el("drawer"), 5)
        sleep(3)
        openDrawer()
        XCTAssertFalse(el("tab-1").label.contains("끝났어요"), "그 탭을 보면 '끝났어요'가 꺼져야 함(현재: \(el("tab-1").label))")
        closeDrawer()

        // 알림을 누른 것처럼 켜면 그 탭(1)으로: 지금 탭을 0 으로 두고 다시 켬
        openTab(0)
        relaunch(test: "notif:1")
        sleep(3)
        openDrawer()
        let moved = expectation(for: NSPredicate(format: "value == '선택됨'"), evaluatedWith: el("tab-1"))
        XCTAssertEqual(XCTWaiter().wait(for: [moved], timeout: 15), .completed, "알림을 누르면 그 탭(1)으로 옮겨져야 함")
        closeDrawer()
    }

    /// U. '@' 맥 파일 첨부: + 메뉴 '맥 파일 첨부'로 목록이 뜨고, 이름 일부를 치면 그 파일이 보이며,
    ///    고르면 '@경로 '가 들어가고, 보내면 pi 가 그 파일을 읽어 답한다(시험 pi 의 폴더는 /tmp)
    func testU_AtFileMention() {
        let mark = "\(Int(Date().timeIntervalSince1970) % 100000)"
        let name = "pitest-attach-\(mark).txt"
        FileManager.default.createFile(atPath: "/tmp/\(name)", contents: "first line marker \(mark)\nsecond line\n".data(using: .utf8))
        defer { try? FileManager.default.removeItem(atPath: "/tmp/\(name)") }
        relaunch(test: "")
        openTab(1)
        let input = el("composerInput")
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        clearPendingQuestion()
        el("plusMenu").tap()
        app.buttons["맥 파일 첨부"].tap()
        XCTAssertTrue(el("filePanel").waitForExistence(timeout: 8), "+ 메뉴로 맥 파일 목록이 떠야 함")
        input.typeText("pitest-attach-\(mark)")
        let row = el("file-\(name)")
        XCTAssertTrue(row.waitForExistence(timeout: 10), "맞는 맥 파일이 목록에 보여야 함")
        shot("file-panel")
        row.tap()
        let filled = expectation(for: NSPredicate(format: "value CONTAINS %@", "@\(name) "), evaluatedWith: input)
        XCTAssertEqual(XCTWaiter().wait(for: [filled], timeout: 5), .completed, "고르면 '@경로 '가 들어가야 함(현재: \(input.value ?? ""))")
        XCTAssertTrue(waitGone(el("filePanel"), 3), "고른 뒤엔 목록이 닫혀야 함")
        input.typeText("Reply with only the first line of that file.")
        el("sendButton").tap()
        let answer = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "marker \(mark)")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 60), "pi 가 첨부한 파일을 읽고 첫 줄을 답해야 함")
        shot("file-answer")
        _ = waitGone(el("stopButton"), 30)
    }

    /// V. 주간 사용량: 서랍 아래 카드(이번 주 %·7일 작은 막대) → 누르면 사용량 화면(주간 추이 그래프·하루 사용량)
    ///    (시험 브리지는 가짜 7일 기록 폴더를 봄: PI_REMOTE_USAGE_DIR)
    func testV_UsageGraph() {
        relaunch(test: "")
        openDrawer()
        let card = el("usageMiniCard")
        XCTAssertTrue(card.waitForExistence(timeout: 10), "서랍 아래 사용량 카드가 보여야 함")
        let pct = expectation(for: NSPredicate(format: "label CONTAINS '%'"), evaluatedWith: card)
        XCTAssertEqual(XCTWaiter().wait(for: [pct], timeout: 15), .completed, "카드에 이번 주 %가 보여야 함(현재: \(card.label))")
        XCTAssertTrue(card.label.contains("개인") || card.label.contains("이번 주"), "카드에 계정별 원형 고리(이름·%)가 보여야 함(현재: \(card.label))")
        shot("usage-mini")
        card.tap()
        XCTAssertTrue(waitGone(el("drawer"), 5), "카드를 누르면 서랍이 닫혀야 함")
        XCTAssertTrue(el("weeklyChart").waitForExistence(timeout: 10), "사용량 화면에 주간 추이 그래프가 보여야 함")
        app.swipeUp()   // 화면 크게
        XCTAssertTrue(el("dailyChart").waitForExistence(timeout: 5), "사용량 화면에 하루 사용량 막대가 보여야 함")
        sleep(1)
        shot("usage-sheet")
    }
    /// W. 작업 표시(Live Activity) 모양: 앱 안에서 시험 표시를 띄우고(PI_REMOTE_TEST=live) 홈·잠금 화면을 찍는다(눈으로 확인용)
    func testW_LiveActivityLook() {
        relaunch(test: "live")
        sleep(5)
        XCUIDevice.shared.press(.home)
        sleep(3)
        shot("live-home")
        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))   // 시뮬레이터 잠금(시험 전용)
        sleep(2)
        XCUIDevice.shared.press(.home)   // 화면만 깨움(잠금 화면)
        sleep(3)
        shot("live-lock")
    }

    /// 시험 확장(/tmp/ptest/ptest-ext.ts)이 남기는 결과 줄
    private func clearPromptResult() { try? "".write(toFile: "/tmp/ptest-result.txt", atomically: true, encoding: .utf8) }
    private func promptResult(_ timeout: TimeInterval = 10) -> String {
        let end = Date().addingTimeInterval(timeout)
        repeat {
            let s = ((try? String(contentsOfFile: "/tmp/ptest-result.txt")) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !s.isEmpty { return s }
            usleep(200_000)
        } while Date() < end
        return ""
    }

    /// X. pi 확인 창 카드(다른 확장·pi 가 띄운 select·confirm·input): 선택은 번호 선택지, 예/아니오는 버튼 둘,
    ///    입력은 아래 입력창에 써서 답, 취소. 시험 확장을 띄운 pitest 에서만 돈다(/tmp/ptest/setup.sh)
    func testX_PromptCards() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/ptest/ptest-ext.ts"), "시험 확장이 없음")
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        clearPendingQuestion()
        let card = el("questionCard")

        // 1) 선택 창: 번호 선택지, 기타 없음, 취소 있음 → 누르면 그 답
        clearPromptResult()
        send("/ptest select")
        XCTAssertTrue(card.waitForExistence(timeout: 15), "선택 창 카드가 떠야 함")
        XCTAssertTrue(el("questionOption-2").exists && el("questionCancel").exists, "선택지 셋과 취소가 보여야 함")
        XCTAssertFalse(el("questionOther").exists, "선택 창엔 기타(직접 입력)가 없어야 함")
        sleep(1)
        shot("prompt-select")
        el("questionOption-1").tap()
        XCTAssertTrue(waitGone(card, 10), "고르면 카드가 사라져야 함")
        XCTAssertEqual(promptResult(), "select=\"Green\"", "고른 답이 확장에 닿아야 함")

        // 2) 예/아니오: 버튼 둘
        clearPromptResult()
        send("/ptest confirm")
        XCTAssertTrue(card.waitForExistence(timeout: 15), "예/아니오 카드가 떠야 함")
        XCTAssertTrue(el("questionOption-0").exists && el("questionOption-1").exists && !el("questionOther").exists, "예·아니오 버튼만")
        sleep(1)
        shot("prompt-confirm")
        el("questionOption-0").tap()
        XCTAssertTrue(waitGone(card, 10))
        XCTAssertEqual(promptResult(), "confirm=true", "예 → true")

        // 3) 입력: 입력창에 써서 보내기
        clearPromptResult()
        send("/ptest input")
        XCTAssertTrue(card.waitForExistence(timeout: 15), "입력 카드가 떠야 함")
        XCTAssertTrue(el("questionOther").exists, "'입력해서 답하기'가 보여야 함")
        sleep(1)
        shot("prompt-input")
        send("Alice")
        XCTAssertTrue(waitGone(card, 10))
        XCTAssertEqual(promptResult(), "input=\"Alice\"", "입력한 글이 답")

        // 4) 취소
        clearPromptResult()
        send("/ptest select")
        XCTAssertTrue(card.waitForExistence(timeout: 15))
        el("questionCancel").tap()
        XCTAssertTrue(waitGone(card, 10), "취소하면 카드가 사라져야 함")
        XCTAssertEqual(promptResult(), "select=undefined", "취소 → 고르지 않음")
    }

    /// Y. 승인 카드(핵심만): 하려는 일·걸린 이유·맡긴 작업·Haiku 요약, 명령은 '명령 보기'로 펼침.
    ///    맥 쪽에서 위험 명령을 시켜야 함(/tmp/ptest/sg-trigger 가 있으면 대기)
    func testY_ApprovalSummaryCard() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/ptest/sg-trigger"), "맥 쪽 시험 신호 없음")
        relaunch(test: "")
        openTab(1)
        try? "ready".write(toFile: "/tmp/ptest/sg-ready", atomically: true, encoding: .utf8)
        let card = el("approvalCard")
        XCTAssertTrue(card.waitForExistence(timeout: 150), "승인 카드가 떠야 함")
        XCTAssertTrue(el("approvalPurpose").waitForExistence(timeout: 5), "하려는 일·걸린 이유가 보여야 함")
        XCTAssertFalse(el("approvalDetail").exists, "명령은 접혀 있어야 함")
        XCTAssertTrue(el("approvalHeadline").waitForExistence(timeout: 45), "무엇을 하는 명령인지 한 문장(Opus)이 채워져야 함")
        XCTAssertTrue(el("approvalRisk").exists, "위험도 배지")
        sleep(1)
        shot("approval-summary")
        el("approvalShowCode").tap()
        XCTAssertTrue(el("approvalDetail").waitForExistence(timeout: 3), "명령 보기를 누르면 명령이 보여야 함")
        sleep(1)
        shot("approval-code")
        el("approvalDeny").tap()
        XCTAssertTrue(waitGone(card, 10), "거부하면 카드가 사라져야 함")
    }

    /// Z. 여러 질문 카드: 질문 두 개를 한 번에(카드 하나), 질문마다 고르고 [보내기] 한 번 → 질문별 답이 pi 에 닿음
    func testZ_MultiQuestionCard() {
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        clearPendingQuestion()
        send("Use the ask_user tool exactly once, putting two questions in the questions array: first 'Color?' with options Red and Blue; second 'Size?' with options Small and Large and multiSelect true. Then reply with the answers only.")
        let card = el("questionCard")
        XCTAssertTrue(card.waitForExistence(timeout: 60), "여러 질문 카드가 떠야 함")
        // 한 번에 하나: 첫 질문만 보이고 둘째 질문 선택지는 아직 없음, 이전 버튼도 없음
        XCTAssertEqual(el("questionStep").label, "질문 1/2")
        XCTAssertTrue(el("mq-0-1").exists && !el("mq-1-0").exists, "질문은 하나씩 보여야 함")
        XCTAssertFalse(el("questionPrev").exists, "첫 질문엔 이전 버튼이 없어야 함")
        shot("multi-question-1")
        // 하나 고르기: 누르면 바로 다음 질문
        el("mq-0-1").tap()
        XCTAssertTrue(el("mq-1-0").waitForExistence(timeout: 3), "고르면 바로 다음 질문으로 넘어가야 함")
        XCTAssertEqual(el("questionStep").label, "질문 2/2")
        // 이전으로 가면 고른 답이 남아 있고, 다시 고르면 다음으로
        el("questionPrev").tap()
        XCTAssertTrue(el("mq-0-1").waitForExistence(timeout: 3), "이전을 누르면 앞 질문")
        XCTAssertEqual(el("questionStep").label, "질문 1/2")
        el("mq-0-1").tap()
        XCTAssertTrue(el("mq-1-0").waitForExistence(timeout: 3))
        // 여러 개 고르기(마지막): 고른 뒤 [보내기]
        XCTAssertFalse(el("questionSubmit").isEnabled, "고르기 전엔 보내기가 꺼져 있어야 함")
        el("mq-1-0").tap()
        el("mq-1-1").tap()
        XCTAssertTrue(card.exists, "여러 개 고르기는 누를 때마다 보내지 않아야 함")
        sleep(1)
        shot("multi-question")
        XCTAssertTrue(el("questionSubmit").isEnabled, "고르면 보내기가 켜져야 함")
        el("questionSubmit").tap()
        XCTAssertTrue(waitGone(card, 10), "보내면 카드가 사라져야 함")
        XCTAssertTrue(sessionLogContains("1. Color? → 사용자가 고른 답: Blue"), "첫 질문 답이 pi 에 닿아야 함")
        XCTAssertTrue(sessionLogContains("2. Size? → 사용자가 고른 답: Small, Large"), "둘째 질문(여러 개) 답이 pi 에 닿아야 함")
        _ = waitGone(el("stopButton"), 60)
    }

    /// FF. 키보드가 올라와도 카드 아래 버튼이 키보드 위에 보임
    ///     ① 긴 여러 질문 카드의 '기타' 칸에 쓰는 중 ② 아래 입력창에 쓰는 중 ③ 입력창에 쓰는 중 뜬 승인 카드
    func testFF_CardButtonsAboveKeyboard() {
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        clearPendingQuestion()
        send("Use the ask_user tool exactly once with a questions array of three questions about favorite season, favorite drink and favorite city. Make each question text about 120 characters long, and give each question two options whose descriptions are about 100 characters long. Then reply with the answers only.")
        let card = el("questionCard")
        XCTAssertTrue(card.waitForExistence(timeout: 90), "여러 질문 카드가 떠야 함")
        XCTAssertTrue(el("mq-0-1").waitForExistence(timeout: 5))
        sleep(1)
        let submit = el("questionNext")   // 첫 질문에선 [다음]

        // ① 카드 안 '기타' 칸
        let other = el("mq-0-other")
        other.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "키보드가 올라와야 함")
        other.typeText("my own answer")
        sleep(1)
        var kb = app.keyboards.firstMatch.frame
        shot("ff-other-keyboard")
        XCTAssertTrue(submit.isHittable, "다음 버튼이 눌릴 수 있어야 함")
        XCTAssertLessThanOrEqual(submit.frame.maxY, kb.minY + 1, "다음 버튼이 키보드 위에 있어야 함")
        XCTAssertLessThanOrEqual(other.frame.maxY, kb.minY + 1, "쓰는 칸도 키보드 위에 보여야 함")
        XCTAssertGreaterThan(other.frame.minY, el("questionScroll").frame.minY - 1, "쓰는 칸이 스크롤 칸 안에 보여야 함")

        // ② 아래 입력창에 쓰는 중
        el("composerInput").tap()
        sleep(1)
        kb = app.keyboards.firstMatch.frame
        shot("ff-composer-keyboard")
        XCTAssertLessThanOrEqual(submit.frame.maxY, kb.minY + 1, "입력창에 쓸 때도 보내기 버튼이 키보드 위")
        XCTAssertLessThanOrEqual(el("composerInput").frame.maxY, kb.minY + 1, "입력창도 키보드 위")

        // [다음] → 둘째 질문 고르면 셋째로 → 마지막 질문을 고르면 따로 누르지 않아도 보냄
        submit.tap()
        XCTAssertTrue(el("mq-1-0").waitForExistence(timeout: 3), "다음을 누르면 둘째 질문")
        el("mq-1-0").tap()
        XCTAssertTrue(el("mq-2-1").waitForExistence(timeout: 3), "고르면 셋째 질문")
        XCTAssertEqual(el("questionStep").label, "질문 3/3")
        el("mq-2-1").tap()
        XCTAssertTrue(waitGone(card, 10), "마지막 질문을 고르면 저절로 보내져 카드가 사라져야 함")
        XCTAssertTrue(sessionLogContains("my own answer"), "'기타'에 쓴 답이 pi 에 닿아야 함")
        _ = waitGone(el("stopButton"), 90)

        // ③ 입력창에 쓰는 중에 뜬 승인 카드(토큰 없는 Slack 요청이라 실행돼도 아무 데도 안 감, 거부로 끝냄)
        send("Run exactly this bash command once and nothing else: curl -s -X POST https://slack.com/api/chat.postMessage -d channel=test -d text=hello")
        let input = el("composerInput")
        input.tap()
        input.typeText("draft while approval")
        let ac = el("approvalCard")
        XCTAssertTrue(ac.waitForExistence(timeout: 90), "승인 카드가 떠야 함")
        sleep(3)
        kb = app.keyboards.firstMatch.frame
        shot("ff-approval-keyboard")
        XCTAssertTrue(app.keyboards.firstMatch.exists, "키보드가 올라와 있는 상태여야 함")
        XCTAssertLessThanOrEqual(el("approvalDeny").frame.maxY, kb.minY + 1, "거부 버튼이 키보드 위에 있어야 함")
        el("approvalDeny").tap()
        XCTAssertTrue(waitGone(ac, 10), "거부하면 카드가 사라져야 함")
        _ = waitGone(el("stopButton"), 60)
        input.tap()
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 30))
    }

    /// GG. pi 가 읽은 사진도 좌우로 넘겨 봄(예전엔 한 장만 열림). 맥에 /tmp/ptest/pic-a.png, pic-b.png 필요
    func testGG_ToolImagesPaging() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/ptest/pic-b.png"), "시험 사진 없음")
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        clearPendingQuestion()
        send("Use the read tool to read the image /tmp/ptest/pic-a.png, then use the read tool again to read /tmp/ptest/pic-b.png. Then reply with only: done")
        _ = el("stopButton").waitForExistence(timeout: 10)
        XCTAssertTrue(waitGone(el("stopButton"), 90), "작업이 끝나야 함")
        let imgs = app.descendants(matching: .any).matching(identifier: "toolImage")
        let second = imgs.element(boundBy: imgs.count - 1)
        XCTAssertGreaterThanOrEqual(imgs.count, 2, "읽은 사진 두 장이 보여야 함")
        XCTAssertTrue(second.waitForExistence(timeout: 15))
        sleep(2)
        imgs.element(boundBy: imgs.count - 2).tap()
        let idx = el("viewerIndex")
        XCTAssertTrue(idx.waitForExistence(timeout: 5), "여러 장이면 위치 표시가 보여야 함(읽은 사진도 넘기기 목록에)")
        let parts = idx.label.components(separatedBy: " / ")
        let at = Int(parts.first ?? "") ?? 0, total = parts.last ?? ""
        shot("gg-viewer")
        app.swipeLeft()
        let next = expectation(for: NSPredicate(format: "label == %@", "\(at + 1) / \(total)"), evaluatedWith: idx)
        XCTAssertEqual(XCTWaiter().wait(for: [next], timeout: 4), .completed, "왼쪽으로 밀면 다음(읽은) 사진(현재 \(idx.label))")
        XCTAssertTrue(el("imageViewer").waitForExistence(timeout: 8), "넘긴 사진도 보여야 함")
        app.swipeRight()
        let prev = expectation(for: NSPredicate(format: "label == %@", "\(at) / \(total)"), evaluatedWith: idx)
        XCTAssertEqual(XCTWaiter().wait(for: [prev], timeout: 4), .completed, "오른쪽으로 밀면 이전 사진")
        el("viewerClose").tap()
    }

    /// HH. 승인이 한꺼번에 여러 개 와도 하나씩('1/2'), 답하면 다음 것.
    ///     시험 확장(/ptest approvals2)이 send-guard 와 같은 이벤트로 승인 두 개를 한꺼번에 띄움
    func testHH_ApprovalsOneAtATime() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/ptest/ptest-ext.ts"), "시험 확장이 없음")
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        clearPendingQuestion()
        clearPromptResult()
        send("/ptest approvals2")
        let cards = app.descendants(matching: .any).matching(identifier: "approvalCard")
        XCTAssertTrue(cards.firstMatch.waitForExistence(timeout: 20), "승인 카드가 떠야 함")
        sleep(2)
        XCTAssertEqual(cards.count, 1, "승인 카드는 한 번에 하나만 보여야 함")
        XCTAssertTrue(el("approvalQueue").exists, "두 개 기다리면 '1/2'가 보여야 함")
        XCTAssertEqual(el("approvalQueue").label, "1/2")
        shot("hh-approval-1")
        el("approvalDeny").tap()
        sleep(2)
        XCTAssertTrue(el("approvalDeny").waitForExistence(timeout: 10), "하나 답하면 다음 승인이 떠야 함")
        XCTAssertEqual(cards.count, 1)
        XCTAssertFalse(el("approvalQueue").exists, "마지막 하나면 '1/N' 표시가 없어야 함")
        shot("hh-approval-2")
        el("approvalDeny").tap()
        XCTAssertTrue(waitGone(cards.firstMatch, 10), "다 답하면 카드가 없어야 함")
        XCTAssertEqual(promptResult(), "approvals2=[false,false]", "두 승인 모두 거부로 pi 에 닿아야 함")
    }

    /// II. 저장하기: 큰 동영상(나눠 받기·진행률) → 사진 앱, PDF → pi-remote 폴더·다른 위치 창,
    ///     카드 길게 누르기 → 폴더, 채팅 사진 → 사진 앱. 맥 쪽에 /tmp/ptest/chunk-e2e.mjs 로 아티팩트를 등록해 둬야 함
    func testII_SaveFiles() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/arttest/big.mp4"), "시험 파일 없음")
        relaunch(test: "attach")
        openTab(1)
        let toast = el("saveToast")
        func openArtifact(_ name: String) {
            el("artifactsButton").tap()
            let row = app.buttons.matching(NSPredicate(format: "identifier == 'artifactRow' AND label CONTAINS %@", name)).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 8), "목록에 \(name)")
            row.tap()
            XCTAssertTrue(el("artifactViewer").waitForExistence(timeout: 8))
        }
        func waitToast(_ text: String) {
            let ok = expectation(for: NSPredicate(format: "label CONTAINS %@", text), evaluatedWith: toast)
            XCTAssertEqual(XCTWaiter().wait(for: [ok], timeout: 20), .completed, "'\(text)' 안내가 떠야 함(지금: \(toast.exists ? toast.label : "없음"))")
        }

        // ① 큰 동영상: 진행률 → 사진 앱
        openArtifact("big.mp4")
        // 시뮬레이터는 맥과 같은 기기라 금방 받음: 받는 중 화면은 보이면 찍어 둠
        if el("artifactLoading").waitForExistence(timeout: 3) { shot("ii-loading") }
        XCTAssertTrue(el("saveButton").waitForExistence(timeout: 90), "다 받으면 저장 버튼이 보여야 함")
        XCTAssertFalse(el("artifactError").exists, "25MB 넘어도 받아져야 함")
        XCTAssertTrue(el("mediaPlayer").waitForExistence(timeout: 5), "동영상은 재생기로 보여야 함")
        let playable = expectation(for: NSPredicate(format: "value BEGINSWITH 'ready'"), evaluatedWith: el("mediaPlayer"))
        XCTAssertEqual(XCTWaiter().wait(for: [playable], timeout: 10), .completed, "동영상을 읽어 재생할 수 있어야 함(지금: \(el("mediaPlayer").value ?? ""))")
        XCTAssertGreaterThan(el("mediaPlayer").frame.height, 300, "재생기가 화면에 크게 보여야 함")
        el("mediaPlayer").tap()   // 재생 조작 막대
        sleep(1)
        let play = app.buttons.matching(NSPredicate(format: "label IN {'재생', 'Play'}")).firstMatch
        if play.waitForExistence(timeout: 3) { play.tap() }
        let moving = expectation(for: NSPredicate(format: "value BEGINSWITH 'ready ' AND value != 'ready 0'"), evaluatedWith: el("mediaPlayer"))
        XCTAssertEqual(XCTWaiter().wait(for: [moving], timeout: 8), .completed, "재생을 누르면 시간이 흘러야 함(지금: \(el("mediaPlayer").value ?? ""))")
        try? "playing".write(toFile: "/tmp/ptest/video-playing", atomically: true, encoding: .utf8)
        sleep(4)   // 그사이 맥에서 시뮬레이터 화면을 직접 찍음
        shot("ii-video-play")
        el("saveButton").tap()
        waitToast("동영상을 사진 앱에 저장했어요")
        sleep(3)
        shot("ii-video-saved")
        el("artifactClose").tap()

        // ② PDF: 누르면 pi-remote 폴더, 길게 누르면 메뉴 → 다른 위치 창
        sleep(2)
        openArtifact("chart.pdf")
        XCTAssertTrue(el("saveButton").waitForExistence(timeout: 20))
        el("saveButton").tap()
        waitToast("Antenna 폴더에 저장했어요")
        sleep(3)
        el("saveButton").press(forDuration: 1.0)
        XCTAssertTrue(app.buttons["다른 위치에 저장…"].waitForExistence(timeout: 5), "길게 누르면 저장 메뉴")
        XCTAssertTrue(app.buttons["파일 앱 › Antenna 폴더에 저장"].exists)
        XCTAssertFalse(app.buttons["사진 앱에 저장"].exists, "문서엔 사진 앱 항목이 없어야 함")
        shot("ii-menu")
        app.buttons["다른 위치에 저장…"].tap()
        sleep(3)
        shot("ii-picker")
        // 폴더 고르기 창(파일 앱): 오른쪽 위 [저장]이 있으면 열린 것. 아래로 내려 닫음
        XCTAssertTrue(app.buttons["저장"].waitForExistence(timeout: 8), "폴더 고르기 창이 열려야 함")
        app.swipeDown(velocity: .fast)
        XCTAssertTrue(waitGone(app.buttons["저장"], 8), "창을 내려 닫을 수 있어야 함")
        sleep(1)
        el("artifactClose").tap()

        // ③ 채팅의 소리 파일 카드 길게 누르기 → pi-remote 폴더
        sleep(2)
        let card = app.buttons.matching(NSPredicate(format: "identifier == 'artifactCard' AND label CONTAINS 'tone.m4a'")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 8), "소리 파일 카드")
        card.press(forDuration: 1.0)
        XCTAssertTrue(app.buttons["파일 앱 › Antenna 폴더에 저장"].waitForExistence(timeout: 5), "카드를 길게 누르면 저장 메뉴")
        app.buttons["파일 앱 › Antenna 폴더에 저장"].tap()
        waitToast("Antenna 폴더에 저장했어요")

        // ④ 채팅 사진: 보내고 전체 화면에서 저장 → 사진 앱
        let thumb = el("attachmentThumb")
        XCTAssertTrue(thumb.waitForExistence(timeout: 15))
        let ready = expectation(for: NSPredicate(format: "value == 'ready'"), evaluatedWith: thumb)
        XCTAssertEqual(XCTWaiter().wait(for: [ready], timeout: 20), .completed)
        send("save test: say ok")
        let bubble = app.descendants(matching: .any).matching(identifier: "bubbleThumb").firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 10))
        bubble.tap()
        XCTAssertTrue(el("imageViewer").waitForExistence(timeout: 8))
        sleep(2)
        el("saveButton").tap()
        waitToast("사진 앱에 저장했어요")
        shot("ii-photo-saved")
        el("viewerClose").tap()
        _ = waitGone(el("stopButton"), 60)
    }

    /// JJ. Claude Code 탭(Claude Code 용 피드): 채팅 화면·입력창 안내·보내기·답·모델 칩. /tmp/ptest/cc-setup.sh 로 준비
    func testJJ_ClaudeCodeTab() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/cctest-hooks.json"), "Claude Code 시험 준비 안 됨")
        relaunch(test: "")
        openTab(1)
        let input = el("composerInput")
        XCTAssertTrue(input.waitForExistence(timeout: 15), "Claude Code 탭도 채팅 화면이어야 함")
        let hint = expectation(for: NSPredicate(format: "placeholderValue == 'Claude에게 메시지 보내기'"), evaluatedWith: input)
        XCTAssertEqual(XCTWaiter().wait(for: [hint], timeout: 8), .completed, "입력창 안내가 Claude 여야 함(지금: \(input.placeholderValue ?? ""))")
        send("Reply with exactly one word: pong")
        let answer = app.staticTexts.matching(NSPredicate(format: "label ==[c] 'pong' OR label ==[c] 'pong.'")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 90), "Claude Code 의 답이 채팅에 보여야 함")
        _ = waitGone(el("stopButton"), 30)
        let chip = expectation(for: NSPredicate(format: "label CONTAINS 'Haiku'"), evaluatedWith: el("modelMenu"))
        XCTAssertEqual(XCTWaiter().wait(for: [chip], timeout: 10), .completed, "모델 칩이 Claude Code 모델이어야 함")
        sleep(1)
        shot("jj-claude-chat")
    }

    /// KK. 연결: QR 링크(piremote://pair?token=)로 저장·다시 연결, 잘못된 링크 무시, 앱에서 토큰 바꾸기(새 토큰 받아 저장 → 브리지가
    ///     새 토큰으로 다시 뜨면 다시 연결). 맥 쪽: 시험 브리지가 /tmp/rot-test.env 를 쓰고, 꺼지면 새 토큰으로 다시 띄우는 감시가 돌아야 함
    func testKK_PairAndRotateToken() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/rot-test.env"), "토큰 바꾸기 시험 준비 안 됨")
        guard #available(iOS 16.4, *) else { throw XCTSkip("링크 열기 시험은 iOS 16.4 이상") }
        let token = ProcessInfo.processInfo.environment["PI_REMOTE_TOKEN"] ?? ""
        relaunch(test: "")
        let connected = app.staticTexts.matching(NSPredicate(format: "label IN {'연결됨', '작업 중'}")).firstMatch
        XCTAssertTrue(connected.waitForExistence(timeout: 20), "처음엔 연결돼야 함")
        let toast = el("saveToast")
        // 1) 잘못된 링크는 무시
        app.open(URL(string: "piremote://pair?token=not-a-token")!)
        sleep(2)
        XCTAssertFalse(toast.exists, "잘못된 링크면 아무 일 없어야 함")
        XCTAssertTrue(connected.exists, "연결은 그대로")
        // 2) 올바른 링크: 저장하고 다시 연결
        app.open(URL(string: "piremote://pair?token=\(token)")!)
        let saved = expectation(for: NSPredicate(format: "label CONTAINS '연결 정보를 저장했어요'"), evaluatedWith: toast)
        XCTAssertEqual(XCTWaiter().wait(for: [saved], timeout: 10), .completed, "QR 링크면 '연결 정보를 저장했어요'")
        XCTAssertTrue(connected.waitForExistence(timeout: 20), "새 토큰으로 다시 연결돼야 함")
        // 3) 앱에서 토큰 바꾸기
        let before = (try? String(contentsOfFile: "/tmp/rot-test.env")) ?? ""
        el("moreMenu").tap()
        XCTAssertTrue(el("menuRotateToken").waitForExistence(timeout: 5))
        el("menuRotateToken").tap()
        XCTAssertTrue(app.buttons["새로 바꾸기"].waitForExistence(timeout: 5), "한 번 더 묻는 창")
        shot("kk-rotate-confirm")
        app.buttons["새로 바꾸기"].tap()
        let rotated = expectation(for: NSPredicate(format: "label CONTAINS '연결 토큰을 새로 바꿨어요'"), evaluatedWith: toast)
        XCTAssertEqual(XCTWaiter().wait(for: [rotated], timeout: 10), .completed, "새 토큰을 받았다는 안내")
        sleep(3)
        let after = (try? String(contentsOfFile: "/tmp/rot-test.env")) ?? ""
        XCTAssertNotEqual(before, after, "맥 설정 파일의 토큰이 바뀌어야 함")
        XCTAssertFalse(after.contains(token), "예전 토큰은 남지 않아야 함")
        // 브리지가 새 토큰으로 다시 뜨면 저절로 다시 연결
        XCTAssertTrue(connected.waitForExistence(timeout: 60), "새 토큰으로 다시 연결돼야 함")
        shot("kk-reconnected")
    }

    /// LL. 첫 화면(토큰 없음): 'QR 코드 찍기' 버튼 → 찍기 화면(시뮬레이터는 카메라 없음 안내) → QR 링크로 저장·바로 연결.
    ///     맥 쪽: 시뮬레이터 키체인을 비우고(xcrun simctl keychain <기기> reset) 시험 브리지를 띄워 둬야 함
    func testLL_TokenScreenQR() throws {
        guard #available(iOS 16.4, *) else { throw XCTSkip("링크 열기 시험은 iOS 16.4 이상") }
        let token = ProcessInfo.processInfo.environment["PI_REMOTE_TOKEN"] ?? ""
        app.terminate()
        app.launchEnvironment["PI_REMOTE_TOKEN"] = ""
        app.launchEnvironment["PI_REMOTE_FORGET_TOKEN"] = "1"
        app.launchEnvironment["PI_REMOTE_TEST"] = ""
        app.launch()
        app.launchEnvironment["PI_REMOTE_FORGET_TOKEN"] = "0"
        let scan = el("scanQR")
        XCTAssertTrue(scan.waitForExistence(timeout: 10) && scan.isHittable, "토큰이 없으면 첫 화면에 'QR 코드 찍기'")
        shot("ll-token-screen")
        scan.tap()
        XCTAssertTrue(el("qrSheet").waitForExistence(timeout: 5), "찍기 화면이 열려야 함")
        XCTAssertTrue(el("qrUnavailable").waitForExistence(timeout: 5), "시뮬레이터는 카메라가 없으니 안내")
        shot("ll-qr-unavailable")
        el("qrClose").tap()
        XCTAssertTrue(waitGone(el("qrSheet"), 5))
        // 카메라로 찍은 것과 같은 링크 → 저장하고 바로 연결
        app.open(URL(string: "piremote://pair?token=\(token)")!)
        let connected = app.staticTexts.matching(NSPredicate(format: "label IN {'연결됨', '작업 중'}")).firstMatch
        XCTAssertTrue(connected.waitForExistence(timeout: 30), "QR 링크로 토큰을 받으면 바로 연결돼야 함")
        shot("ll-connected")
    }

    /// PP. 연결 QR 의 맥 주소·포트: 받은 주소로 붙고, 이미 짝지은 폰의 맥 주소를 바꾸는 링크는 먼저 묻는다.
    ///     맥 쪽: 시험 브리지를 127.0.0.1 에만 열고(HOST=127.0.0.1: 자동 발견한 같은 Wi-Fi 주소로는 닿지 않게) 토큰은 16진수 64자로,
    ///     시뮬레이터 키체인을 비운 뒤 /tmp/ptest/pair-hosts-ok 를 만들어 둔다
    func testPP_PairLinkHosts() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/ptest/pair-hosts-ok"), "맥 주소 시험 준비 안 됨")
        guard #available(iOS 16.4, *) else { throw XCTSkip("링크 열기 시험은 iOS 16.4 이상") }
        let env = ProcessInfo.processInfo.environment
        let token = env["PI_REMOTE_TOKEN"] ?? ""
        let port = env["PI_REMOTE_PORT"] ?? "8799"
        // 처음 설치한 폰처럼 시작: 저장된 토큰·맥 주소를 지움. 그 뒤로는 시험용으로 넣어 주는 값 없이 앱이 저장한 값만 쓴다
        // (링크를 열 때 앱이 새로 뜨기도 해서, 넣어 주는 값이 있으면 링크로 받은 값을 매번 덮어씀)
        app.terminate()
        app.launchEnvironment["PI_REMOTE_TOKEN"] = ""
        app.launchEnvironment["PI_REMOTE_FORGET_TOKEN"] = "1"
        app.launchEnvironment.removeValue(forKey: "PI_REMOTE_HOSTS")
        app.launchEnvironment.removeValue(forKey: "PI_REMOTE_PORT")
        app.launchEnvironment["PI_REMOTE_TEST"] = ""
        app.launch()
        app.launchEnvironment["PI_REMOTE_FORGET_TOKEN"] = "0"
        XCTAssertTrue(el("scanQR").waitForExistence(timeout: 10), "토큰이 없으면 첫 화면")
        let connected = app.staticTexts.matching(NSPredicate(format: "label IN {'연결됨', '작업 중'}")).firstMatch
        let ask = app.alerts["연결할 맥 주소를 바꿀까요?"]
        // 1) 주소 없는 링크(토큰·포트만): 저장은 하지만 붙을 맥 주소가 없어 연결되지 않는다
        app.open(URL(string: "piremote://pair?token=\(token)&port=\(port)")!)
        XCTAssertFalse(connected.waitForExistence(timeout: 12), "맥 주소가 없으면 연결되지 않아야 함")
        XCTAssertFalse(ask.exists, "주소가 없는 링크는 묻지 않음")
        shot("pp-no-host")
        // 2) 주소가 든 링크: 이미 짝지은 폰의 맥 주소가 달라지므로 먼저 묻는다 → 취소하면 그대로
        let link = URL(string: "piremote://pair?token=\(token)&host=127.0.0.1&port=\(port)")!
        app.open(link)
        XCTAssertTrue(ask.waitForExistence(timeout: 8), "맥 주소가 바뀌는 링크면 물어야 함")
        shot("pp-ask")
        ask.buttons["취소"].tap()
        XCTAssertFalse(connected.waitForExistence(timeout: 8), "취소하면 주소를 바꾸지 않아 연결되지 않아야 함")
        // 3) 다시 열어 '바꾸기' → 받은 주소로 연결
        app.open(link)
        XCTAssertTrue(ask.waitForExistence(timeout: 8), "다시 열면 다시 물어야 함")
        ask.buttons["바꾸기"].tap()
        XCTAssertTrue(connected.waitForExistence(timeout: 30), "받은 맥 주소로 연결돼야 함")
        shot("pp-connected")
        // 4) 같은 주소의 링크는 묻지 않고 저장한다(주소에 쓸 수 없는 글자가 든 것은 버려져 주소가 그대로).
        //    포트만 아무것도 없는 곳으로 바꾼 링크 → 묻지 않고 끊김, 원래 포트의 링크 → 묻지 않고 다시 연결
        app.open(URL(string: "piremote://pair?token=\(token)&host=127.0.0.1&host=bad%20host&port=8790")!)
        sleep(2)
        shot("pp-same-host")
        XCTAssertFalse(ask.exists, "같은 주소면 묻지 않음")
        XCTAssertTrue(waitGone(connected, 20), "같은 주소면 묻지 않고 저장(포트가 바뀌어 연결이 끊겨야 함)")
        app.open(link)
        XCTAssertTrue(connected.waitForExistence(timeout: 30), "원래 포트의 링크로 다시 연결돼야 함")
        XCTAssertFalse(ask.exists, "같은 주소면 묻지 않음")
    }

    /// RR. 지금 방식의 짝짓기: QR 에 한 번 쓰는 코드와 맥 인증서 지문이 들어 있다. 코드를 맥에 내고 이 폰만의 토큰을 받아,
    ///     그 지문의 맥과만 맺는 암호화 연결로 붙는다. 이미 쓴 코드의 링크를 다시 열어도 쓰던 연결은 그대로다.
    ///     맥 쪽: 시험 브리지의 설정 폴더에서 코드를 만들어 /tmp/ptest/pair-code-link 에 링크를 적어 둔다(test/app.sh)
    func testRR_PairCode() throws {
        guard #available(iOS 16.4, *) else { throw XCTSkip("링크 열기 시험은 iOS 16.4 이상") }
        guard let text = try? String(contentsOfFile: "/tmp/ptest/pair-code-link", encoding: .utf8),
              let link = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)) else { throw XCTSkip("짝짓기 코드 링크가 준비 안 됨") }
        // 처음 설치한 폰처럼: 저장된 토큰·맥 주소·지문을 지우고, 시험용으로 넣어 주는 값 없이 시작
        app.terminate()
        app.launchEnvironment["PI_REMOTE_TOKEN"] = ""
        app.launchEnvironment["PI_REMOTE_FORGET_TOKEN"] = "1"
        app.launchEnvironment.removeValue(forKey: "PI_REMOTE_HOSTS")
        app.launchEnvironment.removeValue(forKey: "PI_REMOTE_PORT")
        app.launchEnvironment["PI_REMOTE_TEST"] = ""
        app.launch()
        app.launchEnvironment["PI_REMOTE_FORGET_TOKEN"] = "0"
        XCTAssertTrue(el("scanQR").waitForExistence(timeout: 10), "토큰이 없으면 첫 화면")
        let connected = app.staticTexts.matching(NSPredicate(format: "label IN {'연결됨', '작업 중'}")).firstMatch
        // 0) 지문이 다른 링크(맥인 척하는 다른 기기를 흉내): 그 맥을 믿지 않으므로 코드를 보내지 않고, 짝지어지지 않는다.
        //    코드를 보내지 않았다는 것은 바로 아래 1)에서 같은 코드로 짝지어지는 것으로 확인된다(코드는 한 번만 쓸 수 있음)
        var comps = URLComponents(url: link, resolvingAgainstBaseURL: false)!
        comps.queryItems = comps.queryItems?.map { item in
            guard item.name == "fp", let v = item.value, let first = v.first else { return item }
            return URLQueryItem(name: "fp", value: (first == "0" ? "1" : "0") + v.dropFirst())
        }
        app.open(comps.url!)
        XCTAssertFalse(connected.waitForExistence(timeout: 18), "지문이 다른 맥과는 짝짓지 않아야 함")
        XCTAssertTrue(el("scanQR").exists, "짝짓지 못했으면 첫 화면 그대로")
        shot("rr-wrong-fingerprint")
        // 1) 코드가 든 링크: 맥에 코드를 내고 이 폰만의 토큰을 받아 연결
        app.open(link)
        XCTAssertTrue(connected.waitForExistence(timeout: 30), "코드로 짝짓고 받은 토큰으로 연결돼야 함")
        shot("rr-paired")
        // 2) 같은 링크를 다시(코드는 한 번만 쓸 수 있음): 짝짓지는 못하지만 받아 둔 토큰·지문은 그대로라 다시 연결된다
        app.open(link)
        sleep(4)
        XCTAssertTrue(connected.waitForExistence(timeout: 30), "이미 쓴 코드의 링크를 다시 열어도 쓰던 연결은 그대로여야 함")
        shot("rr-reopened")
    }

    /// SS. 서랍의 백그라운드 칸: 백그라운드 탭은 보통 탭 아래 '백그라운드 N' 칸에 따로(앞의 bg 를 뗀 할 일·상태·걸린 시간·시킨 탭),
    ///     ☰ 점에는 넣지 않고(답을 기다릴 때만), 보통 탭 안에서 뒤에서 도는 일은 그 줄에 보인다.
    ///     '끝난 것 모두 닫기'는 확인 창 뒤 끝나고 쉬는 백그라운드 탭만 닫는다(일하는 탭·뒤에서 셸이 도는 탭은 남김).
    ///     맥 쪽: 시험 세션에 시킨 탭과 백그라운드 탭 셋·뒤에서 셸이 도는 보통 탭을 만들고 창 번호를 /tmp/ptest/bg-wins 에 적는다(test/app.sh)
    func testSS_BackgroundDrawer() throws {
        guard let text = try? String(contentsOfFile: "/tmp/ptest/bg-wins", encoding: .utf8) else { throw XCTSkip("백그라운드 서랍 시험 준비 안 됨") }
        let n = text.split(separator: " ").compactMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
        guard n.count == 4 else { throw XCTSkip("백그라운드 서랍 시험 준비가 이상함: \(text)") }
        let (working, done, doneJobs, jobsTab) = (n[0], n[1], n[2], n[3])
        let has = { (e: XCUIElement, pattern: String) in e.label.range(of: pattern, options: .regularExpression) != nil }
        relaunch(test: "")
        openDrawer()
        // 1) 보통 탭 아래 '백그라운드 3' 칸, 그 아래 백그라운드 탭들
        let title = el("drawerBgTitle")
        XCTAssertTrue(title.waitForExistence(timeout: 20), "백그라운드 칸이 보여야 함")
        XCTAssertEqual(title.label, "백그라운드 3")
        let w = el("tab-\(working)"), d = el("tab-\(done)"), dj = el("tab-\(doneJobs)"), j = el("tab-\(jobsTab)")
        XCTAssertTrue(w.exists && d.exists && dj.exists && j.exists, "탭 넷이 다 보여야 함")
        XCTAssertLessThan(j.frame.minY, title.frame.minY, "보통 탭은 백그라운드 칸 위에")
        XCTAssertGreaterThan(w.frame.minY, title.frame.minY, "백그라운드 탭은 그 칸 아래에")
        // 2) 줄 글: 이름은 앞의 bg 를 뗀 할 일, 상태·걸린 시간·시킨 탭
        XCTAssertTrue(w.label.contains("테스트 고치기") && !w.label.contains("bg 테스트"), "이름은 앞의 bg 를 뗀 할 일(현재: \(w.label))")
        XCTAssertTrue(has(w, "작업 중 · \\d+분 · 시킨탭에서 시킴"), "일하는 중·걸린 시간·시킨 탭(현재: \(w.label))")
        XCTAssertTrue(has(d, "끝남 · 1시간( \\d+분)? 전 · 시킨탭의 AI가 시킴"), "끝난 때·AI 가 시킴(현재: \(d.label))")
        XCTAssertTrue(has(dj, "끝남 · \\d+분 전 · 폰에서 시킴"), "끝났지만 뒤에서 셸이 돎·폰에서 시킴(현재: \(dj.label))")
        // 그 아래 줄: 그 탭의 모델·생각 깊이(모르면 줄 없음)
        XCTAssertTrue(w.label.contains("Opus 5.5 · 높음"), "백그라운드 탭의 모델·생각 깊이(현재: \(w.label))")
        XCTAssertFalse(d.label.contains("Opus"), "모델을 모르는 탭에는 모델 줄이 없음(현재: \(d.label))")
        // 뒤에서 도는 일은 줄 아래 따로 누르는 '백그라운드 작업 N ›'(종류를 합한 수: 셸 1개 · 에이전트 2개 → 3)
        XCTAssertEqual(el("tab-jobs-\(doneJobs)").label, "백그라운드 작업 1")
        XCTAssertTrue(el("tab-jobs-\(jobsTab)").label.contains("백그라운드 작업 3") && !j.label.contains("백그라운드 작업"),
                      "보통 탭의 뒤에서 도는 일은 줄 아래 단추에(현재: 줄 \(j.label) / 단추 \(el("tab-jobs-\(jobsTab)").label))")
        XCTAssertFalse(el("tab-jobs-\(working)").exists, "뒤에서 도는 일이 없는 탭에는 단추가 없음")
        shot("ss-drawer")
        // 3) ☰ 점: 일하는 백그라운드 탭은 넣지 않음(그 탭 말고는 일하는 탭이 없음)
        closeDrawer()
        XCTAssertFalse(el("drawerButton").label.contains("작업 중"), "일하는 백그라운드 탭은 ☰ 점에 넣지 않아야 함(현재: \(el("drawerButton").label))")
        // 4) 끝난 것 모두 닫기: 확인 창(닫을 수 1개) → 끝나고 쉬는 탭만 닫힘
        openDrawer()
        let closeAll = el("bgCloseFinished")
        XCTAssertTrue(closeAll.waitForExistence(timeout: 5), "끝난 것이 있으면 '끝난 것 모두 닫기' 단추")
        closeAll.tap()
        let confirm = app.buttons["모두 닫기"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "확인 창이 떠야 함")
        XCTAssertTrue(app.staticTexts["끝난 백그라운드 탭 1개를 닫을까요?"].exists, "확인 창에 닫을 개수(1개)")
        shot("ss-confirm")
        confirm.tap()
        XCTAssertTrue(waitGone(el("tab-\(done)"), 10), "끝나고 쉬는 백그라운드 탭이 닫혀야 함")
        XCTAssertTrue(el("tab-\(working)").exists && el("tab-\(doneJobs)").exists && el("tab-\(jobsTab)").exists, "일하는 탭·뒤에서 셸이 도는 탭은 남아야 함")
        XCTAssertEqual(el("drawerBgTitle").label, "백그라운드 2")
        XCTAssertFalse(el("bgCloseFinished").exists, "더 닫을 것이 없으면 단추가 사라져야 함")
        shot("ss-closed")
        // 5) '백그라운드 작업 3 ›'을 누르면 그 탭으로 가서 작업 목록(맥: 그 탭에 가짜 Claude Code·연결부, 진짜 셸 하나와 대화 기록의 에이전트 하나)
        el("tab-jobs-\(jobsTab)").tap()
        let shellRow = el("job-bshapp"), agentRow = el("job-aagapp")
        XCTAssertTrue(shellRow.waitForExistence(timeout: 20), "작업 목록에 뒤에서 도는 셸")
        XCTAssertTrue(agentRow.exists, "작업 목록에 에이전트")
        // 줄은 안의 '종료' 단추를 따로 누를 수 있게 묶음으로 둠 → 줄 안의 글들을 모아 봄
        let texts = { (e: XCUIElement) in e.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " | ") }
        let st = texts(shellRow), at = texts(agentRow)
        XCTAssertTrue(st.contains("긴 시험 돌리기") && st.range(of: "셸 · \\d+분째", options: .regularExpression) != nil, "셸: 이름·걸린 시간(현재: \(st))")
        XCTAssertTrue(el("jobTail-bshapp").label.contains("진행 2"), "셸의 최근 출력(현재: \(el("jobTail-bshapp").label))")
        XCTAssertTrue(at.contains("엔진 조사") && at.range(of: "에이전트 · \\d+분째", options: .regularExpression) != nil, "에이전트: 이름·걸린 시간(현재: \(at))")
        XCTAssertTrue(at.contains("general-purpose · Opus 5.5 · 높음"), "에이전트: 그 아래 줄에 종류·모델·생각 깊이(현재: \(at))")
        XCTAssertFalse(st.contains("Opus"), "셸에는 모델 줄이 없음(현재: \(st))")
        shot("ss-jobs")
        // 셸 종료: 확인 창 → 맥에서 바로 종료하고 목록에서 빠짐
        XCTAssertEqual(el("jobKill-bshapp").label, "종료")
        el("jobKill-bshapp").tap()
        let killShell = app.buttons["셸 종료"]
        XCTAssertTrue(killShell.waitForExistence(timeout: 5), "셸을 종료할지 묻는 확인 창")
        XCTAssertTrue(app.staticTexts["'긴 시험 돌리기' 셸을 종료할까요?"].exists, "확인 창 제목")
        shot("ss-jobs-confirm")
        killShell.tap()
        let notice = el("jobsNotice")
        XCTAssertTrue(notice.waitForExistence(timeout: 10) && notice.label.contains("작업을 종료했어요"), "종료했다는 안내(현재: \(notice.label))")
        XCTAssertTrue(waitGone(el("job-bshapp"), 15), "종료한 셸은 목록에서 빠짐")
        // 에이전트 종료: 확인 창(조사는 받침에 맞게 '에이전트를') → Claude 에게 종료해 달라고 보냄
        XCTAssertEqual(el("jobKill-aagapp").label, "종료")
        el("jobKill-aagapp").tap()
        let stopAgent = app.buttons["종료해 달라고 보내기"]
        XCTAssertTrue(stopAgent.waitForExistence(timeout: 5), "에이전트를 종료할지 묻는 확인 창")
        XCTAssertTrue(app.staticTexts["'엔진 조사' 에이전트를 종료할까요?"].exists, "확인 창 제목")
        stopAgent.tap()
        var sent = false
        for _ in 0..<20 where !sent {
            sent = el("jobsNotice").exists && el("jobsNotice").label.contains("종료해 달라고 보냈어요")
            if !sent { usleep(500_000) }
        }
        XCTAssertTrue(sent, "종료해 달라고 보냈다는 안내")
        shot("ss-jobs-after")
        el("jobsClose").tap()
        // 6) 연결부가 없는 탭(끝났지만 셸이 도는 백그라운드 탭)의 목록: 연결되지 않았다는 안내
        openDrawer()
        el("tab-jobs-\(doneJobs)").tap()
        XCTAssertTrue(app.staticTexts["이 탭의 Claude Code 에 연결되지 않았어요"].waitForExistence(timeout: 20), "연결부가 없는 탭은 안내")
        el("jobsClose").tap()
        // 7) 확인 창의 글(11-16 사용자 보고: Claude Code 탭을 닫는데 'pi 도 함께 종료돼요'라고 나옴).
        //    창 닫기는 탭에서 무엇이 돌든 맞는 말로, 새 대화는 그 탭에서 도는 것의 이름으로. 창은 닫지 않고 글만 본 뒤 물린다
        let dismiss = { (text: XCUIElement) in
            if self.app.buttons["취소"].exists { self.app.buttons["취소"].tap() }
            else { self.app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).tap() }
            _ = self.waitGone(text, 5)
        }
        el("moreMenu").tap()
        app.buttons["창 닫기"].tap()
        let closeNote = app.staticTexts["이 창에서 실행 중인 작업도 함께 종료돼요."]
        XCTAssertTrue(closeNote.waitForExistence(timeout: 5), "창 닫기 확인 창의 글")
        shot("ss-close-confirm")
        dismiss(closeNote)
        XCTAssertTrue(el("tab-\(doneJobs)").exists || !el("drawer").exists, "물리면 창은 그대로")
        openTab(jobsTab)   // 가짜 Claude Code 가 도는 탭
        el("moreMenu").tap()
        app.buttons["새 대화"].tap()
        let newNote = app.staticTexts["지금 대화는 Claude Code 기록에 남아요. 맥 Claude Code 에서 /resume 으로 다시 열 수 있어요."]
        XCTAssertTrue(newNote.waitForExistence(timeout: 5), "Claude Code 탭의 새 대화 확인 창은 Claude Code 라고 적음")
        shot("ss-new-confirm")
        dismiss(newNote)
    }

    /// QQ. 관리자 권한 확인 창(🔐 탭): 확인 단계에는 버튼(실행·명령 보기·취소)만 있고 글을 넣을 칸이 없다. 실행하면 가려진 칸이 나오고,
    ///     거기에 넣은 글은 화면·쓰던 글 저장에 남지 않으며 그 창에 그대로 전달된다. 취소 버튼은 창을 닫는다.
    ///     맥 쪽: 시험 세션에 🔐sudo 창 두 개를 띄워 두고 창 번호를 /tmp/ptest/secret-win(실행용)·secret-win2(취소용)에 적는다.
    ///     창의 명령은 터미널에서 가려 받은 글을 /tmp/ptest/secret-got 에 적는다(진짜 sudo·진짜 비밀번호는 쓰지 않음)
    func testQQ_SecretInput() throws {
        let num: (String) -> Int? = { (try? String(contentsOfFile: $0)).flatMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) } }
        guard let n = num("/tmp/ptest/secret-win") else { throw XCTSkip("관리자 권한 창 시험 준비 안 됨") }
        let pw = "Tst-Pw!9x"
        try? FileManager.default.removeItem(atPath: "/tmp/ptest/secret-got")
        relaunch(test: "")
        // 0) 취소 버튼: 그 창이 취소로 끝나고 탭이 사라진다
        if let n2 = num("/tmp/ptest/secret-win2"), let flag = try? String(contentsOfFile: "/tmp/ptest/secret-cancel-flag") {
            openTab(n2)
            XCTAssertTrue(el("secretCancel").waitForExistence(timeout: 10), "확인 단계에는 취소 버튼")
            el("secretCancel").tap()
            var cancelled = false
            for _ in 0..<10 where !cancelled {
                cancelled = FileManager.default.fileExists(atPath: flag.trimmingCharacters(in: .whitespacesAndNewlines))
                if !cancelled { sleep(1) }
            }
            XCTAssertTrue(cancelled, "취소 버튼을 누르면 그 창이 취소로 끝나야 함")
        }
        openTab(n)
        // 1) 확인 단계: 버튼만 있고 글을 넣을 칸이 없다(여기에 비밀번호를 칠 수 없게)
        XCTAssertTrue(el("secretRun").waitForExistence(timeout: 10), "확인 단계에는 실행 버튼")
        XCTAssertTrue(el("secretShow").exists && el("secretCancel").exists, "명령 보기·취소 버튼")
        XCTAssertFalse(el("secretInput").exists || el("composerInput").exists, "확인 단계에는 입력란이 없어야 함")
        shot("qq-confirm")
        // 2) 명령 보기: 맥 화면에 명령을 보여 줄 뿐, 여전히 확인 단계
        el("secretShow").tap()
        sleep(2)
        XCTAssertTrue(el("secretRun").exists && !el("secretInput").exists, "명령을 봐도 확인 단계 그대로")
        shot("qq-shown")
        // 3) 실행 → 가려진 칸이 나옴(비밀번호를 물을 때 넣는 곳). 비어 있으면 보낼 수 없다
        el("secretRun").tap()
        let field = el("secretInput")
        XCTAssertTrue(field.waitForExistence(timeout: 10), "실행하면 가려진 입력란")
        XCTAssertFalse(el("secretRun").exists, "실행 뒤에는 실행 버튼이 없어야 함")
        XCTAssertFalse(el("secretSend").isEnabled, "빈 채로는 보낼 수 없어야 함")
        sleep(2)   // 창이 미리 눌린 글자를 비우고 비밀번호를 묻기까지
        // 4) 비밀번호 넣기: 화면에는 가려져 보이고, 보내면 지워짐
        field.tap()
        field.typeText(pw)
        XCTAssertFalse((field.value as? String ?? "").contains("Tst"), "입력란에 글자가 그대로 보이면 안 됨")
        shot("qq-typed")
        el("secretSend").tap()
        // 5) 맥의 그 창이 받은 글이 정확히 그 글
        var got = ""
        for _ in 0..<20 {
            got = (try? String(contentsOfFile: "/tmp/ptest/secret-got")) ?? ""
            if !got.isEmpty { break }
            sleep(1)
        }
        XCTAssertEqual(got, pw, "가려서 보낸 글이 그 창에 그대로 전달돼야 함")
        // 6) 화면 어디에도, 쓰던 글 저장에도 남지 않음
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Tst-Pw'")).count, 0, "보낸 글이 화면에 보이면 안 됨")
        openTab(0)
        let input = el("composerInput")
        XCTAssertTrue(input.waitForExistence(timeout: 10), "다른 탭은 보통 입력란")
        XCTAssertFalse((input.value as? String ?? "").contains("Tst"), "쓰던 글 저장에 남으면 안 됨")
    }

    /// OO. 보내기 버튼을 길게 누르면 '백그라운드로 보내기(새 탭)': 고르면 브리지가 같은 폴더의 새 탭을 열고 안내
    func testOO_BackgroundSend() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/ptest/bg-ok"), "백그라운드 시험 준비 안 됨")
        relaunch(test: "")
        openTab(1)
        let input = el("composerInput")
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        clearPendingQuestion()
        input.tap()
        input.typeText("Reply with exactly: 6161")
        let sendBtn = el("sendButton")
        XCTAssertTrue(sendBtn.waitForExistence(timeout: 5))
        sendBtn.press(forDuration: 1.0)
        let item = app.buttons["백그라운드로 보내기(새 탭)"]
        XCTAssertTrue(item.waitForExistence(timeout: 5), "길게 누르면 '백그라운드로 보내기' 메뉴")
        shot("oo-menu")
        item.tap()
        let banner = el("noticeBanner")
        XCTAssertTrue(banner.waitForExistence(timeout: 10), "시작 안내가 떠야 함")
        XCTAssertTrue((banner.label + ((banner.value as? String) ?? "")).contains("백그라운드 탭") || app.staticTexts.containing(NSPredicate(format: "label CONTAINS '백그라운드 탭'")).count > 0, "안내 글: 백그라운드 탭 …에서 시작했어요")
        shot("oo-notice")
        XCTAssertEqual((input.value as? String)?.contains("6161"), false, "보낸 글은 입력창에서 지워져야 함")
    }

    /// NN. Claude Code 탭의 권한 모드 칩: 맥 모드(매번 묻기)가 보이고, 메뉴로 계획·자동을 고르면 맥 Claude Code 모드가 바뀜. /tmp/ptest/cc-setup.sh 로 준비
    func testNN_ClaudeModeChip() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/cctest-hooks.json"), "Claude Code 시험 준비 안 됨")
        relaunch(test: "")
        openTab(1)
        let chip = el("modeChip")
        XCTAssertTrue(chip.waitForExistence(timeout: 15), "Claude 탭에도 모드 칩")
        let manualP = expectation(for: NSPredicate(format: "value == 'manual'"), evaluatedWith: chip)
        XCTAssertEqual(XCTWaiter().wait(for: [manualP], timeout: 10), .completed, "맥 모드(매번 묻기)가 칩에 보여야 함")
        XCTAssertTrue(app.staticTexts["묻기"].exists)
        chip.tap()
        let accept = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '수정 허용'")).firstMatch
        XCTAssertTrue(accept.waitForExistence(timeout: 5), "Claude 메뉴에는 '수정 허용'도 있어야 함")
        shot("nn-menu")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH '계획'")).firstMatch.tap()
        let planP = expectation(for: NSPredicate(format: "value == 'plan'"), evaluatedWith: chip)
        XCTAssertEqual(XCTWaiter().wait(for: [planP], timeout: 15), .completed, "계획으로 바뀌어야 함")
        shot("nn-plan")
        chip.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH '매번 묻기'")).firstMatch.tap()
        let backP = expectation(for: NSPredicate(format: "value == 'manual'"), evaluatedWith: chip)
        XCTAssertEqual(XCTWaiter().wait(for: [backP], timeout: 15), .completed, "매번 묻기로 돌아와야 함")
    }

    /// MM. Claude Code 탭의 승인·질문 카드를 폰에서 답함(맥 Claude Code 창의 키를 대신 누름). /tmp/ptest/cc-setup.sh 로 준비
    func testMM_ClaudeCodeCards() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/cctest-hooks.json"), "Claude Code 시험 준비 안 됨")
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 15))
        // 승인 카드 → 허용
        send("Use the Write tool to create the file /tmp/cctest/mm.txt containing phone. Do nothing else.")
        let card = el("approvalCard")
        XCTAssertTrue(card.waitForExistence(timeout: 90), "Claude Code 승인 카드가 떠야 함")
        sleep(1)
        shot("mm-approval")
        el("approvalAllow").tap()
        XCTAssertTrue(waitGone(card, 10), "허용하면 카드가 사라져야 함")
        let made = expectation(for: NSPredicate { _, _ in FileManager.default.fileExists(atPath: "/tmp/cctest/mm.txt") }, evaluatedWith: nil)
        XCTAssertEqual(XCTWaiter().wait(for: [made], timeout: 30), .completed, "허용했으니 맥에 파일이 생겨야 함")
        _ = waitGone(el("stopButton"), 60)
        // 질문 카드 → 고르기
        send("Use the AskUserQuestion tool once with one question 'Pet?' (header Pet) with options Cat and Dog. Then reply with the answer only.")
        let q = el("questionCard")
        XCTAssertTrue(q.waitForExistence(timeout: 90), "Claude Code 질문 카드가 떠야 함")
        sleep(1)
        shot("mm-question")
        app.buttons.matching(NSPredicate(format: "label CONTAINS 'Dog'")).firstMatch.tap()
        XCTAssertTrue(waitGone(q, 10), "고르면 카드가 사라져야 함")
        let answer = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Dog'")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 60), "Claude Code 가 고른 답(Dog)을 받아야 함")
        _ = waitGone(el("stopButton"), 60)
        shot("mm-answered")
    }

    /// AA. 아티팩트: 답 안의 카드 → 전체 화면(웹페이지는 실제로 동작), 📎 목록 → 마크다운·PDF 보기.
    ///     맥 쪽 대화에 아티팩트 4개가 등록돼 있어야 함(/tmp/ptest/art-e2e.mjs)
    func testAA_Artifacts() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/arttest/report.html"), "시험 아티팩트 없음")
        relaunch(test: "")
        openTab(1)
        let card = app.buttons.matching(identifier: "artifactCard").firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 20), "답 안에 아티팩트 카드가 보여야 함")
        XCTAssertEqual(el("artifactsButton").value as? String, "4", "위쪽 📎 버튼에 4개")

        // 1) 웹페이지: 전체 화면에서 버튼이 실제로 동작
        app.buttons.matching(NSPredicate(format: "identifier == 'artifactCard' AND label CONTAINS '시험 보고서'")).firstMatch.tap()
        XCTAssertTrue(el("artifactViewer").waitForExistence(timeout: 10))
        let webButton = app.webViews.buttons["눌러 보기"]
        XCTAssertTrue(webButton.waitForExistence(timeout: 15), "웹페이지가 그려져야 함")
        webButton.tap()
        XCTAssertTrue(app.webViews.staticTexts["버튼이 동작해요"].waitForExistence(timeout: 5), "웹페이지의 스크립트가 동작해야 함")
        XCTAssertTrue(el("artifactShare").exists, "공유 버튼")
        shot("artifact-web")
        el("artifactClose").tap()
        _ = waitGone(el("artifactViewer"), 5)

        // 2) 목록 → 마크다운(최근 것 먼저: PDF, PNG, 마크다운, 웹)
        el("artifactsButton").tap()
        let rows = app.buttons.matching(identifier: "artifactRow")
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(rows.count, 4, "목록에 4개")
        shot("artifact-list")
        app.buttons.matching(NSPredicate(format: "identifier == 'artifactRow' AND label CONTAINS '회의 메모'")).firstMatch.tap()
        XCTAssertTrue(el("artifactViewer").waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["회의 메모"].waitForExistence(timeout: 10), "마크다운 제목이 글로 보여야 함")
        sleep(1)
        shot("artifact-md")
        el("artifactClose").tap()
        _ = waitGone(el("artifactViewer"), 5)

        // 3) PDF: iOS 미리보기
        el("artifactsButton").tap()
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 5))
        app.buttons.matching(NSPredicate(format: "identifier == 'artifactRow' AND label CONTAINS '매출 그래프 PDF'")).firstMatch.tap()
        XCTAssertTrue(el("artifactViewer").waitForExistence(timeout: 10))
        sleep(4)
        shot("artifact-pdf")
        XCTAssertFalse(el("artifactError").exists, "PDF 를 열 수 있어야 함")
        el("artifactClose").tap()
    }

    /// BB. 할 일 목록: 맥 pi 가 todo_write 로 만든 목록이 입력창 위 칸에 '할 일 0/3'으로, 누르면 펼침, 다 끝나면 사라짐.
    ///     맥 쪽에서 시켜야 함(/tmp/ptest/todo-trigger 가 있으면 대기)
    func testBB_TodoPanel() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/ptest/todo-trigger"), "맥 쪽 시험 신호 없음")
        relaunch(test: "")
        openTab(1)
        try? "ready".write(toFile: "/tmp/ptest/todo-ready", atomically: true, encoding: .utf8)
        let panel = el("todoPanel")
        XCTAssertTrue(panel.waitForExistence(timeout: 90), "할 일 칸이 떠야 함")
        XCTAssertTrue((panel.value as? String ?? "").hasSuffix("/3"), "할 일 3개")
        panel.tap()
        XCTAssertTrue(el("todoList").waitForExistence(timeout: 3), "누르면 목록이 펼쳐져야 함")
        sleep(1)
        shot("todo-panel")
        XCTAssertTrue(waitGone(panel, 120), "모두 끝나고 작업이 끝나면 칸이 사라져야 함")
    }

    /// CC. 되감기·메모리: 내 메시지를 길게 눌러 '여기서 다시 하기' → 그 글이 입력창으로, 대화는 직전으로.
    ///     … → 메모리: 지침 파일 목록과 편집 화면
    func testCC_RewindAndMemory() {
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        clearPendingQuestion()
        send("Reply with exactly: alpha")
        _ = el("stopButton").waitForExistence(timeout: 10)
        _ = waitGone(el("stopButton"), 60)
        let bubble = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'userBubble' AND label CONTAINS 'alpha'")).firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 10), "내 메시지가 보여야 함")
        bubble.press(forDuration: 1.0)
        let rewind = app.buttons["여기서 다시 하기"]
        XCTAssertTrue(rewind.waitForExistence(timeout: 5), "길게 누르면 '여기서 다시 하기'")
        shot("rewind-menu")
        rewind.tap()
        let input = el("composerInput")
        let filled = expectation(for: NSPredicate(format: "value CONTAINS 'Reply with exactly: alpha'"), evaluatedWith: input)
        XCTAssertEqual(XCTWaiter().wait(for: [filled], timeout: 10), .completed, "그 글이 입력창에 들어와야 함")
        XCTAssertTrue(waitGone(bubble, 10), "대화는 그 메시지 직전으로 돌아가야 함")
        // 입력창 비우기(다음 시험에 남지 않게)
        input.tap()
        if let v = input.value as? String, !v.isEmpty { input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: v.count)) }

        // 메모리
        el("moreMenu").tap()
        el("menuMemory").tap()
        XCTAssertTrue(el("memorySheet").waitForExistence(timeout: 5))
        let files = app.buttons.matching(identifier: "memoryFile")
        XCTAssertTrue(files.firstMatch.waitForExistence(timeout: 10), "지침 파일 목록")
        XCTAssertGreaterThanOrEqual(files.count, 2, "공통 지침 + 프로젝트")
        shot("memory-list")
        files.element(boundBy: 0).tap()
        XCTAssertTrue(el("memoryEditor").waitForExistence(timeout: 5), "편집 화면")
        sleep(1)
        shot("memory-editor")
    }

    /// DD. 계획 모드: '계획' 칩을 켜고 시키면 읽기만 하며 계획을 내놓고, '계획대로 진행할까요?' 카드에서 진행 → 계획 모드가 꺼지고 실행
    func testDD_PlanMode() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: "/tmp/ptest/plan-ok"), "계획 모드 확장을 띄운 시험 환경이 아님")
        relaunch(test: "")
        openTab(1)
        XCTAssertTrue(el("composerInput").waitForExistence(timeout: 10))
        clearPendingQuestion()
        let chip = el("modeChip")
        XCTAssertTrue(chip.waitForExistence(timeout: 5))
        if (chip.value as? String) != "plan" {
            chip.tap()
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH '계획'")).firstMatch.tap()
        }
        let onP = expectation(for: NSPredicate(format: "value == 'plan'"), evaluatedWith: chip)
        XCTAssertEqual(XCTWaiter().wait(for: [onP], timeout: 10), .completed, "모드 칩이 계획이어야 함")
        send("Make a plan to create the file /tmp/plantest/hello.txt containing the word hi. Investigate first with ls /tmp, then give the plan.")
        let card = el("questionCard")
        XCTAssertTrue(card.waitForExistence(timeout: 120), "'계획대로 진행할까요?' 카드가 떠야 함")
        XCTAssertFalse(FileManager.default.fileExists(atPath: "/tmp/plantest/hello.txt"), "계획 모드에서는 아직 파일을 만들지 않아야 함")
        sleep(1)
        shot("plan-card")
        el("questionOption-0").tap()   // 계획대로 진행
        let offP = expectation(for: NSPredicate(format: "value != 'plan'"), evaluatedWith: chip)
        XCTAssertEqual(XCTWaiter().wait(for: [offP], timeout: 15), .completed, "진행하면 계획 모드가 꺼져야 함")
        let end = Date().addingTimeInterval(120)
        while !FileManager.default.fileExists(atPath: "/tmp/plantest/hello.txt") && Date() < end { sleep(2) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: "/tmp/plantest/hello.txt"), "진행하면 계획대로 파일을 만들어야 함")
        _ = waitGone(el("stopButton"), 60)
    }

    /// EE. 입력창 아래 칩 줄: 권한 모드 칩 글자가 잘리지 않고, 메뉴로 매번 묻기 ↔ 자동을 바꿈
    func testEE_PlanChipLabel() {
        relaunch(test: "")
        openTab(1)
        let chip = el("modeChip")
        XCTAssertTrue(chip.waitForExistence(timeout: 15))
        XCTAssertGreaterThan(chip.frame.width, 50, "칩이 아이콘만 남을 만큼 줄어들지 않아야 함")
        chip.tap()
        let ask = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '매번 묻기'")).firstMatch
        XCTAssertTrue(ask.waitForExistence(timeout: 5), "모드 메뉴(자동·매번 묻기·계획)")
        shot("mode-menu")
        ask.tap()
        let askP = expectation(for: NSPredicate(format: "value == 'ask'"), evaluatedWith: chip)
        XCTAssertEqual(XCTWaiter().wait(for: [askP], timeout: 10), .completed, "매번 묻기로 바뀌어야 함")
        XCTAssertTrue(app.staticTexts["묻기"].exists, "칩 글자 '묻기'")
        shot("chip-row")
        chip.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH '자동'")).firstMatch.tap()
        let autoP = expectation(for: NSPredicate(format: "value == 'auto'"), evaluatedWith: chip)
        XCTAssertEqual(XCTWaiter().wait(for: [autoP], timeout: 10), .completed, "자동으로 돌아와야 함")
        // 모델 메뉴: 묶음 없이 바로 모델 목록(자동 계정 하나로)
        el("modelMenu").tap()
        XCTAssertTrue(app.buttons["Opus 5.5"].waitForExistence(timeout: 5) && app.buttons["Haiku 4.5"].exists, "모델이 바로 보여야 함")
        XCTAssertFalse(app.buttons["Anthropic 개인 계정"].exists || app.buttons["Claude 자동 계정"].exists, "계정 묶음은 없어야 함")
        shot("model-menu")
        menuItem("Haiku 4.5").tap()
    }

    /// FF. 작업 중에 보낸 대기 말풍선은 보낸 탭에만 보여야 한다(다른 탭으로 가면 없고, 돌아오면 다시 보임).
    ///     다른 탭에 가 있는 동안 처리된 뒤 돌아오면 대기 표시 없이 한 번만 보여야 한다.
    ///     Claude Code 탭은 받아 둔 대기열을 알려 주지 않아, 앱이 먼저 띄운 말풍선이 다른 탭에도 남던 문제(사용자 보고 11-13).
    ///     준비: 창1 pi Haiku, 창2 Claude Code Haiku(Bash 허용). 보낼 탭은 PI_REMOTE_QTAB(기본 2 = Claude Code)
    func testFF_QueuedBubbleStaysInItsTab() {
        relaunch(test: "")
        let from = Int(ProcessInfo.processInfo.environment["PI_REMOTE_QTAB"] ?? "2") ?? 2
        let other = from == 1 ? 2 : 1
        openTab(from)
        let input = el("composerInput")
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        // Claude Code 는 긴 sleep 을 스스로 백그라운드로 돌려 작업이 바로 끝나므로 ping 으로 60초를 끈다
        send(from == 2 ? "Use the Bash tool in the foreground (not background) to run exactly: ping -c 60 127.0.0.1 . Then reply with one word: finished."
             : "Run the bash command 'sleep 40; echo done' and then reply with one word: finished.")
        XCTAssertTrue(el("stopButton").waitForExistence(timeout: 20), "작업이 시작돼야 함")
        let started = Date()
        sleep(4)
        if el("sendModeMenu").waitForExistence(timeout: 3) {
            el("sendModeMenu").tap()
            app.buttons["끝나고 실행"].tap()
        }
        let note = "qnote \(Int(Date().timeIntervalSince1970) % 100000)"
        send(note)
        let mine = app.staticTexts.matching(NSPredicate(format: "label == %@", note)).firstMatch
        XCTAssertTrue(mine.waitForExistence(timeout: 4), "보낸 탭에 대기 말풍선이 보여야 함")
        shot("queued-\(from)")
        // 다른 채팅 탭으로
        openTab(other)
        XCTAssertTrue(el("chatScroll").waitForExistence(timeout: 10), "다른 탭도 채팅 화면이어야 함")
        sleep(2)
        shot("other-\(other)")
        XCTAssertFalse(mine.exists, "다른 탭에는 대기 말풍선이 없어야 함")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == '작업이 끝나면 실행돼요' OR label == '다음 단계에서 전달돼요'")).count, 0, "다른 탭에 대기 안내가 없어야 함")
        // 원래 탭으로 돌아오면 다시 보임(아직 대기 중이거나 이미 대화에 들어간 말풍선)
        openTab(from)
        XCTAssertTrue(mine.waitForExistence(timeout: 8), "원래 탭으로 돌아오면 보여야 함")
        shot("back-\(from)")
        // 다시 다른 탭에 가 있는 동안 원래 탭의 작업이 끝나고 보낸 글이 처리됨 → 돌아오면 대기 표시 없이 한 번만
        openTab(other)
        Thread.sleep(forTimeInterval: max(0, (from == 2 ? 85 : 65) - Date().timeIntervalSince(started)))
        XCTAssertFalse(mine.exists, "처리되는 동안에도 다른 탭에는 보이지 않아야 함")
        openTab(from)
        _ = waitGone(el("stopButton"), 60)
        sleep(3)   // 남은 대기 말풍선 정리(2초) 뒤에도 같은지
        shot("done-\(from)")
        let waiting = NSPredicate(format: "label == '작업이 끝나면 실행돼요' OR label == '다음 단계에서 전달돼요'")
        XCTAssertEqual(app.staticTexts.matching(waiting).count, 0, "처리된 뒤에는 대기 안내가 없어야 함")
        // Claude Code 는 작업 중에 받은 글을 사용자 메시지가 아니라 'queued_command' 로 기록한다. 연결부(claude-feed)가 이를 내 말풍선으로 옮김
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", note)).count, 1, "보낸 글은 한 번만 보여야 함(중복·사라짐 없음)")
        // 정리: 혹시 아직 돌고 있으면 중지
        if el("stopButton").exists { el("stopButton").tap() }
    }

    /// UU. 맥북 배터리(사용자 요청 11-16): 화면 위 '연결됨' 옆에 잔량이 보이고, 충전기를 꽂으면 번개·충전기 없이 20% 아래면 낮음(빨강),
    ///     배터리가 없는 맥이면 보이지 않는다.
    ///     맥 쪽: 시험 브리지가 /tmp/ptest/battery 의 글을 pmset 출력으로 1초마다 읽는다(test/app.sh). 이 시험이 그 글을 바꿔 가며 본다
    func testUU_MacBattery() throws {
        let path = "/tmp/ptest/battery"
        guard FileManager.default.fileExists(atPath: path) else { throw XCTSkip("배터리 시험 준비 안 됨") }
        let power = { (source: String, pct: Int, state: String) in
            try? "Now drawing from '\(source)'\n -InternalBattery-0 (id=1234567)\t\(pct)%; \(state); 1:00 remaining present: true\n"
                .write(toFile: path, atomically: true, encoding: .utf8)
        }
        let label = el("macBattery")
        let shows = { (want: String) -> Bool in
            for _ in 0..<50 {
                if label.exists && label.label == want { return true }
                usleep(300_000)
            }
            return false
        }
        let now = { label.exists ? label.label : "없음" }
        power("Battery Power", 94, "discharging")
        relaunch(test: "")
        XCTAssertTrue(shows("맥 배터리 94%"), "연결되면 '연결됨' 옆에 잔량(현재: \(now()))")
        shot("uu-battery")
        power("AC Power", 45, "charging")
        XCTAssertTrue(shows("맥 배터리 45%, 충전기 연결됨"), "충전기를 꽂으면 바뀜(현재: \(now()))")
        shot("uu-plugged")
        power("Battery Power", 18, "discharging")
        XCTAssertTrue(shows("맥 배터리 18%, 낮음"), "충전기 없이 20% 아래면 낮음(현재: \(now()))")
        shot("uu-low")
        try? "Now drawing from 'AC Power'\n".write(toFile: path, atomically: true, encoding: .utf8)
        XCTAssertTrue(waitGone(label, 15), "배터리가 없는 맥이면 보이지 않음")
        power("Battery Power", 94, "discharging")   // 뒤 시험을 위해 되돌림
    }

    /// 요소를 찍은 그림에서 가장 밝은 점과 가장 어두운 점의 밝기 차(0~255). 글자가 흐릴수록 작다(밝은 화면·어두운 화면 모두)
    private func contrast(_ e: XCUIElement) -> Int {
        guard let cg = e.screenshot().image.cgImage else { return -1 }
        let w = cg.width, h = cg.height
        var px = [UInt8](repeating: 0, count: w * h * 4)
        guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return -1 }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        var lo = 255, hi = 0
        for i in stride(from: 0, to: px.count, by: 4) {
            let v = (Int(px[i]) + Int(px[i + 1]) + Int(px[i + 2])) / 3
            lo = min(lo, v)
            hi = max(hi, v)
        }
        return hi - lo
    }

    /// VV. Claude Code 탭의 대화 글(가짜 Claude Code 의 대화 기록으로 봄, 11-17 사용자 보고 둘):
    ///     ① 도구를 부르기 전의 진행 설명(맥 화면이 '… · summary'로 보여 주는 글)이 단계 속에 접히지 않고 대화에 보인다.
    ///        마지막 답과 구분되게 조금 흐리게(사용자 결정)
    ///     ② 물결표 범위가 두 번 나와도 그 사이가 취소선으로 지워지지 않는다(지워지면 물결표가 사라져 글이 달라짐)
    ///     ③ 답변 복사에는 답의 글만(진행 설명은 빼고): 여기서는 누르기만 하고, 복사된 글은 test/app.sh 가 맥에서 읽어 확인
    func testVV_UpdatesAndTildes() throws {
        guard let text = try? String(contentsOfFile: "/tmp/ptest/bg-wins", encoding: .utf8) else { throw XCTSkip("가짜 Claude Code 탭 준비 안 됨") }
        let n = text.split(separator: " ").compactMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
        guard n.count == 4 else { throw XCTSkip("가짜 Claude Code 탭 준비가 이상함: \(text)") }
        relaunch(test: "")
        openTab(n[3])   // 가짜 Claude Code 가 도는 탭
        let says = { (part: String) in self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", part)).firstMatch }
        let seen = { self.app.staticTexts.allElementsBoundByIndex.map(\.label).filter { $0.count > 6 }.prefix(12).joined(separator: " | ") }
        let update = says("기준표(7~12개월)를 보고 주 80~120g 기록과 견줘 보겠습니다.")
        XCTAssertTrue(update.waitForExistence(timeout: 20), "도구 앞의 진행 설명이 대화 글로 보이고 물결표도 그대로여야 함(지금 보이는 글: \(seen()))")
        let answer = says("권장량은 하루 5~15분씩, 2~3회입니다.")
        XCTAssertTrue(answer.exists, "답의 물결표 범위도 그대로여야 함(지금 보이는 글: \(seen()))")
        XCTAssertLessThan(update.frame.minY, answer.frame.minY, "진행 설명은 쓴 순서대로 답보다 위에")
        XCTAssertTrue(el("toolGroup").exists, "도구 단계 줄은 그대로 있음")
        // 진행 설명은 답보다 조금 흐리게: 글자와 바탕의 밝기 차가 답 글보다 뚜렷이 작되, 읽을 수 있을 만큼은 남아야 한다
        XCTAssertTrue(el("progressNote").exists, "진행 설명은 답 글과 다른 항목으로 그려야 함")
        XCTAssertNotEqual(answer.identifier, "progressNote", "답 글은 진행 설명이 아님")
        let (cu, ca) = (contrast(update), contrast(answer))
        XCTAssertTrue(cu > 90 && cu < ca - 40, "진행 설명은 읽을 수 있되 답보다 흐려야 함(글자와 바탕의 밝기 차: 설명 \(cu), 답 \(ca))")
        shot("vv-updates")
        let copy = el("copyAnswer")
        XCTAssertTrue(copy.waitForExistence(timeout: 5), "끝난 답 아래에 복사 버튼")
        copy.tap()
        let done = expectation(for: NSPredicate(format: "label == '복사됨'"), evaluatedWith: copy)
        XCTAssertEqual(XCTWaiter().wait(for: [done], timeout: 3), .completed, "누르면 '복사됨'으로 바뀌어야 함")
        XCTAssertEqual(copiedText(), "권장량은 하루 5~15분씩, 2~3회입니다.", "답변 복사에는 답의 글만(도구 앞의 진행 설명은 빠짐)")
    }

    /// YY. 긴 것 접기(사용자 요청 11-18 '출력되는 메시지가 너무 길면 일부만 보여 주고 접힘·펼침'. 대화는 맥의 test/fake-feed.mjs 가 줌):
    ///     ① 화면 두 장을 넘는 답·내 메시지는 반 장만 보이고 '더 보기', '!' 명령 출력은 12줄쯤, 긴 코드 블록은 코드만 접힘
    ///        (짧은 글과 화면 한 장쯤인 답은 그대로)  ② 통째로 온 긴 답은 접힌 채 머리부터 보임  ③ 쓰는 중에 길어진 답은 접지 않고 '접기'만
    ///     ④ 펼쳐도 읽던 자리는 그대로, 끝의 '접기'를 누르면 접힌 것이 보이는 자리로  ⑤ 접힌 코드도 복사는 전체
    func testYY_FoldLongMessages() throws {
        guard let text = try? String(contentsOfFile: "/tmp/ptest/fold-win", encoding: .utf8),
              let win = Int(text.trimmingCharacters(in: .whitespacesAndNewlines)) else { throw XCTSkip("접기 시험 탭 준비 안 됨") }
        relaunch(test: "")
        openTab(win)
        let begins = { (part: String) in self.app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", part)).firstMatch }
        let more = app.buttons.matching(identifier: "foldMore")
        let less = app.buttons.matching(identifier: "foldLess")
        let chat = el("chatScroll")
        let half = app.windows.firstMatch.frame.height * 0.375   // 화면 반 장(대화가 보이는 높이는 화면의 4분의 3쯤)
        let place = { (e: XCUIElement) in "y \(Int(e.frame.minY))~\(Int(e.frame.maxY)), 대화 영역 \(Int(chat.frame.minY))~\(Int(chat.frame.maxY))" }

        // ① 처음: 긴 내 메시지·명령 출력·코드 블록·긴 답 넷만 접혀 있고, 맨 아래의 긴 답은 머리와 '더 보기'가 보인다
        let first = begins("긴 답의 첫 문단")
        XCTAssertTrue(first.waitForExistence(timeout: 20), "접기 시험 대화가 보여야 함")
        sleep(1)
        XCTAssertEqual(more.count, 4, "접힌 것은 넷이어야 함(긴 내 메시지·명령 출력·코드 블록·긴 답. 짧은 글과 화면 한 장쯤인 답은 그대로)")
        XCTAssertEqual(less.count, 0, "처음에는 펼친 것이 없음")
        let firstMore = try XCTUnwrap(toggle(below: first), "긴 답 아래에 '더 보기'")
        XCTAssertEqual(firstMore.identifier, "foldMore")
        XCTAssertEqual(firstMore.frame.minY - first.frame.minY, half, accuracy: 16, "접힌 답은 화면 반 장쯤만 보여야 함")
        XCTAssertGreaterThan(begins("긴 답의 마지막 문단").frame.minY, firstMore.frame.maxY, "접힌 답의 끝은 '더 보기' 아래로 잘려 있어야 함")
        XCTAssertTrue(inChat(first) && inChat(firstMore), "긴 답은 머리와 '더 보기'가 보이는 채로 와 있어야 함(첫 문단 \(place(first)), 더 보기 \(place(firstMore)))")
        shot("yy-folded")

        // ② 통째로 온 긴 답(Claude Code 탭에서 답이 오는 모양): 접힌 채로 와서 머리부터 보인다
        FileManager.default.createFile(atPath: "/tmp/ptest/fold-arrive", contents: nil)
        let second = begins("둘째 긴 답의 첫 문단")
        XCTAssertTrue(second.waitForExistence(timeout: 10), "새 긴 답이 와야 함")
        sleep(1)
        XCTAssertEqual(more.count, 5, "새로 온 긴 답도 접혀 있어야 함")
        let secondMore = try XCTUnwrap(toggle(below: second))
        XCTAssertTrue(inChat(second) && inChat(secondMore), "방금 온 긴 답은 머리와 '더 보기'가 보여야 함(첫 문단 \(place(second)), 더 보기 \(place(secondMore)))")
        shot("yy-arrived")

        // ③ 쓰는 중에 길어진 답: 접지 않고 끝까지 따라가며, 끝난 뒤에는 '접기'만 붙는다
        FileManager.default.createFile(atPath: "/tmp/ptest/fold-grow", contents: nil)
        let grownEnd = begins("자라는 답의 마지막 문단")
        XCTAssertTrue(grownEnd.waitForExistence(timeout: 20), "쓰는 중인 답이 끝까지 와야 함")
        sleep(1)
        XCTAssertEqual(more.count, 5, "쓰는 중에 길어진 답은 접히면 안 됨")
        XCTAssertEqual(less.count, 1, "길어진 답에는 '접기'가 붙어야 함")
        XCTAssertTrue(inChat(grownEnd), "쓰는 동안 맨 아래를 따라가 답의 끝이 보여야 함(\(place(grownEnd)))")
        shot("yy-grown")

        // ④ 펼치기·접기(둘째 긴 답): 펼쳐도 읽던 자리는 그대로, 끝의 '접기'를 누르면 접힌 답의 머리가 보이는 자리로
        XCTAssertTrue(bring(secondMore), "둘째 긴 답의 '더 보기'까지 올라갈 수 있어야 함")
        let before = second.frame.minY
        secondMore.tap()
        sleep(1)
        XCTAssertEqual(more.count, 4, "펼치면 '더 보기'가 하나 줄어야 함")
        XCTAssertEqual(second.frame.minY, before, accuracy: 2, "펼쳐도 읽던 자리(답의 머리)는 움직이지 않아야 함")
        let secondLess = try XCTUnwrap(toggle(below: begins("둘째 긴 답의 마지막 문단")), "펼친 답의 끝에 '접기'")
        XCTAssertEqual(secondLess.identifier, "foldLess")
        shot("yy-expanded")
        XCTAssertTrue(bring(secondLess), "'접기'까지 내려갈 수 있어야 함")
        secondLess.tap()
        sleep(1)
        XCTAssertEqual(more.count, 5, "접으면 다시 '더 보기'")
        XCTAssertEqual(second.frame.minY, chat.frame.minY, accuracy: 60, "접으면 접힌 답의 머리가 화면 위쪽에 와야 함(\(place(second)))")
        shot("yy-refolded")

        // ① 이어서, 긴 코드 블록: 코드만 접히고(답의 나머지 글은 그대로) ⑤ 접힌 채 복사해도 전체가 복사된다
        let code = begins("let line1 = 1")
        let lines = { code.label.components(separatedBy: "\n").count }
        let codeMore = try XCTUnwrap(toggle(below: code), "코드 블록 아래에 '더 보기'")
        XCTAssertEqual(codeMore.identifier, "foldMore")
        XCTAssertTrue(lines() < 120 && abs(CGFloat(lines()) * UIFont.monospacedSystemFont(ofSize: 14, weight: .regular).lineHeight - half) < 24,
                      "접힌 코드는 화면 반 장쯤의 줄만 보여야 함(지금 \(lines())줄)")
        let after = begins("코드 뒤의 글")
        XCTAssertTrue(after.frame.minY > codeMore.frame.maxY && after.frame.minY < codeMore.frame.maxY + 60, "코드만 접히고 답의 나머지 글은 바로 아래에 그대로")
        XCTAssertTrue(bring(codeMore), "코드 블록까지 올라갈 수 있어야 함")
        shot("yy-code")
        let copy = app.buttons.matching(identifier: "copyCode").firstMatch
        XCTAssertTrue(bring(copy), "접힌 코드 블록에도 복사 버튼")
        copy.tap()
        let copied = expectation(for: NSPredicate(format: "label == '복사됨'"), evaluatedWith: copy)
        XCTAssertEqual(XCTWaiter().wait(for: [copied], timeout: 3), .completed)
        let got = (copiedText() ?? "").components(separatedBy: "\n")
        XCTAssertTrue(got.count == 120 && got.first == "let line1 = 1" && got.last == "let line120 = 120", "접힌 코드도 복사는 전체여야 함(복사된 줄 \(got.count))")
        XCTAssertTrue(bring(codeMore))
        codeMore.tap()
        sleep(1)
        XCTAssertEqual(lines(), 120, "펼치면 코드 전체")
        let codeLess = try XCTUnwrap(toggle(below: code))
        XCTAssertEqual(codeLess.identifier, "foldLess")
        XCTAssertTrue(bring(codeLess), "코드 끝의 '접기'까지 내려갈 수 있어야 함")
        codeLess.tap()
        sleep(1)
        XCTAssertLessThan(lines(), 120, "접으면 다시 앞의 몇 줄만")
        XCTAssertTrue(inChat(copy), "코드를 접으면 코드 블록의 머리가 보이는 자리로(복사 버튼 \(place(copy)))")

        // ① 이어서, '!' 명령 출력: 12줄쯤만 보이고 '더 보기'로 나머지
        let output = begins("출력 1\n")
        let outMore = try XCTUnwrap(toggle(below: output), "명령 출력 아래에 '더 보기'")
        XCTAssertEqual(outMore.identifier, "foldMore")
        let twelve = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular).lineHeight * 12
        XCTAssertEqual(outMore.frame.minY - output.frame.minY, twelve, accuracy: 12, "접힌 명령 출력은 12줄쯤")
        XCTAssertTrue(bring(outMore), "명령 출력까지 올라갈 수 있어야 함")
        shot("yy-bash")
        outMore.tap()
        sleep(1)
        let outLess = try XCTUnwrap(toggle(below: output))
        XCTAssertEqual(outLess.identifier, "foldLess")
        XCTAssertGreaterThan(outLess.frame.minY - output.frame.minY, twelve * 3, "펼치면 40줄이 모두 보여야 함")

        // ① 이어서, 긴 내 메시지: 말풍선 안에서 반 장만
        let bubble = begins("붙여 넣은 글 1번째 줄")
        let bubbleMore = try XCTUnwrap(toggle(below: bubble), "긴 내 메시지 아래에 '더 보기'")
        XCTAssertEqual(bubbleMore.identifier, "foldMore")
        XCTAssertEqual(bubbleMore.frame.minY - bubble.frame.minY, half, accuracy: 16, "접힌 내 메시지는 화면 반 장쯤")
        XCTAssertTrue(bring(bubbleMore), "긴 내 메시지까지 올라갈 수 있어야 함")
        // 접힌 글의 가운데('더 보기'에서 접힌 높이의 절반 위)가 화면에 들어오게 한 뒤 그 자리를 누른다
        for _ in 0..<3 where bubbleMore.frame.minY - half / 2 < chat.frame.minY + 20 { chat.swipeDown(velocity: .slow) }
        let inside = bubbleMore.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0)).withOffset(CGVector(dx: 0, dy: -half / 2))
        shot("yy-bubble")
        // 접힌 글을 눌러서는 펼쳐지지 않는다(키보드를 내리려고 대화를 누르다 긴 글이 펼쳐지면 안 됨)
        let foldedNow = more.count
        inside.tap()
        sleep(1)
        XCTAssertEqual(more.count, foldedNow, "접힌 글을 눌러도 펼쳐지지 않아야 함('더 보기'로만 펼침)")
        // 접힌 말풍선도 길게 누르면 메뉴가 뜨고, 복사는 전체
        inside.press(forDuration: 1.0)
        XCTAssertTrue(app.buttons["복사"].waitForExistence(timeout: 5), "접힌 말풍선도 길게 누르면 메뉴")
        XCTAssertTrue(app.buttons["여기서 다시 하기"].exists)
        app.buttons["복사"].tap()
        let pasted = (copiedText() ?? "").components(separatedBy: "\n")
        XCTAssertTrue(pasted.count == 80 && pasted.last == "붙여 넣은 글 80번째 줄", "접힌 말풍선의 복사도 전체여야 함(복사된 줄 \(pasted.count))")
        XCTAssertTrue(bring(bubbleMore))
        bubbleMore.tap()
        sleep(1)
        let bubbleLess = try XCTUnwrap(toggle(below: bubble))
        XCTAssertEqual(bubbleLess.identifier, "foldLess")
        XCTAssertGreaterThan(bubbleLess.frame.minY - bubble.frame.minY, half * 4, "펼치면 80줄이 모두 보여야 함")

        // 짧은 글은 그대로: 접히지 않고, 짧은 말풍선의 길게 누르기 메뉴도 전과 같다
        XCTAssertTrue(begins("짧은 답입니다").exists && begins("중간 답의 마지막 문단").exists, "짧은 답과 화면 한 장쯤인 답은 그대로 있음")
        let short = begins("짧은 질문입니다")
        XCTAssertTrue(bring(short), "맨 위의 짧은 내 메시지까지 올라갈 수 있어야 함")
        short.press(forDuration: 1.0)
        XCTAssertTrue(app.buttons["복사"].waitForExistence(timeout: 5), "짧은 말풍선을 길게 누르면 메뉴")
        app.buttons["복사"].tap()
        XCTAssertEqual(copiedText(), "짧은 질문입니다")
    }

    /// 그 요소 아래에서 가장 가까운 '더 보기'·'접기' 버튼
    private func toggle(below e: XCUIElement) -> XCUIElement? {
        let y = e.frame.minY
        let all = ["foldMore", "foldLess"].flatMap { app.buttons.matching(identifier: $0).allElementsBoundByIndex }
        return all.filter { $0.frame.minY > y }.min { $0.frame.minY < $1.frame.minY }
    }

    /// 대화를 넘겨 그 요소가 눌리는 자리에 오게 한다(멀면 빠르게, 가까우면 천천히)
    private func bring(_ e: XCUIElement, tries: Int = 40) -> Bool {
        let chat = el("chatScroll")
        for _ in 0..<tries {
            guard e.exists else { return false }
            if e.isHittable { return true }
            let f = chat.frame
            let far = abs(e.frame.midY - f.midY) > f.height
            if e.frame.midY < f.midY { chat.swipeDown(velocity: far ? .fast : .slow) } else { chat.swipeUp(velocity: far ? .fast : .slow) }
        }
        return e.isHittable
    }

    /// 그 요소가 대화 영역 안에 통째로 보이는 자리인지
    private func inChat(_ e: XCUIElement) -> Bool {
        let f = el("chatScroll").frame
        return e.exists && e.frame.minY >= f.minY - 1 && e.frame.maxY <= f.maxY + 1
    }

    /// 시뮬레이터에 복사된 글. 맥의 test/app.sh 가 떠 준다(/tmp/ptest/pb-ask 를 만들면 /tmp/ptest/pb-out 에 적어 줌). 못 받으면 nil
    private func copiedText() -> String? {
        let (ask, out) = ("/tmp/ptest/pb-ask", "/tmp/ptest/pb-out")
        try? FileManager.default.removeItem(atPath: out)
        FileManager.default.createFile(atPath: ask, contents: nil)
        for _ in 0..<50 {
            if let t = try? String(contentsOfFile: out, encoding: .utf8) { return t.trimmingCharacters(in: .newlines) }
            usleep(100_000)
        }
        return nil
    }

    /// XX. Claude Code 탭의 컨텍스트 사용량(11-17 사용자 보고 '앱에서 현재 컨텍스트 확인이 안 보인다': 고리가 pi 탭에서만 보였음).
    ///     가짜 Claude Code 의 대화 기록으로 본다(마지막 응답의 입력 토큰 152,000, Opus 5.5 의 기억 용량 1M):
    ///     ① 위쪽 고리에 15%  ② 누르면 사용 중 152K / 1M 토큰, 자동 압축은 97%(967K)에서, 설명 글은 pi 가 아니라 Claude Code
    ///     ③ 셸만 있는 탭으로 가면 고리가 사라짐  ④ '지금 압축하기'를 누르면 창이 닫힘(맥에 /compact 가 갔는지는 test/app.sh 가 확인)
    ///     ⑤ 맥이 압축하는 동안 '대화를 압축하는 중'이 보이고, 끝나면 요약 줄이 생기고 고리는 '–'(가짜가 /compact 를 받아 진짜처럼 압축함)
    func testXX_ClaudeContext() throws {
        guard let text = try? String(contentsOfFile: "/tmp/ptest/bg-wins", encoding: .utf8) else { throw XCTSkip("가짜 Claude Code 탭 준비 안 됨") }
        let n = text.split(separator: " ").compactMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
        guard n.count == 4 else { throw XCTSkip("가짜 Claude Code 탭 준비가 이상함: \(text)") }
        relaunch(test: "")
        openTab(n[3])   // 가짜 Claude Code 가 도는 탭
        let says = { (part: String) in self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", part)).firstMatch }
        let gauge = el("contextGauge")
        XCTAssertTrue(gauge.waitForExistence(timeout: 20), "Claude Code 탭에서도 위쪽에 컨텍스트 고리가 보여야 함")
        XCTAssertEqual(gauge.label, "컨텍스트 15%", "사용률 = 사용 중 152K / 기억 용량 1M")
        shot("xx-claude-gauge")
        gauge.tap()
        XCTAssertTrue(el("contextSheet").waitForExistence(timeout: 5), "고리를 누르면 컨텍스트 창이 떠야 함")
        XCTAssertTrue(says("152K / 1M 토큰").waitForExistence(timeout: 5), "사용 중 토큰과 기억 용량이 보여야 함")
        XCTAssertTrue(says("97%(967K)에서 시작").exists, "자동 압축 지점이 보여야 함")
        XCTAssertTrue(says("Claude Code가 앞부분을 요약해").exists, "설명은 이 탭의 도구 이름으로")
        XCTAssertFalse(says("pi가 앞부분을 요약해").exists, "Claude Code 탭인데 pi 라고 하면 안 됨")
        shot("xx-claude-context")
        el("contextClose").tap()
        XCTAssertTrue(waitGone(el("contextSheet"), 5), "닫기를 누르면 창이 닫혀야 함")

        // 셸만 있는 탭(창 0)에는 고리가 없고, 돌아오면 다시 보인다
        openTab(0)
        XCTAssertTrue(waitGone(el("contextGauge"), 10), "Claude Code·pi 가 없는 탭에서는 고리가 사라져야 함")
        openTab(n[3])
        XCTAssertTrue(gauge.waitForExistence(timeout: 20), "Claude Code 탭으로 돌아오면 고리가 다시 보여야 함")
        XCTAssertEqual(gauge.label, "컨텍스트 15%")

        // 쉬는 중이면 '지금 압축하기'가 켜져 있고, 누르면 창이 닫힌다
        gauge.tap()
        let compact = el("compactNow")
        XCTAssertTrue(compact.waitForExistence(timeout: 5) && compact.isEnabled, "쉬는 중엔 '지금 압축하기'가 켜져 있어야 함")
        compact.tap()
        XCTAssertTrue(waitGone(el("contextSheet"), 5), "'지금 압축하기'를 누르면 창이 닫혀야 함")

        // ⑤ 맥의 Claude Code 가 압축하는 동안(가짜는 8초) 대화 아래에 '대화를 압축하는 중'이 보이고, 끝나면 사라지며
        //    요약 줄이 생기고 고리는 다음 답까지 '–'(사용자 요청 11-17 '컨텍스트가 압축 중일 때 앱에서도 확인이 되어야 됩니다')
        let status = el("statusRow")
        let compactingNow = expectation(for: NSPredicate(format: "label CONTAINS '압축하는 중'"), evaluatedWith: status)
        XCTAssertEqual(XCTWaiter().wait(for: [compactingNow], timeout: 10), .completed, "맥이 압축하는 동안 '대화를 압축하는 중'이 보여야 함")
        shot("xx-claude-compacting")
        XCTAssertTrue(waitGone(status, 20), "압축이 끝나면 '대화를 압축하는 중'이 사라져야 함")
        let summary = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS '이전 대화를 요약했어요'")).firstMatch
        XCTAssertTrue(summary.waitForExistence(timeout: 10), "압축 뒤 요약 줄이 보여야 함")
        let unknown = expectation(for: NSPredicate(format: "label == '컨텍스트 –'"), evaluatedWith: gauge)
        XCTAssertEqual(XCTWaiter().wait(for: [unknown], timeout: 10), .completed, "압축 뒤에는 다음 답까지 사용률을 모름(현재 \(gauge.label))")
        shot("xx-claude-compacted")
    }

    /// WW. 단축어 동작 '맥의 AI 에게 일 시키기'(사용자 요청 11-17: 폰의 사건으로 AI 에게 일 시키기).
    ///     동작을 실행하면 맥이 그 폴더에서 새 백그라운드 탭을 열고, 서랍의 '백그라운드' 칸에 '단축어로 시킴'으로 보인다.
    ///     단축어 앱을 거치지 않고, 앱이 뜨면서 그 동작을 그대로 한 번 실행한다(PI_REMOTE_TEST_TASK. 매개변수·맥에 보내기·답 받기).
    ///     맥 쪽: 시험 브리지는 새 탭에서 진짜 도구 대신 바로 끝나는 명령을 켠다. 탭이 그 폴더에서 하나만 열렸는지는 test/app.sh 가 확인
    func testWW_ShortcutTask() throws {
        guard FileManager.default.fileExists(atPath: "/tmp/ptest/shortcut-ok") else { throw XCTSkip("단축어 시험 준비 안 됨") }
        app.terminate()
        app.launchEnvironment["PI_REMOTE_TEST"] = ""
        app.launchEnvironment["PI_REMOTE_TEST_TASK"] = "단축어 시험: 폴더 살펴보기"
        app.launchEnvironment["PI_REMOTE_TEST_TASK_FOLDER"] = "/tmp/ptest"
        app.launch()
        openDrawer()
        // 맥이 연 탭은 서랍의 백그라운드 칸에: 이름은 앞의 bg 를 뗀 할 일, 그 아래 시킨 쪽
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "단축어 시험")).firstMatch
        let seen = { self.app.buttons.allElementsBoundByIndex.map(\.label).filter { $0.count > 3 }.prefix(14).joined(separator: " | ") }
        XCTAssertTrue(row.waitForExistence(timeout: 25), "단축어 동작이 시킨 일이 서랍에 새 탭으로 보여야 함(지금 보이는 줄: \(seen()))")
        XCTAssertTrue(row.label.contains("단축어로 시킴"), "시킨 쪽이 '단축어로 시킴'으로 보여야 함(현재: \(row.label))")
        XCTAssertFalse(row.label.contains("bg 단축어"), "이름은 앞의 bg 를 뗀 할 일(현재: \(row.label))")
        XCTAssertGreaterThan(row.frame.minY, el("drawerBgTitle").frame.minY, "백그라운드 칸 아래에 있어야 함")
        // 백그라운드 칸의 맨 아래 줄이라 화면 밖일 수 있다: 사진에 보이게 목록을 천천히 끌어 올림(빠르게 쓸면 다른 줄이 눌림)
        if !row.isHittable {
            let from = el("drawerBgTitle").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            from.press(forDuration: 0.1, thenDragTo: from.withOffset(CGVector(dx: 0, dy: -260)))
        }
        XCTAssertTrue(el("drawer").exists && row.isHittable, "목록을 올리면 그 줄이 화면에 보여야 함(서랍은 열린 채)")
        shot("ww-shortcut")
    }

    /// TT. 사진 보관함에서 두 장을 고르면 입력창에 두 칸이 뜨고, 그림이 채워진 뒤 맥에 올라가야 한다
    ///     (사용자 보고 11-15 '사진을 고른 뒤 썸네일이 뜨기까지 시간이 걸림'). 걸린 시간은 시험 기록에 '[TT]' 로 남김
    func testTT_PhotoPicker() {
        let plus = el("plusMenu")
        XCTAssertTrue(plus.waitForExistence(timeout: 20), "+ 단추가 보여야 함")
        plus.tap()
        let library = app.buttons["사진 보관함"]
        XCTAssertTrue(library.waitForExistence(timeout: 5), "+ 메뉴에 사진 보관함이 있어야 함")
        library.tap()
        // 시스템 사진 고르기 창(다른 프로세스지만 앱 화면 트리로 보임)
        let photos = app.images.matching(NSPredicate(format: "label BEGINSWITH '사진'"))
        guard photos.firstMatch.waitForExistence(timeout: 15) else {
            print("[TT] 고르기 창 화면 트리:\n\(app.debugDescription)")
            XCTFail("사진 고르기 창에 사진이 보여야 함")
            return
        }
        photos.element(boundBy: 0).tap()
        photos.element(boundBy: 1).tap()
        let add = app.buttons.matching(identifier: "Add").firstMatch   // 이름 '추가'는 앱의 + 단추와 겹침
        XCTAssertTrue(add.waitForExistence(timeout: 5), "고르기 창에 추가 단추가 있어야 함")
        add.tap()
        let t0 = Date()
        let thumbs = app.descendants(matching: .any).matching(identifier: "attachmentThumb")
        func seconds(until ok: () -> Bool, _ timeout: TimeInterval) -> TimeInterval? {
            while Date().timeIntervalSince(t0) < timeout {
                if ok() { return Date().timeIntervalSince(t0) }
                usleep(50_000)
            }
            return nil
        }
        let chips = seconds(until: { thumbs.count >= 2 }, 10)
        let images = seconds(until: { thumbs.count >= 2 && thumbs.allElementsBoundByIndex.allSatisfy { $0.label != "사진 받는 중" } }, 15)
        let ready = seconds(until: { thumbs.allElementsBoundByIndex.filter { ($0.value as? String) == "ready" }.count >= 2 }, 30)
        print(String(format: "[TT] 추가를 누른 뒤: 칸 두 개 %.2f초 · 그림 %.2f초 · 맥에 저장 %.2f초", chips ?? -1, images ?? -1, ready ?? -1))
        XCTAssertNotNil(chips, "고른 사진 두 장의 칸이 입력창에 떠야 함")
        XCTAssertNotNil(images, "칸에 그림이 채워져야 함")
        XCTAssertNotNil(ready, "두 장 모두 맥에 올라가야 함(현재: \(thumbs.allElementsBoundByIndex.map { $0.value as? String ?? "-" }))")
        while el("attachmentRemove").exists { el("attachmentRemove").tap() }   // 정리: 붙인 사진 빼기
    }
}
