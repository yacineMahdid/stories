"""Build the hair styles for the canonical base.

Each style is a shell that hugs the head: for every direction from the head center we find
the head surface (raycast), then push the hair surface out by a thickness. Outside the
style's hairline the thickness goes slightly negative, so the shell dips under the skin and
the visible hairline is a clean curve. Buns, ponytails, pigtails and long hair are extra
shapes merged into the same mesh. Coordinates are written relative to the Head bone, so the
engine parents the mesh to that bone.

Usage: python3 tools/build_hair.py assets/characters/canonical/source/AC_Player_Base.obj assets/characters/canonical/hair
"""
import base64
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_base import POS, R as REGION, build  # noqa: E402

CENTER = np.array([0.0, 0.79, 0.0])     # head center the shell is built around
HEAD = POS['Head']                      # Head bone rest position (output is relative to it)
N_AZ, N_POL, POL_MAX = 160, 104, 0.80 * math.pi
MAP_R = 0.22                            # arc-length scale used to measure distances to the hairline
SINK = 0.012                            # how far the shell dips under the skin outside the hairline
EDGE = 0.014                            # width of the rounded edge at the hairline


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------
# Head surface
# ---------------------------------------------------------------------------
def head_triangles(obj_path):
    body, _ = build(obj_path)
    P = np.array(body['pos']); idx = np.array(body['idx']).reshape(-1, 3); reg = np.array(body['r'])
    keep = []
    for tri in idx:
        if (reg[tri] != REGION['head']).any():
            continue
        c = P[tri].mean(0)
        if abs(c[0]) > 0.205 and 0.6 < c[1] < 0.77 and c[2] < 0.04:  # ears: hair goes over them
            continue
        keep.append(tri)
    T = np.array(keep)
    return P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]


def directions():
    az = -math.pi + 2 * math.pi * np.arange(N_AZ) / N_AZ
    pol = POL_MAX * np.arange(1, N_POL) / (N_POL - 1)  # row 0 (the pole) is a single vertex
    A, Pl = np.meshgrid(az, pol)                        # (N_POL-1, N_AZ)
    d = np.stack([np.sin(Pl) * np.sin(A), np.cos(Pl), np.sin(Pl) * np.cos(A)], -1)
    return A, Pl, d


def raycast(a, b, c, dirs, origin):
    """Farthest hit distance from origin along each direction (NaN if none)."""
    e1, e2 = b - a, c - a
    s = origin - a
    q = np.cross(s, e1)
    out = np.full(len(dirs), np.nan)
    for k in range(0, len(dirs), 256):
        d = dirs[k:k + 256]
        p = np.cross(d[:, None, :], e2[None])
        det = np.einsum('ntk,tk->nt', p, e1)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1), 0)
        u = np.einsum('tk,ntk->nt', s, p) * inv
        v = np.einsum('nk,tk->nt', d, q) * inv
        t = np.einsum('tk,tk->t', e2, q)[None] * inv
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0)
        best = np.where(hit, t, -np.inf).max(1)
        out[k:k + 256] = np.where(np.isfinite(best), best, np.nan)
    return out


# ---------------------------------------------------------------------------
# Hairlines: y of the edge as a function of azimuth (degrees, 0 = front, +90 = character's left).
# Hair grows above the edge.
# ---------------------------------------------------------------------------
def mirrored(points):
    pts = sorted(points)
    return [(-a, y) for a, y in reversed(pts) if a > 0] + pts


SHORT_SIDES = [(54, 0.86), (58, 0.70), (75, 0.70), (80, 0.757), (112, 0.757), (122, 0.64), (135, 0.625), (180, 0.625)]

