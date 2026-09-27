import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  resolve: {
    alias: { "tesseract.js": "tesseract.js/dist/tesseract.esm.min.js" },
  },
  optimizeDeps: {
    noDiscovery: true,
    exclude: [
      "zxing-wasm/reader",
      "tesseract.js",
      "tesseract.js/dist/tesseract.esm.min.js",
    ],
  },
  server: { port: 5173, strictPort: true },
  build: { target: "es2022" },
});
