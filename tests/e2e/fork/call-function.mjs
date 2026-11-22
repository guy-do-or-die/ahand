// Calls a Vercel Function's web-standard handler the way Vercel's Node.js runtime does: imports
// the entry (`export default { fetch }`) and hands it a Request for each path. Run by node, not bun,
// from tests/e2e/fork/run.ts on the function's files copied out alone:
//
//   node tests/e2e/fork/call-function.mjs <entry.mjs> <origin> <path> [<path> …]
//
// Prints one JSON object: the Node version and, for each path, the status, the headers, and the
// body as text (HTML, text) or, for a PNG, its size from the IHDR chunk and its byte count.
const [entry, origin, ...paths] = process.argv.slice(2);
const { default: handler } = await import(entry);
const answers = [];
for (const path of paths) {
  const started = Date.now();
  const response = await handler.fetch(new Request(`${origin}${path}`));
  const bytes = new Uint8Array(await response.arrayBuffer());
  const headers = Object.fromEntries(response.headers);
  const answer = { path, status: response.status, headers, ms: Date.now() - started };
  if (headers["content-type"] === "image/png") {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    answer.png = { signature: Buffer.from(bytes.subarray(0, 8)).toString("hex"), width: view.getUint32(16), height: view.getUint32(20), bytes: bytes.byteLength };
  } else answer.text = new TextDecoder().decode(bytes);
  answers.push(answer);
}
console.log(JSON.stringify({ node: process.version, answers }));
