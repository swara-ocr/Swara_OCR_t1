// Copies the Tesseract.js worker and WASM core from node_modules into public/tesseract
// so the app loads them from its own origin instead of a CDN.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "tesseract");
const core = join(root, "node_modules", "tesseract.js-core");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"), join(out, "worker.min.js"));
for (const f of readdirSync(core)) {
  if (/-lstm\.wasm\.js$/.test(f) || /-lstm\.js$/.test(f)) cpSync(join(core, f), join(out, f));
}
console.log("copied Tesseract worker and core to public/tesseract");
