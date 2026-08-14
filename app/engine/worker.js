/**
 * The engine, off the main thread.
 *
 * A decision is one batched forward pass over ~20 candidate positions — tens of
 * milliseconds on a laptop, but enough to stutter the board if it ran inline.
 * GitHub Pages cannot send the COOP/COEP headers that WebAssembly threads
 * require, so this is deliberately single-threaded: asking for more threads
 * without cross-origin isolation makes onnxruntime warn and fall back anyway.
 */

import * as ort from "../vendor/ort.min.mjs";
import { Evaluator } from "./evaluator.js";

ort.env.wasm.wasmPaths = new URL("../vendor/", import.meta.url).href;
ort.env.wasm.numThreads = 1;
ort.env.logLevel = "error";

let evaluator = null;

self.onmessage = async (event) => {
  const { id, type, payload } = event.data;
  try {
    const result = await handle(type, payload);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
  }
};

async function handle(type, payload) {
  switch (type) {
    case "load": {
      const meta = await fetch(payload.metaUrl).then((r) => r.json());
      const weights = await download(payload.modelUrl);
      evaluator = await Evaluator.create({ ort, modelUrl: weights, meta });
      return { meta, bytes: weights.byteLength };
    }
    case "rank": {
      if (!evaluator) throw new Error("engine not loaded");
      const ranked = await evaluator.rankPlays(payload.position, payload.dice, {
        ort, midDoubles: payload.midDoubles ?? false,
      });
      // Positions are structured-cloned back so the page can apply the choice
      // without re-deriving it — the worker owns move legality, not the UI.
      return ranked;
    }
    default:
      throw new Error(`unknown request: ${type}`);
  }
}

/**
 * Fetch the weights, reporting progress as they arrive.
 *
 * The network is ~47 MB — the price of shipping the measured model rather than
 * a quantised approximation of it (int8 was tried and cost most of the
 * strength). A visitor deserves to see that number moving rather than a page
 * that appears to have hung.
 */
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not fetch the network: HTTP ${response.status}`);

  const total = Number(response.headers.get("content-length")) || 0;
  const chunks = [];
  let loaded = 0;

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    self.postMessage({ progress: { loaded, total } });
  }

  const weights = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    weights.set(chunk, offset);
    offset += chunk.length;
  }
  return weights;
}
