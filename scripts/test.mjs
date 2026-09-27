import ts from "typescript";
import { readFile, mkdir, writeFile, cp, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url),
  out = new URL("../.test-build/", import.meta.url);
for (const dir of ["src", "tests"]) {
  await mkdir(new URL(dir + "/", out), { recursive: true });
  for (const name of await readdir(new URL(dir + "/", root))) {
    if (
      !name.endsWith(".ts") ||
      (dir === "src" &&
        ![
          "domain.ts",
          "storage.ts",
          "prescription.ts",
          "paper.ts",
          "camera-geometry.ts",
        ].includes(name))
    )
      continue;
    const source = await readFile(new URL(dir + "/" + name, root), "utf8");
    let code = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
    code = code.replace(
      /from (["'])((?:\.\.?\/)[^"']+)\1/g,
      (_, quote, p) =>
        `from ${quote}${p.endsWith(".js") ? p : p + ".js"}${quote}`,
    );
    await writeFile(
      new URL(dir + "/" + name.replace(/\.ts$/, ".js"), out),
      code,
    );
  }
}
await cp(new URL("tests/fixtures", root), new URL("tests/fixtures", out), {
  recursive: true,
});
const result = spawnSync(
  process.execPath,
  [
    "--test",
    ...(await readdir(new URL("tests/", out)))
      .filter((n) => n.endsWith(".test.js"))
      .map((n) => fileURLToPath(new URL("tests/" + n, out))),
  ],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
