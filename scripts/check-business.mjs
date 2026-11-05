import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/business.ts", import.meta.url), "utf8");
// The header comment mentions TODO, so only the data below it is checked.
const data = source.slice(source.indexOf("export const"));

if (data.includes("TODO")) {
  console.error("Fill in src/business.ts before deploying: it still contains TODO.");
  process.exit(1);
}
