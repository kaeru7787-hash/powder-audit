import { readBarcodes, prepareZXingModule } from "zxing-wasm/reader";
import { frameCrop } from "./camera-geometry";
const asset = (path: string) =>
  new URL(`${import.meta.env.BASE_URL}vendor/${path}`, document.baseURI).href;
prepareZXingModule({
  overrides: { locateFile: (path: string) => asset(path) },
});
export class Camera {
  stream: MediaStream | null = null;
  stopped = true;
  private generation = 0;
  constructor(private video: HTMLVideoElement) {}
  async start() {
    this.stop();
    const generation = this.generation;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "カメラにはHTTPSまたはlocalhostが必要です。写真選択も利用できます。",
      );
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    this.stopped = false;
  }
  stop() {
    this.generation++;
    this.stopped = true;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
  capture(roi: boolean | "barcode" = false): HTMLCanvasElement {
    const w = this.video.videoWidth,
      h = this.video.videoHeight;
    if (!w || !h || this.stopped)
      throw new Error("カメラの準備ができていません。");
    const canvas = document.createElement("canvas");
    // Barcode uses cover; the scale OCR and prescription views keep contain.
    if (roi) {
      const { x, y, width, height } = frameCrop(
        w,
        h,
        this.video.clientWidth,
        this.video.clientHeight,
        roi === "barcode",
      );
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      canvas
        .getContext("2d")!
        .drawImage(
          this.video,
          x,
          y,
          width,
          height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
    } else {
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(this.video, 0, 0);
    }
    return canvas;
  }
  async scan(
    onRead: (text: string) => void,
    onError: (error: unknown) => void,
  ) {
    const generation = this.generation;
    while (!this.stopped && generation === this.generation) {
      try {
        const canvas = this.capture("barcode");
        const results = await decode(canvas);
        if (this.stopped || generation !== this.generation) return;
        if (results.length === 1) {
          this.stop();
          onRead(results[0]);
          return;
        }
        if (results.length > 1) {
          this.stop();
          onError(
            new Error(
              "複数のコードを検出しました。1本の瓶だけを枠に入れてください。",
            ),
          );
          return;
        }
      } catch (e) {
        this.stop();
        onError(e);
        return;
      }
      await new Promise((r) => setTimeout(r, 220));
    }
  }
}
export async function decode(
  input: HTMLCanvasElement | Blob,
): Promise<string[]> {
  const data =
    input instanceof HTMLCanvasElement
      ? input.getContext("2d")!.getImageData(0, 0, input.width, input.height)
      : input;
  const results = await readBarcodes(data, {
    formats: [
      "DataBar",
      "DataBarLimited",
      "DataBarExpanded",
      "Code128",
      "DataMatrix",
      "QRCode",
      "ITF",
    ],
    tryHarder: true,
    maxNumberOfSymbols: 10,
  });
  return [...new Set(results.filter((r) => r.isValid).map((r) => r.text))];
}
export async function imageCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
