import "./style.css";
import {
  AuditError,
  type Permit,
  type PrescriptionDrug,
  type Session,
  type InputMethod,
  type Status,
  allPassed,
  isPowder,
  newSession,
  validateMaster,
  parseCSV,
  totalFor,
  positive,
  scan,
  register,
  acknowledge,
  correct,
  endSession,
  weighState,
  event,
} from "./domain";
import { load, save, storageKey, type Store } from "./storage";
import { Camera, decode, imageCanvas } from "./camera";
import { recognizeWeight } from "./ocr";
import { sound, unlockAudio } from "./sound";
import { openQR, openPaper } from "./prescription-ui";
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const fmt = (n: number) =>
  n.toLocaleString("ja-JP", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
    useGrouping: false,
  });
const time = (s: string) =>
  new Date(s).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const labels: Record<Status, string> = {
  pending: "未秤量",
  low: "秤量継続",
  pass: "合格",
  over: "重量超過",
};
const symbols: Record<Status, string> = {
  pending: "○",
  low: "…",
  pass: "✓",
  over: "！",
};
let store: Store,
  selected = "",
  permit: Permit | null = null,
  camera: Camera | null = null,
  dialogEpoch = 0,
  transactionBusy = false;
let offline = "初回準備中",
  notice = "",
  fatal = false;
try {
  store = load();
} catch (e) {
  store = { revision: 0, current: null, archived: [], master: [] };
  fatal = true;
  notice = (e as Error).message;
}
const app = $("#app");
const session = () => store.current!;
const drug = () => session()?.drugs.find((d) => d.id === selected);
const master = () => store.master;
const badge = (status: Status) =>
  `<span class="pill ${status}">${symbols[status]} ${labels[status]}</span>`;