STYLES = {
    'spiky': {
        'label': 'Spiky',
        # pointed bangs: tips at 0, ±17, ±34 degrees
        'edge': mirrored([(0, 0.826), (8.5, 0.885), (17, 0.826), (25.5, 0.885), (34, 0.83), (42, 0.872), (50, 0.876)] + SHORT_SIDES),
        'top': 0.040, 'side': 0.026,
    },
    'bob': {
        'label': 'Bob',
        'edge': mirrored([(0, 0.832), (40, 0.84), (46, 0.845), (50, 0.61), (180, 0.60)]),
        'top': 0.034, 'side': 0.030, 'flare': 0.045, 'ears': 0.03,
    },
    'swept': {
        'label': 'Side part',
        'edge': [(-180, 0.625), (-135, 0.625), (-122, 0.64), (-112, 0.757), (-80, 0.757), (-75, 0.70),
                 (-60, 0.70), (-56, 0.88), (-30, 0.905), (-22, 0.895), (0, 0.86), (25, 0.82), (40, 0.80),
                 (48, 0.80), (53, 0.66), (75, 0.66), (82, 0.70), (112, 0.70), (122, 0.64), (135, 0.625), (180, 0.625)],
        'top': 0.040, 'side': 0.028, 'part': -24,
    },
    'pigtails': {
        'label': 'Pigtails',
        'edge': mirrored([(0, 0.838), (38, 0.845), (46, 0.85), (50, 0.68), (84, 0.68), (180, 0.62)]),
        'top': 0.032, 'side': 0.028, 'part': 0,
        'extras': ['pigtails'],
    },
    'ponytail': {
        'label': 'Ponytail',
        'edge': [(-180, 0.625), (-135, 0.625), (-122, 0.64), (-112, 0.757), (-80, 0.757), (-75, 0.72),
                 (-56, 0.72), (-52, 0.88), (-30, 0.90), (0, 0.87), (20, 0.84), (38, 0.83), (50, 0.86),
                 (54, 0.86), (58, 0.72), (75, 0.72), (80, 0.757), (112, 0.757), (122, 0.64), (135, 0.625), (180, 0.625)],
        'top': 0.034, 'side': 0.024,
        'extras': ['ponytail'],
    },
    'bun': {
        'label': 'Top bun',
        'edge': mirrored([(0, 0.925), (25, 0.915), (45, 0.885), (52, 0.86), (56, 0.73), (75, 0.73)] + SHORT_SIDES[3:]),
        'top': 0.026, 'side': 0.022,
        'extras': ['bun'],
    },
    'long': {
        'label': 'Long',
        'edge': mirrored([(0, 0.835), (40, 0.842), (46, 0.85), (50, 0.60), (180, 0.585)]),
        'top': 0.032, 'side': 0.030, 'flare': 0.052, 'ears': 0.03,
        'extras': ['long'],
    },
}


def edge_samples(points):
    az = np.array([a for a, _ in points], float); y = np.array([y for _, y in points], float)
    grid = np.arange(-200, 200.25, 0.25)
    wrapped = (grid + 180) % 360 - 180
    return np.radians(grid) * MAP_R, np.interp(wrapped, az, y)


def signed_distance(u, y, su, sy):
    """Distance in the (arc, height) map to the hairline; positive where hair grows."""
    d = np.empty(len(u))
    for k in range(0, len(u), 2048):
        du = u[k:k + 2048, None] - su[None]; dy = y[k:k + 2048, None] - sy[None]
        d[k:k + 2048] = np.sqrt(du * du + dy * dy).min(1)
    edge_y = np.interp(u, su, sy)
    return np.where(y >= edge_y, d, -d)


# ---------------------------------------------------------------------------
# Extra shapes
# ---------------------------------------------------------------------------
def tube(points, radii, around=18, ridges=0.08, flat=1.0):
    """A tapered tube along a polyline, closed at the end; `flat` squashes it front-to-back."""
    pts = np.array(points, float); rad = np.array(radii, float)
    # Resample smoothly (Catmull-Rom) for a rounder curve.
    fine, frad = [], []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, len(pts) - 1)]
        for s in np.linspace(0, 1, 6, endpoint=False):
            s2, s3 = s * s, s * s * s
            fine.append(0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3))
            frad.append(rad[i] + (rad[i + 1] - rad[i]) * s)
    fine.append(pts[-1]); frad.append(rad[-1])
    fine = np.array(fine); frad = np.array(frad)
    tang = np.gradient(fine, axis=0); tang /= np.linalg.norm(tang, axis=1, keepdims=True)
    normal = np.cross(tang[0], [0, 0, 1.0]) if abs(tang[0][2]) < 0.9 else np.cross(tang[0], [1.0, 0, 0])
    normal /= np.linalg.norm(normal)
    V, F = [], []
    for i, (c, t, r) in enumerate(zip(fine, tang, frad)):
        normal = normal - t * (normal @ t); normal /= np.linalg.norm(normal)
        binormal = np.cross(t, normal)
        for k in range(around):
            ang = 2 * math.pi * k / around
            rr = r * (1 + ridges * math.cos(ang * 5))
            V.append(c + rr * (math.cos(ang) * normal + flat * math.sin(ang) * binormal))
    for i in range(len(fine) - 1):
        for k in range(around):
            a, b = i * around + k, i * around + (k + 1) % around
            F += [(a, b, a + around), (b, b + around, a + around)]
    tip = len(V); V.append(fine[-1] + tang[-1] * frad[-1] * 0.5)
    last = (len(fine) - 1) * around
    F += [(last + k, last + (k + 1) % around, tip) for k in range(around)]
    return np.array(V), np.array(F)


