"""Convert a single-material OBJ into a GLB the engine can load.

The model is rescaled to a target height, its feet are put on y=0 and it is
centered on x/z. UVs and per-corner normals are kept.

Usage: python3 tools/obj2glb.py in.obj out.glb --height 1.0 --color "#fdd6b2"
"""
import argparse
import json
import struct


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def parse_obj(path):
    v, vt, vn, corners = [], [], [], []
    for line in open(path, encoding='utf-8', errors='replace'):
        parts = line.split()
        if not parts:
            continue
        tag = parts[0]
        if tag == 'v':
            v.append(tuple(map(float, parts[1:4])))
        elif tag == 'vt':
            vt.append(tuple(map(float, parts[1:3])))
        elif tag == 'vn':
            vn.append(tuple(map(float, parts[1:4])))
        elif tag == 'f':
            refs = []
            for ref in parts[1:]:
                idx = (ref.split('/') + ['', ''])[:3]
                refs.append(tuple(int(i) - 1 if i else None for i in idx))
            for k in range(1, len(refs) - 1):  # fan-triangulate
                corners.extend((refs[0], refs[k], refs[k + 1]))
    return v, vt, vn, corners


def build(path, height):
    v, vt, vn, corners = parse_obj(path)
    xs, ys, zs = zip(*v)
    scale = height / (max(ys) - min(ys))
    cx, cz, floor = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2, min(ys)

    lookup, positions, normals, uvs, indices = {}, [], [], [], []
    for corner in corners:
        if corner not in lookup:
            pi, ti, ni = corner
            x, y, z = v[pi]
            lookup[corner] = len(positions)
            positions.append(((x - cx) * scale, (y - floor) * scale, (z - cz) * scale))
            if ni is not None:
                nx, ny, nz = vn[ni]
                n = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
                normals.append((nx / n, ny / n, nz / n))
            else:
                normals.append((0.0, 1.0, 0.0))
            u, w = vt[ti] if ti is not None else (0.0, 0.0)
            uvs.append((u, 1.0 - w))  # glTF UV origin is top-left
        indices.append(lookup[corner])
    return positions, normals, uvs, indices


def write_glb(out, positions, normals, uvs, indices, color, name):
    blobs, views, accessors = bytearray(), [], []

    def add(values, fmt, comp, typ, target, minmax=None):
        """Append a flat list of numbers as one accessor; returns its index."""
        while len(blobs) % 4:
            blobs.append(0)
        offset = len(blobs)
        blobs.extend(struct.pack(f'<{len(values)}{fmt}', *values))
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(blobs) - offset, 'target': target})
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[typ]
        acc = {'bufferView': len(views) - 1, 'componentType': comp, 'count': len(values) // width, 'type': typ}
        if minmax:
            acc['min'], acc['max'] = minmax
        accessors.append(acc)
        return len(accessors) - 1

    flat = lambda rows: [c for r in rows for c in r]
    mins = [min(p[i] for p in positions) for i in range(3)]
    maxs = [max(p[i] for p in positions) for i in range(3)]
    pos = add(flat(positions), 'f', 5126, 'VEC3', 34962, (mins, maxs))
    nor = add(flat(normals), 'f', 5126, 'VEC3', 34962)
    tex = add(flat(uvs), 'f', 5126, 'VEC2', 34962)
    big = len(positions) > 65535
    ind = add(indices, 'I' if big else 'H', 5125 if big else 5123, 'SCALAR', 34963)

    r, g, b = (srgb_to_linear(int(color[i:i + 2], 16) / 255) for i in (1, 3, 5))
    gltf = {
        'asset': {'version': '2.0', 'generator': 'stories/tools/obj2glb.py'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'name': name, 'mesh': 0}],
        'meshes': [{'name': name, 'primitives': [{
            'attributes': {'POSITION': pos, 'NORMAL': nor, 'TEXCOORD_0': tex},
            'indices': ind, 'material': 0}]}],
        'materials': [{'name': 'Skin', 'pbrMetallicRoughness': {
            'baseColorFactor': [r, g, b, 1.0], 'metallicFactor': 0.0, 'roughnessFactor': 0.85}}],
        'buffers': [{'byteLength': len(blobs)}],
        'bufferViews': views,
        'accessors': accessors,
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    blobs.extend(b'\x00' * (-len(blobs) % 4))
    total = 12 + 8 + len(js) + 8 + len(blobs)
    with open(out, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(blobs), 0x004E4942) + bytes(blobs))
    return total


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('obj')
    ap.add_argument('glb')
    ap.add_argument('--height', type=float, default=1.0)
    ap.add_argument('--color', default='#fdd6b2')
    ap.add_argument('--name', default='Body')
    a = ap.parse_args()
    data = build(a.obj, a.height)
    size = write_glb(a.glb, *data, a.color, a.name)
    print(f'{a.glb}: {len(data[0])} vertices, {len(data[3]) // 3} triangles, {size} bytes')
