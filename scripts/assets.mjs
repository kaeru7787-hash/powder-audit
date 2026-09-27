import {
  mkdir,
  copyFile,
  readFile,
  readdir,
  writeFile,
  access,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const vendor = new URL("../public/vendor/", import.meta.url);
await mkdir(vendor, { recursive: true });
const tess = dirname(require.resolve("tesseract.js/package.json"));
const core = dirname(
  createRequire(join(tess, "package.json")).resolve(
    "tesseract.js-core/package.json",
  ),
);
const zxing = join(dirname(require.resolve("zxing-wasm/reader")), "../../..");
await copyFile(
  join(tess, "dist/worker.min.js"),
  new URL("worker.min.js", vendor),
);
await copyFile(
  join(tess, "dist/worker.min.js.LICENSE.txt"),
  new URL("worker-LICENSE.txt", vendor),
);
for (const name of await readdir(core))
  if (/\.wasm(\.js)?$/.test(name))
    await copyFile(join(core, name), new URL(name, vendor));
await copyFile(
  join(zxing, "dist/reader/zxing_reader.wasm"),
  new URL("zxing_reader.wasm", vendor),
);
for (const [folder, name] of [
  [tess, "tesseract"],
  [core, "tesseract-core"],
  [zxing, "zxing"],
]) {
  for (const f of ["LICENSE", "LICENSE.md", "LICENSE.txt"])
    try {
      await copyFile(join(folder, f), new URL(`${name}-LICENSE.txt`, vendor));
      break;
    } catch {}
}
for (const language of ["eng", "jpn"]) {
  const lang = new URL(`${language}.traineddata.gz`, vendor);
  try {
    await access(lang);
  } catch {
    const response = await fetch(
      `https://tessdata.projectnaptha.com/4.0.0/${language}.traineddata.gz`,
    );
    if (!response.ok) throw new Error("OCR language download failed");
    await writeFile(lang, Buffer.from(await response.arrayBuffer()));
  }
}
console.log("Local barcode/OCR assets ready. No runtime CDN is required.");
