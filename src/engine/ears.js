import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Ear styles. Human ears are part of the body mesh and ride on the LeftEar/RightEar bones, so
// they are resized (or hidden) by scaling those bones. Other ears are small extruded shapes
// parented to the Head bone: elf ears replace the human ones at the ear roots; animal ears sit
// on top of the head. Placements are in Head-bone space: +y up, +z toward the face, +x = left.

export const EAR_STYLES = {
  human: { label: 'Human', scale: 1 },
  small: { label: 'Small', scale: 0.7 },
  big: { label: 'Big', scale: 1.45 },
  elf: { label: 'Elf', scale: 0 },
  cat: { label: 'Cat', scale: 0 },
  fox: { label: 'Fox', scale: 0 },
  bunny: { label: 'Bunny', scale: 0 },
  bear: { label: 'Bear', scale: 0 },
  mouse: { label: 'Mouse', scale: 0 },
  floppy: { label: 'Floppy', scale: 0 },
  cow: { label: 'Cow', scale: 0 },
  horse: { label: 'Horse', scale: 0 },
  none: { label: 'None', scale: 0 },
};

const INNER_PINK = '#f3a8b6';

/**
 * A soft, pillowy ear shape: a thin core with a fully rounded rim, smooth-shaded all over (an
 * extrusion is faceted, so its vertices are welded before the normals are computed). As thick
 * as `depth` plus the bevel on both sides.
 */
function extrude(shape, depth, bevel) {
  const core = depth * 0.3, round = (depth - core) / 2 + bevel;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: core, bevelEnabled: true, bevelThickness: round, bevelSize: bevel, bevelSegments: 8, curveSegments: 24,
  });
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const soft = mergeVertices(geo, 1e-5);
  geo.dispose();
  soft.translate(0, 0, -core / 2);
  soft.computeVertexNormals();
  return soft;
}

function triangleShape(w, h, round = 0.25) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.quadraticCurveTo(-w * 0.32, h * 0.72, -w * 0.06, h * (1 - round * 0.1));
  s.quadraticCurveTo(0, h, w * 0.06, h * (1 - round * 0.1));
  s.quadraticCurveTo(w * 0.32, h * 0.72, w / 2, 0);
  s.quadraticCurveTo(0, -h * 0.12, -w / 2, 0);
  return s;
}

function ovalShape(w, h) {
  const s = new THREE.Shape();
  s.absellipse(0, h / 2, w / 2, h / 2, 0, Math.PI * 2, false, 0);
  return s;
}

function circleShape(r) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  return s;
}

function teardropShape(w, h) { // hangs down from the origin
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(w * 0.7, -h * 0.05, w * 0.65, -h * 0.85, 0, -h);
  s.bezierCurveTo(-w * 0.65, -h * 0.85, -w * 0.7, -h * 0.05, 0, 0);
  return s;
}

function elfShape() { // points outward (+x) and up from the ear root
  const s = new THREE.Shape();
  s.moveTo(-0.005, -0.04);
  s.quadraticCurveTo(0.06, -0.045, 0.13, 0.075);
  s.quadraticCurveTo(0.07, 0.035, -0.005, 0.048);
  s.quadraticCurveTo(-0.02, 0.0, -0.005, -0.04);
  return s;
}

/** One ear: an outer shell and an optional inner patch just in front of it. */
function ear(outerShape, depth, outerMat, innerShape, innerMat, innerScale = 0.62, innerLift = 0) {
  const group = new THREE.Group();
  const outer = new THREE.Mesh(extrude(outerShape, depth, depth * 0.45), outerMat);
  outer.castShadow = true;
  group.add(outer);
  if (innerShape) {
    const inner = new THREE.Mesh(extrude(innerShape, depth * 0.3, depth * 0.15), innerMat);
    inner.scale.setScalar(innerScale);
    inner.position.set(0, innerLift, depth * 1.02); // just in front of the outer shell's bevel
    group.add(inner);
  }
  return group;
}

