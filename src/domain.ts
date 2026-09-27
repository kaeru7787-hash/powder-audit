export type InputMethod = "OCR" | "manual";
export type Status = "pending" | "low" | "pass" | "over";
export interface Drug {
  gtin: string;
  yjCode: string;
  receiptCode: string;
  genericCode: string;
  productName: string;
  genericName: string;
  ingredient: string;
  strength: string;
  dosageForm: string;
  manufacturer: string;
  salesStatus: string;
}
export interface PrescriptionDrug {
  id: string;
  rxId: string;
  rpNumber: string;
  sourceType: string;
  prescriptionType: "brand" | "generic";
  drugCode: string;
  receiptCode: string;
  genericCode: string;
  drugName: string;
  genericName: string;
  ingredient: string;
  strength: string;
  dosageForm: string;
  quantityPerDay?: number;
  days?: number;
  expectedTotal: number;
  unit: "g";
  quantityBasis: "product";
  usage: string;
}
export interface Weight {
  id: string;
  drugId: string;
  product: Drug;
  gtin: string;
  value: number;
  method: InputMethod;
  confidence: number | null;
  timestamp: string;
  scanId: string;
  scannedAt: string;
  deleted: boolean;
  originalValue: number;
}
export interface AuditEvent {
  id: string;
  timestamp: string;
  code: string;
  drugId?: string;
  details: Record<string, unknown>;
}
export interface Block {
  code: string;
  expected: string;
  actual: string;
  drugId: string;
}
export interface Session {
  schema: 1;
  id: string;
  demo: boolean;
  startedAt: string;
  endedAt?: string;
  drugs: PrescriptionDrug[];
  weights: Weight[];
  events: AuditEvent[];
  block: Block | null;
  revision: number;
  pendingScan?: string | null;
}
export interface Permit {
  id: string;
  sessionId: string;
  drugId: string;
  product: Drug;
  timestamp: string;
}
export class AuditError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
export const isPowder = (form: string) =>
  ["散剤", "細粒", "顆粒", "ドライシロップ"].includes(form);
