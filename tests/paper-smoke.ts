import { recognizePaper, rectify } from "../src/paper";
document.querySelector<HTMLButtonElement>("#run")!.onclick = async () => {
  const result = document.querySelector("#result")!;
  try {
    const img = document.querySelector<HTMLImageElement>("#fixture")!;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    const corrected = rectify(
      c,
      [
        { x: 0, y: 0 },
        { x: c.width - 1, y: 0 },
        { x: c.width - 1, y: c.height - 1 },
        { x: 0, y: c.height - 1 },
      ],
      0,
    );
    const data = await recognizePaper(
      corrected,
      (s) => (result.textContent = s),
    );
    result.textContent = JSON.stringify(
      { confidence: data.confidence, text: data.text },
      null,
      2,
    );
  } catch (e) {
    result.textContent = String(e);
  }
};
