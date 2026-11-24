"""Build the canonical character base: a rigged, skinned GLB every character derives from.

Input : the AC player base mesh (OBJ, by SSlamon, CC BY 4.0).
Output: assets/characters/canonical/base.gltf with
  - the body mesh, 1 unit tall, feet on y=0, facing +Z
  - a 30-joint skeleton (Mixamo-style names, identity rest rotations)
  - automatic skin weights (region-based, smooth blends at the joints)
  - a `_REGION` vertex attribute (head, chest, upper arm, ...) used to paint outfits
  - a "Face" layer: a thin shell over the front of the head, skinned to Head,
    with planar UVs so the engine can draw eyes/mouth on it with a canvas.

Usage: python3 tools/build_base.py path/to/AC_Player_Base.obj assets/characters/canonical/base.gltf  (.gltf = JSON, .glb = binary)
"""
import json
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from obj2glb import parse_obj  # noqa: E402

# ---------------------------------------------------------------------------
# Skeleton: (name, parent, rest position in body units: height 1, +Z forward).
# Left = +X (the character's own left). Rest rotations are identity.
# ---------------------------------------------------------------------------
SKELETON = [
    ('Root',          None,          (0.000, 0.000, 0.000)),
    ('Hips',          'Root',        (0.000, 0.245, 0.045)),
    ('Spine',         'Hips',        (0.000, 0.320, 0.050)),
    ('Spine1',        'Spine',       (0.000, 0.420, 0.050)),
    ('Neck',          'Spine1',      (0.000, 0.525, 0.045)),
    ('Head',          'Neck',        (0.000, 0.570, 0.030)),
    ('HeadTop_End',   'Head',        (0.000, 1.000, 0.000)),
    ('LeftEar',       'Head',        (0.235, 0.690, -0.030)),
    ('RightEar',      'Head',        (-0.235, 0.690, -0.030)),
    ('LeftShoulder',  'Spine1',      (0.030, 0.490, 0.046)),
    ('LeftArm',       'LeftShoulder', (0.115, 0.480, 0.046)),
    ('LeftForeArm',   'LeftArm',     (0.190, 0.440, 0.046)),
    ('LeftHand',      'LeftForeArm', (0.262, 0.400, 0.046)),
    ('LeftHand_End',  'LeftHand',    (0.330, 0.378, 0.046)),
    ('RightShoulder', 'Spine1',      (-0.030, 0.490, 0.046)),
    ('RightArm',      'RightShoulder', (-0.115, 0.480, 0.046)),
    ('RightForeArm',  'RightArm',    (-0.190, 0.440, 0.046)),
    ('RightHand',     'RightForeArm', (-0.262, 0.400, 0.046)),
    ('RightHand_End', 'RightHand',   (-0.330, 0.378, 0.046)),
    ('LeftUpLeg',     'Hips',        (0.052, 0.225, 0.040)),
    ('LeftLeg',       'LeftUpLeg',   (0.052, 0.130, 0.032)),
    ('LeftFoot',      'LeftLeg',     (0.051, 0.045, 0.020)),
    ('LeftToeBase',   'LeftFoot',    (0.051, 0.015, 0.075)),
    ('LeftToe_End',   'LeftToeBase', (0.051, 0.010, 0.124)),
    ('RightUpLeg',    'Hips',        (-0.052, 0.225, 0.040)),
    ('RightLeg',      'RightUpLeg',  (-0.052, 0.130, 0.032)),
    ('RightFoot',     'RightLeg',    (-0.051, 0.045, 0.020)),
    ('RightToeBase',  'RightFoot',   (-0.051, 0.015, 0.075)),
    ('RightToe_End',  'RightToeBase', (-0.051, 0.010, 0.124)),
    ('Tail',          'Hips',        (0.000, 0.270, -0.035)),
]
NAMES = [b[0] for b in SKELETON]
J = {name: i for i, name in enumerate(NAMES)}
POS = {name: np.array(p, dtype=float) for name, _, p in SKELETON}

