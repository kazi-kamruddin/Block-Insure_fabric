import { copyFileSync, cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const destination = "public/ocr-assets";
const core = "node_modules/tesseract.js-core";
mkdirSync(destination, { recursive: true });
copyFileSync("node_modules/tesseract.js/dist/worker.min.js", join(destination, "worker.min.js"));
copyFileSync("node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", join(destination, "eng.traineddata.gz"));
for (const file of readdirSync(core)) {
  if (/^tesseract-core.*\.wasm(?:\.js)?$/.test(file)) copyFileSync(join(core, file), join(destination, file));
}
copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", join(destination, "pdf.worker.min.mjs"));
cpSync("node_modules/pdfjs-dist/wasm", join(destination, "pdf-wasm"), { recursive: true });
copyFileSync("node_modules/tesseract.js/LICENSE.md", join(destination, "tesseract-license.md"));
copyFileSync(join(core, "LICENSE"), join(destination, "tesseract-core-license.txt"));
copyFileSync("node_modules/pdfjs-dist/LICENSE", join(destination, "pdfjs-license.txt"));
