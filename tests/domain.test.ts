import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  newSession,
  scan,
  register,
  weighState,
  allPassed,
  acknowledge,
  correct,
  endSession,
  normalizeGTIN,
  validateMaster,
  matchDrug,
  parseWeightOCR,
  totalFor,
  parseCSV,
  AuditError,
  type Session,
} from "../src/domain";
const master = validateMaster(
  JSON.parse(
    readFileSync(
      new URL("./fixtures/demo-master.json", import.meta.url),
      "utf8",
    ),
  ),
  true,
);
const input = JSON.parse(
  readFileSync(
    new URL("./fixtures/demo-prescription.json", import.meta.url),
    "utf8",
  ),
);
const fresh = () => newSession(input, true);
test("同じ医薬品コードの成分・規格・剤形矛盾を拒否", () => {
  for (const field of ["yjCode", "receiptCode", "genericCode"] as const) {
    const bad = structuredClone(master);
    bad[1][field] = bad[0][field];
    assert.throws(
      () => validateMaster(bad, true),
      (e: unknown) => e instanceof AuditError && e.code === "MASTER_CONFLICT",
    );
  }
});
function add(s: Session, n: number) {
  const p = scan(s, s.drugs[0].id, "TEST000001", master);
  return register(s, p, n, "manual", null, true);
}
for (const [name, values, sum, status] of [
  ["10 + 10", [10, 10], 20, "pass"],
  ["5.02 + 5.01 + 9.98", [5.02, 5.01, 9.98], 20.01, "pass"],
  ["不足", [12], 12, "low"],
  ["許容下限", [18], 18, "pass"],
  ["許容上限", [22], 22, "pass"],
  ["上限超過", [22.01], 22.01, "over"],
  ["完成条件 7 + 13.02", [7, 13.02], 20.02, "pass"],
] as const)
  test(name, () => {
    const s = fresh();
    for (const v of values) add(s, v);
    assert.equal(weighState(s, s.drugs[0]).current, sum);
    assert.equal(weighState(s, s.drugs[0]).status, status);
  });