export function positive(value: unknown): number {
  const s = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s))
    throw new AuditError(
      "WEIGHT_INVALID",
      "正の数値を入力してください（小数6桁まで）。",
    );
  const n = Number(s);
  if (!(n > 0) || !Number.isSafeInteger(Math.round(n * 1e6)))
    throw new AuditError("WEIGHT_INVALID", "正の数値を入力してください。");
  return n;
}
export function totalFor(
  value: unknown,
  meaning: string,
  days: unknown,
  times: unknown,
  unit: string,
  basis: string,
): number {
  if (unit !== "g")
    throw new AuditError(
      "UNIT_UNKNOWN",
      "監査重量はgで明示してください。不明な単位は換算しません。",
    );
  if (basis !== "product")
    throw new AuditError(
      "TOTAL_QUANTITY_AMBIGUOUS",
      "製剤量の確認が必要です。成分量からは自動換算しません。",
    );
  const q = positive(value);
  if (meaning === "total") return q;
  if (meaning === "daily") return positive((q * positive(days)).toFixed(6));
  if (meaning === "dose")
    return positive((q * positive(days) * positive(times)).toFixed(6));
  throw new AuditError(
    "TOTAL_QUANTITY_AMBIGUOUS",
    "数量が1日量・1回量・全量のどれかを確認してください。",
  );
}
export function normalizeGTIN(raw: string, demo = false): string {
  let s = raw.trim().replace(/^\][A-Za-z][0-9]/, "");
  if (demo && /^TEST[\w-]+$/.test(s)) return s;
  let gtin: string | undefined;
  if (/^\d{14}$/.test(s)) gtin = s;
  else if (/^\(01\)\d{14}(?:$|\()/.test(s)) gtin = s.slice(4, 18);
  else if (/^01\d{14}(?:$|[\x1d\d])/.test(s)) gtin = s.slice(2, 16);
  if (!gtin)
    throw new AuditError(
      "GS1_DECODE_FAILED",
      "GTINを取得できません。GS1のAI(01)または14桁GTINを確認してください。",
    );
  const sum = [...gtin.slice(0, 13)].reduce(
    (a, d, i) => a + Number(d) * (i % 2 === 0 ? 3 : 1),
    0,
  );
  if ((10 - (sum % 10)) % 10 !== Number(gtin[13]))
    throw new AuditError(
      "GS1_DECODE_FAILED",
      "GTINのチェックデジットが一致しません。",
    );
  return gtin;
}
const required: (keyof Drug)[] = [
  "gtin",
  "productName",
  "ingredient",
  "strength",
  "dosageForm",
];
const fields: (keyof Drug)[] = [
  "gtin",
  "yjCode",
  "receiptCode",
  "genericCode",
  "productName",
  "genericName",
  "ingredient",
  "strength",
  "dosageForm",
  "manufacturer",
  "salesStatus",
];
export function validateMaster(input: unknown, demo = false): Drug[] {
  if (!Array.isArray(input) || !input.length)
    throw new AuditError(
      "MASTER_INVALID",
      "医薬品マスターは空でない配列にしてください。",
    );
  const seen = new Set<string>();
  const result = input.map((record, index) => {
    if (!record || typeof record !== "object")
      throw new AuditError("MASTER_INVALID", `${index + 1}行目が不正です。`);
    const d = Object.fromEntries(
      fields.map((f) => [f, String(record[f] ?? "").trim()]),
    ) as unknown as Drug;
    if (required.some((k) => !d[k]) || (!d.yjCode && !d.receiptCode))
      throw new AuditError(
        "MASTER_INVALID",
        `${index + 1}行目：GTIN、薬品コード、商品名、成分、規格、剤形が必要です。`,
      );
    d.gtin = normalizeGTIN(d.gtin, demo);
    if (seen.has(d.gtin))
      throw new AuditError(
        "MASTER_DUPLICATE",
        `${index + 1}行目：GTINが重複しています。`,
      );
    seen.add(d.gtin);
    return d;
  });
  for (const key of ["yjCode", "receiptCode", "genericCode"] as const) {
    const definitions = new Map<string, string>();
    for (const d of result) {
      if (!d[key]) continue;
      const identity = JSON.stringify([d.ingredient, d.strength, d.dosageForm]);
      if (definitions.has(d[key]) && definitions.get(d[key]) !== identity)
        throw new AuditError(
          "MASTER_CONFLICT",
          `${key} ${d[key]} に成分・規格・剤形の矛盾があります。`,
        );
      definitions.set(d[key], identity);
    }
  }
  return result;
}
export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted)
    throw new AuditError("MASTER_INVALID", "CSVの引用符が閉じていません。");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  const headers =
    rows.shift()?.map((x) => x.replace(/^\uFEFF/, "").trim()) ?? [];
  if (new Set(headers).size !== headers.length)
    throw new AuditError("MASTER_INVALID", "CSV見出しが重複しています。");
  return rows.map((r) => {
    if (r.length !== headers.length)
      throw new AuditError("MASTER_INVALID", "CSVの列数が一致しません。");
    return Object.fromEntries(headers.map((h, i) => [h, r[i]]));
  });
}
export function matchDrug(
  rx: PrescriptionDrug,
  product: Drug,
): { ok: boolean; code: string } {
  if (
    ![
      rx.ingredient,
      rx.strength,
      rx.dosageForm,
      product.ingredient,
      product.strength,
      product.dosageForm,
    ].every(Boolean)
  )
    return { ok: false, code: "PRESCRIPTION_DRUG_NOT_FOUND" };
  if (
    rx.ingredient !== product.ingredient ||
    rx.strength !== product.strength ||
    rx.dosageForm !== product.dosageForm
  )
    return { ok: false, code: "WRONG_DRUG" };
  if (rx.prescriptionType === "generic")
    return {
      ok: !!rx.genericCode && rx.genericCode === product.genericCode,
      code:
        rx.genericCode && rx.genericCode === product.genericCode
          ? "DRUG_MATCH"
          : "GENERIC_MATCH_FAILED",
    };
  const matches = !!(
    (rx.drugCode && rx.drugCode === product.yjCode) ||
    (rx.receiptCode && rx.receiptCode === product.receiptCode)
  );
  const conflicts = !!(
    (rx.drugCode && product.yjCode && rx.drugCode !== product.yjCode) ||
    (rx.receiptCode &&
      product.receiptCode &&
      rx.receiptCode !== product.receiptCode)
  );
  return {
    ok: matches && !conflicts,
    code: matches && !conflicts ? "DRUG_MATCH" : "WRONG_DRUG",
  };
}
export function sanitizePrescription(
  input: unknown,
  rxId: string,
): PrescriptionDrug[] {
  if (!Array.isArray(input) || !input.length)
    throw new AuditError(
      "PRESCRIPTION_DRUG_NOT_FOUND",
      "薬剤情報がありません。",
    );
  return input.map((r, i) => {
    if (!r || typeof r !== "object")
      throw new AuditError(
        "PRESCRIPTION_DRUG_NOT_FOUND",
        "処方の形式が不正です。",
      );
    const requiredRx = ["drugName", "ingredient", "strength", "dosageForm"];
    if (requiredRx.some((f) => typeof r[f] !== "string" || !r[f].trim()))
      throw new AuditError(
        "PRESCRIPTION_DRUG_NOT_FOUND",
        `${i + 1}剤目：薬剤名・成分・規格・剤形を明示してください。`,
      );
    if (r.unit !== "g")
      throw new AuditError(
        "UNIT_UNKNOWN",
        `${i + 1}剤目：単位gを確認してください。`,
      );
    if (r.quantityBasis !== "product")
      throw new AuditError(
        "TOTAL_QUANTITY_AMBIGUOUS",
        `${i + 1}剤目：製剤量の確認が必要です。`,
      );
    if (r.prescriptionType !== "brand" && r.prescriptionType !== "generic")
      throw new AuditError(
        "PRESCRIPTION_DRUG_NOT_FOUND",
        "商品名処方／一般名処方を明示してください。",
      );
    if (
      (r.prescriptionType === "brand" && !r.drugCode && !r.receiptCode) ||
      (r.prescriptionType === "generic" && !r.genericCode)
    )
      throw new AuditError(
        "PRESCRIPTION_DRUG_NOT_FOUND",
        "照合用の医薬品コードが必要です。",
      );
    return {
      id: id(),
      rxId,
      rpNumber: String(r.rpNumber ?? i + 1),
      sourceType: String(r.sourceType ?? "json"),
      prescriptionType: r.prescriptionType,
      drugCode: String(r.drugCode ?? ""),
      receiptCode: String(r.receiptCode ?? ""),
      genericCode: String(r.genericCode ?? ""),
      drugName: r.drugName.trim(),
      genericName: String(r.genericName ?? ""),
      ingredient: r.ingredient.trim(),
      strength: r.strength.trim(),
      dosageForm: r.dosageForm.trim(),
      expectedTotal: positive(r.expectedTotal),
      unit: "g",
      quantityBasis: "product",
      usage: String(r.usage ?? ""),
      ...(r.quantityPerDay != null
        ? { quantityPerDay: positive(r.quantityPerDay) }
        : {}),
      ...(r.days != null ? { days: positive(r.days) } : {}),
    };
  });
}
export function newSession(input: unknown, demo: boolean): Session {
  const rxId = id();
  const drugs = sanitizePrescription(input, rxId);
  if (!drugs.some((d) => isPowder(d.dosageForm)))
    throw new AuditError(
      "PRESCRIPTION_DRUG_NOT_FOUND",
      "監査対象の散剤がありません。",
    );
  return {
    schema: 1,
    id: rxId,
    demo,
    startedAt: now(),
    drugs,
    weights: [],
    events: [],
    block: null,
    revision: 0,
  };
}
export function event(
  s: Session,
  code: string,
  details: Record<string, unknown> = {},
  drugId?: string,
) {
  s.events.push({
    id: id(),
    timestamp: now(),
    code,
    details,
    ...(drugId ? { drugId } : {}),
  });
}
export function weighState(s: Session, drug: PrescriptionDrug) {
  const records = s.weights.filter((w) => w.drugId === drug.id && !w.deleted);
  const currentMicro = records.reduce(
    (a, w) => a + BigInt(Math.round(w.value * 1e6)),
    0n,
  );
  const targetMicro = BigInt(Math.round(drug.expectedTotal * 1e6));
  const current = Number(currentMicro) / 1e6;
  const status: Status = !records.length
    ? "pending"
    : currentMicro * 10n < targetMicro * 9n
      ? "low"
      : currentMicro * 10n > targetMicro * 11n
        ? "over"
        : "pass";
  return {
    current,
    status,
    lower: drug.expectedTotal * 0.9,
    upper: drug.expectedTotal * 1.1,
    remaining: Math.max(0, drug.expectedTotal - current),
    difference: current - drug.expectedTotal,
    percent: (current / drug.expectedTotal - 1) * 100,
  };
}
export function allPassed(s: Session): boolean {
  const d = s.drugs.filter((x) => isPowder(x.dosageForm));
  return (
    !s.block &&
    d.length > 0 &&
    d.every((x) => weighState(s, x).status === "pass")
  );
}
export function scan(
  s: Session,
  drugId: string,
  raw: string,
  master: Drug[],
): Permit | null {
  s.pendingScan = null;
  if (s.endedAt || s.block)
    throw new AuditError(
      "AUDIT_LOCKED",
      "警告を確認してから、もう一度GS1を読んでください。",
    );
  const rx = s.drugs.find((d) => d.id === drugId && isPowder(d.dosageForm));
  if (!rx)
    throw new AuditError(
      "PRESCRIPTION_DRUG_NOT_FOUND",
      "対象薬剤を選択してください。",
    );
  let gtin: string;
  try {
    gtin = normalizeGTIN(raw, s.demo);
  } catch (e) {
    event(s, "GS1_DECODE_FAILED", {}, drugId);
    throw e;
  }
  const product = master.find((d) => d.gtin === gtin);
  const result = product
    ? matchDrug(rx, product)
    : { ok: false, code: "GTIN_NOT_FOUND" };
  event(
    s,
    result.code,
    { gtin, product: product?.productName ?? "マスター未登録" },
    drugId,
  );
  if (!result.ok) {
    s.block = {
      code: result.code,
      expected: `${rx.drugName} / ${rx.strength} / ${rx.dosageForm}`,
      actual: product
        ? `${product.productName} / ${product.strength} / ${product.dosageForm}`
        : `未登録GTIN：${gtin}`,
      drugId,
    };
    return null;
  }
  const scanId = id();
  s.pendingScan = scanId;
  return {
    id: scanId,
    sessionId: s.id,
    drugId,
    product: structuredClone(product!),
    timestamp: now(),
  };
}
export function acknowledge(s: Session) {
  if (!s.block) return;
  event(s, "WARNING_ACKNOWLEDGED", { code: s.block.code }, s.block.drugId);
  s.block = null;
  s.pendingScan = null;
}
export function register(
  s: Session,
  permit: Permit | null,
  value: unknown,
  method: InputMethod,
  confidence: number | null,
  confirmed: boolean,
): Weight {
  if (
    s.endedAt ||
    s.block ||
    !permit ||
    permit.sessionId !== s.id ||
    permit.id !== s.pendingScan ||
    s.weights.some((w) => w.scanId === permit.id)
  )
    throw new AuditError(
      "GS1_REQUIRED",
      "重量を登録する前に、GS1をもう一度読んでください。",
    );
  const rx = s.drugs.find((d) => d.id === permit.drugId);
  if (!rx || !matchDrug(rx, permit.product).ok)
    throw new AuditError("WRONG_DRUG", "薬剤一致を確認できません。");
  if (!confirmed)
    throw new AuditError(
      "HUMAN_CONFIRMATION_REQUIRED",
      "重量の目視確認が必要です。",
    );
  if (!["OCR", "manual"].includes(method))
    throw new AuditError("INPUT_METHOD_INVALID", "入力方法が不正です。");
  const n = positive(value);
  const w: Weight = {
    id: id(),
    drugId: rx.id,
    product: structuredClone(permit.product),
    gtin: permit.product.gtin,
    value: n,
    originalValue: n,
    method,
    confidence: method === "OCR" ? confidence : null,
    timestamp: now(),
    scanId: permit.id,
    scannedAt: permit.timestamp,
    deleted: false,
  };
  s.weights.push(w);
  s.pendingScan = null;
  event(
    s,
    "WEIGHT_REGISTERED",
    {
      weightId: w.id,
      value: n,
      method,
      confidence: w.confidence,
      gtin: w.gtin,
      judgement: "DRUG_MATCH",
    },
    rx.id,
  );
  if (weighState(s, rx).status === "over")
    event(
      s,
      "WEIGHT_OVER_LIMIT",
      { current: weighState(s, rx).current, upper: weighState(s, rx).upper },
      rx.id,
    );
  return w;
}
export function correct(
  s: Session,
  weightId: string,
  value: unknown | null,
  reason: string,
  confirmed: boolean,
) {
  if (s.endedAt || s.block)
    throw new AuditError(
      "AUDIT_LOCKED",
      "警告確認中／終了した監査は変更できません。",
    );
  if (!confirmed || !reason.trim())
    throw new AuditError(
      "HUMAN_CONFIRMATION_REQUIRED",
      "訂正理由と目視確認が必要です。",
    );
  const w = s.weights.find((x) => x.id === weightId && !x.deleted);
  if (!w)
    throw new AuditError("WEIGHT_NOT_FOUND", "訂正対象の記録がありません。");
  const before = w.value;
  s.pendingScan = null;
  if (value === null) w.deleted = true;
  else w.value = positive(value);
  event(
    s,
    value === null ? "WEIGHT_DELETED" : "WEIGHT_CORRECTED",
    {
      weightId,
      before,
      after: value === null ? null : w.value,
      reason: reason.trim(),
      method: "manual",
    },
    w.drugId,
  );
}
export function endSession(s: Session) {
  if (!allPassed(s))
    throw new AuditError(
      "AUDIT_INCOMPLETE",
      "対象散剤がすべて合格になるまで終了できません。",
    );
  s.endedAt = now();
  event(s, "AUDIT_ENDED");
}
export function parseWeightOCR(text: string): {
  value: number | null;
  code: string | null;
} {
  // Do not remove minus signs, guess decimal placement, infer units, or merge multiple readings.
  const cleaned = text.trim();
  const m = cleaned.match(/^([0-9]+(?:\.[0-9]{1,6})?)\s*g$/i);
  if (!m)
    return {
      value: null,
      code: cleaned.includes(",")
        ? "OCR_DECIMAL_AMBIGUOUS"
        : /[a-z]/i.test(cleaned)
          ? "OCR_UNCERTAIN"
          : "UNIT_UNKNOWN",
    };
  try {
    return { value: positive(m[1]), code: null };
  } catch {
    return { value: null, code: "WEIGHT_INVALID" };
  }
}
