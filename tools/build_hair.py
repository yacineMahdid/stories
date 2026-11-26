"""Build the hair styles for the canonical base.

Each style is a shell that hugs the head: for every direction from the head center we find
the head surface (raycast), then push the hair surface out by a thickness. Outside the
style's hairline the thickness goes slightly negative, so the shell dips under the skin and
the visible hairline is a clean curve. Buns, ponytails, pigtails and long hair are extra
shapes merged into the same mesh. Coordinates are written relative to the Head bone, so the
engine parents the mesh to that bone.

The hair is sculpted, not a smooth helmet. Every style has a flow: strands grow away from a
crown, or are pulled toward a tie (ponytail, bun, pigtails), and bangs can be combed forward
or swept. The hair is cut into locks along that flow, rounded on top with soft creases
between them, a little uneven, ending in rounded tips where the hair ends (bangs, nape).
Each vertex also carries
  TEXCOORD_0  u across the strands and v along them, in units of the strand texture's tile
              (TILE_U x TILE_V world units, see hair.js); u wraps around without a seam;
  COLOR_0     rgb: baked occlusion and a faint per-lock tint (darker in lock creases, along
              the hairline, under buns and tails, inside long hair);
              a: how much of the strand texture shows (it fades where the strands converge:
              crown, ties, tube tips).

Usage: python3 tools/build_hair.py assets/characters/canonical/source/AC_Player_Base.obj assets/characters/canonical/hair [style,...]
(every build gives the same files; name styles to rebuild only those)
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
N_AZ, N_POL, POL_MAX = 288, 150, 0.80 * math.pi
MAP_R = 0.22                            # arc-length scale used to measure distances to the hairline
SINK = 0.012                            # how far the shell dips under the skin outside the hairline
EDGE = 0.018                            # width of the rounded edge at the hairline
TILE_U, TILE_V = 0.24, 0.48             # world size of one tile of the strand textures (hair.js)
R_FLOW = 0.22                           # turns flow angles into world units
AO_DIRS, AO_STEPS = 32, (0.004, 0.008, 0.013, 0.02, 0.03, 0.042, 0.058, 0.08)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


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


class Grid:
    """A field sampled on the shell's (polar, azimuth) grid, row 0 being the pole."""
    def __init__(self, pole_value, rows):
        self.g = np.vstack([np.full((1, N_AZ), pole_value), rows])

    def __call__(self, dirs):
        pl = np.arccos(np.clip(dirs[..., 1], -1, 1))
        az = np.arctan2(dirs[..., 0], dirs[..., 2])
        fj = np.clip(pl / POL_MAX * (N_POL - 1), 0, N_POL - 1 - 1e-6)
        fk = (az + math.pi) / (2 * math.pi) * N_AZ
        j = np.floor(fj).astype(int); tj = fj - j
        k = np.floor(fk).astype(int); tk = fk - k
        k0 = k % N_AZ; k1 = (k + 1) % N_AZ
        g = self.g
        return ((g[j, k0] * (1 - tk) + g[j, k1] * tk) * (1 - tj)
                + (g[j + 1, k0] * (1 - tk) + g[j + 1, k1] * tk) * tj)


# ---------------------------------------------------------------------------
# Hairlines: y of the edge as a function of azimuth (degrees, 0 = front, +90 = character's left).
# Hair grows above the edge.
# ---------------------------------------------------------------------------
def mirrored(points):
    pts = sorted(points)
    return [(-a, y) for a, y in reversed(pts) if a > 0] + pts


