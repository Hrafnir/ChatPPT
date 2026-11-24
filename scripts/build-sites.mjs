import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const source = process.cwd();
const server = resolve(source, "dist/server");
const manifest = resolve(source, "dist/.openai");
await Promise.all([mkdir(server, { recursive: true }), mkdir(manifest, { recursive: true })]);
await Promise.all([
  copyFile(resolve(source, "lib/worker.mjs"), resolve(server, "index.js")),
  copyFile(resolve(source, ".openai/hosting.json"), resolve(manifest, "hosting.json")),
]);
