/**
 * 번호로 고르는 질문 상자(Claude Code 처럼): 숫자 키로 바로 고르고, ↑↓·Enter·Esc 도 됨
 * - 여러 개 고르기: 숫자·Space 로 체크, Enter 로 보냄
 * - '직접 입력'은 마지막 번호(고르면 호출한 쪽이 입력 창을 띄움)
 * - 여러 질문이면 제목에 (1/3), ← 로 앞 질문
 * 확장이 아니라 공용 코드(extensions/lib 는 pi 가 확장으로 불러오지 않음)
 */
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type ChoiceOption = { label: string; description?: string };
export type ChoiceSpec = {
  question: string;
  options: ChoiceOption[];
  multi?: boolean;
  allowOther?: boolean;   // 마지막에 '직접 입력'
  step?: string;          // 예: '1/3'
  title?: string;         // 기본 'pi가 물어봐요'
};
/** 고른 결과: 번호들(0부터), 직접 입력을 골랐으면 other, ← 면 back. 닫으면 undefined */
export type ChoiceResult = { picks: number[]; other?: boolean; back?: boolean } | undefined;

export const OTHER_LABEL = "직접 입력";

export function choiceLines(spec: ChoiceSpec, sel: number, picked: Set<number>, width: number, theme?: any): string[] {
  const fg = (k: string, t: string) => (theme?.fg ? theme.fg(k, t) : t);
  const bold = (t: string) => (theme?.bold ? theme.bold(t) : t);
  const W = Math.max(30, Math.min(width - 1, 100));
  const inner = W - 4;
  const title = ` ${fg("accent", "●")} ${bold(spec.title ?? "pi가 물어봐요")}${spec.step ? ` ${fg("muted", `(${spec.step})`)}` : ""} `;
  const out = [fg("accent", "╭─") + title + fg("accent", `${"─".repeat(Math.max(1, W - 3 - visibleWidth(title)))}╮`)];
  const row = (t = "") => {
    const cut = truncateToWidth(t, inner);
    out.push(`${fg("accent", "│")} ${cut}${" ".repeat(Math.max(0, inner - visibleWidth(cut)))} ${fg("accent", "│")}`);
  };
  const para = (t: string, indent = "", color?: string, max = 8) => {
    for (const l of wrapTextWithAnsi(t, inner - visibleWidth(indent)).slice(0, max)) row(indent + (color ? fg(color, l) : l));
  };
  row();
  const [first, ...rest] = String(spec.question ?? "").trim().split("\n");
  para(bold(first ?? ""));
  if (rest.join("\n").trim()) para(rest.join("\n").trim(), "", "muted", 14);
  if (spec.multi) row(fg("dim", "여러 개 고를 수 있어요(숫자·Space 로 체크, Enter 로 보내기)"));
  row();
  const items = [...spec.options, ...(spec.allowOther ? [{ label: OTHER_LABEL }] : [])];
  items.forEach((o, i) => {
    const cur = i === sel;
    const box = spec.multi && i < spec.options.length ? (picked.has(i) ? "[✓] " : "[ ] ") : "";
    const head = `${cur ? "❯" : " "} ${i + 1}. ${box}${o.label}`;
    para(cur ? fg("accent", head) : head, "", undefined, 3);
    if (o.description) para(o.description, "      ", "muted", 3);
  });
  row();
  para(`숫자로 고르기 · ↑↓ · Enter${spec.step && !spec.step.startsWith("1/") ? " · ← 앞 질문" : ""} · Esc 닫기`, "", "dim", 2);
  out.push(fg("accent", `╰${"─".repeat(W - 2)}╯`));
  return out;
}

/** 맥 화면에 번호 상자를 띄우고 고른 결과를 돌려줌. ctx.ui.custom 이 없으면 undefined(호출한 쪽이 기본 창으로) */
export async function askChoice(ctx: any, spec: ChoiceSpec, signal?: AbortSignal): Promise<ChoiceResult | "unsupported"> {
  if (typeof ctx?.ui?.custom !== "function") return "unsupported";
  const n = spec.options.length + (spec.allowOther ? 1 : 0);
  return ctx.ui.custom((tui: any, theme: any, kb: any, done: (v: ChoiceResult) => void) => {
    let sel = 0;
    const picked = new Set<number>();
    if (signal) {
      if (signal.aborted) queueMicrotask(() => done(undefined));
      signal.addEventListener("abort", () => done(undefined), { once: true });
    }
    const is = (data: string, name: string, key: string) => (kb?.matches?.(data, name) ?? false) || matchesKey(data, key as any);
    const choose = (i: number) => {
      if (i === spec.options.length && spec.allowOther) return done({ picks: [...picked].sort((a, b) => a - b), other: true });
      if (!spec.multi) return done({ picks: [i] });
      if (picked.has(i)) picked.delete(i);
      else picked.add(i);
      tui.requestRender();
    };
    return {
      render: (width: number) => choiceLines(spec, sel, picked, width, theme),
      handleInput: (data: string) => {
        if (/^[1-9]$/.test(data) && Number(data) <= n) return choose(Number(data) - 1);
        if (is(data, "tui.select.up", "up")) sel = (sel + n - 1) % n;
        else if (is(data, "tui.select.down", "down")) sel = (sel + 1) % n;
        else if (data === " " && spec.multi && sel < spec.options.length) return choose(sel);
        else if (is(data, "tui.select.confirm", "enter")) {
          if (!spec.multi || sel === spec.options.length) return choose(sel);
          if (!picked.size) picked.add(sel);
          return done({ picks: [...picked].sort((a, b) => a - b) });
        } else if (matchesKey(data, "left" as any) && spec.step && !spec.step.startsWith("1/")) return done({ picks: [], back: true });
        else if (is(data, "tui.select.cancel", "escape")) return done(undefined);
        tui.requestRender();
      },
      invalidate: () => {},
    };
  });
}