class Hairline:
    """Signed distance to the hairline in the (arc, height) map; positive where hair grows.
    Distances are measured to the edge's segments (not to samples of it), so steep edges
    (side locks) come out as smooth as flat ones."""
    def __init__(self, points):
        pts = sorted(points)
        az = np.array([a for a, _ in pts], float); y = np.array([y for _, y in pts], float)
        if az[-1] - az[0] >= 360 - 1e-9:                             # -180 and 180 are the same point
            az, y = az[:-1], y[:-1]
        az = np.concatenate([az - 360, az, az + 360])                # three turns: no wrap to handle
        y = np.concatenate([y, y, y])
        self.u = np.radians(az) * MAP_R
        self.y = y

    def __call__(self, u, y):
        pu, py = self.u, self.y
        best = np.full(u.shape, np.inf)
        for k in range(len(pu) - 1):
            if pu[k + 1] < u.min() - 0.1 or pu[k] > u.max() + 0.1:
                continue
            ax, ay, bx, by = pu[k], py[k], pu[k + 1], py[k + 1]
            dx, dy = bx - ax, by - ay
            t = np.clip(((u - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1)
            best = np.minimum(best, np.hypot(u - ax - t * dx, y - ay - t * dy))
        return np.where(y >= np.interp(u, pu, py), best, -best)


# ---------------------------------------------------------------------------
# Flow: strands grow away from a crown or are pulled toward a tie. Around a pole q,
# theta = angle from q and phi = angle around it; strands follow lines of constant phi.
# ---------------------------------------------------------------------------
class Region:
    def __init__(self, spec, rng):
        q = unit(spec['pole'])
        s = np.asarray(spec.get('seam', (0, -0.3, -1.0)), float)  # where the u seam runs (hidden best)
        s = unit(s - (s @ q) * q)
        self.q, self.e1, self.e2 = q, -s, np.cross(q, -s)
        self.tie = spec['kind'] == 'tie'
        self.where = spec.get('where')
        self.comb = spec.get('comb')
        self.wave = (0.02, 4.0, 2, rng.uniform(0, 2 * math.pi))
        self.tiles = max(1, round(2 * math.pi * R_FLOW / TILE_U))
        self.locks = spec['locks']
        self.anchors = []

    def angles(self, D):
        theta = np.arccos(np.clip(D @ self.q, -1, 1))
        phi = np.arctan2(D @ self.e2, D @ self.e1)
        return theta, phi

    def flow_phi(self, D):
        """Angle around the pole, waved and combed: constant along a strand."""
        theta, phi = self.angles(D)
        amp, k, m, ph = self.wave
        f = phi + amp * np.sin(k * theta + m * phi + ph) * smoothstep(0.1, 0.6, theta)
        if self.comb:
            c = self.comb
            x = np.clip(wrap(phi - math.radians(c['from'])) * c['side'], 0, None)
            f = f - c['side'] * math.radians(c['amount']) * smoothstep(*c['theta'], theta) * (1 - smoothstep(0, c['width'], x))
        return theta, f

    def uvg(self, D):
        theta, f = self.flow_phi(D)
        u = f / (2 * math.pi) * self.tiles
        v = ((math.pi - theta) if self.tie else theta) * R_FLOW / TILE_V
        g = smoothstep(0.08, 0.45, theta) * smoothstep(0.08, 0.45, math.pi - theta)
        return u, v, g

    def setup_locks(self, rng):
        self.bounds = lock_bounds(self.locks, self.anchors, rng)
        n = len(self.bounds)
        self.bump = rng.uniform(-1, 1, n)      # a little thicker or thinner
        self.tip = rng.uniform(-1, 1, n)       # a little longer or shorter
        self.tint = rng.uniform(-1, 1, n)      # a little lighter or darker


def lock_bounds(n, anchors, rng):
    """Crease angles of n locks with uneven widths; creases at every anchor angle."""
    a = sorted(set(round(float(wrap(x)), 6) for x in anchors)) or [float(rng.uniform(-math.pi, math.pi))]
    out = []
    for i, start in enumerate(a):
        end = a[i + 1] if i + 1 < len(a) else a[0] + 2 * math.pi
        gap = end - start
        k = max(1, round(gap / (2 * math.pi) * n))
        w = rng.uniform(0.6, 1.45, k)
        out += list(start + np.concatenate([[0], np.cumsum(w / w.sum() * gap)[:-1]]))
    return np.sort(wrap(np.array(out)))


def lock_coords(phi, bounds):
    """e: 0 on a crease, 1 in the middle of a lock; and the lock index."""
    p = wrap(phi)
    ext = np.concatenate([bounds - 2 * math.pi, bounds, bounds + 2 * math.pi])
    i = np.searchsorted(ext, p, side='right') - 1
    x = (p - ext[i]) / (ext[i + 1] - ext[i])
    return 1 - np.abs(2 * x - 1), i % len(bounds)


def lock_profile(e, p=2.4, round_=0.25):
    """Cross-section of a lock: a broad rounded crown dropping into a soft crease. The bottom
    of the crease is rounded over a few grid cells, so diagonal creases shade smoothly."""
    e = (np.sqrt(e * e + round_ * round_) - round_) / (math.sqrt(1 + round_ * round_) - round_)
    return 1 - (1 - e) ** p


def crown(tilt, **kw):
    t = math.radians(tilt)
    return dict(pole=(0, math.cos(t), -math.sin(t)), kind='crown', **kw)


def tie(point, **kw):
    return dict(pole=tuple(np.asarray(point, float) - CENTER), kind='tie', **kw)


def ranges(az_deg, spans, ramp=5.0):
    """A value per azimuth from (a0, a1, value) spans, with soft ends."""
    out = np.zeros_like(az_deg)
    for a0, a1, val in spans:
        w = smoothstep(a0 - ramp, a0 + ramp, az_deg) * (1 - smoothstep(a1 - ramp, a1 + ramp, az_deg))
        if a0 <= -180:
            w = 1 - smoothstep(a1 - ramp, a1 + ramp, az_deg)
        if a1 >= 180:
            w = smoothstep(a0 - ramp, a0 + ramp, az_deg) if a0 > -180 else np.ones_like(az_deg)
        out = np.maximum(out, val * w)
    return out


SHORT_SIDES = [(54, 0.86), (58, 0.70), (75, 0.70), (80, 0.757), (112, 0.757), (122, 0.64), (135, 0.625), (180, 0.625)]

# Bangs of the pigtail and ponytail styles: a cap on the forehead combed forward from the crown.
BANGS_N, BANGS_C = unit((0, 1.0, 2.06)), 0.716


def in_bangs(D):
    return (D @ BANGS_N - BANGS_C) * R_FLOW


def side_of(D):
    return D[..., 0] * R_FLOW


STYLES = {
    'spiky': {
        'label': 'Spiky',
        # pointed bangs: tips at 0, ±17, ±34 degrees
        'edge': mirrored([(0, 0.826), (8.5, 0.885), (17, 0.826), (25.5, 0.885), (34, 0.83), (42, 0.872), (50, 0.876)] + SHORT_SIDES),
        'top': 0.040, 'side': 0.026,
        'flow': [crown(22, locks=18)],
        'anchors': [(a, 0.885) for a in (-25.5, -8.5, 8.5, 25.5)] + [(a, 0.872) for a in (-42, 42)],
        'depth': 0.0095, 'tips': [(-180, 180, 0.007)],
    },
    'bob': {
        'label': 'Bob',
        'edge': mirrored([(0, 0.832), (40, 0.84), (46, 0.845), (50, 0.61), (180, 0.60)]),
        'top': 0.034, 'side': 0.030, 'flare': 0.045, 'ears': 0.03,
        'flow': [crown(15, locks=18)],
        'depth': 0.009, 'tips': [(-46, 46, 0.0085), (52, 180, 0.011), (-180, -52, 0.011)],
    },
    'swept': {
        'label': 'Side part',
        'edge': [(-180, 0.625), (-135, 0.625), (-122, 0.64), (-112, 0.757), (-80, 0.757), (-75, 0.70),
                 (-60, 0.70), (-56, 0.88), (-30, 0.905), (-22, 0.895), (0, 0.86), (25, 0.82), (40, 0.80),
                 (48, 0.80), (53, 0.66), (75, 0.66), (82, 0.70), (112, 0.70), (122, 0.64), (135, 0.625), (180, 0.625)],
        'top': 0.040, 'side': 0.028,
        # the big side sweeps across the forehead, away from the part at -24 degrees
        'flow': [crown(15, locks=18, where=lambda D: np.sin(np.arctan2(D[..., 0], D[..., 2]) - math.radians(-24)) * R_FLOW,
                       comb={'from': -24, 'side': 1, 'amount': 30, 'width': 1.6, 'theta': (0.25, 1.1)}),
                 crown(15, locks=18)],
        'anchors': [(-24, 0.90)],
        'parts': [{'dist': lambda D: np.abs(np.sin(np.arctan2(D[..., 0], D[..., 2]) - math.radians(-24))) * R_FLOW * np.hypot(D[..., 0], D[..., 2]),
                   'mask': lambda D: smoothstep(0.25, 0.5, np.cos(np.arctan2(D[..., 0], D[..., 2]) - math.radians(-24))) * smoothstep(0.2, 0.55, np.hypot(D[..., 0], D[..., 2])),
                   'depth': 0.011, 'width': 0.006}],
        'depth': 0.009, 'tips': [(-58, 50, 0.009), (54, 180, 0.007), (-180, -62, 0.007)],
    },
    'pigtails': {
        'label': 'Pigtails',
        'edge': mirrored([(0, 0.838), (38, 0.845), (46, 0.85), (50, 0.68), (84, 0.68), (180, 0.62)]),
        'top': 0.032, 'side': 0.028,
        # bangs combed forward; the rest parted in the middle and pulled to the two ties
        'flow': [crown(15, locks=20, where=in_bangs),
                 tie((0.17, 0.70, -0.13), locks=12, where=side_of, seam=(0, -1, 0)),
                 tie((-0.17, 0.70, -0.13), locks=12, seam=(0, -1, 0))],
        'parts': [{'dist': lambda D: np.abs(D[..., 0]) * R_FLOW, 'mask': lambda D: smoothstep(-0.004, -0.014, in_bangs(D)),
                   'depth': 0.011, 'width': 0.0055},
                  {'dist': lambda D: np.abs(in_bangs(D)), 'mask': lambda D: np.ones(D.shape[:-1]), 'depth': 0.008, 'width': 0.006}],
        'depth': 0.008, 'tips': [(-47, 47, 0.0085)],
        'extras': ['pigtails'],
    },
    'ponytail': {
        'label': 'Ponytail',
        'edge': [(-180, 0.625), (-135, 0.625), (-122, 0.64), (-112, 0.757), (-80, 0.757), (-75, 0.72),
                 (-56, 0.72), (-52, 0.88), (-30, 0.90), (0, 0.87), (20, 0.84), (38, 0.83), (50, 0.86),
                 (54, 0.86), (58, 0.72), (75, 0.72), (80, 0.757), (112, 0.757), (122, 0.64), (135, 0.625), (180, 0.625)],
        'top': 0.034, 'side': 0.024,
        # a short fringe combed forward; everything else pulled back to the tie
        'flow': [crown(15, locks=20, where=in_bangs, comb={'from': -40, 'side': 1, 'amount': 12, 'width': 1.4, 'theta': (0.3, 1.1)}),
                 tie((0, 0.93, -0.17), locks=16, seam=(0, -1, 0.3))],
        'parts': [{'dist': lambda D: np.abs(in_bangs(D)), 'mask': lambda D: np.ones(D.shape[:-1]), 'depth': 0.007, 'width': 0.006}],
        'depth': 0.008, 'tips': [(-52, 52, 0.0075)],
        'extras': ['ponytail'],
    },
    'bun': {
        'label': 'Top bun',
        'edge': mirrored([(0, 0.925), (25, 0.915), (45, 0.885), (52, 0.86), (56, 0.73), (75, 0.73)] + SHORT_SIDES[3:]),
        'top': 0.026, 'side': 0.022,
        'flow': [tie((0, 1.035, -0.045), locks=16, seam=(0, -0.2, -1))],
        'depth': 0.0075, 'tips': [],
        'extras': ['bun'],
    },
    'long': {
        'label': 'Long',
        'edge': mirrored([(0, 0.835), (40, 0.842), (46, 0.85), (50, 0.60), (180, 0.585)]),
        'top': 0.032, 'side': 0.030, 'flare': 0.052, 'ears': 0.03,
        'flow': [crown(15, locks=18)],
        # the back is a top layer over the long hair: shorter tips and a softer edge there
        'depth': 0.009, 'tips': [(-46, 46, 0.0085), (52, 180, 0.011), (-180, -52, 0.011)], 'rim_back': 0.45,
        'extras': ['long'],
    },
}


# ---------------------------------------------------------------------------
# Parts: a mesh piece with its flow charts. Each triangle is drawn in one chart; vertices on
# a chart boundary (a parting) or on the u seam are duplicated with that chart's coordinates.
# ---------------------------------------------------------------------------
class Part:
    def __init__(self, V, F, chart, uvg, occ, tint=None, occupancy=None, weld=None):
        self.V, self.F, self.chart = np.asarray(V, float), np.asarray(F, int), np.asarray(chart, int)
        self.uvg = uvg                  # uvg(vertex_ids, chart) -> u, v, g ; period(chart) -> u period
        self.occ = np.asarray(occ, float)   # analytic occlusion in [0, 1]
        self.tint = np.ones(len(self.V)) if tint is None else np.asarray(tint, float)
        self.occupancy = occupancy      # points -> inside mask, used to occlude the other parts
        self.weld = weld                # vertex -> canonical vertex (shared normals), optional
        self.ao_origin = self.V          # where the occlusion rays start


def vertex_normals(V, F, weld=None):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    key = np.arange(len(V)) if weld is None else weld
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, key[F[:, k]], fn)
    N = N[key]
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


def prune(V, F, keep_tris):
    F = F[keep_tris]
    used = np.unique(F)
    remap = np.full(len(V), -1); remap[used] = np.arange(len(used))
    return used, remap[F]


# ---------------------------------------------------------------------------
# Shell
# ---------------------------------------------------------------------------
def shell(style, A, d, r, top_r, rng):
    D = np.vstack([[0, 1.0, 0], d.reshape(-1, 3)])
    Rh = np.concatenate([[top_r], r.ravel()])
    Az = np.concatenate([[0.0], A.ravel()])
    y = CENTER[1] + D[:, 1] * Rh
    s = Hairline(style['edge'])(Az * MAP_R, y)
    az_deg = np.degrees(Az)

    upper = smoothstep(0.72, 0.98, y)
    thick = style['side'] + (style['top'] - style['side']) * upper
    if style.get('flare'):
        thick = thick + style['flare'] * (1 - smoothstep(0.60, 0.84, y)) * smoothstep(0.5, 1.2, np.abs(Az))
    if style.get('ears'):                                                             # puff out over the ears
        da = np.abs(Az) - math.radians(97)
        thick = thick + style['ears'] * np.exp(-(da / 0.38) ** 2 - ((y - 0.685) / 0.065) ** 2)
    base = thick.copy()

    # Flow regions: the first whose `where` is positive, else the last one.
    regions = [Region(spec, rng) for spec in style['flow']]
    chart = np.full(len(D), len(regions) - 1)
    for k in range(len(regions) - 2, -1, -1):
        chart[regions[k].where(D) > 0] = k
    for az, ay in style.get('anchors', []):        # creases through these hairline points
        col = np.argmin(np.abs(wrap(A[0] - math.radians(az))))
        row = np.argmin(np.abs(CENTER[1] + d[:, col, 1] * r[:, col] - ay))
        p = d[row, col][None]
        k = len(regions) - 1
        for i in range(len(regions) - 1):
            if regions[i].where(p)[0] > 0:
                k = i; break
        regions[k].anchors.append(float(regions[k].flow_phi(p)[1][0]))
    for reg in regions:
        reg.setup_locks(rng)

    e = np.zeros(len(D)); lid = np.zeros(len(D), int); theta = np.zeros(len(D)); tint = np.ones(len(D))
    bump = np.zeros(len(D)); tipx = np.zeros(len(D))
    for k, reg in enumerate(regions):
        m = chart == k
        th, f = reg.flow_phi(D[m])
        e[m], lid[m] = lock_coords(f, reg.bounds)
        theta[m] = th
        bump[m] = reg.bump[lid[m]]; tipx[m] = reg.tip[lid[m]]; tint[m] = reg.tint[lid[m]]
    h = lock_profile(e)
    # Per-lock variations fade out toward the creases: a step there would zigzag along the grid.
    bump, tipx, tint = bump * h, tipx * h, 1 + 0.035 * tint * h
    is_tie = np.array([reg.tie for reg in regions])[chart]
    grow = np.where(is_tie, smoothstep(0.15, 0.7, theta), smoothstep(0.25, 1.15, theta))  # locks merge at the crown / tie
    part_fade = np.ones(len(D)); dip = np.zeros(len(D))
    for part in style.get('parts', []):
        dist = part['dist'](D); mask = part['mask'](D)
        dip += part['depth'] * mask * np.exp(-(dist / part['width']) ** 2)
        part_fade *= 1 - mask * (1 - smoothstep(0.003, 0.02, dist))
    near_end = 1 - smoothstep(0.02, 0.12, s)                                       # locks are most distinct where they end
    depth = style['depth'] * grow * part_fade * (0.6 + 0.4 * near_end)
    thick = thick + 0.0018 * bump * grow - depth * (1 - h) - dip

    # Where the hair ends (bangs, nape), each lock ends in a rounded tip.
    tip = ranges(az_deg, style.get('tips', []))
    s_tip = s - tip * (1 - h) - 0.4 * tip * tipx
    t = np.where(s_tip > 0, -SINK + (thick + SINK) * smoothstep(0, EDGE, s_tip), -SINK)
    V = CENTER + D * (Rh + t)[:, None]

    # Triangles of the grid; the ones buried under the skin are dropped.
    F = [(0, 1 + k, 1 + (k + 1) % N_AZ) for k in range(N_AZ)]
    for j in range(N_POL - 2):
        a = 1 + j * N_AZ + np.arange(N_AZ); b = 1 + j * N_AZ + (np.arange(N_AZ) + 1) % N_AZ
        F += list(zip(a, a + N_AZ, b)) + list(zip(b, a + N_AZ, b + N_AZ))
    F = np.array(F)
    keep = (t[F] > -SINK * 0.5).any(1)
    used, F = prune(V, F, keep)

    # Analytic occlusion: lock creases, the rounded edge where hair meets skin, parts.
    crease = (1 - h) ** 1.6 * smoothstep(0.0, 1.0, depth / style['depth'])
    rim = (1 - smoothstep(0.0, EDGE * 1.2, s_tip)) * (1 - (1 - style.get('rim_back', 1)) * ranges(az_deg, [(112, 180, 1), (-180, -112, 1)]))
    occ = (1 - 0.36 * crease) * (1 - 0.22 * rim) * (1 - 0.35 * np.clip(dip / 0.011, 0, 1))
    occ *= 0.97 + 0.05 * upper                                                         # tops a touch lighter

    def uvg(ids, k):
        return regions[k].uvg(D[used][ids])
    uvg.period = lambda k: regions[k].tiles

    # What the shell occludes (for the extras): the head plus the hair's smooth thickness.
    hair_r = Grid(top_r + style['top'], (r + np.maximum(base[1:].reshape(r.shape), 0) * (t[1:].reshape(r.shape) > 0)))
    head = Grid(top_r, r)

    def occupancy(p):
        q = p - CENTER
        dist = np.linalg.norm(q, axis=-1)
        dirs = q / np.maximum(dist, 1e-9)[..., None]
        below = dirs[..., 1] < math.cos(POL_MAX)
        return ~below & (dist < np.maximum(hair_r(dirs), head(dirs)))

    part = Part(V[used], F, chart[used], uvg, occ[used], tint[used], occupancy)
    part.ao_origin = (CENTER + D * (Rh + np.maximum(t, 0.0015))[:, None])[used]   # tucked-in edge: from the skin

    def crease_azimuths(y_level):
        # azimuths (degrees) where the default region's lock creases cross a height on the back
        row = np.argmin(np.abs(CENTER[1] + d[:, N_AZ // 2, 1] * r[:, N_AZ // 2] - y_level))
        f = regions[-1].flow_phi(d[row])[1]
        out = []
        for b in regions[-1].bounds:
            g = wrap(f - b)
            k = np.where((np.sign(g[:-1]) != np.sign(g[1:])) & (np.abs(g[:-1] - g[1:]) < 1))[0]
            out += [math.degrees(A[0, i] + (A[0, i + 1] - A[0, i]) * g[i] / (g[i] - g[i + 1])) for i in k]
        return out
    part.crease_azimuths = crease_azimuths
    return part


# ---------------------------------------------------------------------------
# Extra shapes
# ---------------------------------------------------------------------------
def catmull(points, radii, per=10):
    pts = np.array(points, float); rad = np.array(radii, float)
    fine, frad = [], []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, len(pts) - 1)]
        for s in np.linspace(0, 1, per, endpoint=False):
            s2, s3 = s * s, s * s * s
            fine.append(0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3))
            frad.append(rad[i] + (rad[i + 1] - rad[i]) * (3 * s * s - 2 * s * s * s))
    fine.append(pts[-1]); frad.append(rad[-1])
    return np.array(fine), np.array(frad)


def tube(points, radii, rng, around=48, lobes=7, depth=0.15, twist=0.9, flat=1.0):
    """A tapered tube of hair along a polyline, in a few twisting locks, closed at the end."""
    fine, frad = catmull(points, radii)
    tang = np.gradient(fine, axis=0); tang /= np.linalg.norm(tang, axis=1, keepdims=True)
    seg = np.linalg.norm(np.diff(fine, axis=0), axis=1)
    arc = np.concatenate([[0], np.cumsum(seg)]); along = arc / arc[-1]
    normal = np.cross(tang[0], [0, 0, 1.0]) if abs(tang[0][2]) < 0.9 else np.cross(tang[0], [1.0, 0, 0])
    normal /= np.linalg.norm(normal)
    bounds = lock_bounds(lobes, [], rng)
    tint_l = rng.uniform(-1, 1, len(bounds))
    tiles = max(1, round(2 * math.pi * float(np.mean(frad[:-1])) / TILE_U))
    ang = 2 * math.pi * np.arange(around) / around
    V, U, Vv, G, H, T = [], [], [], [], [], []
    for i, (c, t, r) in enumerate(zip(fine, tang, frad)):
        normal = normal - t * (normal @ t); normal /= np.linalg.norm(normal)
        binormal = np.cross(t, normal)
        a_eff = ang + twist * along[i]
        e, lid = lock_coords(a_eff, bounds)
        h = lock_profile(e)
        rr = r * (1 - depth * (1 - h) * smoothstep(0.0, 0.12, along[i]))
        V += list(c + rr[:, None] * (np.cos(ang)[:, None] * normal + flat * np.sin(ang)[:, None] * binormal))
        U += list(a_eff / (2 * math.pi) * tiles); Vv += [arc[i] / TILE_V] * around
        G += [smoothstep(0.0, 0.1, along[i]) * (1 - smoothstep(0.82, 1.0, along[i]))] * around
        H += list(h); T += list(1 + 0.04 * tint_l[lid] * h)
    F = []
    n = len(fine)
    for i in range(n - 1):
        for k in range(around):
            a, b = i * around + k, i * around + (k + 1) % around
            F += [(a, b, a + around), (b, b + around, a + around)]
    tip = len(V); V.append(fine[-1] + tang[-1] * frad[-1] * 0.6)
    U.append(U[-1]); Vv.append(Vv[-1] + frad[-1] * 0.6 / TILE_V); G.append(0.0); H.append(1.0); T.append(1.0)
    last = (n - 1) * around
    F += [(last + k, last + (k + 1) % around, tip) for k in range(around)]
    V = np.array(V); U = np.array(U); Vv = np.array(Vv); G = np.array(G); H = np.array(H)
    occ = 1 - 0.3 * (1 - H) ** 1.6

    def uvg(ids, k):
        return U[ids], Vv[ids], G[ids]
    uvg.period = lambda k: tiles

    lo, hi = fine.min(0) - frad.max(), fine.max(0) + frad.max()

    def occupancy(p):
        inside = np.zeros(p.shape[:-1], bool)
        near = np.all((p > lo) & (p < hi), axis=-1)            # only points around the tube
        q = p[near]
        hit = np.zeros(len(q), bool)
        for i in range(len(fine) - 1):
            a, b = fine[i], fine[i + 1]
            ab = b - a
            w = np.clip(((q - a) @ ab) / (ab @ ab), 0, 1)
            dist = np.linalg.norm(q - a - w[..., None] * ab, axis=-1)
            hit |= dist < frad[i] + (frad[i + 1] - frad[i]) * w
        inside[near] = hit
        return inside
    return Part(V, np.array(F), np.zeros(len(V), int), uvg, occ, np.array(T), occupancy)


def curtain(a0, a1, profile, th, rng, creases=(), n_a=96, n_y=34, width=17.0, depth=0.009):
    """A thick sheet of hair hanging straight down around the back of the head (a C-shaped
    band between azimuths a0..a1 degrees). Its locks carry on the shell's locks (creases at
    `creases` degrees, wide ones split by shallower creases) and end in rounded tips."""
    primary = [a0] + sorted(c % 360 for c in creases if a0 + 5 < c % 360 < a1 - 5) + [a1]
    cuts, strength = [], []
    for lo, hi in zip(primary[:-1], primary[1:]):
        k = max(1, round((hi - lo) / width))
        w = rng.uniform(0.75, 1.25, k)
        for j, c in enumerate(lo + (hi - lo) * np.concatenate([[0], np.cumsum(w / w.sum())[:-1]])):
            cuts.append(c); strength.append(1.0 if j == 0 else 0.55)
    cuts.append(a1); strength.append(1.0)
    B = np.radians(cuts); S = np.array(strength)
    A = np.radians(np.linspace(a0, a1, n_a))
    i = np.clip(np.searchsorted(B, A, side='right') - 1, 0, len(B) - 2)
    x = (A - B[i]) / (B[i + 1] - B[i])
    h = lock_profile(1 - np.abs(2 * x - 1))
    crease = (1 - h) * np.where(x < 0.5, S[i], S[i + 1])
    tip_l = rng.uniform(-1, 1, len(B)); tint_l = rng.uniform(-1, 1, len(B))
    ys = [p[0] for p in profile][::-1]; xs = [p[1] for p in profile][::-1]; zs = [p[2] for p in profile][::-1]
    y_top, y_bot = profile[0][0], profile[-1][0]
    length = (y_top - y_bot) * (1 - 0.055 * crease ** 1.5 - 0.03 * tip_l[i] * h - 0.012)
    outer, inner, uo, vo, go, ho, io = [], [], [], [], [], [], []
    for row in range(n_y):
        t = row / (n_y - 1)
        for k, a in enumerate(A):
            y = y_top - length[k] * t
            ex = float(np.interp(y, ys, xs)); ez = float(np.interp(y, ys, zs))
            half = th / 2 * (np.sqrt(max(0.0, 1 - ((t - 0.78) / 0.22) ** 2)) if t > 0.78 else 1.0)
            half *= 1 - 0.2 * crease[k] * smoothstep(0.0, 0.3, t)
            ridge = 1 - depth * crease[k] * smoothstep(0.0, 0.3, t) / 0.22
            base = np.array([math.sin(a) * ex * ridge, y, math.cos(a) * ez * ridge])
            n = np.array([math.sin(a) / ex, 0, math.cos(a) / ez]); n /= np.linalg.norm(n)
            outer.append(base + n * half); inner.append(base - n * half)
            uo.append(a * 0.22 / TILE_U); vo.append((y_top - y) / TILE_V)
            go.append(smoothstep(0.0, 0.08, t)); ho.append(crease[k]); io.append(t)
    V = np.array(outer + inner)
    U = np.array(uo + uo); Vv = np.array(vo + vo); G = np.array(go + go); C = np.array(ho + ho)
    tvals = np.array(io + io)
    is_inner = np.r_[np.zeros(len(outer)), np.ones(len(inner))]
    off = n_y * n_a
    F = []
    for row in range(n_y - 1):
        for k in range(n_a - 1):
            a, b, c, d = row * n_a + k, row * n_a + k + 1, (row + 1) * n_a + k, (row + 1) * n_a + k + 1
            F += [(a, c, b), (b, c, d)]                                   # outer, facing out
            F += [(off + a, off + b, off + c), (off + b, off + d, off + c)]  # inner, facing in
    last = (n_y - 1) * n_a
    for k in range(n_a - 1):                                             # bottom rim
        a, b = last + k, last + k + 1
        F += [(a, off + a, b), (b, off + a, off + b)]
    for row in range(n_y - 1):                                           # the two side edges
        for k, flip in ((0, False), (n_a - 1, True)):
            a, c = row * n_a + k, (row + 1) * n_a + k
            quad = [(a, off + a, c), (c, off + a, off + c)]
            F += [(x, z, y) for x, y, z in quad] if flip else quad
    # creases and the inside (darker higher up, where it is deep under the hair) are in shadow
    occ = (1 - 0.3 * C ** 1.6) * np.where(is_inner > 0, 0.55 + 0.3 * smoothstep(0.2, 1.0, tvals), 1.0)
    T = np.tile(1 + 0.035 * tint_l[i] * h, 2 * n_y)

    def uvg(ids, k):
        return U[ids], Vv[ids], G[ids]
    uvg.period = lambda k: 1e9                                            # open band: no seam

    return Part(V, np.array(F), np.zeros(len(V), int), uvg, occ, T, None)


def ellipsoid(center, radii, rng, lat=30, lon=56, lobes=7, depth=0.09, twist=1.1):
    """A bun: a ball of hair wound in a few twisting locks."""
    c = np.array(center, float); rad = np.array(radii, float)
    bounds = lock_bounds(lobes, [], rng)
    tint_l = rng.uniform(-1, 1, len(bounds))
    tiles = max(1, round(2 * math.pi * float(rad.mean()) / TILE_U))
    V, U, Vv, G, H, T = [], [], [], [], [], []
    for i in range(lat + 1):
        th = math.pi * i / lat
        ph = 2 * math.pi * np.arange(lon) / lon
        a_eff = ph + twist * th
        e, lid = lock_coords(a_eff, bounds)
        h = lock_profile(e)
        k = 1 - depth * (1 - h) * math.sin(th) ** 0.7
        dirs = np.stack([math.sin(th) * np.cos(ph), np.full(lon, math.cos(th)), math.sin(th) * np.sin(ph)], -1)
        V += list(c + rad * k[:, None] * dirs)
        U += list(-a_eff / (2 * math.pi) * tiles); Vv += [th * rad.mean() * 1.4 / TILE_V] * lon
        G += [float(smoothstep(0.15, 0.6, th) * smoothstep(0.15, 0.6, math.pi - th))] * lon
        H += list(h); T += list(1 + 0.04 * tint_l[lid] * h)
    F = []
    for i in range(lat):
        for k in range(lon):
            a, b = i * lon + k, i * lon + (k + 1) % lon
            F += [(a, b, a + lon), (b, b + lon, a + lon)]
    V = np.array(V); H = np.array(H)
    U, Vv, G = np.array(U), np.array(Vv), np.array(G)
    # The poles are rings of coincident vertices: weld them so they share one normal.
    weld = np.arange(len(V))
    weld[:lon] = 0; weld[lat * lon:] = lat * lon
    occ = 1 - 0.3 * (1 - H) ** 1.6

    def uvg(ids, k):
        return U[ids], Vv[ids], G[ids]
    uvg.period = lambda k: tiles

    def occupancy(p):
        return (((p - c) / rad) ** 2).sum(-1) < 1
    return Part(V, np.array(F), np.zeros(len(V), int), uvg, occ, np.array(T), occupancy, weld)


def extras(name, rng, shell_part):
    if name == 'bun':
        return [ellipsoid((0, 1.035, -0.045), (0.088, 0.078, 0.088), rng)]
    if name == 'ponytail':
        return [tube([(0, 0.93, -0.17), (0, 0.92, -0.27), (0, 0.83, -0.33), (0, 0.72, -0.33), (0, 0.62, -0.29)],
                     [0.05, 0.058, 0.062, 0.048, 0.012], rng)]
    if name == 'pigtails':
        out = []
        for s in (1, -1):
            out.append(tube([(s * 0.17, 0.70, -0.13), (s * 0.25, 0.68, -0.13), (s * 0.29, 0.60, -0.11), (s * 0.29, 0.52, -0.09), (s * 0.27, 0.46, -0.08)],
                            [0.045, 0.05, 0.048, 0.036, 0.01], rng, around=44, lobes=6, twist=s * 0.8))
        return out
    if name == 'long':
        # (height, half-width, half-depth): starts inside the cap, tucked under the cap's tips,
        # then out below them like a second layer
        return [curtain(112, 248, [(0.75, 0.19, 0.19), (0.60, 0.205, 0.188), (0.53, 0.24, 0.226), (0.465, 0.228, 0.212)], th=0.05, rng=rng,
                        creases=shell_part.crease_azimuths(0.62))]
    raise KeyError(name)


# ---------------------------------------------------------------------------
# Baked occlusion: rays from every vertex against the head, the neck and the other parts.
# ---------------------------------------------------------------------------
def body_occupancy(p):
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    neck = (x * x + (z - 0.035) ** 2 < 0.05 ** 2) & (y > 0.45) & (y < 0.62)
    torso = (x / 0.115) ** 2 + ((y - 0.40) / 0.13) ** 2 + ((z - 0.05) / 0.10) ** 2 < 1
    return neck | torso


def hemisphere(n):
    i = np.arange(n) + 0.5
    rr = np.sqrt(i / n); a = i * math.pi * (3 - math.sqrt(5))
    return np.stack([rr * np.cos(a), rr * np.sin(a), np.sqrt(1 - rr * rr)], -1)   # cosine-weighted


def bake_ao(V, N, blockers):
    dirs = hemisphere(AO_DIRS)
    t1 = np.cross(N, np.where(np.abs(N[:, 1:2]) < 0.9, [[0, 1.0, 0]], [[1.0, 0, 0]]))
    t1 /= np.linalg.norm(t1, axis=1, keepdims=True)
    t2 = np.cross(N, t1)
    open_ = np.zeros(len(V))
    for k in range(0, len(V), 2048):
        n, a, b, p = N[k:k + 2048], t1[k:k + 2048], t2[k:k + 2048], V[k:k + 2048]
        ray = dirs[None, :, 0:1] * a[:, None] + dirs[None, :, 1:2] * b[:, None] + dirs[None, :, 2:3] * n[:, None]
        hit = np.zeros(ray.shape[:2], bool)
        for step in AO_STEPS:
            q = p[:, None] + n[:, None] * 0.002 + ray * step
            for blocker in blockers:
                hit |= blocker(q)
        open_[k:k + 2048] = 1 - hit.mean(1)
    return open_


def smooth_on_mesh(values, F, n_verts, weld=None, rounds=2):
    key = np.arange(n_verts) if weld is None else weld
    v = values.copy()
    for _ in range(rounds):
        acc = np.zeros(n_verts); cnt = np.zeros(n_verts)
        for a, b in ((0, 1), (1, 2), (2, 0)):
            np.add.at(acc, key[F[:, a]], v[F[:, b]]); np.add.at(cnt, key[F[:, a]], 1)
            np.add.at(acc, key[F[:, b]], v[F[:, a]]); np.add.at(cnt, key[F[:, b]], 1)
        v = 0.5 * v + 0.5 * acc[key] / np.maximum(cnt[key], 1)
    return v


# ---------------------------------------------------------------------------
# Output: split chart boundaries and u seams, merge the parts, write glTF.
# ---------------------------------------------------------------------------
def split(part, N, color):
    V, F = part.V, part.F
    tri_chart = part.chart[F].min(1)                   # a triangle on a boundary takes the lower chart
    U = np.zeros(F.shape); W = np.zeros(F.shape); G = np.zeros(F.shape); S = np.zeros(F.shape, int)
    for c in np.unique(tri_chart):
        m = tri_chart == c
        ids = np.unique(F[m])
        u, v, g = part.uvg(ids, c)
        pos = np.searchsorted(ids, F[m])
        cu = u[pos]
        period = part.uvg.period(c)
        lo, hi = cu.min(1, keepdims=True), cu.max(1, keepdims=True)
        sh = (hi - lo > period / 2) & (cu < (lo + hi) / 2)          # across the u seam: wrap the low corners
        U[m], W[m], G[m], S[m] = cu + sh * period, v[pos], g[pos], sh
    key = (F * (part.chart.max() + 1) + tri_chart[:, None]) * 2 + S
    _, first, inv = np.unique(key.ravel(), return_index=True, return_inverse=True)
    src = F.ravel()[first]
    uv = np.stack([U.ravel()[first], W.ravel()[first]], -1)
    return V[src], N[src], uv, color[src], G.ravel()[first], inv.reshape(F.shape)


def write_gltf(path, name, V, N, UV, C, F):
    V = (V - HEAD).astype(np.float32); N = N.astype(np.float32); UV = UV.astype(np.float32)
    C = np.clip(np.round(C * 255), 0, 255).astype(np.uint8)
    big = len(V) > 65535
    I = F.astype(np.uint32 if big else np.uint16).ravel()
    chunks = [V.tobytes(), N.tobytes(), UV.tobytes(), C.tobytes(), I.tobytes()]
    offsets = np.concatenate([[0], np.cumsum([len(c) for c in chunks])]).tolist()
    blob = b''.join(chunks)
    while len(blob) % 4:
        blob += b'\0'
    nv = len(V)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'stories/tools/build_hair.py'},
        'extras': {'attachTo': 'Head', 'style': name, 'tile': [TILE_U, TILE_V]},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': f'Hair_{name}', 'mesh': 0}],
        'meshes': [{'name': f'Hair_{name}', 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2, 'COLOR_0': 3}, 'indices': 4, 'material': 0}]}],
        'materials': [{'name': 'Hair', 'pbrMetallicRoughness': {'baseColorFactor': [0.3, 0.18, 0.1, 1], 'metallicFactor': 0, 'roughnessFactor': 0.85}}],
        'buffers': [{'byteLength': len(blob), 'uri': 'data:application/octet-stream;base64,' + base64.b64encode(blob).decode()}],
        'bufferViews': [
            {'buffer': 0, 'byteOffset': offsets[0], 'byteLength': len(chunks[0]), 'target': 34962},
            {'buffer': 0, 'byteOffset': offsets[1], 'byteLength': len(chunks[1]), 'target': 34962},
            {'buffer': 0, 'byteOffset': offsets[2], 'byteLength': len(chunks[2]), 'target': 34962},
            {'buffer': 0, 'byteOffset': offsets[3], 'byteLength': len(chunks[3]), 'target': 34962},
            {'buffer': 0, 'byteOffset': offsets[4], 'byteLength': len(chunks[4]), 'target': 34963},
        ],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': nv, 'type': 'VEC3', 'min': V.min(0).tolist(), 'max': V.max(0).tolist()},
            {'bufferView': 1, 'componentType': 5126, 'count': nv, 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5126, 'count': nv, 'type': 'VEC2'},
            {'bufferView': 3, 'componentType': 5121, 'normalized': True, 'count': nv, 'type': 'VEC4'},
            {'bufferView': 4, 'componentType': 5125 if big else 5123, 'count': len(I), 'type': 'SCALAR'},
        ],
    }
    with open(path, 'w') as f:
        json.dump(gltf, f, separators=(',', ':'))