test("未秤量は合格しない", () => {
  const s = fresh();
  assert.equal(weighState(s, s.drugs[0]).status, "pending");
  assert.equal(allPassed(s), false);
});
test("薬剤違いは監査停止、確認後も再GS1が必要", () => {
  const s = fresh(),
    old = scan(s, s.drugs[0].id, "TEST000001", master);
  assert.equal(scan(s, s.drugs[0].id, "TEST000002", master), null);
  assert.equal(s.block?.code, "WRONG_DRUG");
  assert.throws(() => register(s, old, 1, "manual", null, true));
  acknowledge(s);
  assert.throws(() => register(s, old, 1, "manual", null, true));
  assert.ok(s.events.some((e) => e.code === "WRONG_DRUG"));
  add(s, 20);
  assert.equal(allPassed(s), true);
});
test("同一成分でも規格違いを拒否", () => {
  const s = fresh();
  scan(s, s.drugs[0].id, "TEST000003", master);
  assert.equal(s.block?.code, "WRONG_DRUG");
});
test("一般名はコード・成分・規格・剤形が一致する別商品に適合", () => {
  const s = fresh();
  s.drugs[0].prescriptionType = "generic";
  const p = scan(s, s.drugs[0].id, "TEST000004", master);
  assert.ok(p);
  register(s, p, 20, "manual", null, true);
  assert.ok(allPassed(s));
});
test("一般名コード不明・相違を合格にしない", () => {
  const s = fresh();
  s.drugs[0].prescriptionType = "generic";
  s.drugs[0].genericCode = "";
  assert.equal(matchDrug(s.drugs[0], master[0]).ok, false);
  s.drugs[0].genericCode = "OTHER";
  assert.equal(matchDrug(s.drugs[0], master[0]).ok, false);
});
test("商品名が同じでもコード違いは拒否", () => {
  const s = fresh();
  const m = { ...master[1], productName: s.drugs[0].drugName };
  assert.equal(matchDrug(s.drugs[0], m).ok, false);
});
test("1回のGS1で2回登録できない（削除後も不可）", () => {
  const s = fresh(),
    p = scan(s, s.drugs[0].id, "TEST000001", master),
    w = register(s, p, 7, "manual", null, true);
  assert.throws(() => register(s, p, 13, "manual", null, true));
  correct(s, w.id, null, "重複", true);
  assert.throws(() => register(s, p, 13, "manual", null, true));
});
test("新しいスキャンは以前の許可を無効にする", () => {
  const s = fresh(),
    p = scan(s, s.drugs[0].id, "TEST000001", master);
  scan(s, s.drugs[0].id, "TEST000001", master);
  assert.throws(() => register(s, p, 1, "manual", null, true));
});
test("GS1なし、無確認、負数、0、NaNを登録しない", () => {
  const s = fresh();
  assert.throws(() => register(s, null, 7, "manual", null, true));
  const p = scan(s, s.drugs[0].id, "TEST000001", master);
  assert.throws(() => register(s, p, 7, "OCR", 99, false));
  for (const n of [-7, 0, NaN, Infinity])
    assert.throws(() => register(s, p, n, "manual", null, true));
  assert.equal(s.weights.length, 0);
});
test("小数点誤認702は自動登録されず、確認した場合に超過", () => {
  assert.equal(parseWeightOCR("702 g").value, 702);
  const s = fresh(),
    p = scan(s, s.drugs[0].id, "TEST000001", master);
  assert.throws(() => register(s, p, 702, "OCR", 95, false));
  register(s, p, 702, "OCR", 95, true);
  assert.equal(weighState(s, s.drugs[0]).status, "over");
  assert.ok(s.events.some((e) => e.code === "WEIGHT_OVER_LIMIT"));
});
test("OCRで単位を推測せず、mg・kg・カンマ・負号・複数候補を拒否", () => {
  assert.equal(parseWeightOCR("7.02 g").value, 7.02);
  for (const text of [
    "7.02",
    "7.02 mg",
    "7.02 kg",
    "7,02g",
    "-7.02g",
    "7.02 g 7.03 g",
    "0 g",
  ])
    assert.equal(parseWeightOCR(text).value, null, text);
});
test("数量の意味と製剤量・単位が不明なら総量を算出しない", () => {
  assert.equal(totalFor("1.5", "daily", 14, undefined, "g", "product"), 21);
  assert.equal(totalFor("1.5", "total", 14, undefined, "g", "product"), 1.5);
  assert.equal(totalFor("0.5", "dose", 14, 3, "g", "product"), 21);
  for (const args of [
    ["1.5", "", 14, 3, "g", "product"],
    ["1.5", "daily", 14, 3, "mg", "product"],
    ["1.5", "daily", 14, 3, "g", "ingredient"],
  ] as const)
    assert.throws(() =>
      totalFor(args[0], args[1], args[2], args[3], args[4], args[5]),
    );
});
test("訂正・削除で合計と完了を再計算、元記録を保存", () => {
  const s = fresh(),
    w = add(s, 20);
  assert.ok(allPassed(s));
  correct(s, w.id, 12, "入力訂正", true);
  assert.equal(weighState(s, s.drugs[0]).status, "low");
  assert.equal(w.originalValue, 20);
  assert.equal(allPassed(s), false);
  correct(s, w.id, null, "再秤量", true);
  assert.equal(s.weights.length, 1);
  assert.ok(w.deleted);
  assert.equal(weighState(s, s.drugs[0]).current, 0);
  assert.equal(s.events.filter((e) => e.code.startsWith("WEIGHT_C")).length, 1);
});
test("全薬剤合格まで終了できない、終了後に登録不可", () => {
  const s = newSession([input[0], input[0]], true);
  add(s, 20);
  assert.throws(() => endSession(s));
  const p = scan(s, s.drugs[1].id, "TEST000001", master);
  register(s, p, 20, "manual", null, true);
  endSession(s);
  assert.ok(s.endedAt);
  assert.throws(() => scan(s, s.drugs[0].id, "TEST000001", master));
});
test("患者氏名・生年月日・元QRは永続データに取り込まない", () => {
  const s = newSession(
    [
      {
        ...input[0],
        patientName: "PRIVATE",
        birthday: "PRIVATE",
        rawQR: "PRIVATE",
      },
    ],
    true,
  );
  assert.equal(JSON.stringify(s).includes("PRIVATE"), false);
});
test("TESTは実薬モードで拒否、未知コードで停止", () => {
  assert.throws(() => normalizeGTIN("TEST000001"));
  const s = fresh();
  scan(s, s.drugs[0].id, "TEST999999", master);
  assert.equal(s.block?.code, "GTIN_NOT_FOUND");
});
test("GTINチェックデジットとAI01、シンボル識別子", () => {
  const body = "0000000000000";
  assert.equal(normalizeGTIN(body + "0"), body + "0");
  assert.equal(normalizeGTIN("]C101" + body + "0" + "17270101"), body + "0");
  assert.equal(normalizeGTIN("(01)" + body + "0" + "(17)270101"), body + "0");
  assert.throws(() => normalizeGTIN(body + "1"));
  assert.throws(() => normalizeGTIN("123"));
});
test("CSV引用符・カンマ・改行と重複マスター検査", () => {
  assert.equal(parseCSV('a,b\n"one,two","a""b"\n')[0].a, "one,two");
  assert.equal(parseCSV('a,b\n"one,two","a""b"\n')[0].b, 'a"b');
  assert.throws(() => validateMaster([...master, master[0]], true));
  assert.throws(() => parseCSV('a,b\n"unfinished'));
});
test("小さな処方量の境界も整数で判定", () => {
  const s = newSession([{ ...input[0], expectedTotal: 0.03 }], true);
  add(s, 0.033);
  assert.equal(weighState(s, s.drugs[0]).status, "pass");
  add(s, 0.000001);
  assert.equal(weighState(s, s.drugs[0]).status, "over");
});
test("同じコードでも欠損情報は合格にしない", () => {
  const s = fresh();
  s.drugs[0].strength = "";
  assert.equal(matchDrug(s.drugs[0], master[0]).ok, false);
});
