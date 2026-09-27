# Third-party notices

- Pictokun artwork (`public/pictokun.png`, icon PNGs) and visual references: https://github.com/kaeru7787-hash/pill-counter, original LICENSE: GNU Affero General Public License v3. The original license text is retained as `LICENSE`. Source obtained 2026-09-27. Original application files were not modified.
- zxing-wasm 2.2.1: MIT for the wrapper; ZXing-C++ components: Apache-2.0. https://github.com/Sec-ant/zxing-wasm . Supports DataBar, DataBarLimited, DataBarExpanded in the pinned version. License files are copied to vendor output.
- Tesseract.js 6.0.1 and tesseract.js-core 6.1.2: Apache-2.0. https://github.com/naptha/tesseract.js . The worker bundle's bundled notices are copied too.
- English and Japanese trained data: https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz and https://tessdata.projectnaptha.com/4.0.0/jpn.traineddata.gz ; Tesseract trained data is distributed under Apache-2.0. See https://github.com/tesseract-ocr/tessdata . No patient data is transmitted when fetching it at build time.
- Vite: MIT; TypeScript: Apache-2.0. Used for development/build. Versions are pinned in package.json / pnpm-lock.yaml.

This project uses no paid barcode SDK and requires no API key. The complete source and these notices should accompany distribution. Runtime third-party notices are included under `vendor/` in the built application.