def build_style(name, style, A, d, r, top_r, head_r):
    rng = np.random.default_rng(sum(map(ord, name)))           # same output every build
    parts = [shell(style, A, d, r, top_r, rng)]
    parts += [x for e in style.get('extras', []) for x in extras(e, rng, parts[0])]
    out = []
    for i, part in enumerate(parts):
        N = vertex_normals(part.V, part.F, part.weld)
        blockers = [head_r, body_occupancy] + [p.occupancy for j, p in enumerate(parts) if j != i and p.occupancy]
        ao = bake_ao(part.ao_origin, N, blockers)
        ao = smooth_on_mesh(ao, part.F, len(part.V), part.weld)
        shade = (1 - 0.6 * (1 - ao)) * part.occ * part.tint
        color = np.stack([shade, shade, shade], -1)
        out.append(split(part, N, color))
    V = np.vstack([o[0] for o in out]); N = np.vstack([o[1] for o in out]); UV = np.vstack([o[2] for o in out])
    C = np.vstack([o[3] for o in out]); G = np.concatenate([o[4] for o in out])
    Fs, off = [], 0
    for o in out:
        Fs.append(o[5] + off); off += len(o[0])
    C = np.concatenate([np.clip(C, 0, 1), G[:, None]], 1)
    return V, N, UV, C, np.vstack(Fs)


