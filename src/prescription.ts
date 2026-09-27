import { AuditError, type Drug } from "./domain";
export interface DraftDrug {
  rp: string;
  sequence: string;
  name: string;
  code: string;
  codeType: string;
  quantity: string;
  unit: string;
  days: string;
  times: string;
  meaning: string;
  basis: string;
  usage: string;
  notes: string[];
  sourceType: string;
}
// Drug records only are returned. Patient/provider records are discarded at this boundary.
export function parseJahis(raw: string, sourceType = "jahis"): DraftDrug[] {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .replace(/\x1a$/, "")
    .trim()
    .split(/\r?\n/);
  const version = lines
    .shift()
    ?.trim()
    .match(/^JAHIS(\d+)$/);
  if (!version || Number(version[1]) < 2 || Number(version[1]) > 11)
    throw new AuditError(
      "QR_FORMAT_UNSUPPORTED",
      "対応するJAHIS2～11の処方データではありません。引換番号だけのコードからは処方を取得できません。",
    );
  const records = lines.filter(Boolean).map((l) => l.split(","));
  if (records.some((r) => r[0].startsWith("JAHIS")))
    throw new AuditError(
      "MULTIPLE_PRESCRIPTIONS",
      "複数処方をまとめて解析できません。1処方ずつ読み込んでください。",
    );
  const groups = new Map<string, string[]>(),
    usages = new Map<string, string[]>(),
    splits = new Map<string, string[]>();
  for (const r of records) {
    if (["101", "111", "102"].includes(r[0])) {
      const map = r[0] === "101" ? groups : r[0] === "111" ? usages : splits;
      if (map.has(r[1]))
        throw new AuditError(
          "DUPLICATE_RECORD",
          "同じRpのレコードが重複しています。QRの重複・不足を確認してください。",
        );
      map.set(r[1], r);
    }
  }
  const keys = new Set<string>(),
    hasSplit = records.some((r) => r[0] === "63");
  const result = records
    .filter((r) => r[0] === "201")
    .map((r) => {
      if (r.length < 10 || !r[1] || !r[2])
        throw new AuditError(
          "QR_INCOMPLETE",
          "薬品レコードが途中で切れています。分割QRをすべて読み込んでください。",
        );
      const key = r[1] + ":" + r[2];
      if (keys.has(key))
        throw new AuditError(
          "DUPLICATE_RECORD",
          "薬品レコードが重複しています。",
        );
      keys.add(key);
      const g = groups.get(r[1]),
        u = usages.get(r[1]),
        split = splits.get(r[1]);
      if (!g || g.length < 5 || !u)
        throw new AuditError(
          "QR_INCOMPLETE",
          "Rpの剤形・用法情報が不足しています。残りのQRを読み込んでください。",
        );
      const notes: string[] = [];
      if (split || hasSplit)
        notes.push("分割処方：今回分の数量を原本と確認してください。");
      if (
        records.some(
          (x) => ["181", "211", "221", "281"].includes(x[0]) && x[1] === r[1],
        )
      )
        notes.push(
          "用法・単位・薬品の補足指示があります。原本の全指示を確認してください。",
        );
      if (r[8] !== "1")
        notes.push(
          "成分量・力価または数量基準不明。製剤総量を確認してください。",
        );
      if (!["2", "4", "7"].includes(r[4]))
        notes.push(
          "コードなし／未対応コード体系。マスターを人が選択してください。",
        );
      if (g[2] === "2") notes.push("頓服：回数と総量を確認してください。");
      const simple = g[2] === "1" && !notes.length;
      return {
        rp: r[1],
        sequence: r[2],
        name: r[6],
        code: r[5],
        codeType: r[4],
        quantity: r[7],
        unit: r[9].normalize("NFKC"),
        days: split?.[2] ?? g[4],
        times: u[5] ?? "",
        meaning: simple ? "daily" : "",
        basis: r[8] === "1" ? "product" : "ingredient",
        usage: u[4] ?? "",
        notes,
        sourceType,
      };
    });
  if (!result.length)
    throw new AuditError(
      "PRESCRIPTION_DRUG_NOT_FOUND",
      "薬品情報がありません。引換番号だけでは監査を開始できません。",
    );
  return result;
}
export function codeCandidates(d: DraftDrug, master: Drug[]): Drug[] {
  if (!d.code) return [];
  return master.filter((m) =>
    d.codeType === "2"
      ? m.receiptCode === d.code
      : d.codeType === "4"
        ? m.yjCode === d.code
        : d.codeType === "7"
          ? m.genericCode === d.code
          : false,
  );
}
// OCR proposals retain raw spelling and never become confirmed drug identities.
export function parsePaperText(text: string): DraftDrug[] {
  const blocks = text
    .trim()
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (!blocks.length)
    throw new AuditError(
      "OCR_EMPTY",
      "薬剤情報を読み取れません。手入力で確認してください。",
    );
  return blocks.map((block, i) => {
    const lines = block.split(/\r?\n/).map((l) => l.trim()),
      numeric = block.normalize("NFKC");
    const amount = numeric.match(
      /(?:^|\n)\s*(?:(1\s*日\s*量|1\s*回\s*量|全\s*量|総\s*量)\s*[:：]?\s*)?(\d+(?:\.\d+)?)\s*(mg|g|錠|カプセル|包)(?=\s|$)/m,
    );
    const days = numeric.match(
        /(\d+)\s*日\s*分|(?:^|\n)\s*(\d+)\s*日\s*(?:$|\n)/,
      ),
      times = numeric.match(/(?:分\s*|1日\s*)(\d+)\s*(?:回)?/);
    return {
      rp: String(i + 1),
      sequence: "1",
      name: lines.find((l) => !/^Rp[.．\s\d]/i.test(l)) ?? "",
      code: "",
      codeType: "",
      quantity: amount?.[2] ?? "",
      unit: amount?.[3] ?? "",
      days: days?.[1] ?? days?.[2] ?? "",
      times: times?.[1] ?? "",
      meaning:
        amount?.[1]?.replace(/\s/g, "") === "1日量"
          ? "daily"
          : amount?.[1]?.replace(/\s/g, "") === "1回量"
            ? "dose"
            : amount?.[1]
              ? "total"
              : "",
      basis: "",
      usage: "",
      notes: [
        "OCR原文の薬剤名は自動補正していません。原本と照合してください。",
      ],
      sourceType: "paper-ocr",
    };
  });
}
export function nameCandidates(name: string, master: Drug[]): Drug[] {
  const n = name.normalize("NFKC").replace(/\s/g, "");
  if (!n) return [];
  const score = (candidate: string) => {
    const c = candidate.normalize("NFKC").replace(/\s/g, "");
    if (c === n) return 1;
    if (c.includes(n) || n.includes(c)) return 0.9;
    const a = new Set([...n]),
      b = new Set([...c]);
    return [...a].filter((x) => b.has(x)).length / Math.max(a.size, b.size);
  };
  return master
    .map((d) => ({
      d,
      s: Math.max(score(d.productName), score(d.genericName)),
    }))
    .filter((x) => x.s >= 0.4)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.d);
}
export interface QRPart {
  bytes: Uint8Array;
  sequenceSize: number;
  sequenceIndex: number;
  sequenceId: string;
}
export class QRAssembler {
  private parts = new Map<number, Uint8Array>();
  private size = -1;
  private key = "";
  add(part: QRPart): Uint8Array | null {
    if (part.sequenceSize === -1) {
      if (this.parts.size)
        throw new AuditError(
          "QR_MIXED",
          "分割QRと別のQRが混在しています。読み取りをやり直してください。",
        );
      return part.bytes;
    }
    if (
      part.sequenceSize < 1 ||
      part.sequenceIndex < 0 ||
      part.sequenceIndex >= part.sequenceSize
    )
      throw new AuditError("QR_INCOMPLETE", "分割番号を確認できません。");
    if (
      this.parts.size &&
      (this.size !== part.sequenceSize || this.key !== part.sequenceId)
    )
      throw new AuditError("QR_MIXED", "別の組の分割QRを検出しました。");
    this.size = part.sequenceSize;
    this.key = part.sequenceId;
    const previous = this.parts.get(part.sequenceIndex);
    if (
      previous &&
      (previous.length !== part.bytes.length ||
        previous.some((v, i) => v !== part.bytes[i]))
    )
      throw new AuditError("QR_MIXED", "同じ分割番号で内容が異なります。");
    this.parts.set(part.sequenceIndex, part.bytes);
    if (this.parts.size !== this.size) return null;
    const bytes = new Uint8Array(
      [...this.parts.values()].reduce((n, p) => n + p.length, 0),
    );
    let offset = 0;
    for (let i = 0; i < this.size; i++) {
      const p = this.parts.get(i)!;
      bytes.set(p, offset);
      offset += p.length;
    }
    return bytes;
  }
  get progress() {
    return `${this.parts.size} / ${this.size < 0 ? "?" : this.size}`;
  }
}
