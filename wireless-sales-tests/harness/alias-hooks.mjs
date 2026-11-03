// "@/…" → wireless-sales/…  (WS_ROOT 로 다른 버전(예: 수정 전 main 사본)을 가리킬 수 있음)
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.WS_ROOT || path.resolve(here, "../../wireless-sales");
function find(base) {
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}
export async function resolve(spec, ctx, next) {
  if (spec === "server-only") return { url: pathToFileURL(path.join(here, "stub-empty.mjs")).href, shortCircuit: true };
  if (spec === "next/server") return { url: pathToFileURL(path.join(here, "stub-next-server.mjs")).href, shortCircuit: true };
  if (spec.startsWith("@/")) {
    const p = find(path.join(root, spec.slice(2)));
    if (p) return { url: pathToFileURL(p).href, shortCircuit: true };
  }
  if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$/.test(spec)) {
    const p = find(fileURLToPath(new URL(spec, ctx.parentURL)));
    if (p) return { url: pathToFileURL(p).href, shortCircuit: true };
  }
  return next(spec, ctx);
}
