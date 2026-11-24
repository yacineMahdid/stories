import * as THREE from 'three';
import { loadGLTF } from './loader.js';

// Hair styles built by tools/build_hair.py. Each mesh is in Head-bone space, so it is simply
// parented to the Head bone and follows every head movement.
export const HAIR_STYLES = [
  { id: 'spiky', label: 'Spiky' },
  { id: 'bob', label: 'Bob' },
  { id: 'swept', label: 'Side part' },
  { id: 'pigtails', label: 'Pigtails' },
  { id: 'ponytail', label: 'Ponytail' },
  { id: 'bun', label: 'Top bun' },
  { id: 'long', label: 'Long' },
];

export const HAIR_COLORS = [
  { id: 'brown', label: 'Brown', value: '#4a2f22' },
  { id: 'black', label: 'Black', value: '#1f1b1a' },
  { id: 'chestnut', label: 'Chestnut', value: '#7a4a2c' },
  { id: 'blonde', label: 'Blonde', value: '#e0b45c' },
  { id: 'ginger', label: 'Ginger', value: '#d4692e' },
  { id: 'pink', label: 'Pink', value: '#f29ab2' },
  { id: 'blue', label: 'Blue', value: '#4d7cc9' },
  { id: 'gray', label: 'Gray', value: '#c8c3ba' },
];

const cache = new Map();

export function loadHairGeometry(style) {
  if (!cache.has(style)) {
    const url = new URL(`../../assets/characters/canonical/hair/${style}.gltf`, import.meta.url).href;
    cache.set(style, loadGLTF(url).then((gltf) => {
      let geometry = null;
      gltf.scene.traverse((obj) => { if (obj.isMesh && !geometry) geometry = obj.geometry; });
      return geometry;
    }));
  }
  return cache.get(style);
}

export function createHairMaterial() {
  return new THREE.MeshStandardMaterial({ name: 'Hair', roughness: 0.55, metalness: 0 });
}
