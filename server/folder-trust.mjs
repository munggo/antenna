// 새로 켠 Claude Code 가 '이 폴더를 믿나요(Yes, I trust this folder)' 창에서 멈추지 않게 '예'를 누른다
// (사용자 결정 11-20 '새로 띄우는 곳은 자동으로 yes'). 연결부가 연 탭(앱의 새 탭·단축어·백그라운드로 보내기)에서만,
// 켠 뒤 잠시 그 탭 화면만 본다. 창은 '아니요'가 먼저라 아래로 옮기고, 커서가 '예'에 온 것을 확인한 뒤에만 Enter.
// 신뢰 기록(~/.claude.json)을 직접 고치지 않는 까닭: 켜져 있는 Claude Code 들이 그 파일을 수시로 다시 써서 서로 덮어쓸 수 있다.
// 상위 폴더를 믿어도 그 안의 다른 git 저장소 폴더에는 이어지지 않는다(11-20: 프로젝트 홈 폴더를 믿는데 그 안의 다른 저장소에서 창이 뜸)
const DIALOG = /Yes, I trust this folder/;
const ON_YES = /❯\s*(?:\d+\.\s*)?Yes, I trust this folder/;

/**
 * capture(): 그 탭 화면 글(탭이 없으면 null), press(키): tmux 키 이름으로 누름.
 * 돌려주는 값: 'accepted'(예를 누름) · 'none'(창이 안 뜸) · 'closed'(탭이 닫힘) · 'unsure'(커서를 예로 못 옮겨 누르지 않음)
 */
export async function acceptFolderTrust({ capture, press, ms = 30_000, step = 500, sleep = (t) => new Promise((r) => setTimeout(r, t)) }) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = capture();
    if (s === null) return "closed";
    if (DIALOG.test(s)) {
      for (let i = 0; i < 3 && !ON_YES.test(capture() ?? ""); i++) {
        press("Down");
        await sleep(300);
      }
      if (!ON_YES.test(capture() ?? "")) return "unsure";
      press("Enter");
      return "accepted";
    }
    await sleep(step);
  }
  return "none";
}
