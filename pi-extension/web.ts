/**
 * 웹 검색·웹 페이지 가져오기(Claude Code 의 WebSearch·WebFetch 처럼)
 *
 * - web_search: DuckDuckGo HTML 판으로 검색(키·요금 없음) → 제목·주소·요약
 * - web_fetch: 주소의 내용을 읽기 쉬운 글로(HTML 은 본문 위주로 제목·목록·링크·표 모양 살림, JSON 은 정리, 길면 끊어 읽기).
 *   글이 아닌 파일(PDF 등)은 임시 폴더에 받아 경로를 알려 줌
 * - 수집 규칙(공통 지침): 브라우저와 같은 헤더, 같은 사이트에 이어 요청하면 1초 이상 간격
 * 작성: 서문교
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Safari/605.1.15";
const HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};
const PAGE_CHARS = 20_000;
const MAX_BYTES = 10 * 1024 * 1024;

// ───────── 글 바꾸기(시험에서도 씀) ─────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", copy: "©", reg: "®", trade: "™", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const inline = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** HTML → 읽기 쉬운 글(마크다운 비슷하게). base: 상대 링크를 절대 주소로 */
export function htmlToText(html: string, base = ""): { title: string; text: string } {
  const title = inline((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? "");
  let h = html.replace(/<!--[\s\S]*?-->/g, "");
  h = h.replace(/<(script|style|noscript|svg|template|iframe|canvas|head)\b[\s\S]*?<\/\1>/gi, "");
  // 본문이 있으면 본문만(머리·꼬리·메뉴 빼기)
  const main = h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ?? h.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (main && inline(main[1]).length > 200) h = main[1];
  else h = h.replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, "");
  const abs = (u: string) => {
    try {
      return base ? new URL(decodeEntities(u), base).href : decodeEntities(u);
    } catch {
      return decodeEntities(u);
    }
  };
  // 코드 블록은 모양 그대로
  const blocks: string[] = [];
  h = h.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, c: string) => {
    blocks.push(decodeEntities(c.replace(/<[^>]+>/g, "")));
    return `\n\u0000${blocks.length - 1}\u0000\n`;
  });
  h = h
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${inline(t)}\n\n`)
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, u: string, t: string) => {
      const label = inline(t);
      if (!label) return "";
      return /^(#|javascript:|mailto:)/i.test(u) ? label : `[${label}](${abs(u)})`;
    })
    .replace(/<img\b[^>]*alt\s*=\s*["']([^"']+)["'][^>]*>/gi, (_m, a: string) => `[그림: ${inline(a)}]`)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<(code|kbd)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t: string, c: string) => `\`${inline(c)}\``)
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|ul|ol|table|blockquote|dl|dd|dt|figure|form)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  let text = decodeEntities(h)
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  text = text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `\`\`\`\n${blocks[Number(i)].replace(/\n+$/, "")}\n\`\`\``);
  return { title, text };
}

/** DuckDuckGo 우회 주소(//duckduckgo.com/l/?uddg=…) → 원래 주소 */
export function decodeDdgUrl(u: string): string {
  const m = u.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return u;
    }
  }
  return u.startsWith("//") ? `https:${u}` : u;
}

