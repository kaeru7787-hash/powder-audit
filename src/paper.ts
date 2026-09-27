import Tesseract from "tesseract.js";
export interface Point {
  x: number;
  y: number;
}
export function homography(from: Point[], to: Point[]): number[] {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i],
      u = to[i].x,
      v = to[i].y;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++)
      if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r;
    [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
    const n = rows[c][c];
    if (Math.abs(n) < 1e-10)
      throw new Error("四隅が重なっています。範囲を選び直してください。");
    for (let j = c; j < 9; j++) rows[c][j] /= n;
    for (let r = 0; r < 8; r++)
      if (r !== c) {
        const f = rows[r][c];
        for (let j = c; j < 9; j++) rows[r][j] -= f * rows[c][j];
      }
  }
  return rows.map((r) => r[8]);
}
export function project(h: number[], x: number, y: number): Point {
  const den = h[6] * x + h[7] * y + 1;
  return {
    x: (h[0] * x + h[1] * y + h[2]) / den,
    y: (h[3] * x + h[4] * y + h[5]) / den,
  };
}
export function rectify(
  source: HTMLCanvasElement,
  corners: Point[],
  angle: number,
): HTMLCanvasElement {
  if (
    corners.length !== 4 ||
    corners.some((p, i) => {
      const q = corners[(i + 1) % 4],
        r = corners[(i + 2) % 4];
      return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x) <= 0;
    })
  )
    throw new Error(
      "左上→右上→右下→左下の順で、交差しない四隅を選んでください。",
    );
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const w = Math.max(
      distance(corners[0], corners[1]),
      distance(corners[2], corners[3]),
    ),
    h = Math.max(
      distance(corners[0], corners[3]),
      distance(corners[1], corners[2]),
    );
  if (w < 10 || h < 10) throw new Error("処方欄の四隅を選んでください。");
  const scale = Math.min(1, 2200 / Math.max(w, h)),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const transform = homography(
    [
      { x: 0, y: 0 },
      { x: canvas.width - 1, y: 0 },
      { x: canvas.width - 1, y: canvas.height - 1 },
      { x: 0, y: canvas.height - 1 },
    ],
    corners,
  );
  const pixels = source
      .getContext("2d")!
      .getImageData(0, 0, source.width, source.height),
    ctx = canvas.getContext("2d")!,
    out = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      const p = project(transform, x, y),
        sx = Math.round(p.x),
        sy = Math.round(p.y),
        i = (y * canvas.width + x) * 4;
      let value = 255;
      if (sx >= 0 && sy >= 0 && sx < source.width && sy < source.height) {
        const k = (sy * source.width + sx) * 4;
        value =
          0.299 * pixels.data[k] +
          0.587 * pixels.data[k + 1] +
          0.114 * pixels.data[k + 2];
      }
      value = Math.max(0, Math.min(255, (value - 128) * 1.25 + 128));
      out.data[i] = out.data[i + 1] = out.data[i + 2] = value;
      out.data[i + 3] = 255;
    }
  ctx.putImageData(out, 0, 0);
  if (!angle) return canvas;
  const rotated = document.createElement("canvas"),
    r = (angle * Math.PI) / 180;
  rotated.width = Math.ceil(
    Math.abs(canvas.width * Math.cos(r)) +
      Math.abs(canvas.height * Math.sin(r)),
  );
  rotated.height = Math.ceil(
    Math.abs(canvas.height * Math.cos(r)) +
      Math.abs(canvas.width * Math.sin(r)),
  );
  const rc = rotated.getContext("2d")!;
  rc.fillStyle = "#fff";
  rc.fillRect(0, 0, rotated.width, rotated.height);
  rc.translate(rotated.width / 2, rotated.height / 2);
  rc.rotate(r);
  rc.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return rotated;
}
export async function recognizePaper(
  canvas: HTMLCanvasElement,
  progress: (s: string) => void,
) {
  const base = new URL(`${import.meta.env.BASE_URL}vendor/`, document.baseURI)
    .href;
  const worker = await Tesseract.createWorker(["jpn", "eng"], 1, {
    workerPath: base + "worker.min.js",
    corePath: base,
    langPath: base,
    workerBlobURL: false,
    logger: (m) =>
      progress(
        `${m.status === "recognizing text" ? "処方欄を認識中" : "OCRを準備中"} ${Math.round(m.progress * 100)}%`,
      ),
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
    return (await worker.recognize(canvas)).data;
  } finally {
    await worker.terminate();
  }
}
