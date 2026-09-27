import { recognizeWeight } from "../src/ocr";
const result = document.querySelector("#result")!;
document.querySelector<HTMLButtonElement>("#run")!.onclick = async () => {
  try {
    const img = document.querySelector<HTMLImageElement>("#fixture")!;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    const reading = await recognizeWeight(
      canvas,
      (m) => (result.textContent = m),
    );
    result.textContent = JSON.stringify(
      { pass: reading.value === 7.02, ...reading },
      null,
      2,
    );
  } catch (e) {
    result.textContent = String(e);
  }
};