if __name__ == '__main__':
    obj, out_dir = sys.argv[1], sys.argv[2]
    only = sys.argv[3].split(',') if len(sys.argv) > 3 else None
    os.makedirs(out_dir, exist_ok=True)
    a, b, c = head_triangles(obj)
    A, _, d = directions()
    r = raycast(a, b, c, d.reshape(-1, 3), CENTER).reshape(A.shape)
    for j in range(1, r.shape[0]):                       # rays that slip out under the jaw: reuse the row above
        r[j] = np.where(np.isnan(r[j]), r[j - 1], r[j])
    # The skull is low-poly; smooth its radius field so the hair dome comes out round, not faceted.
    for _ in range(4):
        r = (np.roll(r, 1, axis=1) + 2 * r + np.roll(r, -1, axis=1)) / 4                     # around (wraps)
        r = np.vstack([r[:1], (r[:-2] + 2 * r[1:-1] + r[2:]) / 4, r[-1:]])                  # top to bottom
    r = r + 0.002                                                                          # stay just outside
    top_r = raycast(a, b, c, np.array([[0, 1.0, 0]]), CENTER)[0]
    head_grid = Grid(top_r, r - 0.004)

    def head_r(p):
        q = p - CENTER
        dist = np.linalg.norm(q, axis=-1)
        dirs = q / np.maximum(dist, 1e-9)[..., None]
        return (dirs[..., 1] >= math.cos(POL_MAX)) & (dist < head_grid(dirs))

    index = []
    for name, style in STYLES.items():
        index.append({'id': name, 'label': style['label']})
        if only and name not in only:
            continue
        V, N, UV, C, F = build_style(name, style, A, d, r, top_r, head_r)
        write_gltf(os.path.join(out_dir, f'{name}.gltf'), name, V, N, UV, C, F)
        print(f'{name:9s} {len(V):6d} verts {len(F):6d} tris')
    with open(os.path.join(out_dir, 'index.json'), 'w') as f:
        json.dump(index, f, indent=1)
