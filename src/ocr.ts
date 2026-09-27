import Tesseract, { type Worker } from "tesseract.js";
const { createWorker, PSM } = Tesseract;
import { parseWeightOCR } from "./domain";
let workerPromise: Promise<Worker> | undefined;
export async function recognizeWeight(
  canvas: HTMLCanvasElement,
  progress: (message: string) => void,
) {
  const base = new URL(`${import.meta.env.BASE_URL}vendor/`, document.baseURI)
    .href;
  workerPromise ??= createWorker("eng", 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === "recognizing text")
        progress(`数字を読み取り中 ${Math.round(m.progress * 100)}%`);
    },
  }).catch((e) => {
    workerPromise = undefined;
    throw e;
  });
  const worker = await workerPromise;
  // Include letters to detect mg / kg instead of silently turning them into g.
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789.,gGmkK-−",
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    preserve_interword_spaces: "1",
  });
  const gray = document.createElement("canvas");
  const scale = Math.max(1, Math.min(3, 1200 / canvas.width));
  gray.width = Math.round(canvas.width * scale);
  gray.height = Math.round(canvas.height * scale);
  const ctx = gray.getContext("2d")!;
  ctx.drawImage(canvas, 0, 0, gray.width, gray.height);
  const pixels = ctx.getImageData(0, 0, gray.width, gray.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value =
      0.299 * pixels.data[i] +
      0.587 * pixels.data[i + 1] +
      0.114 * pixels.data[i + 2];
    const contrast = Math.max(0, Math.min(255, (value - 128) * 1.4 + 128));
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = contrast;
  }
  ctx.putImageData(pixels, 0, 0);
  const first = (await worker.recognize(canvas)).data;
  const second = (await worker.recognize(gray)).data;
  const a = parseWeightOCR(first.text),
    b = parseWeightOCR(second.text);
  const agreement = a.value !== null && a.value === b.value;
  const confidence = Math.min(first.confidence, second.confidence);
  // One valid result may be shown as a low-confidence candidate, never as an automatic registration.
  // If both valid readings disagree, do not choose either number.
  const candidate = agreement
    ? a.value
    : a.value !== null && b.value === null
      ? a.value
      : b.value !== null && a.value === null
        ? b.value
        : null;
  return {
    value: candidate,
    confidence,
    agreement,
    low: !agreement || confidence < 85,
    raw: [first.text.trim(), second.text.trim()],
    code: !agreement
      ? candidate !== null
        ? "OCR_LOW_CONFIDENCE"
        : (a.code ?? b.code ?? "OCR_READINGS_DISAGREE")
      : confidence < 85
        ? "OCR_LOW_CONFIDENCE"
        : null,
  };
}
