import { prepareZXingModule, writeBarcode, readBarcodes } from "zxing-wasm";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
prepareZXingModule({
  overrides: {
    wasmBinary: await readFile(
      require.resolve("zxing-wasm/full/zxing_full.wasm"),
    ),
  },
});
for (const format of [
  "DataBar",
  "DataBarLimited",
  "DataBarExpanded",
  "Code128",
  "QRCode",
]) {
  const text =
    format === "QRCode"
      ? "TEST000001"
      : format === "Code128" || format === "DataBarExpanded"
        ? "(01)00000000000000"
        : "00000000000000";
  const result = await writeBarcode(text, {
    format,
    options: format === "QRCode" ? "" : "gs1",
    scale: 3,
  });
  if (result.error) throw new Error(format + ": " + result.error);
  const { width, height, data } = result.symbol,
    rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = data[i];
    rgba[i * 4 + 3] = 255;
  }
  const decoded = await readBarcodes(
    { width, height, data: rgba },
    { formats: [format], tryHarder: true },
  );
  if (!decoded.length || !decoded[0].isValid)
    throw new Error(format + " decode failed");
  console.log(format, decoded[0].text);
  if (format === "QRCode")
    await writeFile(
      new URL("../tests/fixtures/TEST000001.png", import.meta.url),
      Buffer.from(await result.image.arrayBuffer()),
    );
}