# Body regions (stored per vertex in _REGION) — the engine paints outfits with these.
REGIONS = ['head', 'neck', 'chest', 'pelvis', 'upperArm', 'foreArm', 'hand', 'thigh', 'shin', 'foot']
R = {name: i for i, name in enumerate(REGIONS)}

# Face layer: planar projection window on the front of the head (x, y in body units).
FACE_RECT = (-0.23, 0.56, 0.23, 1.02)  # x0, y0, x1, y1 -> u = (x-x0)/w, v = (y1-y)/h


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def normalize_mesh(v):
    P = np.array(v, dtype=float)
    mn, mx = P.min(0), P.max(0)
    s = 1.0 / (mx[1] - mn[1])
    c = np.array([(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2])
    return (P - c) * s


def weights_for(p):
    """Return ({joint: weight}, region) for one rest-pose vertex position."""
    x, y, z = p
    side = 'Left' if x >= 0 else 'Right'
    ax = abs(x)
    w = {}

    def add(name, amount):
        if amount > 1e-4:
            w[name] = w.get(name, 0.0) + amount

    # Arms ----------------------------------------------------------------
    sh = POS['LeftArm']; wr = POS['LeftHand']
    d = wr - sh; L = np.linalg.norm(d); d = d / L
    q = np.array([ax, y, z]) - sh
    t = q @ d
    perp = np.linalg.norm(q - t * d)
    tE = np.linalg.norm(POS['LeftForeArm'] - sh)
    if 0.30 < y < 0.56 and ax > 0.10 and t > -0.015 and perp < 0.075:
        a_root = smooth(-0.015, 0.025, t)            # shoulder -> arm
        a_elbow = smooth(tE - 0.02, tE + 0.02, t)     # arm -> forearm
        a_wrist = smooth(L - 0.012, L + 0.012, t)     # forearm -> hand
        add(side + 'Shoulder', 1 - a_root)
        add(side + 'Arm', a_root * (1 - a_elbow))
        add(side + 'ForeArm', a_root * a_elbow * (1 - a_wrist))
        add(side + 'Hand', a_root * a_elbow * a_wrist)
        region = 'upperArm' if t < tE else ('foreArm' if t < L - 0.005 else 'hand')
        return w, region

    # Head and neck -------------------------------------------------------
    if y >= 0.545:
        h = smooth(0.545, 0.578, y)
        add('Head', h)
        add('Neck', 1 - h)
        return w, ('head' if y >= 0.565 else 'neck')

    # Legs ----------------------------------------------------------------
    if y < 0.265 and ax > 0.004:
        hip = smooth(0.205, 0.262, y)                 # leg -> hips
        knee = smooth(0.112, 0.150, y)                # shin -> thigh
        ankle = smooth(0.034, 0.062, y)               # foot -> shin
        toe = smooth(0.050, 0.085, z) * (1 - smooth(0.020, 0.040, y))
        leg = 1 - hip
        add('Hips', hip)
        add(side + 'UpLeg', leg * knee)
        add(side + 'Leg', leg * (1 - knee) * ankle)
        add(side + 'Foot', leg * (1 - knee) * (1 - ankle) * (1 - toe))
        add(side + 'ToeBase', leg * (1 - knee) * (1 - ankle) * toe)
        if y >= 0.215:
            region = 'pelvis'
        else:
            region = 'thigh' if y >= 0.13 else ('shin' if y >= 0.045 else 'foot')
        return w, region

    # Torso -----------------------------------------------------------------
    a = smooth(0.270, 0.310, y)   # hips -> spine
    b = smooth(0.370, 0.410, y)   # spine -> spine1
    c = smooth(0.505, 0.545, y)   # spine1 -> neck
    body = {'Hips': 1 - a, 'Spine': a * (1 - b), 'Spine1': a * b * (1 - c), 'Neck': a * b * c}
    shoulder = smooth(0.06, 0.12, ax) * smooth(0.43, 0.47, y) * 0.75
    for name, amount in body.items():
        add(name, amount * (1 - shoulder) if name == 'Spine1' else amount)
    add(side + 'Shoulder', body['Spine1'] * shoulder)
    region = 'neck' if y >= 0.53 else ('chest' if y >= 0.33 else 'pelvis')
    return w, region


def top4(w):
    items = sorted(w.items(), key=lambda kv: -kv[1])[:4]
    total = sum(a for _, a in items)
    items = [(J[n], a / total) for n, a in items]
    while len(items) < 4:
        items.append((0, 0.0))
    return items


def loop_subdivide(P, tris, tri_uv):
    """One step of Loop subdivision on a welded triangle mesh; UVs are split linearly per face."""
    n = len(P)
    edge_faces = {}
    for f, (a, b, c) in enumerate(tris):
        for i, j, k in ((a, b, c), (b, c, a), (c, a, b)):
            edge_faces.setdefault((min(i, j), max(i, j)), []).append(k)
    nbrs = [set() for _ in range(n)]
    border = [[] for _ in range(n)]
    for (i, j), opposite in edge_faces.items():
        nbrs[i].add(j); nbrs[j].add(i)
        if len(opposite) != 2:
            border[i].append(j); border[j].append(i)

    moved = np.empty_like(P)
    for v in range(n):
        if border[v]:
            if len(border[v]) == 2:
                b1, b2 = border[v]
                moved[v] = 0.75 * P[v] + 0.125 * (P[b1] + P[b2])
            else:
                moved[v] = P[v]
        else:
            k = len(nbrs[v])
            beta = 3 / 16 if k == 3 else 3 / (8 * k)
            moved[v] = (1 - k * beta) * P[v] + beta * P[list(nbrs[v])].sum(0)

    edge_vertex, points = {}, []
    for (i, j), opposite in edge_faces.items():
        if len(opposite) == 2:
            pt = 0.375 * (P[i] + P[j]) + 0.125 * (P[opposite[0]] + P[opposite[1]])
        else:
            pt = 0.5 * (P[i] + P[j])
        edge_vertex[(i, j)] = n + len(points)
        points.append(pt)

    mid = lambda s, t: ((s[0] + t[0]) / 2, (s[1] + t[1]) / 2)
    E = lambda i, j: edge_vertex[(min(i, j), max(i, j))]
    tris2, uv2 = [], []
    for (a, b, c), (ua, ub, uc) in zip(tris, tri_uv):
        ab, bc, ca = E(a, b), E(b, c), E(c, a)
        uab, ubc, uca = mid(ua, ub), mid(ub, uc), mid(uc, ua)
        tris2 += [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]
        uv2 += [(ua, uab, uca), (uab, ub, ubc), (uca, ubc, uc), (uab, ubc, uca)]
    return np.vstack([moved, np.array(points)]), tris2, uv2


def corner_normals(P, tris, crease_deg=60.0):
    """Smooth normals per triangle corner, keeping edges sharper than `crease_deg`."""
    T = np.array(tris)
    fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])  # area-weighted
    unit = fn / np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
    around = [[] for _ in range(len(P))]
    for f, tri in enumerate(tris):
        for v in tri:
            around[v].append(f)
    cos_crease = np.cos(np.radians(crease_deg))
    out = np.zeros((len(tris), 3, 3))
    smooth = np.zeros_like(P)
    for v, faces in enumerate(around):
        if faces:
            smooth[v] = fn[faces].sum(0)
    smooth /= np.maximum(np.linalg.norm(smooth, axis=1, keepdims=True), 1e-12)
    for f, tri in enumerate(tris):
        for k, v in enumerate(tri):
            faces = around[v]
            keep = [g for g in faces if unit[g] @ unit[f] >= cos_crease]
            nrm = fn[keep].sum(0)
            out[f, k] = nrm / max(np.linalg.norm(nrm), 1e-12)
    return out, smooth


