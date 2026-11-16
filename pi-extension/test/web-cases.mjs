// 웹 도구 판정 시험: sh test/run.sh (WEB_PATH 에 확장 사본). 네트워크 없이 글 바꾸기·검색 결과 읽기만
import { readFileSync } from "node:fs";
const m = await import(process.env.WEB_PATH);
let fail = 0;
const ok = (c, n) => { console.log(`${c ? "통과" : "실패"}: ${n}`); if (!c) fail++; };

// 1. 검색 결과 읽기(DuckDuckGo 결과 페이지의 구조를 본떠 만든 자료: 결과 10개 + 광고 1개, 우회 주소 결과 1개)
const html = readFileSync(new URL("./fixtures/ddg-tmux.html", import.meta.url), "utf8");
const rs = m.parseDdg(html);
ok(rs.length === 10 && rs[0].url.startsWith("https://github.com/") && rs[0].title.length > 3 && rs[0].snippet.length > 10, `검색 결과 10개(제목·주소·요약, 광고는 뺌): ${rs[0]?.title}`);
ok(rs.every((r) => /^https?:\/\//.test(r.url)), "모든 주소가 http(s)");
ok(rs[2]?.url === "https://blog.example.com/posts/tmux-focus?ref=search" && rs[2]?.title.includes("doesn't"), "결과 속의 우회 주소·엔티티를 풂");
ok(rs[0].snippet.includes("tmux focus events") && !rs[0].snippet.includes("<b>") && rs[0].snippet.includes("&"), "요약의 강조 표시는 걷어 내고 글만");
ok(m.decodeDdgUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&rut=x") === "https://example.com/a?b=1", "우회 주소 풀기");
ok(m.parseDdg('<a class="result__a" href="https://duckduckgo.com/y.js?ad_provider=x">광고</a>').length === 0, "광고 주소는 뺌");
ok(m.parseDdg("<html>없음</html>").length === 0, "결과 없는 페이지");

// 2. HTML → 글
const page = `<html><head><title>시험 &amp; 페이지</title><style>.x{}</style><script>alert(1)</script></head><body>
<nav><a href="/menu">메뉴</a></nav>
<main><h1>제목 하나</h1><p>첫 문단 <b>굵게</b> &lt;코드&gt; &#44032;&#xAC01;</p>
<ul><li>하나</li><li>둘 <a href="/doc?a=1&amp;b=2">문서</a></li></ul>
<pre><code>const a = 1;
  if (a) { x(); }</code></pre>
<table><tr><th>이름</th><th>값</th></tr><tr><td>가</td><td>1</td></tr></table>
<p>${"긴 본문 ".repeat(40)}</p></main><footer>꼬리</footer></body></html>`;
const t = m.htmlToText(page, "https://ex.com/a/b");
ok(t.title === "시험 & 페이지", "제목(엔티티 풀기)");
ok(!/alert|\.x\{\}|메뉴|꼬리/.test(t.text), "스크립트·스타일·메뉴·꼬리 뺌(본문만)");
ok(t.text.includes("# 제목 하나") && t.text.includes("- 하나") && t.text.includes("<코드> 가각"), "제목·목록·엔티티");
ok(t.text.includes("[문서](https://ex.com/doc?a=1&b=2)"), "상대 링크 → 절대 주소");
ok(t.text.includes("```\nconst a = 1;\n  if (a) { x(); }\n```"), "코드 블록 모양 그대로");
ok(/이름 \| 값 \|/.test(t.text) && /가 \| 1 \|/.test(t.text), "표 모양");
const noMain = m.htmlToText("<body><header>머리</header><div>본문만 있음</div></body>");
ok(noMain.text === "본문만 있음", "본문 태그가 없으면 머리·꼬리만 빼고 전체");
ok(m.decodeEntities("&#x1F600;&bogus;&nbsp;") === "😀&bogus; ", "숫자·모르는 엔티티");

// 3. 도구 등록·입력 검사(네트워크 없이)
const tools = {};
m.default({ registerTool: (x) => (tools[x.name] = x) });
ok(tools.web_search && tools.web_fetch, "도구 두 개 등록");
ok((await tools.web_search.execute("1", { query: "  " })).content[0].text.includes("비어"), "빈 검색어 안내");
ok((await tools.web_fetch.execute("2", { url: "file:///etc/hosts" })).details.error === "bad-url", "http(s) 아닌 주소 거절");
ok((await tools.web_fetch.execute("3", { url: "not a url" })).details.error === "bad-url", "주소 아님 거절");
console.log(fail ? `실패 ${fail}개` : "모두 통과");
process.exit(fail ? 1 : 0);
