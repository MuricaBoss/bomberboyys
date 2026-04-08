import fs from "node:fs";
import path from "node:path";

const buildMetaPath = path.resolve(process.cwd(), "src/build-meta.ts");
const source = fs.existsSync(buildMetaPath)
  ? fs.readFileSync(buildMetaPath, "utf8")
  : "export const DISPLAY_BUILD_NUMBER = 0;\n";

const match = source.match(/DISPLAY_BUILD_NUMBER\s*=\s*(?:"|')?([\d.]+)(?:"|')?/);
const current = match ? match[1] : "0";
let next = current;

if (current.includes(".")) {
  // If it's a decimal like 140.2, just keep it or increment the integer part if you MUST,
  // but let's just make it possible to stay on a version if it's special.
  // Actually, let's just increment the whole integer version for next time.
  next = Math.floor(parseFloat(current) + 1).toString();
} else {
  next = (parseInt(current, 10) + 1).toString();
}

fs.writeFileSync(
  buildMetaPath,
  `export const DISPLAY_BUILD_NUMBER = "${next}";\n`,
  "utf8",
);

console.log(`[build-number] ${current} -> ${next}`);