/**
 * Build the ear meshes for a style. Returns [{ bone, object }] to attach (both sides);
 * `colors` = { fur, skin }.
 */
export function buildEars(style, colors) {
  const soft = (color, roughness = 0.75) => new THREE.MeshPhysicalMaterial({
    color, roughness, specularIntensity: 0.25, sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3),
  });
  const fur = soft(colors.fur);
  const skin = soft(colors.skin, 0.8);
  const pink = soft(INNER_PINK, 0.8);
  const cream = soft('#fff1dc', 0.8);
  const out = [];

  const onHead = (makeEar, place) => {
    for (const side of [1, -1]) {
      const e = makeEar();
      place(e, side);
      out.push({ bone: 'Head', object: e });
    }
  };

  switch (style) {
    case 'elf':
      for (const side of [1, -1]) { // at the ear root (the LeftEar/RightEar rest position)
        const e = ear(elfShape(), 0.012, skin);
        e.scale.x = side;
        e.position.set(side * 0.19, 0.116, -0.055);
        e.rotation.set(0, side * 0.55, side * 0.12);
        out.push({ bone: 'Head', object: e });
      }
      break;
    case 'cat':
      onHead(() => ear(triangleShape(0.15, 0.13), 0.026, fur, triangleShape(0.15, 0.13), pink, 0.6, 0.012), (e, side) => {
        e.position.set(side * 0.125, 0.365, -0.035); e.rotation.set(-0.15, 0, -side * 0.38);
      });
      break;
    case 'fox':
      onHead(() => ear(triangleShape(0.13, 0.17), 0.026, fur, triangleShape(0.13, 0.17), cream, 0.6, 0.015), (e, side) => {
        e.position.set(side * 0.12, 0.37, -0.04); e.rotation.set(-0.2, 0, -side * 0.3);
      });
      break;
    case 'bunny':
      onHead(() => ear(ovalShape(0.065, 0.24), 0.022, fur, ovalShape(0.065, 0.24), pink, 0.62, 0.035), (e, side) => {
        e.position.set(side * 0.075, 0.375, -0.05); e.rotation.set(-0.22, 0, -side * 0.16);
      });
      break;
    case 'bear':
      onHead(() => ear(circleShape(0.055), 0.03, fur, circleShape(0.055), soft('#d9a77c'), 0.55), (e, side) => {
        e.position.set(side * 0.175, 0.355, -0.04); e.rotation.set(-0.1, 0, -side * 0.55);
      });
      break;
    case 'mouse':
      onHead(() => ear(circleShape(0.085), 0.024, fur, circleShape(0.085), pink, 0.66), (e, side) => {
        e.position.set(side * 0.2, 0.33, -0.05); e.rotation.set(-0.05, -side * 0.2, -side * 0.75);
      });
      break;
    case 'floppy': // hang from the top of the head, flaring a little outward
      onHead(() => ear(teardropShape(0.085, 0.21), 0.024, fur), (e, side) => {
        // face sideways first, then flare the bottom outward (world Z), so order ZYX
        e.position.set(side * 0.175, 0.35, 0.0); e.rotation.set(0.08, side * Math.PI / 2, side * 0.32, 'ZYX');
      });
      break;
    case 'cow': // leaf-shaped ears sticking out sideways
      onHead(() => ear(ovalShape(0.07, 0.15), 0.022, fur, ovalShape(0.07, 0.15), pink, 0.6, 0.03), (e, side) => {
        e.position.set(side * 0.2, 0.29, -0.03); e.rotation.set(-0.3, 0, -side * 1.95);
      });
      break;
    case 'horse': // tall, narrow, upright
      onHead(() => ear(triangleShape(0.085, 0.16), 0.024, fur, triangleShape(0.085, 0.16), soft('#3a2a22'), 0.55, 0.02), (e, side) => {
        e.position.set(side * 0.11, 0.375, -0.05); e.rotation.set(-0.15, -side * 0.25, -side * 0.12);
      });
      break;
    default:
      break;
  }
  return out;
}
