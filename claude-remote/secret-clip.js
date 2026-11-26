// 폰에서 받은 비밀번호를 맥 클립보드에 잠깐 넣고 지우는 도우미(osascript -l JavaScript secret-clip.js <동작>).
// - set: 표준 입력의 글을 넣는다. 이 맥에서만(아이폰·아이패드로 넘어가지 않음), 숨김·잠깐 표시를 붙여 클립보드 기록 앱이 남기지 않게,
//        우리 표시(app.antenna.secret)도 붙여 나중에 지울 때 사용자가 따로 복사한 것을 건드리지 않게 한다
// - clear: 지금 클립보드가 우리가 넣은 것일 때만 비운다(그 사이 사용자가 다른 것을 복사했으면 그대로)
// - check: 시험용. 값은 내지 않고 우리 표시·숨김 표시가 있는지와 글자 수만 낸다
// 값은 화면·명령 줄 인자·파일에 남기지 않는다(표준 입력으로만 받음)
// 작성: 서문교
ObjC.import("AppKit");

const MARK = "app.antenna.secret";
const HIDE = ["org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType"];

function run(argv) {
  const pb = $.NSPasteboard.generalPasteboard;
  const types = () => ObjC.deepUnwrap(pb.types) || [];
  switch (argv[0]) {
    case "set": {
      const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
      const s = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
      // 글자 수는 숫자가 아니라 글("0")로 와서 Number 로 바꿔 본다
      if (!s || s.isNil() || Number(s.length) === 0) return "empty";
      pb.prepareForNewContentsWithOptions($.NSPasteboardContentsCurrentHostOnly);
      pb.setStringForType(s, $.NSPasteboardTypeString);
      for (const t of [...HIDE, MARK]) pb.setStringForType($(""), t);
      return types().includes(MARK) ? "set" : "failed";
    }
    case "clear": {
      if (!types().includes(MARK)) return "kept";
      pb.clearContents;
      return "cleared";
    }
    case "check": {
      const t = types();
      const s = pb.stringForType($.NSPasteboardTypeString);
      return JSON.stringify({ ours: t.includes(MARK), hidden: HIDE.every((h) => t.includes(h)), length: s && !s.isNil() ? Number(s.length) : 0 });
    }
    default:
      return "usage: set | clear | check";
  }
}
