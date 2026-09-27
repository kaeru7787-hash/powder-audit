import { AuditError, type Session, type Drug } from "./domain";
const KEY = "pictokun-powder-audit-v1";
export interface Store {
  revision: number;
  current: Session | null;
  archived: Session[];
  master: Drug[];
}
export function load(): Store {
  const raw = localStorage.getItem(KEY);
  if (!raw) return { revision: 0, current: null, archived: [], master: [] };
  try {
    const data = JSON.parse(raw);
    if (
      !Number.isInteger(data.revision) ||
      !Array.isArray(data.archived) ||
      !Array.isArray(data.master) ||
      (data.current && data.current.schema !== 1)
    )
      throw new Error();
    return data;
  } catch {
    throw new AuditError(
      "STORAGE_CORRUPT",
      "保存データを読み込めません。データを消去せず、開発者に確認してください。",
    );
  }
}
export function save(next: Store, expectedRevision: number): Store {
  if (load().revision !== expectedRevision)
    throw new AuditError(
      "CONCURRENT_CHANGE",
      "別の画面でデータが更新されました。再読込してGS1からやり直してください。",
    );
  const result = structuredClone(next);
  result.revision = expectedRevision + 1;
  if (result.current) result.current.revision++;
  try {
    localStorage.setItem(KEY, JSON.stringify(result));
  } catch {
    throw new AuditError(
      "STORAGE_FAILED",
      "端末に保存できませんでした。登録は確定していません。空き容量とブラウザの保存設定を確認してください。",
    );
  }
  return result;
}
export const storageKey = KEY;
