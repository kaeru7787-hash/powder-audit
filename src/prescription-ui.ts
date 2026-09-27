import { readBarcodes } from "zxing-wasm/reader";
import { Camera, imageCanvas } from "./camera";
import {
  parseJahis,
  parsePaperText,
  codeCandidates,
  nameCandidates,
  QRAssembler,
  type DraftDrug,
} from "./prescription";
import { rectify, recognizePaper, type Point } from "./paper";
import {
  newSession,
  totalFor,
  isPowder,
  event,
  AuditError,
  type Drug,
  type Session,
} from "./domain";
interface Context {
  demo?: boolean;
  dialog: (title: string, body: string) => number;
  bind: (id: string, fn: () => unknown) => void;
  epoch: () => number;
  setCamera: (camera: Camera) => void;
  master: () => Drug[];
  review: (s: Session) => void;
  error: (e: unknown) => void;
}
const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const fmt = (v: number) =>
  v.toLocaleString("ja-JP", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
export function openQR(ctx: Context) {
  const epoch = ctx.dialog(
    "処方箋・電子処方箋控えのQR",
    `<p>この処方にあるQRをすべて読み取ってください。分割QRはそろうまで解析しません。</p><div class="camera-wrap"><video id="rx-video" playsinline muted></video><div class="camera-caption" id="qr-progress">処方情報を含むQRに対応</div></div><button id="rx-camera" class="primary full">カメラで処方QRを読む</button><label class="field">QR画像を選択（複数可）<input id="rx-qr-file" type="file" accept="image/*" multiple></label><label class="field">入力元<select id="rx-source"><option value="jahis">処方箋QR</option><option value="electronic-copy">電子処方箋控え</option></select></label><label class="field">文字コード<select id="rx-encoding"><option value="shift-jis">Shift-JIS（JAHIS標準）</option><option value="utf-8">UTF-8</option></select></label><details><summary>QRのテキスト／JAHISファイルを読み込む</summary><label class="field">JAHISデータ<textarea id="jahis-raw" placeholder="JAHIS11"></textarea></label><label class="field">JAHISファイル<input id="jahis-file" type="file" accept=".txt,.csv"></label><button id="parse-jahis" class="secondary full">処方内容を解析</button></details><div class="notice warn">引換番号・URLだけのコードには薬剤情報がありません。その場合は処方箋の写真または手入力を使ってください。</div>`,
  );
  let assembler = new QRAssembler(),
    done = false;
  const parse = (raw: string) => {
    if (ctx.epoch() !== epoch) return;
    const source = $<HTMLSelectElement>("#rx-source").value;
    const rows = parseJahis(raw, source);
    done = true;
    reviewDrafts(ctx, rows);
  };
  const decode = async (input: HTMLCanvasElement | File) => {
    const data =
      input instanceof HTMLCanvasElement
        ? input.getContext("2d")!.getImageData(0, 0, input.width, input.height)
        : input;
    return (
      await readBarcodes(data, {
        formats: ["QRCode"],
        tryHarder: true,
        maxNumberOfSymbols: 255,
      })
    ).filter((x) => x.isValid);
  };
  const accept = (results: Awaited<ReturnType<typeof decode>>) => {
    if (ctx.epoch() !== epoch || done) return;
    if (results.some((x) => x.sequenceSize === -1) && results.length > 1)
      throw new AuditError(
        "MULTIPLE_PRESCRIPTIONS",
        "複数の独立したQRを検出しました。対象のQRを1つずつ確認してください。",
      );
    let complete: Uint8Array | null = null;
    for (const part of results) complete = assembler.add(part) ?? complete;
    if (complete) {
      const encoding = $<HTMLSelectElement>("#rx-encoding").value;
      const raw = new TextDecoder(encoding, { fatal: true }).decode(complete);
      parse(raw);
    } else if (results.length)
      $("#qr-progress").textContent =
        `分割QR ${assembler.progress} 個。残りを読んでください。`;
  };
  ctx.bind("rx-camera", async () => {
    const cam = new Camera($<HTMLVideoElement>("#rx-video"));
    ctx.setCamera(cam);
    await cam.start();
    while (!cam.stopped && ctx.epoch() === epoch && !done) {
      try {
        accept(await decode(cam.capture()));
      } catch (e) {
        cam.stop();
        assembler = new QRAssembler();
        ctx.error(e);
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    cam.stop();
  });
  $<HTMLInputElement>("#rx-qr-file").onchange = () => {
    void (async () => {
      const files = [...($<HTMLInputElement>("#rx-qr-file").files ?? [])];
      const results: Awaited<ReturnType<typeof decode>> = [];
      for (const file of files) {
        results.push(...(await decode(file)));
      }
      accept(results);
      if (!done && ctx.epoch() === epoch)
        $("#qr-progress").textContent =
          `未完了：${assembler.progress} 個。残りのQRを読み取ってください。`;
    })().catch((e) => {
      assembler = new QRAssembler();
      ctx.error(e);
    });
  };
  ctx.bind("parse-jahis", () =>
    parse($<HTMLTextAreaElement>("#jahis-raw").value),
  );
  $<HTMLInputElement>("#jahis-file").onchange = () => {
    void (async () => {
      const file = $<HTMLInputElement>("#jahis-file").files?.[0];
      if (!file) return;
      const encoding = $<HTMLSelectElement>("#rx-encoding").value;
      parse(
        new TextDecoder(encoding, { fatal: true }).decode(
          await file.arrayBuffer(),
        ),
      );
    })().catch(ctx.error);
  };
}
export function reviewDrafts(ctx: Context, rows: DraftDrug[]) {
  const master = ctx.master();
  if (!master.length)
    throw new AuditError(
      "MASTER_REQUIRED",
      "先に実薬の医薬品マスターを取り込んでください。",
    );
  const options = (d: DraftDrug) => {
    const codes = codeCandidates(d, master),
      suggested = codes.length ? codes : nameCandidates(d.name, master),
      ordered = [...suggested, ...master.filter((m) => !suggested.includes(m))];
    return ordered
      .map(
        (m) =>
          `<option value="${master.indexOf(m)}">${suggested.includes(m) ? "候補：" : ""}${esc(m.productName)} / ${esc(m.strength)} / ${esc(m.dosageForm)}</option>`,
      )
      .join("");
  };
  ctx.dialog(
    "読み取った処方を1剤ずつ確認",
    `<div class="notice warn">名前は自動補正・確定しません。すべての薬剤を原本と確認し、マスターの薬剤を選択してください。</div>${rows.map((d, i) => `<section class="history-row" id="draft-${i}"><h3>Rp.${esc(d.rp)}　読取：${esc(d.name || "名称なし")}</h3><p class="code">${esc(d.codeType)} / ${esc(d.code)}</p><p>読取量：${esc(d.quantity || "不明")} ${esc(d.unit || "単位不明")}<br>日数・回数：${esc(d.days || "不明")} / ${esc(d.usage)}</p>${d.notes.length ? `<div class="notice warn">${d.notes.map(esc).join("<br>")}</div>` : ""}<label class="field">${i + 1}剤目：原本に対応する薬剤<select id="drug-${i}"><option value="">必ず選択してください</option><option value="exclude">監査対象外（錠剤・外用など）</option>${options(d)}</select></label><div id="mapped-${i}" class="muted"></div><label class="field">処方の種類<select id="type-${i}"><option value="brand" ${d.codeType === "7" ? "" : "selected"}>商品名処方</option><option value="generic" ${d.codeType === "7" ? "selected" : ""}>一般名処方</option></select></label><div class="grid2"><label class="field">製剤の数量（g）<input id="quantity-${i}" inputmode="decimal" value="${esc(d.unit === "g" && d.basis !== "ingredient" ? d.quantity : "")}"></label><label class="field">この数量の意味<select id="meaning-${i}"><option value="">選択してください</option><option value="daily" ${d.meaning === "daily" ? "selected" : ""}>1日量</option><option value="dose" ${d.meaning === "dose" ? "selected" : ""}>1回量</option><option value="total" ${d.meaning === "total" ? "selected" : ""}>全量（頓服を含む）</option></select></label><label class="field">今回の日数<input id="days-${i}" inputmode="numeric" value="${esc(d.days)}"></label><label class="field">1日回数<input id="times-${i}" inputmode="numeric" value="${esc(d.times)}"></label></div><div id="total-${i}" class="target-number">総量：未確認</div><label class="field">対象外にする理由（対象外のみ必須）<input id="exclude-${i}"></label><label class="check"><input id="checked-${i}" type="checkbox">この薬剤の原本・成分・規格・剤形・製剤総量g、または対象外の理由を確認しました</label></section>`).join("")}<label class="check"><input id="all-records" type="checkbox">処方箋のすべての薬剤を照合し、読み取り漏れがないことを確認しました</label><button id="draft-review" class="primary full">確認した処方の最終確認へ</button>`,
  );
  rows.forEach((d, i) => {
    const update = () => {
      try {
        const total = totalFor(
          $<HTMLInputElement>(`#quantity-${i}`).value,
          $<HTMLSelectElement>(`#meaning-${i}`).value,
          $<HTMLInputElement>(`#days-${i}`).value,
          $<HTMLInputElement>(`#times-${i}`).value,
          "g",
          "product",
        );
        $(`#total-${i}`).textContent = `総量 ${fmt(total)} g`;
      } catch {
        $(`#total-${i}`).textContent = "総量：自動確定できません";
      }
      $<HTMLInputElement>(`#checked-${i}`).checked = false;
    };
    ["quantity", "meaning", "days", "times"].forEach(
      (k) => ($(`#${k}-${i}`).oninput = update),
    );
    $(`#type-${i}`).onchange = () => {
      $<HTMLInputElement>(`#checked-${i}`).checked = false;
    };
    $(`#exclude-${i}`).oninput = () => {
      $<HTMLInputElement>(`#checked-${i}`).checked = false;
    };
    $(`#drug-${i}`).onchange = () => {
      const index = $<HTMLSelectElement>(`#drug-${i}`).value,
        m = master[Number(index)];
      $(`#mapped-${i}`).textContent =
        index !== "" && index !== "exclude" && m
          ? `選択：${m.productName} / ${m.ingredient} / ${m.strength} / ${m.dosageForm}`
          : "";
      $<HTMLInputElement>(`#checked-${i}`).checked = false;
    };
    update();
  });
  ctx.bind("draft-review", () => {
    if (!$<HTMLInputElement>("#all-records").checked)
      throw new Error("全薬剤と読み取り漏れを確認してください。");
    const excluded: { name: string; reason: string }[] = [],
      drugs: unknown[] = [];
    rows.forEach((d, i) => {
      if (!$<HTMLInputElement>(`#checked-${i}`).checked)
        throw new Error(`${i + 1}剤目を確認してください。`);
      const index = $<HTMLSelectElement>(`#drug-${i}`).value;
      if (index === "exclude") {
        const reason = $<HTMLInputElement>(`#exclude-${i}`).value.trim();
        if (!reason) throw new Error("対象外の理由を入力してください。");
        excluded.push({ name: d.name, reason });
        return;
      }
      if (index === "") throw new Error("薬剤を選択してください。");
      const m = master[Number(index)];
      if (!isPowder(m.dosageForm))
        throw new Error("散剤以外は対象外として理由を確認してください。");
      const generic = $<HTMLSelectElement>(`#type-${i}`).value === "generic";
      if (d.code && ["2", "4", "7"].includes(d.codeType)) {
        const candidates = codeCandidates(d, master);
        if (!candidates.includes(m))
          throw new Error(
            `${i + 1}剤目：読み取ったコードと選択薬が一致しません。マスターを確認してください。`,
          );
        if ((d.codeType === "7") !== generic)
          throw new Error("QRの処方種別と選択が異なります。");
      }
      if (generic && !m.genericCode)
        throw new Error("一般名コードがありません。");
      const q = $<HTMLInputElement>(`#quantity-${i}`).value,
        meaning = $<HTMLSelectElement>(`#meaning-${i}`).value,
        days = $<HTMLInputElement>(`#days-${i}`).value,
        total = totalFor(
          q,
          meaning,
          days,
          $<HTMLInputElement>(`#times-${i}`).value,
          "g",
          "product",
        );
      drugs.push({
        rpNumber: d.rp,
        sourceType: d.sourceType,
        prescriptionType: generic ? "generic" : "brand",
        drugCode: generic ? "" : m.yjCode,
        receiptCode: generic ? "" : m.receiptCode,
        genericCode: m.genericCode,
        drugName: generic ? m.genericName : m.productName,
        genericName: m.genericName,
        ingredient: m.ingredient,
        strength: m.strength,
        dosageForm: m.dosageForm,
        expectedTotal: total,
        unit: "g",
        quantityBasis: "product",
        usage: d.usage,
        ...(meaning === "daily"
          ? { quantityPerDay: Number(q), days: Number(days) }
          : {}),
      });
    });
    const candidate = newSession(drugs, ctx.demo ?? false);
    event(candidate, "SOURCE_REVIEWED", {
      source: rows[0]?.sourceType,
      readCount: rows.length,
      included: drugs.length,
      excluded: excluded.map((x) => ({ reason: x.reason })),
    });
    ctx.review(candidate);
  });
}
export function openPaper(ctx: Context) {
  ctx.dialog(
    "紙処方箋を読み取る",
    `<p>処方欄を明るく、正面から撮影してください。画像は端末内だけで処理し、保存しません。</p><div class="camera-wrap"><video id="paper-video" playsinline muted></video><div class="camera-caption">処方欄を画面全体に入れる</div></div><div class="actions"><button id="paper-camera">カメラを起動</button><button id="paper-capture" class="primary" disabled>処方箋を撮影</button></div><label class="field">処方箋の写真<input id="paper-file" type="file" accept="image/*" capture="environment"></label><button id="paper-text" class="text-button full">処方欄のテキストを貼り付ける</button>`,
  );
  const epoch = ctx.epoch();
  let camera: Camera;
  ctx.bind("paper-camera", async () => {
    camera = new Camera($<HTMLVideoElement>("#paper-video"));
    ctx.setCamera(camera);
    await camera.start();
    if (ctx.epoch() === epoch)
      $<HTMLButtonElement>("#paper-capture").disabled = false;
  });
  ctx.bind("paper-capture", () => {
    const image = camera.capture();
    camera.stop();
    correctPaper(ctx, image);
  });
  $<HTMLInputElement>("#paper-file").onchange = () => {
    void (async () => {
      const f = $<HTMLInputElement>("#paper-file").files?.[0];
      if (!f) return;
      const image = await imageCanvas(f);
      if (ctx.epoch() === epoch) correctPaper(ctx, image);
    })().catch(ctx.error);
  };
  ctx.bind("paper-text", () => paperText(ctx, ""));
}
function correctPaper(ctx: Context, source: HTMLCanvasElement) {
  ctx.dialog(
    "処方欄の台形・傾きを補正",
    `<p>処方欄の四隅を <strong>左上 → 右上 → 右下 → 左下</strong> の順にタップしてください。</p><canvas id="paper-corners" style="width:100%;touch-action:none" aria-label="処方欄の四隅を指定"></canvas><p id="corner-progress">0 / 4点</p><button id="corner-reset">四隅を選び直す</button><button id="corner-full">画像全体を使う</button><label class="field">追加の回転角度<input type="number" id="paper-angle" value="0" step="0.5"></label><button id="paper-preview" class="secondary full">補正結果を確認</button><div id="rectified"></div>`,
  );
  const canvas = $<HTMLCanvasElement>("#paper-corners"),
    scale = Math.min(1, 900 / source.width);
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const points: Point[] = [];
  const draw = () => {
    const c = canvas.getContext("2d")!;
    c.drawImage(source, 0, 0, canvas.width, canvas.height);
    c.strokeStyle = "#07874b";
    c.fillStyle = "#07874b";
    c.lineWidth = 3;
    c.font = "bold 22px sans-serif";
    points.forEach((p, i) => {
      c.beginPath();
      c.arc(p.x * scale, p.y * scale, 8, 0, Math.PI * 2);
      c.fill();
      c.fillText(String(i + 1), p.x * scale + 10, p.y * scale + 24);
    });
    if (points.length > 1) {
      c.beginPath();
      points.forEach((p, i) =>
        i
          ? c.lineTo(p.x * scale, p.y * scale)
          : c.moveTo(p.x * scale, p.y * scale),
      );
      if (points.length === 4) c.closePath();
      c.stroke();
    }
    $("#corner-progress").textContent = `${points.length} / 4点`;
    $("#rectified").innerHTML = "";
  };
  draw();
  canvas.onpointerdown = (e) => {
    if (points.length === 4) return;
    const rect = canvas.getBoundingClientRect();
    points.push({
      x: ((e.clientX - rect.left) / rect.width) * source.width,
      y: ((e.clientY - rect.top) / rect.height) * source.height,
    });
    draw();
  };
  ctx.bind("corner-reset", () => {
    points.length = 0;
    draw();
  });
  ctx.bind("corner-full", () => {
    points.splice(
      0,
      points.length,
      { x: 0, y: 0 },
      { x: source.width - 1, y: 0 },
      { x: source.width - 1, y: source.height - 1 },
      { x: 0, y: source.height - 1 },
    );
    draw();
  });
  $("#paper-angle").oninput = () => ($("#rectified").innerHTML = "");
  ctx.bind("paper-preview", () => {
    if (points.length !== 4) throw new Error("四隅を指定してください。");
    const angle = Number($<HTMLInputElement>("#paper-angle").value);
    if (!Number.isFinite(angle))
      throw new Error("回転角度を入力してください。");
    const corrected = rectify(source, points, angle);
    $("#rectified").innerHTML =
      `<img class="preview-image" src="${corrected.toDataURL("image/png")}" alt="補正後の処方欄"><button id="run-paper-ocr" class="primary full">この画像をOCRする</button>`;
    ctx.bind("run-paper-ocr", async () => {
      const epoch = ctx.dialog(
        "処方欄を認識中",
        '<p id="paper-progress" role="status">日本語OCRを準備中…</p><p>画像は送信されません。</p>',
      );
      const result = await recognizePaper(corrected, (s) => {
        if (ctx.epoch() === epoch) $("#paper-progress").textContent = s;
      });
      if (ctx.epoch() === epoch) paperText(ctx, result.text, result.confidence);
    });
  });
}
function paperText(ctx: Context, text: string, confidence?: number) {
  ctx.dialog(
    "OCR原文を確認",
    `<div class="notice warn">自動確定はしません。薬剤名・数値・単位を原本と見比べてください。</div><p>${confidence === undefined ? "" : `OCR信頼度 ${confidence.toFixed(0)}%（正答率ではありません）`}</p><label class="field">薬剤部分だけを残し、1剤ずつ空行で区切ってください<textarea id="paper-raw" style="min-height:260px">${esc(text)}</textarea></label><p class="muted">患者氏名・住所などは削除してください。次の画面では薬品マスターから人が薬剤を選びます。</p><button id="paper-parse" class="primary full">薬剤と数量の確認へ</button>`,
  );
  ctx.bind("paper-parse", () =>
    reviewDrafts(
      ctx,
      parsePaperText($<HTMLTextAreaElement>("#paper-raw").value),
    ),
  );
}