def build(obj_path, subdivisions=1):
    v, vt, vn, corners = parse_obj(obj_path)
    P = normalize_mesh(v)
    VT = np.array(vt, dtype=float)
    tris = [tuple(c[0] for c in corners[k:k + 3]) for k in range(0, len(corners), 3)]
    tri_uv = [tuple((VT[c[1]][0], 1.0 - VT[c[1]][1]) for c in corners[k:k + 3]) for k in range(0, len(corners), 3)]
    for _ in range(subdivisions):
        P, tris, tri_uv = loop_subdivide(P, tris, tri_uv)
    P[:, 1] -= P[:, 1].min()  # keep the feet on the ground after smoothing
    normals, smooth_n = corner_normals(P, tris)

    # Weights and region depend only on the rest position.
    vert_w, vert_r = [], []
    for p in P:
        w, region = weights_for(p)
        vert_w.append(top4(w))
        vert_r.append(R[region])

    # Each triangle gets one region (from its centroid) so outfit colors have crisp edges;
    # vertices on a region border are duplicated, with identical position, normal and weights.
    tri_region = [R[weights_for(P[list(tri)].mean(0))[1]] for tri in tris]

    body = {'pos': [], 'nor': [], 'uv': [], 'j': [], 'w': [], 'r': [], 'idx': []}
    lookup = {}
    for f, tri in enumerate(tris):
        for k, pi in enumerate(tri):
            nrm = normals[f, k]
            uv = tri_uv[f][k]
            key = (pi, tri_region[f], round(uv[0], 5), round(uv[1], 5), *np.round(nrm, 3))
            if key not in lookup:
                lookup[key] = len(body['pos'])
                body['pos'].append(P[pi]); body['nor'].append(nrm); body['uv'].append(uv)
                body['j'].append([j for j, _ in vert_w[pi]]); body['w'].append([a for _, a in vert_w[pi]])
                body['r'].append(tri_region[f])
            body['idx'].append(lookup[key])

    # Face shell: head triangles facing forward, pushed out a hair, planar UVs.
    x0, y0, x1, y1 = FACE_RECT
    face = {'pos': [], 'nor': [], 'uv': [], 'j': [], 'w': [], 'idx': []}
    flookup = {}
    head = J['Head']
    for tri in tris:
        pis = list(tri)
        ps = P[pis]
        if (ps[:, 1] < 0.585).any() or (np.abs(ps[:, 0]) > 0.236).any():
            continue
        if (smooth_n[pis][:, 2] < 0.05).any() or ps[:, 2].mean() < 0.02:
            continue
        for pi in pis:
            if pi not in flookup:
                flookup[pi] = len(face['pos'])
                p = P[pi] + smooth_n[pi] * 0.0015
                face['pos'].append(p); face['nor'].append(smooth_n[pi])
                face['uv'].append(((p[0] - x0) / (x1 - x0), (y1 - p[1]) / (y1 - y0)))
                face['j'].append([head, 0, 0, 0]); face['w'].append([1.0, 0, 0, 0])
            face['idx'].append(flookup[pi])
    return body, face


