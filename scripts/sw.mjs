import { readdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../dist/", import.meta.url);
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
  await copyFile(new URL("../" + name, import.meta.url), new URL(name, root));
async function walk(url, prefix = "") {
  const result = [];
  for (const entry of await readdir(url, { withFileTypes: true })) {
    if (entry.isDirectory())
      result.push(
        ...(await walk(
          new URL(entry.name + "/", url),
          prefix + entry.name + "/",
        )),
      );
    else if (entry.name !== "sw.js") result.push(prefix + entry.name);
  }
  return result;
}
const paths = await walk(root);
const hash = createHash("sha256");
for (const p of paths.sort()) {
  hash.update(p);
  hash.update(await readFile(new URL(p, root)));
}
const cache = "powder-audit-" + hash.digest("hex").slice(0, 12);
await writeFile(
  new URL("sw.js", root),
  `const CACHE=${JSON.stringify(cache)};const FILES=${JSON.stringify(paths.map((p) => "./" + p))};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('powder-audit-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin)return;e.respondWith(caches.open(CACHE).then(async c=>{const exact=await c.match(e.request);if(exact)return exact;const start=new URL('index.html',self.registration.scope);if(e.request.mode==='navigate'&&(u.pathname===new URL(self.registration.scope).pathname||u.pathname===start.pathname)){const index=await c.match(start.href);if(index)return index;}return fetch(e.request);}));});
`,
);
console.log("Offline package:", paths.length, "files", cache);
