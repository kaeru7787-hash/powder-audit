/** Convert the visible guide to sensor coordinates. Keep in sync with .roi CSS. */
export function frameCrop(
  w: number,
  h: number,
  bw: number,
  bh: number,
  barcode: boolean,
) {
  if (![w, h, bw, bh].every((n) => Number.isFinite(n) && n > 0))
    throw new Error("カメラの表示サイズを確認できません。");
  const scale = barcode ? Math.max(bw / w, bh / h) : Math.min(bw / w, bh / h);
  const ox = (bw - w * scale) / 2,
    oy = (bh - h * scale) / 2;
  const top = barcode ? 0.2 : 0.375,
    bottom = barcode ? 0.8 : 0.625;
  const x = Math.max(0, (bw * 0.1 - ox) / scale),
    y = Math.max(0, (bh * top - oy) / scale);
  return {
    x,
    y,
    width: Math.min(w, (bw * 0.9 - ox) / scale) - x,
    height: Math.min(h, (bh * bottom - oy) / scale) - y,
  };
}