/** DuckDuckGo HTML 결과 → [{title, url, snippet}] (광고 주소는 뺌) */
export function parseDdg(html: string): { title: string; url: string; snippet: string }[] {
  const out: { title: string; url: string; snippet: string }[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const heads = [...html.matchAll(re)];
  heads.forEach((m, i) => {
    const end = heads[i + 1]?.index ?? html.length;
    const chunk = html.slice(m.index ?? 0, end);
    const sn = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const url = decodeDdgUrl(decodeEntities(m[1]));
    if (/duckduckgo\.com\/y\.js|[?&]ad_provider=/.test(url)) return;
    out.push({ title: inline(m[2]), url, snippet: sn ? inline(sn[1]) : "" });
  });
  return out;
}

// ───────── 요청(같은 사이트는 1초 간격) ─────────

const lastAt = new Map<string, number>();
async function politeFetch(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  const host = new URL(url).host;
  const wait = (lastAt.get(host) ?? 0) + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt.set(host, Date.now());
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  signal?.addEventListener("abort", () => ac.abort(), { once: true });
  try {
    return await fetch(url, { ...init, headers: { ...HEADERS, Referer: `${new URL(url).origin}/`, ...(init.headers ?? {}) }, redirect: "follow", signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

const text = (t: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: t }], details });

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "웹 검색",
    description:
      "Search the web (DuckDuckGo) for current information, documentation, error messages or news. Returns titles, URLs and " +
      "snippets. Use web_fetch to read a result page.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      count: Type.Optional(Type.Number({ description: "Number of results (1-20, default 8)" })),
    }),
    async execute(_id: string, params: any, signal: AbortSignal | undefined) {
      const q = String(params.query ?? "").trim();
      if (!q) return text("검색어가 비어 있어요.", { error: "empty" });
      const n = Math.min(20, Math.max(1, Math.round(Number(params.count) || 8)));
      try {
        const res = await politeFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {}, signal);
        const html = await res.text();
        if (!res.ok) return text(`검색에 실패했어요(HTTP ${res.status}).`, { error: res.status });
        const results = parseDdg(html).slice(0, n);
        if (!results.length) {
          return text(/anomaly|captcha|unusual/i.test(html) ? "검색 엔진이 잠시 요청을 막았어요. 잠시 뒤 다시 해 주세요." : `'${q}' 검색 결과가 없어요.`, { query: q, results: [] });
        }
        const body = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`).join("\n\n");
        return text(`'${q}' 웹 검색 결과 ${results.length}개\n\n${body}`, { query: q, results });
      } catch (e: any) {
        return text(`검색하지 못했어요: ${e?.name === "AbortError" ? "시간 초과" : e?.message ?? e}`, { error: String(e?.message ?? e) });
      }
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "웹 페이지 가져오기",
    description:
      "Fetch a URL and return its content as readable text (HTML is converted to markdown-like text, JSON is pretty-printed). " +
      `Long pages are returned ${PAGE_CHARS} characters at a time; pass start to continue. Non-text files (PDF etc.) are saved to a temp file and the path is returned.`,
    parameters: Type.Object({
      url: Type.String({ description: "http(s) URL" }),
      start: Type.Optional(Type.Number({ description: "Character offset to continue from (default 0)" })),
    }),
    async execute(_id: string, params: any, signal: AbortSignal | undefined) {
      let url: URL;
      try {
        url = new URL(String(params.url ?? "").trim());
        if (!/^https?:$/.test(url.protocol)) throw new Error("http(s) 주소만");
      } catch {
        return text("주소가 올바르지 않아요(http:// 또는 https:// 로 시작해야 해요).", { error: "bad-url" });
      }
      try {
        const res = await politeFetch(url.href, {}, signal);
        const type = (res.headers.get("content-type") ?? "").toLowerCase();
        const len = Number(res.headers.get("content-length") ?? 0);
        if (len > MAX_BYTES) return text(`파일이 너무 커요(${Math.round(len / 1048576)}MB).`, { error: "too-big", status: res.status });
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_BYTES) return text("파일이 너무 커요(10MB 넘음).", { error: "too-big", status: res.status });
        const finalUrl = res.url || url.href;
        const head = `${res.ok ? "" : `(HTTP ${res.status}) `}${finalUrl}`;
        const isText = /text\/|json|xml|javascript|html/.test(type) || (!type && !buf.subarray(0, 512).includes(0));
        if (!isText) {
          const dir = join(tmpdir(), "pi-web");
          mkdirSync(dir, { recursive: true });
          const name = (url.pathname.split("/").pop() || "download").replace(/[^\w.\-]/g, "_").slice(0, 80);
          const path = join(dir, `${Date.now()}-${name}`);
          writeFileSync(path, buf);
          return text(`${head}\n글이 아닌 파일(${type || "알 수 없는 형식"}, ${Math.round(buf.length / 1024)}KB)이라 받아 두었어요: ${path}`, { url: finalUrl, path, type, status: res.status });
        }
        const raw = buf.toString("utf8");
        let title = "", body: string;
        if (/html|xml/.test(type) && /<html|<body|<div|<p\b/i.test(raw)) ({ title, text: body } = htmlToText(raw, finalUrl));
        else if (/json/.test(type)) {
          try {
            body = JSON.stringify(JSON.parse(raw), null, 2);
          } catch {
            body = raw;
          }
        } else body = raw;
        const start = Math.max(0, Math.round(Number(params.start) || 0));
        const part = body.slice(start, start + PAGE_CHARS);
        const more = start + PAGE_CHARS < body.length;
        const tail = more ? `\n\n…(전체 ${body.length}자 중 ${start + part.length}자까지. 이어 읽으려면 start=${start + PAGE_CHARS})` : "";
        return text(`${head}${title ? `\n# ${title}` : ""}\n\n${part || "(내용 없음)"}${tail}`, { url: finalUrl, title, status: res.status, length: body.length, start, more });
      } catch (e: any) {
        return text(`가져오지 못했어요: ${e?.name === "AbortError" ? "시간 초과(20초)" : e?.cause?.code ?? e?.message ?? e}`, { error: String(e?.message ?? e) });
      }
    },
  });
}
