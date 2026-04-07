import fs from "node:fs";
import path from "node:path";

const buildMetaPath = path.resolve(process.cwd(), "src/build-meta.ts");
const source = fs.existsSync(buildMetaPath)
  ? fs.readFileSync(buildMetaPath, "utf8")
  : "export const DISPLAY_BUILD_NUMBER = 0;\n";

const match = source.match(/DISPLAY_BUILD_NUMBER\s*=\s*(\d+)/);
const current = match ? Number(match[1]) : 0;
const next = current + 1;

fs.writeFileSync(
  buildMetaPath,
  `export const DISPLAY_BUILD_NUMBER = ${next};\n`,
  "utf8",
);

console.log(`[build-number] ${current} -> ${next}`);
