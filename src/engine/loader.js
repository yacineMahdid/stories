import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Load a .gltf whose buffer is embedded as a data: URI. Pages with a strict content security
 * policy (like published artifacts) can't fetch data: URIs, so the buffer is decoded here and
 * the model is handed to the loader as an in-memory binary glTF instead.
 */
export async function loadGLTF(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  const uri = json.buffers?.[0]?.uri ?? '';
  if (!uri.startsWith('data:')) return new GLTFLoader().parseAsync(JSON.stringify(json), new URL('.', url).href);
  const bin = Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  delete json.buffers[0].uri;
  return new GLTFLoader().parseAsync(packGLB(json, bin), '');
}

function packGLB(json, bin) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const textLen = Math.ceil(text.length / 4) * 4;
  const binLen = Math.ceil(bin.length / 4) * 4;
  const total = 12 + 8 + textLen + 8 + binLen;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, textLen, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  bytes.set(text, 20);
  bytes.fill(0x20, 20 + text.length, 20 + textLen);
  view.setUint32(20 + textLen, binLen, true);
  view.setUint32(24 + textLen, 0x004e4942, true); // 'BIN'
  bytes.set(bin, 28 + textLen);
  return out;
}
