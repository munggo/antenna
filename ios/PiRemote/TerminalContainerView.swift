import SwiftUI
import SwiftTerm
import UIKit

/// SwiftTerm의 TerminalView(UIKit)를 SwiftUI에 끼워 넣는 래퍼.
/// 세로 드래그를 tmux/pi 스크롤(휠 이벤트)로 변환하는 제스처를 단다.
struct TerminalContainerView: UIViewRepresentable {
    let session: TerminalSession
    /// 채팅을 보는 동안엔 숨겨서 그리기를 멈춘다(내용은 계속 받아 두므로 전환하면 바로 최신 상태)
    var hidden: Bool = false
    /// 맥에 붙어 있는지. 붙기 전의 빈 터미널에서는 커서를 깜빡이지 않는다(보여 줄 것이 없는데 끝없이 도는 애니메이션)
    var connected: Bool = true

    func makeCoordinator() -> Coordinator { Coordinator(session: session) }

    func makeUIView(context: Context) -> TerminalView {
        let tv = session.terminalView
        let pan = UIPanGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handlePan(_:))
        )
        pan.delegate = context.coordinator
        tv.addGestureRecognizer(pan)

        // 터미널 영역 탭 → 키보드 내리기(출력 더 보기). 입력바 탭하면 다시 올라옴.
        let tap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap)
        )
        tap.delegate = context.coordinator
        tv.addGestureRecognizer(tap)
        return tv
    }

    func updateUIView(_ uiView: TerminalView, context: Context) {
        if uiView.isHidden != hidden {
            uiView.isHidden = hidden
            if !hidden { uiView.setNeedsDisplay() }
        }
        // 숨어 있거나 아직 맥에 붙지 않은 동안에는 커서 깜빡임(끝없는 애니메이션)을 멈춤
        (uiView as? OutputOnlyTerminalView)?.cursorBlinks = !hidden && connected
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        let session: TerminalSession
        private var lastY: CGFloat = 0
        private var coasting = false
        init(session: TerminalSession) { self.session = session }

        @objc func handlePan(_ g: UIPanGestureRecognizer) {
            switch g.state {
            case .began:
                lastY = g.translation(in: g.view).y
                coasting = false   // 이전 관성 중단
            case .changed:
                let y = g.translation(in: g.view).y
                let dy = y - lastY
                let step: CGFloat = 5 // 초춘히 → 더 부드럽게
                if abs(dy) >= step {
                    let lines = Int(dy / step)
                    // 손가락을 아래로 끌면(dy>0) 과거 보기(위로 스크롤)
                    session.scrollLines(up: dy > 0, count: min(abs(lines), 5))
                    lastY += CGFloat(lines) * step
                }
            case .ended, .cancelled:
                startCoast(velocity: g.velocity(in: g.view).y)
            default:
                break
            }
        }

        /// 손 뗄 뒤 속도로 감속하며 추가 스크롤(관성).
        private func startCoast(velocity: CGFloat) {
            coasting = true
            var v = velocity
            func tick() {
                guard self.coasting, abs(v) > 50 else { self.coasting = false; return }
                let lines = max(1, min(Int(abs(v) / 650), 4))
                self.session.scrollLines(up: v > 0, count: lines)
                v *= 0.90   // 감속(더 길게 미끄러짐)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.016) { tick() }
            }
            tick()
        }

        @objc func handleTap() {
            // SwiftUI 포커스 상태를 꺼서 키보드를 내린다(다시 안 올라오게).
            DispatchQueue.main.async { self.session.inputFocused = false }
        }

        // SwiftTerm 내장 제스처와 동시 인식 허용
        func gestureRecognizer(
            _ g: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
        ) -> Bool { true }
    }
}