def curtain(a0, a1, profile, th, n_a=56, n_y=26):
    """A thick sheet of hair hanging straight down around the back of the head (a C-shaped
    band between azimuths a0..a1 degrees), with a rounded bottom edge."""
    A = np.radians(np.linspace(a0, a1, n_a))
    ys = [p[0] for p in profile][::-1]; xs = [p[1] for p in profile][::-1]; zs = [p[2] for p in profile][::-1]
    y_top, y_bot = profile[0][0], profile[-1][0]
    outer, inner = [], []
    for i in range(n_y):
        t = i / (n_y - 1)
        y = y_top + (y_bot - y_top) * t
        ex = float(np.interp(y, ys, xs)); ez = float(np.interp(y, ys, zs))
        half = th / 2 * (np.sqrt(max(0.0, 1 - ((t - 0.8) / 0.2) ** 2)) if t > 0.8 else 1.0)
        for a in A:
            ridge = 1 + 0.025 * math.cos(a * 22)
            base = np.array([math.sin(a) * ex * ridge, y, math.cos(a) * ez * ridge])
            n = np.array([math.sin(a) / ex, 0, math.cos(a) / ez]); n /= np.linalg.norm(n)
            outer.append(base + n * half); inner.append(base - n * half)
    V = np.array(outer + inner)
    off = n_y * n_a
    F = []
    for i in range(n_y - 1):
        for k in range(n_a - 1):
            a, b, c, d = i * n_a + k, i * n_a + k + 1, (i + 1) * n_a + k, (i + 1) * n_a + k + 1
            F += [(a, c, b), (b, c, d)]                                   # outer, facing out
            F += [(off + a, off + b, off + c), (off + b, off + d, off + c)]  # inner, facing in
    last = (n_y - 1) * n_a
    for k in range(n_a - 1):                                             # bottom rim
        a, b = last + k, last + k + 1
        F += [(a, off + a, b), (b, off + a, off + b)]
    for i in range(n_y - 1):                                             # the two side edges
        for k, flip in ((0, False), (n_a - 1, True)):
            a, c = i * n_a + k, (i + 1) * n_a + k
            quad = [(a, off + a, c), (c, off + a, off + c)]
            F += [(x, z, y) for x, y, z in quad] if flip else quad
    return V, np.array(F)


def ellipsoid(center, radii, lat=14, lon=24, ridges=0.06):
    V, F = [], []
    for i in range(lat + 1):
        th = math.pi * i / lat
        for k in range(lon):
            ph = 2 * math.pi * k / lon
            r = 1 + ridges * math.cos(ph * 6) * math.sin(th)
            V.append(np.array(center) + np.array(radii) * r * np.array([math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)]))
    for i in range(lat):
        for k in range(lon):
            a, b = i * lon + k, i * lon + (k + 1) % lon
            F += [(a, b, a + lon), (b, b + lon, a + lon)]
    return np.array(V), np.array(F)


def extras(name):
    if name == 'bun':
        return [ellipsoid((0, 1.035, -0.045), (0.088, 0.078, 0.088))]
    if name == 'ponytail':
        return [tube([(0, 0.93, -0.17), (0, 0.92, -0.27), (0, 0.83, -0.33), (0, 0.72, -0.33), (0, 0.62, -0.29)],
                     [0.05, 0.058, 0.062, 0.048, 0.012])]
    if name == 'pigtails':
        out = []
        for s in (1, -1):
            out.append(tube([(s * 0.17, 0.70, -0.13), (s * 0.25, 0.68, -0.13), (s * 0.29, 0.60, -0.11), (s * 0.29, 0.52, -0.09), (s * 0.27, 0.46, -0.08)],
                            [0.045, 0.05, 0.048, 0.036, 0.01]))
        return out
    if name == 'long':
        # (height, half-width, half-depth): starts inside the cap, widest just under its edge
        return [curtain(112, 248, [(0.75, 0.205, 0.205), (0.60, 0.25, 0.24), (0.465, 0.228, 0.212)], th=0.05)]
    raise KeyError(name)


