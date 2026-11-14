// 브라우저 시험용 화면 묶기 (esbuild). react·react-dom 은 이 PC 에 이미 있는 19.2.8 사용 (웹앱과 같은 버전)
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const WS = process.env.WS_ROOT || path.resolve(here, "../../wireless-sales");
const MODS = process.env.E2E_NODE_MODULES || "/opt/npm-tools/node_modules";
const { build } = await import(path.join(MODS, "esbuild/lib/main.js"));
const find = (base) => ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map((e) => base + e).find((p) => existsSync(p) && !p.endsWith("/"));
export async function bundle(outfile) {
  await build({
    entryPoints: [path.join(here, "client.tsx")],
    bundle: true,
    outfile,
    format: "iife",
    jsx: "automatic",
    target: "es2022",
    nodePaths: [MODS],
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "error",
    plugins: [{
      name: "alias",
      setup(b) {
        b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: path.join(here, "stub-navigation.ts") }));
        b.onResolve({ filter: /^@\// }, (a) => ({ path: find(path.join(WS, a.path.slice(2))) }));
      },
    }],
  });
}
if (process.argv[2]) await bundle(process.argv[2]);