# ---------------------------------------------------------------------------
# GLB writer
# ---------------------------------------------------------------------------
class Writer:
    def __init__(self):
        self.blob = bytearray(); self.views = []; self.accessors = []

    def add(self, arr, comp, typ, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        while len(self.blob) % 4:
            self.blob.append(0)
        off = len(self.blob)
        self.blob.extend(arr.tobytes())
        view = {'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes}
        if target:
            view['target'] = target
        self.views.append(view)
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[typ]
        acc = {'bufferView': len(self.views) - 1, 'componentType': comp, 'count': arr.size // width, 'type': typ}
        if minmax:
            flat = arr.reshape(-1, width)
            acc['min'] = flat.min(0).tolist(); acc['max'] = flat.max(0).tolist()
        self.accessors.append(acc)
        return len(self.accessors) - 1


def write_glb(path, body, face, skin_rgb=(0.992, 0.839, 0.698)):
    W = Writer()
    F32, U16, U8 = 5126, 5123, 5121

    def prim(part, material, with_region):
        attrs = {
            'POSITION': W.add(np.array(part['pos'], np.float32), F32, 'VEC3', 34962, minmax=True),
            'NORMAL': W.add(np.array(part['nor'], np.float32), F32, 'VEC3', 34962),
            'TEXCOORD_0': W.add(np.array(part['uv'], np.float32), F32, 'VEC2', 34962),
            'JOINTS_0': W.add(np.array(part['j'], np.uint8), U8, 'VEC4', 34962),
            'WEIGHTS_0': W.add(np.array(part['w'], np.float32), F32, 'VEC4', 34962),
        }
        if with_region:
            attrs['_REGION'] = W.add(np.array(part['r'], np.float32), F32, 'SCALAR', 34962)
        idx = W.add(np.array(part['idx'], np.uint16), U16, 'SCALAR', 34963)
        return {'attributes': attrs, 'indices': idx, 'material': material}

    # Nodes: 0 = character root, 1 = mesh node, 2.. = joints
    nodes = [{'name': 'CanonicalBase', 'children': [1, 2]}, {'name': 'Body', 'mesh': 0, 'skin': 0}]
    jnode = {name: 2 + i for i, name in enumerate(NAMES)}
    for name, parent, p in SKELETON:
        local = np.array(p) - (np.array(POS[parent]) if parent else 0)
        nodes.append({'name': name, 'translation': [round(float(c), 6) for c in local]})
    for name, parent, _ in SKELETON:
        if parent:
            nodes[jnode[parent]].setdefault('children', []).append(jnode[name])

    ibm = np.zeros((len(NAMES), 4, 4), np.float32)
    for i, name in enumerate(NAMES):
        m = np.eye(4, dtype=np.float32); m[:3, 3] = -POS[name]
        ibm[i] = m.T  # column-major
    ibm_acc = W.add(ibm.reshape(-1), F32, 'MAT4')

    r, g, b = skin_rgb
    gltf = {
        'asset': {'version': '2.0', 'generator': 'stories/tools/build_base.py'},
        'extras': {'regions': REGIONS, 'faceRect': FACE_RECT,
                   'credits': 'Body mesh: "Animal Crossing Player Model" by SSlamon, CC BY 4.0'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': nodes,
        'meshes': [{'name': 'Body', 'primitives': [prim(body, 0, True), prim(face, 1, False)]}],
        'skins': [{'name': 'CanonicalRig', 'joints': [jnode[n] for n in NAMES], 'skeleton': jnode['Root'],
                   'inverseBindMatrices': ibm_acc}],
        'materials': [
            {'name': 'Skin', 'pbrMetallicRoughness': {'baseColorFactor': [r, g, b, 1], 'metallicFactor': 0, 'roughnessFactor': 0.85}},
            {'name': 'Face', 'alphaMode': 'BLEND', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 0], 'metallicFactor': 0, 'roughnessFactor': 0.9}},
        ],
        'buffers': [{'byteLength': 0}],
        'bufferViews': W.views,
        'accessors': W.accessors,
    }
    while len(W.blob) % 4:
        W.blob.append(0)
    gltf['buffers'][0]['byteLength'] = len(W.blob)
    if path.endswith('.gltf'):  # JSON glTF with the buffer embedded
        import base64
        gltf['buffers'][0]['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(bytes(W.blob)).decode()
        text = json.dumps(gltf, separators=(',', ':'))
        with open(path, 'w') as f:
            f.write(text)
        return len(text)
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(W.blob)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(W.blob), 0x004E4942) + bytes(W.blob))
    return total


if __name__ == '__main__':
    body, face = build(sys.argv[1])
    size = write_glb(sys.argv[2], body, face)
    regions = np.bincount(np.array(body['r'], int), minlength=len(REGIONS))
    print(f"{sys.argv[2]}: {size} bytes, body {len(body['pos'])} verts / {len(body['idx']) // 3} tris, "
          f"face {len(face['pos'])} verts / {len(face['idx']) // 3} tris, {len(NAMES)} joints")
    print('corners per region:', dict(zip(REGIONS, regions.tolist())))