# ---------------------------------------------------------------------------
# Shell
# ---------------------------------------------------------------------------
def shell(style, A, Pl, d, r, top_r):
    head_pts = CENTER + d * r[..., None]
    x, y = head_pts[..., 0], head_pts[..., 1]
    su, sy = edge_samples(style['edge'])
    s = signed_distance((A * MAP_R).ravel(), y.ravel(), su, sy).reshape(A.shape)

    upper = smoothstep(0.72, 0.98, y)
    thick = style['side'] + (style['top'] - style['side']) * upper
    if style.get('flare'):
        thick = thick + style['flare'] * (1 - smoothstep(0.60, 0.84, y)) * smoothstep(0.5, 1.2, np.abs(A))
    thick = thick + 0.0035 * np.cos(A * 26) * np.sin(Pl) * (1 - upper * 0.6)          # strand clumps
    if style.get('ears'):                                                             # puff out over the ears
        da = np.abs(A) - math.radians(97)
        thick = thick + style['ears'] * np.exp(-(da / 0.38) ** 2 - ((y - 0.685) / 0.065) ** 2)
    if 'part' in style:
        da = (A - math.radians(style['part']) + math.pi) % (2 * math.pi) - math.pi
        thick = thick - 0.012 * np.exp(-(da / 0.05) ** 2) * smoothstep(0.80, 0.93, y) * (np.abs(da) < 0.3)
    t = np.where(s > 0, -SINK + (thick + SINK) * smoothstep(0, EDGE, s), -SINK)
    rows = CENTER + d * (r + t)[..., None]
    pole = CENTER + np.array([0, 1.0, 0]) * (top_r + style['top'])

    V = np.vstack([pole[None], rows.reshape(-1, 3)])
    T = np.concatenate([[style['top']], t.ravel()])
    F = []
    for k in range(N_AZ):
        F.append((0, 1 + k, 1 + (k + 1) % N_AZ))
    for j in range(N_POL - 2):
        for k in range(N_AZ):
            a = 1 + j * N_AZ + k; b = 1 + j * N_AZ + (k + 1) % N_AZ
            F += [(a, a + N_AZ, b), (b, a + N_AZ, b + N_AZ)]
    F = np.array(F)
    visible = (T[F] > -SINK * 0.5).any(1)          # drop triangles buried under the skin
    return V, F[visible]


def merge(parts):
    Vs, Fs, off = [], [], 0
    for V, F in parts:
        Vs.append(V); Fs.append(F + off); off += len(V)
    V = np.vstack(Vs); F = np.vstack(Fs)
    used = np.unique(F)
    remap = np.full(len(V), -1); remap[used] = np.arange(len(used))
    return V[used], remap[F]


def vertex_normals(V, F):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


def write_gltf(path, name, V, F):
    N = vertex_normals(V, F)
    V = (V - HEAD).astype(np.float32); N = N.astype(np.float32)
    big = len(V) > 65535
    I = F.astype(np.uint32 if big else np.uint16).ravel()
    blob = V.tobytes() + N.tobytes() + I.tobytes()
    while len(blob) % 4:
        blob += b'\0'
    nv = len(V)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'stories/tools/build_hair.py'},
        'extras': {'attachTo': 'Head', 'style': name},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': f'Hair_{name}', 'mesh': 0}],
        'meshes': [{'name': f'Hair_{name}', 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1}, 'indices': 2, 'material': 0}]}],
        'materials': [{'name': 'Hair', 'pbrMetallicRoughness': {'baseColorFactor': [0.3, 0.18, 0.1, 1], 'metallicFactor': 0, 'roughnessFactor': 0.6}}],
        'buffers': [{'byteLength': len(blob), 'uri': 'data:application/octet-stream;base64,' + base64.b64encode(blob).decode()}],
        'bufferViews': [
            {'buffer': 0, 'byteOffset': 0, 'byteLength': nv * 12, 'target': 34962},
            {'buffer': 0, 'byteOffset': nv * 12, 'byteLength': nv * 12, 'target': 34962},
            {'buffer': 0, 'byteOffset': nv * 24, 'byteLength': I.nbytes, 'target': 34963},
        ],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': nv, 'type': 'VEC3', 'min': V.min(0).tolist(), 'max': V.max(0).tolist()},
            {'bufferView': 1, 'componentType': 5126, 'count': nv, 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5125 if big else 5123, 'count': len(I), 'type': 'SCALAR'},
        ],
    }
    with open(path, 'w') as f:
        json.dump(gltf, f, separators=(',', ':'))


if __name__ == '__main__':
    obj, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    a, b, c = head_triangles(obj)
    A, Pl, d = directions()
    r = raycast(a, b, c, d.reshape(-1, 3), CENTER).reshape(A.shape)
    for j in range(1, r.shape[0]):                       # rays that slip out under the jaw: reuse the row above
        r[j] = np.where(np.isnan(r[j]), r[j - 1], r[j])
    top_r = raycast(a, b, c, np.array([[0, 1.0, 0]]), CENTER)[0]
    index = []
    for name, style in STYLES.items():
        parts = [shell(style, A, Pl, d, r, top_r)] + [extra for e in style.get('extras', []) for extra in extras(e)]
        V, F = merge(parts)
        write_gltf(os.path.join(out_dir, f'{name}.gltf'), name, V, F)
        index.append({'id': name, 'label': style['label']})
        print(f'{name:9s} {len(V):6d} verts {len(F):6d} tris')
    with open(os.path.join(out_dir, 'index.json'), 'w') as f:
        json.dump(index, f, indent=1)