function message(e: unknown) {
  notice =
    e instanceof AuditError
      ? `${e.message}（${e.code}）`
      : e instanceof Error
        ? e.message
        : String(e);
  if ($("#message")) $("#message").textContent = notice;
  if ($("#dialog-error")) $("#dialog-error").textContent = notice;
}
function invoke(fn: () => unknown) {
  return () => {
    try {
      Promise.resolve(fn()).catch(message);
    } catch (e) {
      message(e);
    }
  };
}
function bind(id: string, fn: () => unknown) {
  const el = document.getElementById(id);
  if (el) el.onclick = invoke(fn);
}
async function mutate<T>(fn: (next: Store) => T): Promise<T> {
  if (fatal) throw new Error("保存データの復旧が必要です。");
  if (transactionBusy) throw new Error("保存処理中です。");
  transactionBusy = true;
  try {
    const operation = () => {
      const next = structuredClone(store);
      const result = fn(next);
      store = save(next, store.revision);
      return result;
    };
    return navigator.locks
      ? await navigator.locks.request("pictokun-powder-audit-data", operation)
      : operation();
  } finally {
    transactionBusy = false;
  }
}
function render() {
  const s = store.current,
    drugs = s?.drugs.filter((d) => isPowder(d.dosageForm)) ?? [];
  if (!drugs.some((d) => d.id === selected)) selected = drugs[0]?.id ?? "";
  const d = drug(),
    state = s && d ? weighState(s, d) : null,
    complete = s && allPassed(s);
  app.innerHTML = `<header class="app-header"><img class="pictokun" src="./pictokun.png" alt="ピクト君"><div class="brand"><h1>散剤監査</h1><button class="guide-button" id="guide">使い方を見る ↗</button></div><span class="local">● 端末内で解析</span></header><main><div id="message" role="alert" class="notice error">${esc(notice)}</div>
 ${s ? `<div class="row between" style="margin-bottom:18px"><div><h2>本日の監査</h2><span class="muted">${new Date(s.startedAt).toLocaleDateString("ja-JP")} ・ 散剤 ${drugs.length}剤</span></div><span class="pill">処方確認済み</span></div>` : `<section class="card card-body intro"><div><h2>処方を確認して、監査をはじめる</h2><p class="muted">薬剤確認から秤量まで、1回ずつ確実に。</p></div><div class="actions"><button class="primary" id="import" ${fatal ? "disabled" : ""}>処方を取り込む</button></div></section>`}
 <ol class="steps"><li class="${!s ? "active" : ""}"><span class="step-num">1</span>処方を確認</li><li class="${s && !permit ? "active" : ""}"><span class="step-num">2</span>GS1を読む</li><li class="${permit ? "active" : ""}"><span class="step-num">3</span>重量を確認</li><li><span class="step-num">4</span>登録・合算</li></ol>
 ${complete ? `<div class="completion" role="status"><img src="./pictokun.png" alt="ピクト君・監査完了"><div><h2>✓ 全薬剤の監査が完了しました</h2><span>薬剤師による最終確認を行ってください。</span></div></div>` : ""}
 <div class="workspace"><div class="stack">${
   s && d && state
     ? `<section class="card"><div class="panel-heading"><span>Rp.${esc(d.rpNumber)} ${d.prescriptionType === "generic" ? "・一般名処方" : ""}</span>${badge(state.status)}</div><div class="card-body"><h2>${esc(d.drugName)}</h2><div class="muted">${esc(d.strength)} / ${esc(d.dosageForm)} / 製剤量</div><div class="metrics"><div><div class="metric-label">現在の合計</div><div class="large-number" id="current-total">${fmt(state.current)}<span class="unit">g</span></div></div><div><div class="metric-label">処方総量</div><div class="target-number">${fmt(d.expectedTotal)}<span class="unit">g</span></div><div class="muted">${d.quantityPerDay && d.days ? `${fmt(d.quantityPerDay)} g / 日 × ${d.days}日` : esc(d.usage || "総量を確認済み")}</div></div></div><div class="progress ${state.status}"><span style="width:${Math.min(100, (state.current / d.expectedTotal) * 100)}%"></span></div><div class="row between muted"><span>合格範囲 ${fmt(state.lower)} ～ ${fmt(state.upper)} g</span><span>±10%</span></div>
 <div class="helper"><img src="./pictokun.png" alt="ピクト君・${labels[state.status]}"><p>${state.status === "over" ? "<strong>！ 上限を超えています。</strong><br>天秤・登録値を確認してください。" : state.status === "pass" ? `<strong>✓ 合格範囲に入りました。</strong><br>差 ${state.difference >= 0 ? "+" : ""}${fmt(state.difference)} g（${state.percent >= 0 ? "+" : ""}${state.percent.toFixed(2)}%）` : `<strong>${permit ? "✓ 薬剤一致。天秤の重量を確認しましょう。" : "瓶のGS1を、秤量のたびに確認しましょう。"}</strong><br>残り目安 ${fmt(state.remaining)} g`}</p></div>
 ${permit ? `<div class="notice">✓ 薬剤一致：${esc(permit.product.productName)}<br><span class="code">${esc(permit.product.gtin)}</span></div><div class="actions" style="margin-top:14px"><button class="primary" id="camera-weight">天秤を撮影</button><button id="manual-weight">重量を手入力</button></div><button id="cancel-permit" class="text-button full">この秤量を中止（GS1からやり直す）</button>` : `<button class="primary full" id="scan" ${s.block || fatal ? "disabled" : ""}>▣ GS1を読む</button><p class="muted" style="text-align:center;margin:8px 0 0">重量の追加には毎回GS1確認が必要です</p>`}</div></section><section class="card"><div class="panel-heading"><h2>秤量履歴</h2><span class="muted">${s.weights.filter((w) => w.drugId === d.id && !w.deleted).length}回</span></div><div class="card-body">${historyHTML(s, d)}<button id="all-history" class="text-button">監査ログをすべて見る ↗</button></div></section>`
     : `<section class="card"><div class="panel-heading"><h2>本日の監査</h2><span class="pill">処方未選択</span></div><div class="empty"><img src="./pictokun.png" alt=""><h3>まずは処方内容を確認しましょう</h3><p class="muted">実物の処方箋をQR・写真・手入力から取り込んでください。</p></div></section>`
 }</div>
 <aside class="stack">${
   s
     ? `<section class="card"><div class="panel-heading"><h2>処方薬一覧</h2><span class="muted">${drugs.filter((x) => weighState(s, x).status === "pass").length} / ${drugs.length} 合格</span></div>${drugs
         .map((x) => {
           const ws = weighState(s, x);
           return `<button class="drug-item" data-drug="${x.id}" aria-pressed="${x.id === selected}" ${s.block ? "disabled" : ""}><span class="muted">Rp.${esc(x.rpNumber)}</span><span class="name">${esc(x.drugName)}</span><div class="row between"><span>${fmt(ws.current)} / ${fmt(x.expectedTotal)} g</span>${badge(ws.status)}</div></button>`;
         })
         .join(
           "",
         )}</section><button class="secondary full" id="finish" ${!complete ? "disabled" : ""}>この処方のデータを終了</button>`
     : `<section class="card card-body"><h2>1回の秤量の流れ</h2><p>① 散剤瓶のGS1を読む<br>② 天秤の表示を撮影<br>③ 数字を確認して登録</p><div class="notice">毎回GS1で薬剤を確認します。</div><p class="muted">処方総量の±10%以内で合格。<br>薬剤師の最終監査を補助するシステムです。</p></section>`
 }<section class="card card-body"><h3>データ・設定</h3><button id="master" class="full" ${s ? "disabled" : ""}>医薬品マスター ${store.master.length}件</button><button id="archive" class="text-button full">終了した監査 ${store.archived.length}件</button><button id="sounds" class="text-button full">通知音を確認する</button><p class="muted">保存先：このブラウザ<br>外部への自動送信はありません。</p></section></aside></div><footer><span>ピクト君 散剤監査 v0.2.1</span><span id="offline">${offline}</span><span>最終監査は薬剤師が行ってください。</span><a href="https://github.com/kaeru7787-hash/powder-audit" target="_blank" rel="noopener noreferrer">ソースコード（GitHub） ↗</a></footer>${import.meta.env.DEV && new URLSearchParams(location.search).has("debug") ? `<details><summary>開発用デバッグ</summary><pre>${esc(JSON.stringify({ drug: d, permit, state, session: s }, null, 2))}</pre></details>` : ""}</main><dialog id="dialog" aria-labelledby="dialog-title"></dialog><dialog id="alarm" class="alarm-dialog" aria-labelledby="alarm-title"></dialog>`;
  bind("guide", guide);
  bind("import", prescriptionInput);
  bind("master", masterInput);
  bind("archive", archives);
  bind("sounds", sounds);
  bind("scan", scanDialog);
  bind("manual-weight", () => manualWeight());
  bind("camera-weight", weightCamera);
  bind("cancel-permit", () => {
    permit = null;
    render();
  });
  bind("all-history", () => logDialog(s!));
  bind("finish", finishDialog);
  document.querySelectorAll<HTMLButtonElement>("[data-drug]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.drug!;
        permit = null;
        notice = "";
        render();
      }),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-correct]")
    .forEach((b) => (b.onclick = () => correction(b.dataset.correct!)));
  if (s?.block) alarm();
}
function historyHTML(s: Session, d: PrescriptionDrug) {
  const weights = s.weights.filter((w) => w.drugId === d.id);
  return !weights.length
    ? '<p class="muted">まだ重量は登録されていません。</p>'
    : weights
        .map(
          (w, i) =>
            `<div class="history-row ${w.deleted ? "deleted" : ""}"><div class="row between"><span><span class="muted">${i + 1}回目　${time(w.timestamp)}</span><br><span class="history-value">${w.deleted ? "<s>" : ""}${fmt(w.value)} g${w.deleted ? "</s>" : ""}</span> ${w.deleted ? '<span class="pill">削除済み</span>' : ""}</span>${!w.deleted ? `<button class="text-button" data-correct="${w.id}">訂正・削除</button>` : ""}</div><span class="muted">${w.method === "OCR" ? `OCR・信頼度 ${w.confidence?.toFixed(0) ?? "不明"}%` : "手入力"} / ${esc(w.product.productName)}${w.value !== w.originalValue ? " / 訂正あり" : ""}</span><div class="code">GTIN ${esc(w.gtin)}</div></div>`,
        )
        .join("");
}
function closeDialog() {
  dialogEpoch++;
  camera?.stop();
  camera = null;
  $<HTMLDialogElement>("#dialog")?.close();
}
function dialog(title: string, body: string) {
  closeDialog();
  const el = $<HTMLDialogElement>("#dialog");
  el.innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button id="close-dialog" aria-label="閉じる">×</button></div><div class="dialog-body"><div id="dialog-error" role="alert" class="muted"></div>${body}</div>`;
  el.oncancel = () => closeDialog();
  el.onclose = () => camera?.stop();
  el.showModal();
  bind("close-dialog", closeDialog);
  return dialogEpoch;
}
function guide() {
  dialog(
    "使い方",
    `<p>1. 処方を取り込み、薬剤・規格・総量を確認します。</p><p>2. 対象薬を選び、瓶のGS1を読みます。薬剤が一致したときだけ次に進めます。</p><p>3. 天秤の表示を枠に入れて撮影。数字と単位gを目視確認して登録します。手入力も使えます。</p><p>4. 次の秤量もGS1から。重量を累積し、処方総量の±10%以内で合格です。</p><div class="notice warn">処方箋QR（JAHIS）、電子処方箋控えの処方情報、紙処方箋OCR、JSON、手入力に対応します。引換番号だけのQRからは処方を取得しません。読取結果は原本と確認してから監査を開始します。</div><p class="muted">カメラはHTTPSで使用できます。音量・消音設定は端末側で確認してください。振動非対応の端末では画面と音で警告します。</p>`,
  );
}
function review(candidate: Session) {
  dialog(
    "処方内容を確認",
    `<div class="notice">原本と薬剤・規格・数量を照合してください。</div>${candidate.drugs.map((d) => `<div class="history-row"><h3>Rp.${esc(d.rpNumber)} ${esc(d.drugName)}</h3><p>${esc(d.ingredient)} / ${esc(d.strength)} / ${esc(d.dosageForm)}${!isPowder(d.dosageForm) ? "（監査対象外）" : ""}</p><div class="muted">${d.quantityPerDay ? `1日量 ${fmt(d.quantityPerDay)} g　` : ""}${d.days ? `${d.days}日分` : ""}</div><div class="target-number">総量 ${fmt(d.expectedTotal)} g</div><span class="muted">製剤量 / ${d.prescriptionType === "generic" ? "一般名" : "商品名"}処方</span><div class="code">${esc(d.drugCode || d.receiptCode || d.genericCode)}</div></div>`).join("")}<label class="check"><input id="rx-confirm" type="checkbox">薬剤・規格・剤形・数量の意味・製剤総量を確認しました</label><button id="start-audit" class="primary full" disabled>この内容で監査開始</button>`,
  );
  $("#rx-confirm").onchange = () => {
    $<HTMLButtonElement>("#start-audit").disabled =
      !$<HTMLInputElement>("#rx-confirm").checked;
  };
  bind("start-audit", async () => {
    if (!$<HTMLInputElement>("#rx-confirm").checked) return;
    await mutate((next) => {
      if (next.current) throw new Error("進行中の監査があります。");
      next.current = candidate;
      event(next.current, "PRESCRIPTION_CONFIRMED");
    });
    closeDialog();
    selected = "";
    permit = null;
    notice = "";
    render();
  });
}
function masterInput() {
  dialog(
    "医薬品マスター",
    `<p>GTINと薬品コードに加えて、成分・規格・剤形を照合に使います。CSV / JSON形式のマスターを読み込めます。</p><div class="notice">現在 ${store.master.length}件。内容を検証してから既存マスターを置き換えます。</div><label class="field">マスターファイル<input id="master-file" type="file" accept=".csv,.json"></label><div id="master-preview"></div><p class="muted">監査中は更新できません。TEST用GTINは実薬マスターに取り込めません。</p><a href="./data/master-template.csv" download>CSVひな形をダウンロード</a>`,
  );
  $<HTMLInputElement>("#master-file").onchange = invoke(async () => {
    const file = $<HTMLInputElement>("#master-file").files?.[0];
    if (!file) return;
    const epoch = dialogEpoch,
      text = await file.text();
    if (epoch !== dialogEpoch) return;
    const list = validateMaster(
      file.name.endsWith(".csv")
        ? parseCSV(text)
        : JSON.parse(text.replace(/^\uFEFF/, "")),
    );
    $("#master-preview").innerHTML =
      `<div class="notice">${list.length}件を検証しました。先頭：${esc(list[0].productName)}</div><button id="save-master" class="primary full">このマスターに更新</button>`;
    bind("save-master", async () => {
      await mutate((next) => {
        if (next.current) throw new Error("監査中は更新できません。");
        next.master = list;
      });
      closeDialog();
      notice = "";
      render();
    });
  });
}
function prescriptionInput() {
  dialog(
    "処方を取り込む",
    `<div class="actions"><button id="rx-qr" class="primary">処方箋・控えのQR</button><button id="rx-paper" class="secondary">紙処方箋OCR</button></div><div class="divider"></div><div class="tabs"><button id="json-mode" aria-pressed="true">JSON読込</button><button id="manual-mode" aria-pressed="false">処方を手入力</button></div><div id="rx-input"></div>`,
  );
  bind("json-mode", jsonInput);
  bind("manual-mode", manualPrescription);
  const context = () => ({
    dialog,
    bind,
    epoch: () => dialogEpoch,
    setCamera: (c: Camera) => {
      camera?.stop();
      camera = c;
    },
    master: () => store.master,
    review,
    error: message,
  });
  bind("rx-qr", () => openQR(context()));
  bind("rx-paper", () => openPaper(context()));
  jsonInput();
}
function jsonInput() {
  $("#json-mode").setAttribute("aria-pressed", "true");
  $("#manual-mode").setAttribute("aria-pressed", "false");
  $("#rx-input").innerHTML =
    `<p>共通形式の処方JSONを読み込みます。患者氏名等は保存せず、必要な薬剤情報のみを取り込みます。</p><label class="field">処方JSON<input type="file" id="rx-file" accept=".json"></label><p class="muted">各薬剤に expectedTotal（製剤総量）、unit: "g"、quantityBasis: "product" と照合コードが必要です。</p><div class="notice warn">QR・OCRは上のボタンから利用できます。取り込みには確認済みの医薬品マスターが必要です。</div>`;
  $<HTMLInputElement>("#rx-file").onchange = invoke(async () => {
    const file = $<HTMLInputElement>("#rx-file").files?.[0];
    if (!file) return;
    const epoch = dialogEpoch,
      obj = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
    if (epoch !== dialogEpoch) return;
    const candidate = newSession(Array.isArray(obj) ? obj : obj.drugs, false);
    validateRxMaster(candidate);
    review(candidate);
  });
}
function validateRxMaster(s: Session) {
  for (const d of s.drugs.filter((x) => isPowder(x.dosageForm))) {
    if (
      !store.master.some((m) =>
        d.prescriptionType === "generic"
          ? m.genericCode === d.genericCode
          : (d.drugCode && m.yjCode === d.drugCode) ||
            (d.receiptCode && m.receiptCode === d.receiptCode),
      )
    )
      throw new AuditError(
        "PRESCRIPTION_DRUG_NOT_FOUND",
        `${d.drugName}のコードがマスターにありません。先にマスターを更新してください。`,
      );
  }
}
let draftRx: unknown[] = [];
function manualPrescription() {
  draftRx = [];
  $("#json-mode").setAttribute("aria-pressed", "false");
  $("#manual-mode").setAttribute("aria-pressed", "true");
  $("#rx-input").innerHTML = store.master.length
    ? `<label class="field">処方薬を選択<select id="rx-product"><option value="">選択してください</option>${store.master.map((m, i) => `<option value="${i}">${esc(m.productName)} / ${esc(m.strength)} / ${esc(m.dosageForm)}</option>`).join("")}</select></label><label class="field">処方の種類<select id="rx-type"><option value="brand">商品名処方</option><option value="generic">一般名処方（一般名コードを確認）</option></select></label><label class="field">Rp番号<input id="rp" value="1" inputmode="numeric"></label><div class="grid2"><label class="field">処方の数量（g）<input id="rx-quantity" inputmode="decimal"></label><label class="field">数量の意味<select id="rx-meaning"><option value="">選択してください</option><option value="daily">1日量</option><option value="dose">1回量</option><option value="total">全量</option></select></label><label class="field">日数（1日量・1回量の場合）<input id="rx-days" inputmode="numeric"></label><label class="field">1日回数（1回量の場合）<input id="rx-times" inputmode="numeric"></label></div><label class="check"><input id="rx-basis" type="checkbox">この数量は製剤量です（成分量ではありません）</label><button id="add-rx" class="full">＋ この薬剤を追加</button><div id="draft-list"></div><button id="review-rx" class="primary full" disabled>処方内容の確認へ</button>`
    : '<div class="notice warn">先に医薬品マスターを読み込んでください。</div>';
  bind("add-rx", () => {
    const index = $<HTMLSelectElement>("#rx-product").value;
    if (index === "") throw new Error("処方薬を選んでください。");
    const m = store.master[Number(index)],
      meaning = $<HTMLSelectElement>("#rx-meaning").value,
      q = $<HTMLInputElement>("#rx-quantity").value,
      days = $<HTMLInputElement>("#rx-days").value,
      total = totalFor(
        q,
        meaning,
        days,
        $<HTMLInputElement>("#rx-times").value,
        "g",
        $<HTMLInputElement>("#rx-basis").checked ? "product" : "",
      ),
      generic = $<HTMLSelectElement>("#rx-type").value === "generic";
    if (generic && !m.genericCode)
      throw new Error("一般名コードがありません。");
    draftRx.push({
      rpNumber: $<HTMLInputElement>("#rp").value,
      sourceType: "manual",
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
      ...(meaning === "daily"
        ? { quantityPerDay: positive(q), days: positive(days) }
        : {}),
      usage: meaning === "total" ? "全量を確認" : "数量の意味を確認",
    });
    $("#draft-list").innerHTML =
      `<div class="notice" style="margin:15px 0">${draftRx.length}剤を追加済み。直近：${esc(m.productName)} / 総量 ${fmt(total)} g</div>`;
    $<HTMLButtonElement>("#review-rx").disabled = false;
  });
  bind("review-rx", () => review(newSession(draftRx, false)));
}
async function scanInput(raw: string) {
  permit = null;
  let result: Permit | null = null,
    scanError: unknown;
  await mutate((next) => {
    try {
      result = scan(next.current!, selected, raw, master());
    } catch (e) {
      scanError = e;
    }
  });
  if (scanError) throw scanError;
  permit = result;
  closeDialog();
  notice = "";
  render();
  sound(session().block ? "wrong" : "ok");
}
function scanDialog() {
  unlockAudio();
  dialog(
    "散剤瓶のGS1を読む",
    `<p>処方：<strong>${esc(drug()!.drugName)}</strong><br>瓶を1本だけ枠に入れてください。</p><div class="camera-wrap barcode-camera"><video id="video" playsinline muted></video><div class="roi barcode"></div><div class="camera-caption" id="camera-status">カメラを起動すると読み取りを開始します</div></div><button id="start-camera" class="primary full" style="margin-top:14px">カメラでGS1を読む</button><label class="field">GS1の写真を選択<input id="barcode-file" type="file" accept="image/*"></label><details><summary>GTINを手入力・スキャナー入力</summary><label class="field">GS1 / 14桁GTIN<input id="gs1-text" autocomplete="off" placeholder="(01)…"></label><button id="check-gs1" class="secondary full">このコードを照合</button></details>`,
  );
  bind("start-camera", async () => {
    const epoch = dialogEpoch;
    camera?.stop();
    camera = new Camera($<HTMLVideoElement>("#video"));
    await camera.start();
    if (epoch !== dialogEpoch) return;
    $("#camera-status").textContent = "GS1を読み取り中…";
    void camera.scan((raw) => {
      void scanInput(raw).catch(message);
    }, message);
  });
  bind("check-gs1", () => scanInput($<HTMLInputElement>("#gs1-text").value));
  $("#gs1-text").onkeydown = (e) => {
    if (e.key === "Enter")
      invoke(() => scanInput($<HTMLInputElement>("#gs1-text").value))();
  };
  $<HTMLInputElement>("#barcode-file").onchange = invoke(async () => {
    const file = $<HTMLInputElement>("#barcode-file").files?.[0];
    if (!file) return;
    camera?.stop();
    const epoch = dialogEpoch,
      results = await decode(file);
    if (epoch !== dialogEpoch) return;
    if (results.length !== 1)
      throw new AuditError(
        "GS1_DECODE_FAILED",
        results.length
          ? "複数のコードを検出しました。1本だけ撮影してください。"
          : "コードを読めませんでした。撮り直すか手入力してください。",
      );
    await scanInput(results[0]);
  });
}
function alarm() {
  const b = session().block!,
    el = $<HTMLDialogElement>("#alarm");
  el.innerHTML = `<div class="alarm-inner"><div class="alarm-mascot"><img src="./pictokun.png" alt="ピクト君・監査停止"><span class="alarm-symbol" aria-hidden="true">×</span></div><h2 id="alarm-title">${b.code === "GTIN_NOT_FOUND" ? "薬剤を確認できません" : "薬剤が違います"}</h2><strong>監査を停止しました</strong><div class="alarm-compare"><div><span>処方</span><br><strong>${esc(b.expected)}</strong></div><div><span>読み取った薬</span><br><strong>${esc(b.actual)}</strong></div></div><p>瓶と処方を確認し、正しい薬剤のGS1を読み直してください。</p><div class="code">${esc(b.code)}</div><label class="check"><input id="ack-check" type="checkbox">薬剤の違い・未確認の内容を確認しました</label><button id="ack" disabled>確認して戻る</button><p style="font-size:14px">この警告は監査ログに残ります。</p></div>`;
  el.oncancel = (e) => e.preventDefault();
  el.showModal();
  $("#ack-check").onchange = () => {
    $<HTMLButtonElement>("#ack").disabled =
      !$<HTMLInputElement>("#ack-check").checked;
  };
  bind("ack", async () => {
    if (!$<HTMLInputElement>("#ack-check").checked) return;
    await mutate((next) => acknowledge(next.current!));
    permit = null;
    el.close();
    render();
  });
}
function manualWeight(initial = "") {
  if (!permit)
    throw new AuditError("GS1_REQUIRED", "先にGS1を確認してください。");
  dialog(
    "重量を手入力",
    `<p>${esc(permit.product.productName)}</p><label class="field">天秤の重量（g）<input id="weight-input" inputmode="decimal" autocomplete="off" value="${esc(initial)}" placeholder="7.02"></label><p class="muted">天秤の表示単位がgであることを確認してください。負の値や0は登録できません。</p><button id="weight-review" class="primary full">入力した重量を確認</button>`,
  );
  bind("weight-review", () =>
    confirmWeight(
      positive($<HTMLInputElement>("#weight-input").value),
      "manual",
      null,
    ),
  );
}
function weightCamera() {
  if (!permit)
    throw new AuditError("GS1_REQUIRED", "先にGS1を確認してください。");
  dialog(
    "天秤の表示を撮影",
    `<p>数字と単位gを中央の枠に入れてください。枠内だけを読み取ります。</p><div class="camera-wrap"><video id="video" playsinline muted></video><div class="roi"></div><div class="camera-caption" id="camera-status">天秤の数字と単位gを枠に入れる</div></div><div class="actions" style="margin-top:14px"><button id="start-weight-camera" class="secondary">カメラを起動</button><button id="capture" class="primary" disabled>重量を撮影</button></div><label class="field">表示部分を撮影した写真を選択<input id="weight-file" type="file" accept="image/*" capture="environment"></label><p class="muted">写真選択の場合も、次の画面で表示部分だけを範囲指定します。</p><button id="manual-fallback" class="text-button full">重量を手入力</button>`,
  );
  bind("manual-fallback", () => manualWeight());
  bind("start-weight-camera", async () => {
    const epoch = dialogEpoch;
    camera?.stop();
    camera = new Camera($<HTMLVideoElement>("#video"));
    await camera.start();
    if (epoch !== dialogEpoch) return;
    $<HTMLButtonElement>("#capture").disabled = false;
  });
  bind("capture", async () => {
    const canvas = camera!.capture(true);
    camera!.stop();
    await processOCR(canvas);
  });
  $<HTMLInputElement>("#weight-file").onchange = invoke(async () => {
    const file = $<HTMLInputElement>("#weight-file").files?.[0];
    if (!file) return;
    const epoch = dialogEpoch,
      canvas = await imageCanvas(file);
    if (epoch !== dialogEpoch) return;
    cropDialog(canvas);
  });
}
function cropDialog(source: HTMLCanvasElement) {
  dialog(
    "表示部分だけを範囲指定",
    `<p>四角い枠の中に数字と単位gだけを入れてください。</p><canvas id="crop-preview" style="width:100%;max-height:350px;object-fit:contain;background:#102f49" aria-label="OCR範囲のプレビュー"></canvas><div class="grid2"><label class="field">左位置（%）<input id="crop-x" type="range" min="0" max="90" value="10"></label><label class="field">上位置（%）<input id="crop-y" type="range" min="0" max="90" value="35"></label><label class="field">幅（%）<input id="crop-w" type="range" min="5" max="100" value="80"></label><label class="field">高さ（%）<input id="crop-h" type="range" min="5" max="100" value="30"></label></div><button class="primary full" id="crop-read">この範囲を読み取る</button>`,
  );
  const bounds = () => {
    const x = Number($<HTMLInputElement>("#crop-x").value) / 100,
      y = Number($<HTMLInputElement>("#crop-y").value) / 100;
    return {
      x,
      y,
      w: Math.min(1 - x, Number($<HTMLInputElement>("#crop-w").value) / 100),
      h: Math.min(1 - y, Number($<HTMLInputElement>("#crop-h").value) / 100),
    };
  };
  const draw = () => {
    const c = $<HTMLCanvasElement>("#crop-preview"),
      ratio = Math.min(1, 1000 / source.width);
    c.width = source.width * ratio;
    c.height = source.height * ratio;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const b = bounds();
    ctx.fillStyle = "#001c3380";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(
      source,
      b.x * source.width,
      b.y * source.height,
      b.w * source.width,
      b.h * source.height,
      b.x * c.width,
      b.y * c.height,
      b.w * c.width,
      b.h * c.height,
    );
    ctx.strokeStyle = "#3df7a2";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      b.x * c.width,
      b.y * c.height,
      b.w * c.width,
      b.h * c.height,
    );
  };
  ["x", "y", "w", "h"].forEach((k) => ($("#crop-" + k).oninput = draw));
  draw();
  bind("crop-read", () => {
    const b = bounds(),
      c = document.createElement("canvas");
    c.width = Math.round(b.w * source.width);
    c.height = Math.round(b.h * source.height);
    c.getContext("2d")!.drawImage(
      source,
      b.x * source.width,
      b.y * source.height,
      b.w * source.width,
      b.h * source.height,
      0,
      0,
      c.width,
      c.height,
    );
    return processOCR(c);
  });
}
async function processOCR(canvas: HTMLCanvasElement) {
  const image = canvas.toDataURL("image/png"),
    epoch = dialog(
      "重量を読み取り中",
      `<img class="preview-image" src="${image}" alt="OCR対象範囲"><p id="ocr-progress" role="status">端末内のOCRを準備中…</p><p class="muted">画像は送信・保存されません。</p>`,
    );
  try {
    const result = await recognizeWeight(canvas, (m) => {
      if (epoch === dialogEpoch) $("#ocr-progress").textContent = m;
    });
    if (epoch !== dialogEpoch || !permit) return;
    if (result.code)
      await mutate((next) =>
        event(
          next.current!,
          result.code!,
          { confidence: result.confidence, agreement: result.agreement },
          selected,
        ),
      );
    if (result.value === null) {
      dialog(
        "重量を確定できません",
        `<img class="preview-image" src="${image}" alt="OCR対象範囲"><div class="notice warn">⚠ 読み取りに自信がありません。単位・小数点・数値を目視確認してください。</div><p>認識候補：${result.raw.map(esc).join(" / ")}</p><p class="muted">${esc(result.code)} / 信頼度 ${result.confidence.toFixed(0)}%</p><div class="actions"><button id="retake">撮り直し</button><button id="ocr-manual" class="primary">手入力</button></div>`,
      );
      bind("retake", weightCamera);
      bind("ocr-manual", () => manualWeight());
    } else
      confirmWeight(result.value, "OCR", result.confidence, image, result.low);
  } catch (e) {
    if (epoch !== dialogEpoch) return;
    message(e);
    $("#ocr-progress").textContent =
      "OCRを利用できません。撮り直すか手入力してください。";
    const b = document.createElement("button");
    b.textContent = "手入力に切り替え";
    b.className = "primary full";
    b.onclick = () => manualWeight();
    $("#ocr-progress").after(b);
  }
}
function confirmWeight(
  value: number,
  method: InputMethod,
  confidence: number | null,
  image = "",
  low = false,
) {
  if (!permit)
    throw new AuditError("GS1_REQUIRED", "先にGS1を確認してください。");
  const d = drug()!,
    current = weighState(session(), d).current,
    unusual =
      value > d.expectedTotal * 1.1 || current + value > d.expectedTotal * 1.1;
  dialog(
    "重量を目視確認",
    `${image ? `<img class="preview-image" src="${image}" alt="読み取った天秤の表示">` : ""}<p>${esc(permit.product.productName)}<br><span class="muted">入力方法：${method === "OCR" ? `OCR（信頼度 ${confidence?.toFixed(0)}%）` : "手入力"}</span></p>${low ? '<div class="notice warn">⚠ 読み取りに自信がありません。天秤と数値を再確認してください。</div>' : ""}<div class="weight-confirm"><div class="large-number">${fmt(value)}<span class="unit">g</span></div><span>この重量を登録しますか？</span></div>${unusual ? `<div class="notice warn">⚠ 処方量から外れています。小数点・単位を再確認してください。<br>処方 ${fmt(d.expectedTotal)} g / 登録後 ${fmt(current + value)} g / 上限 ${fmt(d.expectedTotal * 1.1)} g</div>` : ""}<label class="check"><input id="weight-confirm" type="checkbox">天秤の数値・小数点・単位gを確認しました${unusual ? "。超過することも確認しました" : ""}</label><button class="primary full" id="register" disabled>✓ 登録</button><div class="actions" style="margin-top:12px"><button id="retake">撮り直し</button><button id="edit-value">手入力</button></div>`,
  );
  $("#weight-confirm").onchange = () => {
    $<HTMLButtonElement>("#register").disabled =
      !$<HTMLInputElement>("#weight-confirm").checked;
  };
  bind("retake", weightCamera);
  bind("edit-value", () => manualWeight(String(value)));
  const token = permit;
  bind("register", async () => {
    if (!$<HTMLInputElement>("#weight-confirm").checked) return;
    $<HTMLButtonElement>("#register").disabled = true;
    try {
      await mutate((next) =>
        register(next.current!, token, value, method, confidence, true),
      );
      permit = null;
      closeDialog();
      notice = "";
      render();
      sound(weighState(session(), drug()!).status === "over" ? "over" : "ok");
    } catch (e) {
      permit = null;
      closeDialog();
      render();
      throw e;
    }
  });
}
function correction(weightId: string) {
  permit = null;
  render();
  const w = session().weights.find((x) => x.id === weightId)!;
  dialog(
    "秤量記録の訂正・削除",
    `<p>${esc(w.product.productName)} / ${time(w.timestamp)}<br>元の登録 ${fmt(w.originalValue)} g / 現在 ${fmt(w.value)} g</p><label class="field">訂正後の重量（g）<input id="correction-value" inputmode="decimal" value="${w.value}"></label><label class="field">訂正・削除の理由<input id="correction-reason" placeholder="例：小数点の入力誤り"></label><label class="check"><input id="correction-confirm" type="checkbox">天秤・記録と訂正内容を確認しました</label><div class="actions"><button id="save-correction" class="primary">訂正を確認</button><button id="delete-weight" class="danger">削除を確認</button></div><p class="muted">元の数値と変更内容は監査ログに残ります。</p>`,
  );
  const preview = (deleting: boolean) => {
    if (!$<HTMLInputElement>("#correction-confirm").checked)
      throw new Error("訂正内容の確認が必要です。");
    const reason = $<HTMLInputElement>("#correction-reason").value;
    if (!reason.trim()) throw new Error("理由を入力してください。");
    const value = deleting
      ? null
      : positive($<HTMLInputElement>("#correction-value").value);
    dialog(
      "変更を確定しますか？",
      `<p>${esc(w.product.productName)}</p><div class="target-number">${fmt(w.value)} g → ${value === null ? "削除済み" : fmt(value) + " g"}</div><p>理由：${esc(reason)}</p><button id="commit-correction" class="${deleting ? "danger" : "primary"} full">${deleting ? "削除を確定" : "訂正を確定"}</button>`,
    );
    bind("commit-correction", async () => {
      await mutate((next) =>
        correct(next.current!, weightId, value, reason, true),
      );
      closeDialog();
      notice = "";
      render();
      sound(weighState(session(), drug()!).status === "over" ? "over" : "ok");
    });
  };
  bind("save-correction", () => preview(false));
  bind("delete-weight", () => preview(true));
}
function logDialog(s: Session) {
  dialog(
    "監査ログ",
    `<p>${new Date(s.startedAt).toLocaleString("ja-JP")} ${s.demo ? " / TEST" : ""}</p><button id="export-log" class="secondary full">監査データをJSONで保存</button>${
      [...s.events]
        .reverse()
        .map(
          (e) =>
            `<div class="history-row"><span class="muted">${time(e.timestamp)}</span><strong class="code" style="display:block">${esc(e.code)}</strong><pre>${esc(JSON.stringify(e.details, null, 2))}</pre></div>`,
        )
        .join("") || "<p>記録はありません。</p>"
    }`,
  );
  bind("export-log", () => download(`audit-${s.id}.json`, s));
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function archives() {
  dialog(
    "終了した監査",
    `${store.archived.length ? store.archived.map((s, i) => `<div class="history-row row between"><div>${new Date(s.startedAt).toLocaleString("ja-JP")}<br><span class="muted">${s.demo ? "TEST / " : ""}${s.drugs.filter((d) => isPowder(d.dosageForm)).length}剤</span></div><button data-archive="${i}">履歴を見る</button></div>`).join("") : "<p>終了した監査はありません。</p>"}`,
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-archive]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          logDialog(store.archived[Number(b.dataset.archive)])),
    );
}
function finishDialog() {
  dialog(
    "この監査データを終了しますか？",
    '<p>全薬剤が合格です。データはこの端末の履歴に保存され、次の処方へ進みます。</p><button id="confirm-end" class="primary full">確認して終了</button>',
  );
  bind("confirm-end", async () => {
    await mutate((next) => {
      endSession(next.current!);
      next.archived.push(next.current!);
      next.current = null;
    });
    permit = null;
    closeDialog();
    notice = "";
    render();
    sound("ok");
  });
}
function sounds() {
  dialog(
    "通知音を確認する",
    '<p>端末の音量・消音設定を確認してください。アプリから最大音量を強制変更することはありません。</p><div class="stack"><button id="sound-ok" class="primary full">正常音を試す</button><button id="sound-over" class="full">重量超過音を試す</button><button id="sound-wrong" class="danger full">薬剤違い警告音を試す</button></div><p class="muted">iPhone等で振動非対応の場合は、画面と警告音で通知します。</p>',
  );
  bind("sound-ok", () => sound("ok"));
  bind("sound-over", () => sound("over"));
  bind("sound-wrong", () => sound("wrong"));
}
window.addEventListener("storage", (e) => {
  if (e.key !== storageKey) return;
  permit = null;
  closeDialog();
  try {
    store = load();
    notice = "別の画面で更新されました。GS1からやり直してください。";
    render();
  } catch (err) {
    fatal = true;
    message(err);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) camera?.stop();
});
window.addEventListener("pagehide", () => camera?.stop());
render();
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register("./sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      offline = "オフライン対応";
      $("#offline").textContent = offline;
    })
    .catch(() => {
      offline = "オフライン準備に失敗";
      $("#offline").textContent = offline;
    });
} else {
  offline = "開発プレビュー";
  $("#offline").textContent = offline;
}
