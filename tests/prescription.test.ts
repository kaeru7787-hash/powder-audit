import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseJahis,
  parsePaperText,
  codeCandidates,
  QRAssembler,
} from "../src/prescription";
import { homography, project } from "../src/paper";
import { validateMaster } from "../src/domain";
const example = readFileSync(
  new URL("../public/data/demo-jahis.txt", import.meta.url),
  "utf8",
);
const master = validateMaster(
  JSON.parse(
    readFileSync(
      new URL("../public/data/demo-master.json", import.meta.url),
      "utf8",
    ),
  ),
  true,
);
test("JAHIS11からコード・日量・日数を取得し、総量は未確定", () => {
  const [d] = parseJahis(example);
  assert.equal(d.code, "TEST-YJ-001");
  assert.equal(d.quantity, "2");
  assert.equal(d.days, "10");
  assert.equal(d.meaning, "daily");
  assert.equal(d.basis, "product");
  assert.equal(codeCandidates(d, master)[0], master[0]);
  assert.equal("expectedTotal" in d, false);
});
test("JAHIS一般名コードを具体的商品の候補に対応", () => {
  const [d] = parseJahis(example.replace("4,TEST-YJ-001", "7,TEST-GEN-A"));
  assert.equal(d.codeType, "7");
  assert.equal(codeCandidates(d, master).length, 2);
});
test("JAHIS成分量を製剤量と解釈しない", () => {
  const [d] = parseJahis(example.replace(",2,1,g", ",2,2,g"));
  assert.equal(d.basis, "ingredient");
  assert.equal(d.meaning, "");
});
test("分割指示は今回量を取り出して自動計算を保留", () => {
  const [d] = parseJahis(
    example.replace("101,1,1,,10", "101,1,1,,30\n102,1,10,30"),
  );
  assert.equal(d.days, "10");
  assert.equal(d.meaning, "");
  assert.ok(d.notes.length);
});
test("頓服と単位変換を単純な日量計算にしない", () => {
  const [d] = parseJahis(example.replace("101,1,1", "101,1,2"));
  assert.equal(d.meaning, "");
  const [conversion] = parseJahis(example + "\n211,1,1,0.5");
  assert.equal(conversion.meaning, "");
});
test("不完全QR・薬品重複・未知バージョンを拒否", () => {
  assert.throws(() => parseJahis(example.replace("111,1,1,,テスト用法,2", "")));
  assert.throws(() =>
    parseJahis(example + "\n201,1,1,1,4,TEST-YJ-001,テスト散剤A,2,1,g"),
  );
  assert.throws(() => parseJahis(example.replace("JAHIS11", "JAHIS99")));
});
test("引換番号だけから処方を推測しない", () => {
  assert.throws(() => parseJahis("JAHIS11\n82,1,1234567890123456"));
  assert.throws(() => parseJahis("https://example.invalid/1234"));
});
test("患者氏名のレコードを解析結果に返さない", () => {
  const result = parseJahis(
    example.replace(
      "JAHIS11",
      "JAHIS11\n11,1,PRIVATE-PATIENT\n12,PRIVATE-BIRTHDAY",
    ),
  );
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});
test("分割QRはすべてそろってから、順番どおり連結", () => {
  const a = new QRAssembler();
  assert.equal(
    a.add({
      bytes: new Uint8Array([3, 4]),
      sequenceIndex: 1,
      sequenceSize: 2,
      sequenceId: "same",
    }),
    null,
  );
  const done = a.add({
    bytes: new Uint8Array([1, 2]),
    sequenceIndex: 0,
    sequenceSize: 2,
    sequenceId: "same",
  });
  assert.deepEqual([...done!], [1, 2, 3, 4]);
});
test("分割QRの重複は増殖せず、別処方・矛盾内容は拒否", () => {
  const a = new QRAssembler(),
    part = {
      bytes: new Uint8Array([1]),
      sequenceIndex: 0,
      sequenceSize: 2,
      sequenceId: "same",
    };
  a.add(part);
  a.add(part);
  assert.equal(a.progress, "1 / 2");
  assert.throws(() => a.add({ ...part, sequenceId: "other" }));
  assert.throws(() => a.add({ ...part, bytes: new Uint8Array([2]) }));
});
test("OCRの数量意味がなければ1日量と推測しない", () => {
  const [d] = parsePaperText("酸化マグネシウム\n1.5g\n分3\n14日分");
  assert.equal(d.quantity, "1.5");
  assert.equal(d.days, "14");
  assert.equal(d.times, "3");
  assert.equal(d.meaning, "");
  assert.equal(d.basis, "");
  assert.equal(d.code, "");
});
test("OCR誤字を自動補正しない、明示された日量だけ提案", () => {
  const [d] = parsePaperText("アムロシヒン\n1日量：1.5g\n14日分");
  assert.equal(d.name, "アムロシヒン");
  assert.equal(d.meaning, "daily");
  assert.equal(d.days, "14");
});
test("薬品規格の10mgを服用量として抽出しない", () => {
  const [d] = parsePaperText("テスト錠10mg\n14日分");
  assert.equal(d.quantity, "");
});
test("日本語OCRの空白・互換数字は数量候補だけ正規化", () => {
  const [d] = parsePaperText("テ ス ト 散 剤 A\n① 日 量 : ①.⑤ g\n⑭ 日 分");
  assert.equal(d.name, "テ ス ト 散 剤 A");
  assert.equal(d.quantity, "1.5");
  assert.equal(d.meaning, "daily");
  assert.equal(d.days, "14");
});
test("台形補正の射影は四隅を正しく変換", () => {
  const src = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ],
    dest = [
      { x: 20, y: 10 },
      { x: 140, y: 30 },
      { x: 125, y: 220 },
      { x: 5, y: 190 },
    ];
  const h = homography(src, dest);
  src.forEach((p, i) => {
    const q = project(h, p.x, p.y);
    assert.ok(Math.abs(q.x - dest[i].x) < 0.0001);
    assert.ok(Math.abs(q.y - dest[i].y) < 0.0001);
  });
});
test("重なった四隅では補正を実行しない", () => {
  assert.throws(() =>
    homography(Array(4).fill({ x: 0, y: 0 }), Array(4).fill({ x: 0, y: 0 })),
  );
});
