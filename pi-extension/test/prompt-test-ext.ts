// 시험 전용: pi 확인 창(select·confirm·input)을 띄우는 명령과 도구. 결과는 /tmp/ptest-result.txt 에 한 줄씩
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  const log = (s: string) => appendFileSync("/tmp/ptest-result.txt", `${s}\n`);
  pi.registerCommand("ptest", {
    description: "확인 창 시험",
    handler: async (args: string, ctx: any) => {
      const k = String(args ?? "").trim();
      let r: any;
      if (k === "select") r = await ctx.ui.select("Pick a color", ["Red", "Green", "Blue"]);
      else if (k === "confirm") r = await ctx.ui.confirm("Delete cache?", "This removes /tmp/x");
      else if (k === "input") r = await ctx.ui.input("Your name", "type a name");
      else if (k === "timeout") r = await ctx.ui.select("Quick pick", ["A", "B"], { timeout: 3000 });
      else if (k === "abort") {
        const ac = new AbortController();
        setTimeout(() => ac.abort(), 2500);
        r = await ctx.ui.select("Aborted pick", ["A", "B"], { signal: ac.signal });
      }
      log(`${k}=${JSON.stringify(r) ?? "undefined"}`);
    },
  });
  pi.registerTool({
    name: "confirm_test",
    label: "confirm test",
    description: "Ask the user a yes/no confirmation. Testing only.",
    parameters: Type.Object({}),
    async execute(_id: string, _params: any, _signal: AbortSignal | undefined, _onUpdate: any, ctx: any) {
      const ok = await ctx.ui.confirm("Proceed with test?", "Testing tool confirm");
      log(`tool=${ok}`);
      return { content: [{ type: "text", text: ok ? "user said yes" : "user said no" }], details: {} };
    },
  });
}
