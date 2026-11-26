"""Build the hair styles for the canonical base.

Each style is a shell that hugs the head: for every direction from the head center we find
the head surface (raycast), then push the hair surface out by a thickness. Outside the
style's hairline the thickness goes slightly negative, so the shell dips under the skin and
the visible hairline is a clean curve. Buns, tails, braids, ropes, ringlets, rolls, puffs and
long hair are extra shapes merged into the same mesh. Coordinates are written relative to the
Head bone, so the engine parents the mesh to that bone.

The hair is sculpted, not a smooth helmet. Every style has a flow: strands grow away from a
crown, or are pulled toward a tie (ponytail, bun, pigtails), and bangs can be combed forward
or swept. The hair is cut into locks along that flow: a few broad locks of irregular widths
between creases of varied depth (some deep, some shallow and starting lower down), rounded on
top, a little uneven, ending in rounded tips where the hair ends (bangs, nape). Curly and coily
hair adds curl clumps (lumps) and a scalloped edge made of them; volume styles grow out to an
envelope. Each vertex also carries
  TEXCOORD_0  u across the strands and v along them, in units of the strand texture's tile
              (TILE_U x TILE_V world units, see hair.js); u wraps around without a seam. Curly
              and coily surfaces use a conformal v (Mercator), so their tiles stay round.
  COLOR_0     r: baked occlusion and a faint per-lock tint (darker in lock creases, along the
                 hairline, under buns and tails, inside long hair);
              g: skin mix, how much of the skin colour shows instead of the hair colour (faded
                 sides, the scalp through a buzz cut, partings);
              b: reserved (0);
              a: how much of the strand texture shows (it fades where the strands converge:
                 crown, ties, tube tips), times (1 - skin mix).

Each look is a quantized binary glTF (KHR_mesh_quantization): positions int16 in Head-bone
metres, normals int8, uv / UV_SCALE int16, COLOR_0 uint8, uint16 indices, no node transform.
A style is <id>.glb; a texture that changes the shape has its own mesh (bob-curly.glb, ...),
see VARIANTS. index.json lists the styles with their textures and files.

Usage: python3 tools/build_hair.py assets/characters/canonical/source/AC_Player_Base.obj assets/characters/canonical/hair [name,...]
(every build gives the same bytes; name outputs, styles like `afro` or texture meshes like
`bob-curly`, to rebuild only those)
"""
import json
import math
import os
import struct
import sys
import zlib
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_base import POS, R as REGION, build  # noqa: E402

CENTER = np.array([0.0, 0.79, 0.0])     # head center the shell is built around
HEAD = POS['Head']                      # Head bone rest position (output is relative to it)
N_AZ, N_POL, POL_MAX = 288, 150, 0.80 * math.pi
MAP_R = 0.22                            # arc-length scale used to measure distances to the hairline
SINK = 0.012                            # how far the shell dips under the skin outside the hairline
OFFSET = 0.002                          # how far out of the (smoothed) skin the shell's base surface lies
EDGE = 0.018                            # width of the rounded edge at the hairline
TILE_U, TILE_V = 0.24, 0.48             # world size of one tile of the strand textures (hair.js)
UV_SCALE = 16.0                         # TEXCOORD_0 is stored as uv / UV_SCALE (hair.js repeats by it)
R_FLOW = 0.22                           # turns flow angles into world units
RHYTHM = 0.6                            # a shell has this many locks per lock of its nominal count
LOCK_BUMP = 0.0024                      # how much fuller or flatter a lock may be than its neighbours
CREASE_W = 0.8                          # crease width, as a share of an average lock's half-width
AO_DIRS, AO_STEPS = 32, (0.004, 0.008, 0.013, 0.02, 0.03, 0.042, 0.058, 0.08)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


def dir_from(az, el):
    """Unit direction at an azimuth (degrees, 0 = front, +90 = the character's left) and elevation."""
    a, e = math.radians(az), math.radians(el)
    return np.array([math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)])


def rng_for(name, *tags):
    """A random stream of its own for one piece of a style, the same every build."""
    return np.random.default_rng([sum(map(ord, name))] + [zlib.crc32(str(t).encode()) for t in tags])


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


def head_setup(obj_path):
    """The head as seen from CENTER: grid directions A, d, the smoothed radius just outside the
    skin along them (r), the same at the pole (top_r), and an occupancy test for the head."""
    a, b, c = head_triangles(obj_path)
    A, _, d = directions()
    r = raycast(a, b, c, d.reshape(-1, 3), CENTER).reshape(A.shape)
    for j in range(1, r.shape[0]):                       # rays that slip out under the jaw: reuse the row above
        r[j] = np.where(np.isnan(r[j]), r[j - 1], r[j])
    # The skull is low-poly; smooth its radius field so the hair dome comes out round, not faceted.
    for _ in range(4):
        r = (np.roll(r, 1, axis=1) + 2 * r + np.roll(r, -1, axis=1)) / 4                     # around (wraps)
        r = np.vstack([r[:1], (r[:-2] + 2 * r[1:-1] + r[2:]) / 4, r[-1:]])                  # top to bottom
    r = r + OFFSET                                                                         # stay just outside
    # The pole gets the same treatment as the rings around it: it continues the smoothed dome of
    # the first two rings (r = a + b theta^2), so the top of every shell is round, with no pit.
    top_r = float(r[0].mean() - (r[1].mean() - r[0].mean()) / 3)
    head_grid = Grid(top_r - 0.004, r - 0.004)

    def head_r(p):
        q = p - CENTER
        dist = np.linalg.norm(q, axis=-1)
        dirs = q / np.maximum(dist, 1e-9)[..., None]
        return (dirs[..., 1] >= math.cos(POL_MAX)) & (dist < head_grid(dirs))
    return A, d, r, top_r, head_r


def head_point(az_deg, y, ctx, out=0.0):
    """The point of the (smoothed) head surface at an azimuth and height, pushed out by `out`."""
    head = Grid(ctx.top_r, ctx.r)
    pol = np.linspace(0.0, POL_MAX, 600)
    a = math.radians(az_deg)
    D = np.stack([np.sin(pol) * math.sin(a), np.cos(pol), np.sin(pol) * math.cos(a)], -1)
    ys = CENTER[1] + D[:, 1] * head(D)
    k = int(np.clip(np.searchsorted(-ys, -y), 1, len(ys) - 1))
    t = (ys[k - 1] - y) / (ys[k - 1] - ys[k])
    p = unit(D[k - 1] * (1 - t) + D[k] * t)
    return CENTER + p * (head(p[None])[0] + out)


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
        self.axis = None
        if spec['kind'] == 'axis':
            # Rows wrapped around a line from the face to the nape: they run front to back, fanned
            # out at the forehead and gathered at the nape, and both ends of the chart are hidden.
            F, N = (np.asarray(x, float) for x in spec['ends'])
            a = unit(N - F)
            up = unit(np.array([0, 1.0, 0]) - a[1] * a)
            self.axis = (F, a, float(np.linalg.norm(N - F)))
            self.q, self.e1, self.e2 = a, up, np.cross(a, up)
        self.where = spec.get('where')
        self.comb = spec.get('comb')
        self.wave = (0.02, 4.0, 2, rng.uniform(0, 2 * math.pi))
        if spec.get('wave'):                         # wavy hair: every lock snakes in a slow S
            amp, k = spec['wave']
            self.wave = (amp, k, 0, self.wave[3])
        # Curly and coily tiles have no direction but must stay round: a conformal chart.
        self.conformal = spec.get('conformal', False)
        self.tiles = max(1, round(2 * math.pi * spec.get('uv_r', R_FLOW) / TILE_U))
        self.locks = spec['locks']
        self.anchors = []

    def angles(self, D):
        if self.axis is not None:
            F, a, length = self.axis
            v = CENTER + D * R_FLOW - F
            along = v @ a
            perp = v - along[..., None] * a
            return math.pi * np.clip(along / length, 0, 1), np.arctan2(perp @ self.e2, perp @ self.e1)
        theta = np.arccos(np.clip(D @ self.q, -1, 1))
        phi = np.arctan2(D @ self.e2, D @ self.e1)
        return theta, phi

    def flow_phi(self, D):
        """Angle around the pole, waved and combed: constant along a strand."""
        theta, phi = self.angles(D)
        amp, k, m, ph = self.wave
        f = phi + amp * np.sin(k * theta + m * phi + ph) * smoothstep(0.1, 0.6, theta)
        if self.comb:
            # Combed away from a part at `from`: full strength at the part, fading over `width`
            # on the combed side, and fading again before the far side of the pole, so the
            # flow is continuous all the way around (no jump where phi - from wraps).
            c = self.comb
            x = wrap(phi - math.radians(c['from'])) * c['side']
            w = np.where(x >= 0, 1 - smoothstep(0, c['width'], x), smoothstep(-math.pi, -math.pi + c['width'], x))
            f = f - c['side'] * math.radians(c['amount']) * smoothstep(*c['theta'], theta) * w
        return theta, f

    def uvg(self, D):
        theta, f = self.flow_phi(D)
        u = f / (2 * math.pi) * self.tiles
        if self.conformal:
            # Mercator: u and v keep the same scale everywhere (tiles shrink toward the poles
            # instead of squashing), and the tile stays at full strength up to near the poles.
            th = np.clip(theta, 0.02, math.pi - 0.02)
            v = self.tiles / (4 * math.pi) * np.log(np.tan(th / 2))
            g = smoothstep(0.05, 0.2, theta) * smoothstep(0.05, 0.2, math.pi - theta)
        else:
            v = ((math.pi - theta) if self.tie else theta) * R_FLOW / TILE_V
            g = smoothstep(0.08, 0.45, theta) * smoothstep(0.08, 0.45, math.pi - theta)
        return u, v, g

    def setup_locks(self, legacy, rng, even=False, alternate=False):
        # hair-soft drew its per-lock values from the style's main stream; they are still drawn
        # (and dropped), so the extras that draw after the shell (tails, buns) come out as before.
        n_old = len(lock_bounds(self.locks, self.anchors, legacy))
        for _ in range(3):
            legacy.uniform(-1, 1, n_old)
        self.bounds, self.strength, self.start = shell_creases(self.locks, self.anchors, rng, even)
        n = len(self.bounds)
        # A broad lock keeps creases as narrow as an average lock's: a flat-topped chunk with a
        # clear crease on each side, not a wide shallow trough.
        half = (np.roll(self.bounds, -1) - self.bounds) % (2 * math.pi) / 2
        self.sharp = np.maximum(1.0, half / (CREASE_W * math.pi / n))
        self.bump = rng.uniform(-1, 1, n)      # a little thicker or thinner
        self.tip = rng.uniform(-1, 1, n)       # a little longer or shorter
        self.tint = rng.uniform(-1, 1, n)      # a little lighter or darker
        if even:
            self.bump[:] = 0; self.tip[:] = 0; self.tint[:] = 0
        if alternate:                          # wavy ends flick alternately out and in
            self.tip = np.where(np.arange(n) % 2 == 0, 1.0, -1.0)


def lock_bounds(n, anchors, rng):
    """Crease angles of n locks with uneven widths; creases at every anchor angle (tubes, buns)."""
    a = sorted(set(round(float(wrap(x)), 6) for x in anchors)) or [float(rng.uniform(-math.pi, math.pi))]
    out = []
    for i, start in enumerate(a):
        end = a[i + 1] if i + 1 < len(a) else a[0] + 2 * math.pi
        gap = end - start
        k = max(1, round(gap / (2 * math.pi) * n))
        w = rng.uniform(0.6, 1.45, k)
        out += list(start + np.concatenate([[0], np.cumsum(w / w.sum() * gap)[:-1]]))
    return np.sort(wrap(np.array(out)))


def shell_creases(n, anchors, rng, even=False):
    """The creases of a shell's locks: fewer and broader than the nominal count n, of irregular
    widths, some deep and some shallow (a shallow one starts lower down), so a head never reads
    as a ribbed pumpkin from above or behind. Creases go through every anchor angle; `even`
    gives n equal locks (cornrows). Returns (angles, depth factors, start offsets in theta)."""
    if even:
        b = np.sort(wrap(np.linspace(-math.pi, math.pi, n, endpoint=False) + math.pi / n))
        return b, np.ones(n), np.zeros(n)
    m = max(3, round(n * RHYTHM))
    a = sorted(set(round(float(wrap(x)), 6) for x in anchors))
    fixed = bool(a)
    if not a:
        a = [float(rng.uniform(-math.pi, math.pi))]
    pos, anchor = [], []
    for i, start in enumerate(a):
        end = a[i + 1] if i + 1 < len(a) else a[0] + 2 * math.pi
        gap = end - start
        k = max(1, round(gap / (2 * math.pi) * m))
        w = np.clip(np.exp(rng.normal(0.0, 0.5, k)), 0.4, 2.6)
        pos += list(start + np.concatenate([[0], np.cumsum(w / w.sum() * gap)[:-1]]))
        anchor += [fixed] + [False] * (k - 1)
    pos = wrap(np.array(pos)); order = np.argsort(pos)
    pos, anchor = pos[order], np.array(anchor)[order]
    k = len(pos)
    shallow = rng.uniform(0, 1, k) < 0.38
    strength = np.where(shallow, rng.uniform(0.22, 0.45, k), rng.uniform(1.0, 1.45, k))
    start = np.where(shallow, rng.uniform(0.15, 0.45, k), rng.uniform(0.0, 0.12, k))
    strength[anchor] = 1.15; start[anchor] = 0.0
    return pos, strength, start


def lock_coords(phi, bounds):
    """e: 0 on a crease, 1 in the middle of a lock; the lock index; and the nearest crease."""
    p = wrap(phi)
    ext = np.concatenate([bounds - 2 * math.pi, bounds, bounds + 2 * math.pi])
    i = np.searchsorted(ext, p, side='right') - 1
    x = (p - ext[i]) / (ext[i + 1] - ext[i])
    n = len(bounds)
    return 1 - np.abs(2 * x - 1), i % n, np.where(x < 0.5, i, i + 1) % n


def lock_profile(e, p=2.4, round_=0.25):
    """Cross-section of a lock: a broad rounded crown dropping into a soft crease. The bottom
    of the crease is rounded over a few grid cells, so diagonal creases shade smoothly."""
    e = (np.sqrt(e * e + round_ * round_) - round_) / (math.sqrt(1 + round_ * round_) - round_)
    return 1 - (1 - e) ** p


def crown(tilt, **kw):
    t = math.radians(tilt)
    return dict(pole=(0, math.cos(t), -math.sin(t)), kind='crown', **kw)


def face_pole(el, **kw):
    """A flow pole in the face (no hair there): its opposite pole lands low on the back of the
    head, so a round tile (curls, coils) never pinches on the top or the front."""
    return dict(pole=tuple(dir_from(0, el)), kind='crown', seam=(0, -1.0, 0.05), **kw)


def tie(point, **kw):
    return dict(pole=tuple(np.asarray(point, float) - CENTER), kind='tie', **kw)


def rows_between(front, back, **kw):
    """Rows (locks) wrapped around the line from `front` (inside the face) to `back` (the nape)."""
    return dict(pole=(0, 0, -1.0), kind='axis', ends=(front, back), **kw)


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


def envelope(D, c, radii):
    """Distance from CENTER along each direction to an ellipsoid (the outside of a volume)."""
    radii = np.asarray(radii, float)
    o = (CENTER - np.asarray(c, float)) / radii
    dd = D / radii
    qa = (dd * dd).sum(-1); qb = 2 * (o * dd).sum(-1); qc = (o * o).sum() - 1
    return (-qb + np.sqrt(np.maximum(qb * qb - 4 * qa * qc, 0))) / (2 * qa)


def fib_dirs(n, rng, jitter=0.25):
    """About n evenly spread directions (a Fibonacci sphere), a little jittered."""
    i = np.arange(n) + 0.5
    yy = 1 - 2 * i / n
    rr = np.sqrt(1 - yy * yy)
    a = i * math.pi * (3 - math.sqrt(5)) + rng.uniform(-jitter, jitter, n)
    return unit(np.stack([rr * np.cos(a), yy + rng.uniform(-0.02, 0.02, n), rr * np.sin(a)], -1))


def lump_field(D, n, radius, rng, stretch=None):
    """Curl clumps: round bumps over about n directions, about 1 on a clump's top and 0 between
    clumps. Where `stretch` > 1 a clump is drawn out downward (hanging curls), so curls
    read as springy clumps rather than cauliflower."""
    L = fib_dirs(n, rng)
    if stretch is None:
        stretch = np.ones(len(D))
    down = np.array([0, -1.0, 0]) + D[:, 1:2] * D                    # downhill on the sphere
    ln = np.linalg.norm(down, axis=1, keepdims=True)
    down = np.where(ln > 1e-6, down / np.maximum(ln, 1e-12), [[1.0, 0, 0]])
    rest = np.ones(len(D))          # a soft union: clumps merge in rounded valleys, never a sharp crease
    for k in range(0, len(L), 32):
        Lk = L[k:k + 32]
        cosang = D @ Lk.T
        delta = Lk[None] - cosang[..., None] * D[:, None]            # offset in the tangent plane
        along = np.einsum('vkc,vc->vk', delta, down)
        across2 = np.einsum('vkc,vkc->vk', delta, delta) - along ** 2
        dist2 = across2 + (along / stretch[:, None]) ** 2
        bump = np.clip(1 - dist2 / radius ** 2, 0, 1) ** 2 * (cosang > 0)
        rest *= np.prod(1 - 0.9 * bump, axis=1)
    return (1 - rest) / 0.9


SHORT_SIDES = [(54, 0.86), (58, 0.70), (75, 0.70), (80, 0.757), (112, 0.757), (122, 0.64), (135, 0.625), (180, 0.625)]
# A natural hairline: temples a little back, square sideburns, ears out (buzz cut, cornrows).
NATURAL = mirrored([(0, 0.915), (14, 0.912), (30, 0.902), (42, 0.885), (50, 0.872), (54, 0.86), (57, 0.78), (62, 0.745),
                    (75, 0.745), (80, 0.757), (112, 0.757), (122, 0.66), (135, 0.64), (180, 0.635)])
# A crisp line-up: a straight forehead line and squared temples (the fade).
LINEUP = mirrored([(0, 0.89), (38, 0.888), (46, 0.885), (49, 0.80), (55, 0.74), (75, 0.74), (80, 0.757), (112, 0.757),
                   (122, 0.665), (135, 0.648), (180, 0.645)])

# Bangs of the pigtail and ponytail styles: a cap on the forehead combed forward from the crown.
BANGS_N, BANGS_C = unit((0, 1.0, 2.06)), 0.716
EARS = {'az': 97.0, 'y': 0.685, 'w': 0.38, 'h': 0.065}          # where hair puffs out over the ears


def in_bangs(D):
    return (D @ BANGS_N - BANGS_C) * R_FLOW


def side_of(D):
    return D[..., 0] * R_FLOW


def az_of(D):
    return np.arctan2(D[..., 0], D[..., 2])


def center_part(depth, width, skin=0.0, reach=(0.2, 0.55)):
    """A parting straight back from the middle of the forehead."""
    return {'dist': lambda D: np.abs(np.sin(az_of(D))) * R_FLOW * np.hypot(D[..., 0], D[..., 2]),
            'mask': lambda D: smoothstep(0.25, 0.5, np.cos(az_of(D))) * smoothstep(*reach, np.hypot(D[..., 0], D[..., 2])),
            'depth': depth, 'width': width, 'skin': skin}


# Every style: its shell (hairline `edge`, thickness `top`/`side`, flow, locks, tips ...), the
# extra shapes, and the textures it can be drawn with (its natural texture first).
STYLES = {
    'spiky': {
        'label': 'Spiky', 'textures': ['straight'],
        # pointed bangs: tips at 0, ±17, ±34 degrees
        'edge': mirrored([(0, 0.826), (8.5, 0.885), (17, 0.826), (25.5, 0.885), (34, 0.83), (42, 0.872), (50, 0.876)] + SHORT_SIDES),
        'top': 0.040, 'side': 0.026,
        'flow': [crown(22, locks=18)],
        'anchors': [(a, 0.885) for a in (-25.5, -8.5, 8.5, 25.5)] + [(a, 0.872) for a in (-42, 42)],
        'depth': 0.0095, 'tips': [(-180, 180, 0.007)],
    },
    'swept': {
        'label': 'Side part', 'textures': ['straight'],
        'edge': [(-180, 0.625), (-135, 0.625), (-122, 0.64), (-112, 0.757), (-80, 0.757), (-75, 0.70),
                 (-60, 0.70), (-56, 0.88), (-30, 0.905), (-22, 0.895), (0, 0.86), (25, 0.82), (40, 0.80),
                 (48, 0.80), (53, 0.66), (75, 0.66), (82, 0.70), (112, 0.70), (122, 0.64), (135, 0.625), (180, 0.625)],
        'top': 0.040, 'side': 0.028,
        # the big side sweeps across the forehead, away from the part at -24 degrees
        'flow': [crown(15, locks=18, where=lambda D: np.sin(az_of(D) - math.radians(-24)) * R_FLOW,
                       comb={'from': -24, 'side': 1, 'amount': 30, 'width': 1.6, 'theta': (0.25, 1.1)}),
                 crown(15, locks=18)],
        'anchors': [(-24, 0.90)],
        'parts': [{'dist': lambda D: np.abs(np.sin(az_of(D) - math.radians(-24))) * R_FLOW * np.hypot(D[..., 0], D[..., 2]),
                   'mask': lambda D: smoothstep(0.25, 0.5, np.cos(az_of(D) - math.radians(-24))) * smoothstep(0.2, 0.55, np.hypot(D[..., 0], D[..., 2])),
                   'depth': 0.011, 'width': 0.006}],
        'depth': 0.009, 'tips': [(-58, 50, 0.009), (54, 180, 0.007), (-180, -62, 0.007)],
    },
    'buzz': {
        'label': 'Buzz cut', 'textures': ['straight', 'coily'],
        # a skin-tight cap; the scalp shows through it, more so along the hairline (the mix is in
        # linear light, where a fifth of a light skin turned black hair light brown)
        'edge': NATURAL, 'top': 0.009, 'side': 0.006, 'edge_w': 0.024, 'soft_edge': 0.03, 'lock_bump': 0.0,
        'flow': [face_pole(8, locks=26)], 'conformal': True, 'depth': 0.0, 'tips': [],
        'skin': lambda c: 0.08 + 0.62 * (1 - smoothstep(0.0, 0.03, c.s_vis)), 'strand': 0.5,
    },
    'fade': {
        'label': 'Fade', 'textures': ['coily', 'straight'],
        # a short rounded top over sides that fade into the skin, with a crisp line-up
        'edge': LINEUP, 'top': 0.044, 'side': 0.0035, 'band': (0.85, 0.97), 'edge_w': 0.03, 'soft_edge': 0.02, 'lock_bump': 0.0,
        'flow': [face_pole(8, locks=20)], 'conformal': True, 'depth': 0.0, 'tips': [],
        'lumps': [(320, 0.09, 0.006)], 'lump_band': True, 'lump_occ': 0.12,
        # the sides fade into the skin, and right at their edge the shell is all skin
        'skin': lambda c: np.maximum(0.82 * (1 - smoothstep(0.79, 0.86, c.y)), 1 - smoothstep(0.0, 0.012, c.s_vis)) * (c.y < 0.88),
    },
    'quiff': {
        'label': 'Quiff', 'textures': ['straight'],
        # a tall front lock rising and rolling back over a bare forehead, short combed sides
        'edge': mirrored([(0, 0.905), (25, 0.90), (45, 0.885)] + SHORT_SIDES), 'top': 0.03, 'side': 0.012, 'band': (0.80, 0.95),
        'bumps': [((0, 0.62, 0.78), 0.42, 0.075), ((0, 0.9, 0.2), 0.45, 0.02)],
        'flow': [tie((0, 0.93, -0.26), locks=16, seam=(0, -1, 0.3))], 'depth': 0.010, 'tips': [(-60, 60, 0.004)],
    },
    'curls': {
        'label': 'Short curls', 'textures': ['curly', 'coily'],
        # a rounded cap of chunky curls tumbling over the forehead and the tops of the ears
        'edge': mirrored([(0, 0.85), (30, 0.852), (48, 0.85), (54, 0.80), (60, 0.73), (75, 0.725), (80, 0.75), (112, 0.75),
                          (122, 0.66), (135, 0.64), (180, 0.635)]),
        'top': 0.048, 'side': 0.034, 'ears': 0.012,
        'flow': [face_pole(8, locks=16)], 'conformal': True, 'depth': 0.0, 'lock_bump': 0.0, 'tips': [],
        'lumps': [(120, 0.25, 0.018), (380, 0.12, 0.004)], 'lump_stretch': 1.4, 'scallop': 0.028, 'lump_occ': 0.16,
    },
    'shaggy': {
        'label': 'Shaggy', 'textures': ['straight'],
        # a rounded mop: a heavy choppy fringe to the brows, uneven tips flicking out, volume at the crown
        'edge': mirrored([(0, 0.815), (12, 0.80), (24, 0.822), (36, 0.80), (46, 0.828), (50, 0.745), (60, 0.705), (80, 0.70),
                          (100, 0.69), (130, 0.66), (180, 0.65)]),
        'top': 0.058, 'side': 0.032, 'flare': 0.018,
        'flow': [crown(30, locks=20)], 'depth': 0.016, 'tips': [(-180, 180, 0.024)], 'chop': 2.0,
        'bumps': [((0, 1, -0.5), 0.6, 0.014)],
    },
    'balding': {
        'label': 'Balding', 'textures': ['straight', 'curly', 'coily'],
        # a bare dome, a horseshoe of hair round the back and fluffy tufts above the ears
        'edge': mirrored([(0, 0.70), (55, 0.70), (75, 0.70), (80, 0.745), (112, 0.745), (122, 0.64), (135, 0.625), (180, 0.625)]),
        'upper': mirrored([(0, 0.66), (55, 0.66), (64, 0.80), (90, 0.835), (130, 0.85), (180, 0.86)]),
        'top': 0.026, 'side': 0.02, 'ears': 0.014, 'ears_at': {'az': 98, 'y': 0.78, 'w': 0.5, 'h': 0.08}, 'edge_w': 0.04,
        'flow': [crown(10, locks=18)], 'conformal': True, 'depth': 0.006, 'tips': [],
        'lumps': [(130, 0.26, 0.012)], 'scallop': 0.016, 'lump_occ': 0.12,
        'skin': lambda c: 0.3 * (1 - smoothstep(0.0, 0.03, c.s_upper)),     # thinning toward the top
    },
    'bob': {
        'label': 'Bob', 'textures': ['straight', 'wavy', 'curly'],
        'edge': mirrored([(0, 0.832), (40, 0.84), (46, 0.845), (50, 0.61), (180, 0.60)]),
        'top': 0.034, 'side': 0.030, 'flare': 0.045, 'ears': 0.03,
        'flow': [crown(15, locks=18)],
        'depth': 0.009, 'tips': [(-46, 46, 0.0085), (52, 180, 0.011), (-180, -52, 0.011)],
    },
    'afro': {
        'label': 'Afro', 'textures': ['coily', 'curly'],
        # a big round cloud with a soft lumpy outline and a clean rounded hairline
        'edge': mirrored([(0, 0.895), (30, 0.89), (45, 0.875), (52, 0.845), (57, 0.76), (64, 0.70), (78, 0.67), (110, 0.655),
                          (125, 0.645), (140, 0.64), (180, 0.635)]),
        'top': 0.12, 'side': 0.03, 'outer': ((0, 0.86, -0.03), (0.33, 0.30, 0.325)), 'edge_w': 0.10, 'lock_bump': 0.0,
        'flow': [face_pole(18, locks=16)], 'conformal': True, 'uv_r': 0.3, 'depth': 0.0, 'tips': [],
        'lumps': [(90, 0.30, 0.018), (500, 0.10, 0.004)], 'lump_occ': 0.14,
    },
    'long': {
        'label': 'Long', 'textures': ['straight', 'wavy', 'curly'],
        'edge': mirrored([(0, 0.835), (40, 0.842), (46, 0.85), (50, 0.60), (180, 0.585)]),
        'top': 0.032, 'side': 0.030, 'flare': 0.052, 'ears': 0.03,
        'flow': [crown(15, locks=18)],
        # the back is a top layer over the long hair: shorter tips and a softer edge there
        'depth': 0.009, 'tips': [(-46, 46, 0.0085), (52, 180, 0.011), (-180, -52, 0.011)], 'rim_back': 0.45,
        'extras': ['long'],
    },
    'parted': {
        'label': 'Center part', 'textures': ['straight'],
        # long hair parted in the middle: the forehead open in a soft arch, the front locks framing the face
        'edge': mirrored([(0, 0.905), (14, 0.902), (24, 0.89), (32, 0.86), (38, 0.80), (43, 0.70), (48, 0.615), (52, 0.60), (180, 0.585)]),
        'top': 0.032, 'side': 0.030, 'flare': 0.05, 'ears': 0.03,
        'flow': [crown(15, locks=17, where=side_of, comb={'from': 0, 'side': 1, 'amount': 26, 'width': 1.4, 'theta': (0.25, 1.1)}),
                 crown(15, locks=17, comb={'from': 0, 'side': -1, 'amount': 26, 'width': 1.4, 'theta': (0.25, 1.1)})],
        'parts': [center_part(0.011, 0.006, skin=0.5)],
        'depth': 0.009, 'tips': [(30, 180, 0.011), (-180, -30, 0.011)], 'rim_back': 0.45,
        'extras': ['long'],
    },
    'ponytail': {
        'label': 'Ponytail', 'textures': ['straight'],
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
    'pigtails': {
        'label': 'Pigtails', 'textures': ['straight'],
        'edge': mirrored([(0, 0.838), (38, 0.845), (46, 0.85), (50, 0.68), (84, 0.68), (180, 0.62)]),
        'top': 0.032, 'side': 0.028,
        # bangs combed forward; the rest parted in the middle and pulled to the two ties. The
        # partings are soft and shallow and the lock creases run right into them, so the back
        # reads as locks pulled to the ties rather than two smooth panels with a sharp seam.
        'flow': [crown(15, locks=20, where=in_bangs),
                 tie((0.17, 0.70, -0.13), locks=16, where=side_of, seam=(0, -1, 0)),
                 tie((-0.17, 0.70, -0.13), locks=16, seam=(0, -1, 0))],
        'parts': [{'dist': lambda D: np.abs(D[..., 0]) * R_FLOW, 'mask': lambda D: smoothstep(-0.004, -0.014, in_bangs(D)),
                   'depth': 0.007, 'width': 0.010, 'fade': (0.003, 0.012)},
                  {'dist': lambda D: np.abs(in_bangs(D)), 'mask': lambda D: np.ones(D.shape[:-1]), 'depth': 0.005, 'width': 0.010, 'fade': (0.003, 0.012)}],
        'depth': 0.011, 'tips': [(-47, 47, 0.0085)],
        'extras': ['pigtails'],
    },
    'braids': {
        'label': 'Braids', 'textures': ['straight', 'curly', 'coily'],
        # the pigtail cap with two thick three-strand plaits hanging beside the face
        'like': 'pigtails',
        'extras': ['braids'],
    },
    'cornrows': {
        'label': 'Cornrows', 'textures': ['coily'],
        # raised braided rows from the forehead back to the nape, scalp lines between them,
        # short braid ends at the nape
        'edge': NATURAL, 'top': 0.02, 'side': 0.017, 'edge_w': 0.010,
        'flow': [rows_between((0, 0.74, 0.22), (0, 0.635, -0.17), locks=14)], 'even': True,
        'depth': 0.018, 'tips': [], 'profile': 1.5, 'rows': 0.026, 'lock_bump': 0.0,
        'skin': lambda c: 0.85 * (1 - c.h) ** 5,
        'extras': ['cornrows'],
    },
    'locs': {
        'label': 'Locs', 'textures': ['coily'],
        # rope-like locs from a sectioned scalp, the front ones swept aside, rounded ends at the shoulders
        'edge': mirrored([(0, 0.89), (35, 0.885), (48, 0.87), (54, 0.80), (60, 0.75), (75, 0.745), (80, 0.757), (112, 0.757),
                          (122, 0.66), (135, 0.64), (180, 0.635)]),
        'top': 0.014, 'side': 0.012, 'flow': [crown(10, locks=18)], 'depth': 0.012, 'profile': 1.3, 'tips': [],
        'skin': lambda c: 0.6 * (1 - c.h) ** 5 * c.grow,          # fine section lines; they merge at the crown
        'extras': ['locs'],
    },
    'bun': {
        'label': 'Top bun', 'textures': ['straight', 'curly', 'coily'],
        'edge': mirrored([(0, 0.925), (25, 0.915), (45, 0.885), (52, 0.86), (56, 0.73), (75, 0.73)] + SHORT_SIDES[3:]),
        'top': 0.026, 'side': 0.022,
        'flow': [tie((0, 1.035, -0.045), locks=16, seam=(0, -0.2, -1))],
        'depth': 0.0075, 'tips': [],
        'extras': ['bun'],
    },
    'buns': {
        'label': 'Two buns', 'textures': ['straight', 'curly', 'coily'],
        # a center part, the sides pulled smooth, no fringe, two round buns high on the head
        'edge': mirrored([(0, 0.885), (40, 0.875), (50, 0.86)] + SHORT_SIDES[1:]), 'top': 0.02, 'side': 0.018,
        'flow': [tie((0.13, 1.0, -0.03), locks=12, where=side_of, seam=(0, -1, 0)), tie((-0.13, 1.0, -0.03), locks=12, seam=(0, -1, 0))],
        'parts': [{'dist': lambda D: np.abs(D[..., 0]) * R_FLOW, 'mask': lambda D: np.ones(D.shape[:-1]), 'depth': 0.008, 'width': 0.005, 'skin': 0.5}],
        'depth': 0.007, 'tips': [],
        'extras': ['buns'],
    },
    'updo': {
        'label': 'Updo', 'textures': ['coily', 'straight'],
        # swept up from the nape, sides and forehead into a tall crown of rolled twists
        'edge': mirrored([(0, 0.905), (30, 0.90), (46, 0.89), (52, 0.865), (56, 0.78), (75, 0.775), (80, 0.785), (112, 0.785),
                          (122, 0.73), (150, 0.725), (180, 0.725)]),
        'top': 0.03, 'side': 0.024, 'band': (0.78, 1.0),
        'flow': [tie((0, 1.0, -0.15), locks=12, seam=(0, -0.2, -1))], 'depth': 0.02, 'profile': 1.3, 'tips': [],
        'bumps': [((0, 0.75, -0.66), 0.55, 0.03)],
        'extras': ['updo'],
    },
}
STYLES['braids'] = {**{k: v for k, v in STYLES['pigtails'].items() if k not in ('label', 'textures', 'extras')}, **STYLES['braids']}
STYLES['braids'].pop('like')

# Textures that change the shape get a mesh of their own: file -> (style, texture, changes).
# A texture mesh is seeded like its style, so the parts they share come out the same.
VARIANTS = {
    'bob-wavy': ('bob', 'wavy', {'wave': (0.15, 6.0), 'alternate': True, 'swell': 0.006}),
    'bob-curly': ('bob', 'curly', {
        'edge': mirrored([(0, 0.852), (40, 0.86), (46, 0.865), (50, 0.63), (180, 0.62)]),
        'top': 0.044, 'side': 0.038, 'flow': [face_pole(-14, locks=18)], 'conformal': True, 'depth': 0.0, 'lock_bump': 0.0,
        'tips': [], 'lumps': [(140, 0.24, 0.018), (400, 0.11, 0.004)], 'lump_stretch': 1.4, 'scallop': 0.026, 'lump_occ': 0.16}),
    'long-wavy': ('long', 'wavy', {'wave': (0.15, 6.0), 'alternate': True, 'swell': 0.006, 'curtain_wave': (0.022, 0.017, 0.11)}),
    'long-curly': ('long', 'curly', {
        'edge': mirrored([(0, 0.84), (30, 0.842), (46, 0.85), (50, 0.66), (180, 0.64)]),
        'top': 0.05, 'side': 0.04, 'flare': 0.0, 'ears': 0.02, 'rim_back': 1.0,
        'flow': [face_pole(-14, locks=16)], 'conformal': True, 'depth': 0.0, 'lock_bump': 0.0, 'tips': [],
        'lumps': [(140, 0.24, 0.018), (400, 0.11, 0.004)], 'lump_stretch': 1.4, 'scallop': 0.026, 'lump_occ': 0.16,
        'extras': ['ringlets']}),
    'bun-puff': ('bun', 'curly', {'extras': ['bun_puff']}),
    'buns-puff': ('buns', 'curly', {'extras': ['buns_puff']}),
}
# Which file draws each texture of a style (the others reuse <style>.glb with that texture's tile).
FILES = {sid: {tex: f for f, (s, t, _) in VARIANTS.items() if s == sid for tex in STYLES[sid]['textures']
               if (t == tex or (f.endswith('-puff') and tex in ('curly', 'coily')))}
         for sid in STYLES}


def look(name):
    """(style id, texture, style) of an output file name: a style id or a texture mesh."""
    if name in VARIANTS:
        sid, tex, changes = VARIANTS[name]
        return sid, tex, {**STYLES[sid], **changes}
    return name, STYLES[name]['textures'][0], STYLES[name]


# ---------------------------------------------------------------------------
# Parts: a mesh piece with its flow charts. Each triangle is drawn in one chart; vertices on
# a chart boundary (a parting) or on the u seam are duplicated with that chart's coordinates.
# ---------------------------------------------------------------------------
class Part:
    def __init__(self, V, F, chart, uvg, occ, tint=None, occupancy=None, weld=None, skin=None):
        self.V, self.F, self.chart = np.asarray(V, float), np.asarray(F, int), np.asarray(chart, int)
        self.uvg = uvg                  # uvg(vertex_ids, chart) -> u, v, g ; period(chart) -> u period
        self.occ = np.asarray(occ, float)   # analytic occlusion in [0, 1]
        self.tint = np.ones(len(self.V)) if tint is None else np.asarray(tint, float)
        self.occupancy = occupancy      # points -> inside mask, used to occlude the other parts
        self.weld = weld                # vertex -> canonical vertex (shared normals), optional
        self.skin = np.zeros(len(self.V)) if skin is None else np.asarray(skin, float)
        self.ao_origin = self.V          # where the occlusion rays start
        self.self_occlude = False       # merged pieces (ropes, lobes) also shade each other


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
def shell(name, style, A, d, r, top_r, rng):
    D = np.vstack([[0, 1.0, 0], d.reshape(-1, 3)])
    Rh = np.concatenate([[top_r], r.ravel()])
    Az = np.concatenate([[0.0], A.ravel()])
    y = CENTER[1] + D[:, 1] * Rh
    n = len(D)
    s_lower = Hairline(style['edge'])(Az * MAP_R, y)
    s_upper = -Hairline(style['upper'])(Az * MAP_R, y) if style.get('upper') else np.full(n, np.inf)
    s = np.minimum(s_lower, s_upper)                   # hair grows above the edge (and below `upper`)
    az_deg = np.degrees(Az)

    band = style.get('band', (0.72, 0.98))
    upper = smoothstep(band[0], band[1], y)
    thick = style['side'] + (style['top'] - style['side']) * upper
    if style.get('flare'):
        thick = thick + style['flare'] * (1 - smoothstep(0.60, 0.84, y)) * smoothstep(0.5, 1.2, np.abs(Az))
    if style.get('ears'):                                                             # puff out over the ears
        ez = {**EARS, **style.get('ears_at', {})}
        da = np.abs(Az) - math.radians(ez['az'])
        thick = thick + style['ears'] * np.exp(-(da / ez['w']) ** 2 - ((y - ez['y']) / ez['h']) ** 2)
    if style.get('outer'):                                                            # a volume: out to an ellipsoid
        c, radii = style['outer']
        thick = np.maximum(thick, envelope(D, c, radii) - Rh)
    for direction, radius, height in style.get('bumps', []):
        thick = thick + height * np.exp(-(np.arccos(np.clip(D @ unit(direction), -1, 1)) / radius) ** 2)
    base = thick.copy()

    # Flow regions: the first whose `where` is positive, else the last one.
    shared = {k: style[k] for k in ('wave', 'conformal', 'uv_r') if k in style}
    regions = [Region({**spec, **shared}, rng) for spec in style['flow']]
    chart = np.full(n, len(regions) - 1)
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
    for k, reg in enumerate(regions):
        reg.setup_locks(rng, rng_for(name, 'locks', k), style.get('even', False), style.get('alternate', False))

    e = np.zeros(n); lid = np.zeros(n, int); near = np.zeros(n, int); theta = np.zeros(n); tint = np.ones(n)
    bump = np.zeros(n); tipx = np.zeros(n); cs = np.ones(n); cst = np.zeros(n); wph = np.zeros(n)
    for k, reg in enumerate(regions):
        m = chart == k
        wph[m] = reg.wave[3]
        th, f = reg.flow_phi(D[m])
        e[m], lid[m], near[m] = lock_coords(f, reg.bounds)
        e[m] = np.minimum(1.0, e[m] * reg.sharp[lid[m]])
        theta[m] = th
        bump[m] = reg.bump[lid[m]]; tipx[m] = reg.tip[lid[m]]; tint[m] = reg.tint[lid[m]]
        cs[m] = reg.strength[near[m]]; cst[m] = reg.start[near[m]]
    h = lock_profile(e, p=style.get('profile', 2.4))
    # Per-lock variations fade out toward the creases: a step there would zigzag along the grid.
    bump, tipx, tint = bump * h, tipx * h, 1 + 0.035 * tint * h
    is_tie = np.array([reg.tie for reg in regions])[chart]
    grow = np.where(is_tie, smoothstep(0.15, 0.7, theta), smoothstep(0.25, 1.15, theta))  # locks merge at the crown / tie
    grow_c = np.where(is_tie, smoothstep(0.15 + cst, 0.7 + cst, theta), smoothstep(0.25 + cst, 1.15 + cst, theta))
    is_axis = np.array([reg.axis is not None for reg in regions])[chart]
    gather = smoothstep(0.1, 0.45, math.pi - theta)          # rows run right to the hairline and merge where they gather
    grow = np.where(is_axis, gather, grow); grow_c = np.where(is_axis, gather, grow_c)
    part_fade = np.ones(n); dip = np.zeros(n); part_skin = np.zeros(n)
    for part in style.get('parts', []):
        dist = part['dist'](D); mask = part['mask'](D)
        line = mask * np.exp(-(dist / part['width']) ** 2)
        dip += part['depth'] * line
        part_skin = np.maximum(part_skin, part.get('skin', 0.0) * line)
        # A parting is a chart boundary: the locks on its two sides differ, so their relief fades
        # out toward it (over `fade`, metres from the part line) and both sides meet without a step.
        part_fade *= 1 - mask * (1 - smoothstep(*part.get('fade', (0.003, 0.02)), dist))
    near_end = 1 - smoothstep(0.02, 0.12, s)                                       # locks are most distinct where they end
    depth = style['depth'] * grow_c * part_fade * (0.6 + 0.4 * near_end) * cs
    thick = thick + style.get('lock_bump', LOCK_BUMP) * bump * grow * part_fade - depth * (1 - h) - dip
    if style.get('swell'):              # wavy: the hair swells in and out along its length, in step with its S
        thick = thick + style['swell'] * np.sin(style['wave'][1] * theta + wph + 1.2) * smoothstep(0.35, 0.9, theta) * part_fade

    # Curl clumps (curly and coily): round lumps, drawn out where the hair hangs.
    lump = np.zeros(n)
    for i, (count, radius, height) in enumerate(style.get('lumps', [])):
        hang = 1 - smoothstep(0.2, 0.7, D[:, 1])
        lf = lump_field(D, count, radius, rng_for(name, 'lumps', i), 1 + (style.get('lump_stretch', 1.0) - 1) * hang)
        thick = thick + height * (lf - 0.5) * (upper if style.get('lump_band') else 1.0)
        if i == 0:
            lump = lf
    rows = None
    if style.get('rows'):                         # cornrows: each row a chain of lobes in a chevron
        rows = 0.5 + 0.5 * np.cos(2 * math.pi * theta * R_FLOW / style['rows'] + math.pi * (lid % 2) + 2.6 * (1 - e))
        rows = 0.5 + (rows - 0.5) * smoothstep(0.1, 0.5, theta) * smoothstep(0.15, 0.6, math.pi - theta)   # calm where they gather
        thick = thick * (0.86 + 0.18 * rows)

    # Where the hair ends (bangs, nape), each lock ends in a rounded tip; a shallow crease
    # barely notches the end, so neighbouring locks read as one broad lock.
    tip = ranges(az_deg, style.get('tips', []))
    s_tip = s - tip * (1 - h) * np.minimum(cs, 1.0) - style.get('chop', 0.4) * tip * tipx
    if style.get('scallop'):                      # the edge is made of curls
        s_tip = s_tip + style['scallop'] * (lump - 0.5)
    edge_w = style.get('edge_w', EDGE)
    # Where the edge comes out of the skin: the shell rises from SINK under it, so it breaks the
    # surface part way up its rounded edge (thin hair: well inside the hairline curve).
    sunk = np.clip(SINK / np.maximum(thick + SINK, 1e-6), 0.0, 1.0)            # inverse smoothstep of this
    s_vis = s_tip - edge_w * (0.5 - np.sin(np.arcsin(1 - 2 * sunk) / 3))
    if style.get('soft_edge'):
        # Thin hair (buzz cut, fade) grows out of the skin at that same line at a gentle angle
        # instead, easing into its thickness over `soft_edge`, so the edge shows no ledge. It must
        # not come out flat: nearly level with the skin, the line where the two cross would follow
        # the grid in steps. Outside the line the shell keeps going down, under the skin.
        x = np.clip(s_vis / style['soft_edge'], None, 1.0)
        t = np.maximum(-OFFSET + (thick + OFFSET) * (1 - (1 - x) ** 2), -SINK)
    else:
        t = np.where(s_tip > 0, -SINK + (thick + SINK) * smoothstep(0, edge_w, s_tip), -SINK)
    V = CENTER + D * (Rh + t)[:, None]

    # Triangles of the grid; the ones buried under the skin are dropped.
    F = [(0, 1 + k, 1 + (k + 1) % N_AZ) for k in range(N_AZ)]
    for j in range(N_POL - 2):
        a = 1 + j * N_AZ + np.arange(N_AZ); b = 1 + j * N_AZ + (np.arange(N_AZ) + 1) % N_AZ
        F += list(zip(a, a + N_AZ, b)) + list(zip(b, a + N_AZ, b + N_AZ))
    F = np.array(F)
    keep = (t[F] > -SINK * 0.5).any(1)
    used, F = prune(V, F, keep)

    # Analytic occlusion: lock creases, the rounded edge where hair meets skin, parts, curls.
    crease = (1 - h) ** 1.6 * smoothstep(0.0, 1.0, depth / max(style['depth'], 1e-9))
    rim = (1 - smoothstep(0.0, EDGE * 1.2, s_tip)) * (1 - (1 - style.get('rim_back', 1)) * ranges(az_deg, [(112, 180, 1), (-180, -112, 1)]))
    occ = (1 - 0.36 * crease) * (1 - 0.22 * rim) * (1 - 0.35 * np.clip(dip / 0.011, 0, 1))
    if style.get('lumps'):
        occ *= 1 - style.get('lump_occ', 0.22) * (1 - smoothstep(0.1, 0.7, lump))
    if rows is not None:
        occ *= 0.88 + 0.12 * rows
    occ *= 0.97 + 0.05 * smoothstep(0.72, 0.98, y)                                   # tops a touch lighter

    ctx = SimpleNamespace(D=D, y=y, s=s, s_upper=s_upper, s_tip=s_tip, s_vis=s_vis, h=h, e=e, Az=Az, theta=theta, upper=upper, grow=grow)
    skin = np.clip(style['skin'](ctx), 0, 1) if style.get('skin') else np.zeros(n)
    skin = np.maximum(skin, part_skin)
    strand = style.get('strand', 1.0)

    def uvg(ids, k):
        u, v, g = regions[k].uvg(D[used][ids])
        return u, v, g * strand
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

    part = Part(V[used], F, chart[used], uvg, occ[used], tint[used], occupancy, skin=skin[used])
    part.ao_origin = (CENTER + D * (Rh + np.maximum(t, 0.0015))[:, None])[used]   # tucked-in edge: from the skin
    part.surface = Grid(top_r + t[0], r + t[1:].reshape(r.shape))                   # the shell's outside, per direction

    def crease_azimuths(y_level):
        # (azimuth in degrees, depth factor) where the default region's creases cross a height on the back
        row = np.argmin(np.abs(CENTER[1] + d[:, N_AZ // 2, 1] * r[:, N_AZ // 2] - y_level))
        reg = regions[-1]
        f = reg.flow_phi(d[row])[1]
        out = []
        for b, st in zip(reg.bounds, reg.strength):
            g = wrap(f - b)
            k = np.where((np.sign(g[:-1]) != np.sign(g[1:])) & (np.abs(g[:-1] - g[1:]) < 1))[0]
            out += [(math.degrees(A[0, i] + (A[0, i + 1] - A[0, i]) * g[i] / (g[i] - g[i + 1])), float(st)) for i in k]
        return out
    part.crease_azimuths = crease_azimuths
    return part


# ---------------------------------------------------------------------------
# Extra shapes
# ---------------------------------------------------------------------------
def catmull(points, radii, per):
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


def capsules(P, R):
    """Occupancy of a tube as capsules along its centerline (radii lerped along each segment),
    tested only for points inside the tube's box; raster() draws it into a voxel grid."""
    P = np.asarray(P, float); Rr = np.asarray(R, float)
    lo, hi = P.min(0) - Rr.max(), P.max(0) + Rr.max()
    A_, AB = P[:-1], P[1:] - P[:-1]
    L2 = np.maximum((AB * AB).sum(1), 1e-18)
    R0, dR = Rr[:-1], Rr[1:] - Rr[:-1]

    def occupancy(p):
        out = np.zeros(p.shape[:-1], bool)
        near = np.all((p > lo) & (p < hi), axis=-1)
        q = p[near]
        if not len(q):
            return out
        hit = np.zeros(len(q), bool)
        for i in range(0, len(A_), 24):
            a, ab, l2 = A_[i:i + 24], AB[i:i + 24], L2[i:i + 24]
            w = np.clip(np.einsum('nsk,sk->ns', q[:, None, :] - a[None], ab) / l2, 0, 1)
            dist = np.linalg.norm(q[:, None, :] - a[None] - w[..., None] * ab[None], axis=-1)
            hit |= (dist < R0[i:i + 24] + dR[i:i + 24] * w).any(1)
        out[near] = hit
        return out

    def raster(grid, glo, step):
        # mark the grid cells inside, segment by segment within each segment's own box
        n = np.array(grid.shape)
        for i in range(len(A_)):
            a, b = P[i], P[i + 1]
            r = max(Rr[i], Rr[i + 1])
            i0 = np.clip(np.floor((np.minimum(a, b) - r - glo) / step).astype(int), 0, n - 1)
            i1 = np.clip(np.ceil((np.maximum(a, b) + r - glo) / step).astype(int), 0, n - 1)
            ax = [glo[k] + step * np.arange(i0[k], i1[k] + 1) for k in range(3)]
            X, Y, Z = np.meshgrid(*ax, indexing='ij')
            q = np.stack([X, Y, Z], -1)
            w = np.clip(((q - a) @ AB[i]) / L2[i], 0, 1)
            d = q - a - w[..., None] * AB[i]
            grid[i0[0]:i1[0] + 1, i0[1]:i1[1] + 1, i0[2]:i1[2] + 1] |= (d * d).sum(-1) < (R0[i] + dR[i] * w) ** 2
    occupancy.raster = raster
    occupancy.box = (lo, hi)
    return occupancy


def box_raster(fn, lo, hi):
    """A raster function for an occupancy test that is only true inside a box."""
    def raster(grid, glo, step):
        n = np.array(grid.shape)
        i0 = np.clip(np.floor((lo - glo) / step).astype(int), 0, n - 1)
        i1 = np.clip(np.ceil((hi - glo) / step).astype(int), 0, n - 1)
        ax = [glo[k] + step * np.arange(i0[k], i1[k] + 1) for k in range(3)]
        X, Y, Z = np.meshgrid(*ax, indexing='ij')
        grid[i0[0]:i1[0] + 1, i0[1]:i1[1] + 1, i0[2]:i1[2] + 1] |= fn(np.stack([X, Y, Z], -1))
    return raster


def tube(points, radii, rng, around=48, lobes=7, depth=0.15, twist=0.9, flat=1.0, root=0, per=10,
         end='point', start='flat', fold=0.6):
    """A tapered tube of hair along a polyline, in a few twisting locks, closed at both ends.
    The first `root` control points lie inside the head: the tube grows out of the scalp, so
    its start is buried and never shows, and its locks and strands start at point `root` (the
    tie). `end` is 'point' (a tapered tip) or 'round' (a rounded end, ropes and rolls), `start`
    'flat' (a buried root) or 'round'. On the inside of a bend the surface is pulled in, so it
    never folds over itself where the bend is tighter than the tube."""
    fine, frad = catmull(points, radii, per)
    tang = np.gradient(fine, axis=0); tang /= np.linalg.norm(tang, axis=1, keepdims=True)
    seg = np.linalg.norm(np.diff(fine, axis=0), axis=1)
    arc = np.concatenate([[0], np.cumsum(seg)])
    a0 = arc[root * per]
    along = np.clip((arc - a0) / (arc[-1] - a0), 0, 1)
    d1 = np.gradient(fine, axis=0); d2 = np.gradient(d1, axis=0)
    l1 = np.maximum((d1 * d1).sum(1), 1e-18)
    kap = (d2 - (np.einsum('ik,ik->i', d2, d1) / l1)[:, None] * d1) / l1[:, None]   # curvature vector
    normal = np.cross(tang[0], [0, 0, 1.0]) if abs(tang[0][2]) < 0.9 else np.cross(tang[0], [1.0, 0, 0])
    normal /= np.linalg.norm(normal)
    bounds = lock_bounds(lobes, [], rng)
    tint_l = rng.uniform(-1, 1, len(bounds))
    tiles = max(1, round(2 * math.pi * float(np.mean(frad[:-1])) / TILE_U))
    ang = 2 * math.pi * np.arange(around) / around
    V, U, Vv, G, H, T = [], [], [], [], [], []
    offs = []
    for i, (c, t, r) in enumerate(zip(fine, tang, frad)):
        normal = normal - t * (normal @ t); normal /= np.linalg.norm(normal)
        binormal = np.cross(t, normal)
        a_eff = ang + twist * along[i]
        e, lid, _ = lock_coords(a_eff, bounds)
        h = lock_profile(e)
        rr = r * (1 - depth * (1 - h) * smoothstep(0.0, 0.12, along[i]))
        off = rr[:, None] * (np.cos(ang)[:, None] * normal + flat * np.sin(ang)[:, None] * binormal)
        kn = np.linalg.norm(kap[i])
        if kn * rr.max() > fold:                    # inside of a tight bend: pull the surface in
            khat = kap[i] / kn
            over = off @ khat - fold / kn
            off = off - np.maximum(over, 0)[:, None] * khat
        offs.append(off)
        V += list(c + off)
        U += list(a_eff / (2 * math.pi) * tiles); Vv += [arc[i] / TILE_V] * around
        G += [smoothstep(0.0, 0.1, along[i]) * (1 - smoothstep(0.82, 1.0, along[i]))] * around
        H += list(h); T += list(1 + 0.04 * tint_l[lid] * h)
    n = len(fine)
    F = []
    for i in range(n - 1):
        for k in range(around):
            a, b = i * around + k, i * around + (k + 1) % around
            F += [(a, b, a + around), (b, b + around, a + around)]

    def cap(ring0, c, t, off, h_ring, u_ring, v0, sign):
        """Rounded cap rings closing over a tube end (sign +1 at the end, -1 at the start)."""
        rmean = float(np.linalg.norm(off, axis=1).mean())
        prev = ring0
        for k, a in enumerate((0.42, 0.8, 1.15)):
            idx = len(V)
            V.extend(list(c + sign * t * rmean * math.sin(a) * 0.95 + off * math.cos(a)))
            U.extend(list(u_ring)); Vv.extend([v0 + sign * rmean * a / TILE_V] * around); G.extend([0.0] * around)
            H.extend(list(h_ring)); T.extend([1.0] * around)
            for j in range(around):
                p0, p1 = prev + j, prev + (j + 1) % around
                q0, q1 = idx + j, idx + (j + 1) % around
                F.extend([(p0, p1, q0), (p1, q1, q0)] if sign > 0 else [(p1, p0, q0), (q1, p1, q0)])
            prev = idx
        tip_i = len(V)
        V.append(c + sign * t * rmean * 0.95)
        U.append(float(np.mean(u_ring))); Vv.append(v0 + sign * rmean * 1.57 / TILE_V); G.append(0.0); H.append(1.0); T.append(1.0)
        F.extend([(prev + j, prev + (j + 1) % around, tip_i) if sign > 0 else (prev + (j + 1) % around, prev + j, tip_i) for j in range(around)])

    last = (n - 1) * around
    if end == 'round':
        cap(last, fine[-1], tang[-1], offs[-1], H[last:last + around], U[last:last + around], Vv[last], 1)
    else:
        tip = len(V); V.append(fine[-1] + tang[-1] * frad[-1] * 0.6)
        U.append(U[-1]); Vv.append(Vv[-1] + frad[-1] * 0.6 / TILE_V); G.append(0.0); H.append(1.0); T.append(1.0)
        F += [(last + k, last + (k + 1) % around, tip) for k in range(around)]
    if start == 'round':
        cap(0, fine[0], tang[0], offs[0], H[:around], U[:around], Vv[0], -1)
    else:
        # The start is closed too, so even a root that came out of the scalp could not show a hole.
        st = len(V); V.append(fine[0] - tang[0] * frad[0] * 0.3)
        U.append(U[0]); Vv.append(Vv[0]); G.append(0.0); H.append(1.0); T.append(1.0)
        F += [((k + 1) % around, k, st) for k in range(around)]
    V = np.array(V); U = np.array(U); Vv = np.array(Vv); G = np.array(G); H = np.array(H)
    occ = 1 - 0.3 * (1 - H) ** 1.6

    def uvg(ids, k):
        return U[ids], Vv[ids], G[ids]
    uvg.period = lambda k: tiles

    part = Part(V, np.array(F), np.zeros(len(V), int), uvg, occ, np.array(T), capsules(fine, frad))
    part.start_ring = V[:around]          # the root: checked to be buried
    part.inner = capsules(fine, frad * (1 - depth))   # a little inside the surface, for self-occlusion
    return part


def curtain(a0, a1, profile, th, rng, creases=(), n_a=96, n_y=34, width=17.0, depth=0.009, wave=None):
    """A thick sheet of hair hanging straight down around the back of the head (a C-shaped
    band between azimuths a0..a1 degrees). Its locks carry on the shell's locks (creases at
    `creases`, (degrees, depth factor) pairs; wide locks are split by shallower creases) and
    end in rounded tips. `wave` = (amplitude, ripple, wavelength): wavy locks swing sideways
    and in and out more and more toward the tips."""
    pts = sorted((c % 360, st) for c, st in creases if a0 + 5 < c % 360 < a1 - 5)
    primary = [a0] + [c for c, _ in pts] + [a1]
    pstr = [1.0] + [min(st, 1.0) for _, st in pts] + [1.0]
    cuts, strength = [], []
    for j, (lo, hi) in enumerate(zip(primary[:-1], primary[1:])):
        k = max(1, round((hi - lo) / width))
        w = rng.uniform(0.75, 1.25, k)
        for jj, c in enumerate(lo + (hi - lo) * np.concatenate([[0], np.cumsum(w / w.sum())[:-1]])):
            cuts.append(c); strength.append(pstr[j] if jj == 0 else 0.45)
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
            if wave:
                amp, ripple, wl = wave
                ph = 2 * math.pi * (y_top - y) / wl + 0.35 * math.sin(5 * a + 0.6)
                grow = smoothstep(0.08, 0.9, t) * smoothstep(0.0, 0.25, min(a - A[0], A[-1] - a))
                side = np.array([n[2], 0, -n[0]])
                base = base + side * amp * grow * math.sin(ph) + n * ripple * grow * math.cos(ph)
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


def ellipsoid(center, radii, rng, lat=30, lon=56, lobes=7, depth=0.09, twist=1.1, calm=0.7):
    """A bun: a ball of hair wound in a few twisting locks (calmer toward the poles for a higher `calm`)."""
    c = np.array(center, float); rad = np.array(radii, float)
    bounds = lock_bounds(lobes, [], rng)
    tint_l = rng.uniform(-1, 1, len(bounds))
    tiles = max(1, round(2 * math.pi * float(rad.mean()) / TILE_U))
    V, U, Vv, G, H, T = [], [], [], [], [], []
    for i in range(lat + 1):
        th = math.pi * i / lat
        ph = 2 * math.pi * np.arange(lon) / lon
        a_eff = ph + twist * th
        e, lid, _ = lock_coords(a_eff, bounds)
        h = lock_profile(e)
        k = 1 - depth * (1 - h) * math.sin(th) ** calm
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


def sphere_grid(lat, lon):
    """Triangles of a (lat + 1) x lon sphere grid whose poles are rings of coincident vertices,
    without the zero-area triangles at the poles."""
    F = []
    for i in range(lat):
        for k in range(lon):
            a, b = i * lon + k, i * lon + (k + 1) % lon
            if i > 0:
                F.append((a, b, a + lon))
            if i < lat - 1:
                F.append((b, b + lon, a + lon))
    return np.array(F)


def lobe(center, axes, radii, rng, lat=10, lon=16, lobes=3, depth=0.12, twist=0.5):
    """An ellipsoid lobe of hair in its own frame (axes rows: local x, y = the long axis
    pointing back up the braid, z), in a few twisting locks: one strand of a braid."""
    c = np.asarray(center, float); R = np.asarray(axes, float); rad = np.asarray(radii, float)
    bounds = lock_bounds(lobes, [], rng)
    tint_l = rng.uniform(-1, 1, len(bounds))
    tiles = max(1, round(2 * math.pi * float(rad[[0, 2]].mean()) / TILE_U))
    V, U, Vv, G, H, T = [], [], [], [], [], []
    for i in range(lat + 1):
        th = math.pi * i / lat
        ph = 2 * math.pi * np.arange(lon) / lon
        a_eff = ph + twist * th
        e, lid, _ = lock_coords(a_eff, bounds)
        h = lock_profile(e)
        k = 1 - depth * (1 - h) * math.sin(th) ** 0.7
        local = np.stack([math.sin(th) * np.cos(ph), np.full(lon, -math.cos(th)), math.sin(th) * np.sin(ph)], -1) * rad * k[:, None]
        V += list(c + local @ R)
        U += list(a_eff / (2 * math.pi) * tiles); Vv += [th * rad[1] / TILE_V] * lon
        G += [float(smoothstep(0.2, 0.7, th) * smoothstep(0.2, 0.7, math.pi - th))] * lon
        H += list(h); T += list(1 + 0.04 * tint_l[lid] * h)
    V = np.array(V); H = np.array(H); U, Vv, G = np.array(U), np.array(Vv), np.array(G)
    F = sphere_grid(lat, lon)[:, [0, 2, 1]]                  # local y runs down: keep the outside out
    weld = np.arange(len(V)); weld[:lon] = 0; weld[lat * lon:] = lat * lon
    occ = 1 - 0.3 * (1 - H) ** 1.6

    def uvg(ids, k):
        return U[ids], Vv[ids], G[ids]
    uvg.period = lambda k: tiles

    def occupancy(p, s=1.0):
        q = ((p - c) @ R.T) / (rad * s)
        return (q * q).sum(-1) < 1
    part = Part(V, F, np.zeros(len(V), int), uvg, occ, np.array(T), occupancy, weld)
    part.inner = lambda p: occupancy(p, 1 - depth)
    return part


def braid(points, width, rng, pitch=0.034, tilt=36, taper=0.4, side=(1.0, 0, 0), first=0.0):
    """A three-strand plait along a path: a chain of plump lobes, tilted left and right in a
    chevron and overlapping, getting a little thinner toward the end; the first lobes lie along
    the path, so the plait comes straight out of the hair. Returns the lobes, the point where
    the last lobe ends (a tie band goes there), the direction there and the half-width there."""
    fine, _ = catmull(points, np.ones(len(points)), per=40)
    seg = np.linalg.norm(np.diff(fine, axis=0), axis=1); arc = np.concatenate([[0], np.cumsum(seg)])
    n = int((arc[-1] - first) / pitch)
    parts = []
    for k in range(n):
        s = first + (k + 0.5) * pitch
        i = min(np.searchsorted(arc, s), len(fine) - 2)
        c = fine[i]; t = unit(fine[i + 1] - fine[i])
        sd = unit(np.asarray(side, float) - (np.asarray(side, float) @ t) * t)
        out = np.cross(sd, t)
        f = (1 - taper * s / arc[-1]) * (0.8 + 0.2 * min(1.0, k / 2))      # the first lobes a little smaller
        sgn = 1 if k % 2 == 0 else -1
        a = math.radians(tilt) * sgn * min(1.0, k / 2)
        long_ax = unit(math.cos(a) * t + math.sin(a) * sd)       # the lobe's long axis, tilted
        x_ax = unit(np.cross(long_ax, out))
        axes = np.stack([x_ax, -long_ax, np.cross(x_ax, -long_ax)])
        center = c + sd * (-sgn) * 0.17 * width * f * min(1.0, k / 2)
        parts.append(lobe(center, axes, (0.40 * width * f, 1.2 * pitch, 0.34 * width * f), rng))
    s = first + (n - 0.5) * pitch + 0.8 * pitch                 # near the tip of the last lobe
    i = min(np.searchsorted(arc, s), len(fine) - 2)
    return parts, fine[i], unit(fine[i + 1] - fine[i]), 0.40 * width * (1 - taper * s / arc[-1])


def voxelize(rasters, lo, hi, step=0.003):
    """Occupancy tests drawn once into a grid (step metres): a lookup instead of the tests."""
    lo = np.asarray(lo, float) - step; hi = np.asarray(hi, float) + step
    n = np.ceil((hi - lo) / step).astype(int) + 1
    grid = np.zeros(n, bool)
    for raster in rasters:
        raster(grid, lo, step)

    def lookup(p):
        idx = np.rint((p - lo) / step).astype(int)
        ok = np.all((idx >= 0) & (idx < n), axis=-1)
        out = np.zeros(p.shape[:-1], bool)
        k = idx[ok]
        out[ok] = grid[k[..., 0], k[..., 1], k[..., 2]]
        return out
    lookup.voxels = True
    return lookup


def rasterizer(fn, part):
    """How to draw a piece's occupancy into a grid: segment by segment for a tube, else its box."""
    if hasattr(fn, 'raster'):
        return fn.raster
    return box_raster(fn, part.V.min(0) - 0.002, part.V.max(0) + 0.002)


def merge_parts(parts, self_occlude=True):
    """One Part from several pieces (ropes, lobes, ringlets): one occlusion blocker for the
    group, each piece keeping its own chart so its u seam still wraps. The pieces also shade
    each other (each tested a little inside its surface, so a piece does not shade itself)."""
    V, F, chart, occ, T, weld, skin, offs = [], [], [], [], [], [], [], []
    off = 0
    for k, p in enumerate(parts):
        V.append(p.V); F.append(p.F + off); occ.append(p.occ); T.append(p.tint); skin.append(p.skin)
        chart.append(np.full(len(p.V), k))
        weld.append((p.weld if p.weld is not None else np.arange(len(p.V))) + off)
        offs.append(off); off += len(p.V)
    offs = np.array(offs + [off])

    def uvg(ids, k):
        return parts[k].uvg(ids - offs[k], 0)
    uvg.period = lambda k: parts[k].uvg.period(0)

    V = np.vstack(V)
    lo, hi = V.min(0) - 0.004, V.max(0) + 0.004
    part = Part(V, np.vstack(F), np.concatenate(chart), uvg, np.concatenate(occ), np.concatenate(T),
                voxelize([rasterizer(q.occupancy, q) for q in parts], lo, hi), np.concatenate(weld), np.concatenate(skin))
    part.inner_union = voxelize([rasterizer(getattr(q, 'inner', q.occupancy), q) for q in parts], lo, hi)
    part.self_occlude = self_occlude
    return part


def puff(center, radii, rng, pole, lumps=((40, 0.5, 0.018), (220, 0.18, 0.005)), lat=44, lon=88):
    """A soft round puff of curly or coily hair: a lumpy ellipsoid. Its conformal chart has its
    pole on `pole`'s side (sunk into the head) and the opposite pole on the far side."""
    c = np.array(center, float); rad = np.array(radii, float)
    q = unit(pole)
    e1 = unit(np.cross(q, [0.0, 0, 1]) if abs(q[2]) < 0.9 else np.cross(q, [1.0, 0, 0]))
    e2 = np.cross(e1, q)                               # (q, e1, e2) like ellipsoid()'s (y, x, z): outside out
    th = np.linspace(0, math.pi, lat + 1)
    ph = 2 * math.pi * np.arange(lon) / lon
    TH, PH = np.meshgrid(th, ph, indexing='ij')
    dirs = (np.cos(TH)[..., None] * q + np.sin(TH)[..., None] * (np.cos(PH)[..., None] * e1 + np.sin(PH)[..., None] * e2)).reshape(-1, 3)
    lf = np.zeros(len(dirs)); big = None
    for i, (count, radius, height) in enumerate(lumps):
        f = lump_field(dirs, count, radius, rng)
        lf = lf + height * (f - 0.5)
        if big is None:
            big = f
    k = 1 + lf / rad.mean()
    V = c + dirs * rad * k[:, None]
    tiles = max(1, round(2 * math.pi * float(rad.mean()) / TILE_U))
    thc = np.clip(TH.ravel(), 0.02, math.pi - 0.02)
    U = PH.ravel() / (2 * math.pi) * tiles
    Vv = tiles / (4 * math.pi) * np.log(np.tan(thc / 2))
    G = smoothstep(0.05, 0.2, TH.ravel()) * smoothstep(0.05, 0.2, math.pi - TH.ravel())
    F = sphere_grid(lat, lon)
    weld = np.arange(len(V)); weld[:lon] = 0; weld[lat * lon:] = lat * lon
    occ = 1 - 0.14 * (1 - smoothstep(0.1, 0.7, big))

    def uvg(ids, k_):
        return U[ids], Vv[ids], G[ids]
    uvg.period = lambda k_: tiles

    def occupancy(p):
        return (((p - c) / rad) ** 2).sum(-1) < 1
    return Part(V, F, np.zeros(len(V), int), uvg, occ, None, occupancy, weld)


def body_occupancy(p):
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    neck = (x * x + (z - 0.035) ** 2 < 0.05 ** 2) & (y > 0.45) & (y < 0.62)
    torso = (x / 0.115) ** 2 + ((y - 0.40) / 0.13) ** 2 + ((z - 0.05) / 0.10) ** 2 < 1
    return neck | torso


# --- the extra shapes of each style ------------------------------------------------------------
def extra_bun(rng, ctx):
    return [ellipsoid((0, 1.035, -0.045), (0.088, 0.078, 0.088), rng)]


def extra_bun_puff(rng, ctx):
    # a soft round high puff in the wound bun's place
    return [puff((0, 1.05, -0.045), (0.11, 0.10, 0.11), rng, pole=(0, -0.55, 0.85))]


def extra_ponytail(rng, ctx):
    # The tail starts 3 cm inside the head (the first point, on the line of the first segment)
    # and comes out of the hair at the tie, so there is no gap or open end at the root. It swings
    # out to one side and a little up, so it shows past the head from the front.
    return [tube([(0, 0.937, -0.10), (0, 0.93, -0.17), (0.03, 0.965, -0.27), (0.12, 0.90, -0.33), (0.20, 0.80, -0.31),
                  (0.26, 0.72, -0.25), (0.31, 0.70, -0.20)],
                 [0.045, 0.05, 0.06, 0.064, 0.056, 0.04, 0.012], rng, root=1)]


PIGTAIL_PATH = [(0.12, 0.7125, -0.13), (0.17, 0.70, -0.13), (0.25, 0.68, -0.13), (0.29, 0.60, -0.11), (0.29, 0.52, -0.09), (0.27, 0.46, -0.08)]


def extra_pigtails(rng, ctx):
    out = []
    for s in (1, -1):
        out.append(tube([(s * x, y, z) for x, y, z in PIGTAIL_PATH], [0.04, 0.045, 0.05, 0.048, 0.036, 0.01], rng,
                        around=44, lobes=6, twist=s * 0.8, root=1))
    return out


def extra_braids(rng, ctx):
    # two plaits from the pigtail ties, each with a tie band and a short tuft at the end
    out = []
    for s in (1, -1):
        path = [(s * 0.12, 0.7125, -0.13), (s * 0.17, 0.70, -0.13), (s * 0.245, 0.675, -0.128), (s * 0.282, 0.60, -0.11),
                (s * 0.285, 0.50, -0.09), (s * 0.27, 0.43, -0.08)]
        root = tube([path[0], path[1], (s * 0.228, 0.684, -0.129)], [0.026, 0.03, 0.022], rng, around=36, lobes=5,
                    twist=s * 0.6, root=1, per=8)
        lobes, end, t, half = braid(path[1:], 0.07, rng, pitch=0.034, side=(1.0, 0, 0.25 * s), first=0.012)
        band = 0.8 * half
        tieband = tube([end - t * 0.006, end + t * 0.006], [band, band], rng, around=24, lobes=1, depth=0.0, per=4,
                       end='round', start='round')
        tuft = tube([end - t * 0.004, end + t * 0.02, end + t * 0.044 + np.array([0, -0.002, 0.003])],
                    [0.85 * band, 1.1 * band, 0.004], rng, around=24, lobes=4, twist=0.6, per=6)
        out.append(merge_parts([root] + lobes + [tieband, tuft]))
    return out


def extra_cornrows(rng, ctx):
    # short braid ends at the nape, where the rows are gathered
    out = []
    for az in (-160, -173, 173, 160):
        root = head_point(az, 0.69, ctx, out=-0.002)
        top = head_point(az, 0.665, ctx, out=0.012)
        o = unit(np.array([top[0], 0, top[2]]))
        path = [root, top, top + o * 0.006 + np.array([0, -0.06, 0]), top + o * 0.004 + np.array([0, -0.125, 0]),
                top + np.array([0, -0.16, 0])]
        lobes, end, t, half = braid(path, 0.036, rng, pitch=0.018, side=(1.0, 0, 0), first=0.0)
        tuft = tube([end - t * 0.008, end + t * 0.01, end + t * 0.026], [0.8 * half, 0.95 * half, 0.0025], rng, around=16,
                    lobes=3, twist=0.6, per=6)
        out += lobes + [tuft]
    return [merge_parts(out)]


def extra_locs(rng, ctx):
    """About 40 ropes rooted on rings from the crown down; each follows the head surface down to
    y .76, then hangs to the shoulders with a rounded end. None start over the face below .95, and
    the front ones are swept aside so the face stays open."""
    ropes = []
    for ri, (y0, m) in enumerate([(0.96, 9), (0.895, 12), (0.825, 15), (0.99, 4)]):
        for j in range(m):
            az = (j + 0.5 * (ri % 2)) * 360 / m + rng.uniform(-6, 6)
            az = (az + 180) % 360 - 180
            if abs(az) < 40 and y0 < 0.95:
                continue                                   # keep the face open
            sweep = 0.0 if abs(az) > 60 else math.copysign(60 - abs(az), az)
            radius = 0.025 * rng.uniform(0.92, 1.08)
            pts = [head_point(az + sweep * k / 3, yy, ctx, out=0.03 + 0.008 * k) for k, yy in enumerate(np.linspace(y0, 0.76, 4))]
            t0 = unit(pts[1] - pts[0])
            pts.insert(0, pts[0] - t0 * 0.03 - unit(pts[0] - CENTER) * 0.045)       # the root, under the scalp
            last = pts[-1]
            o = unit(np.array([last[0], 0, last[2]]))
            front = math.cos(math.radians(az + sweep)) > 0.3
            bottom = (0.535 if front else 0.50) + rng.uniform(-0.03, 0.03)
            L = 0.76 - bottom
            sw = np.cross([0, 1.0, 0], o) * rng.uniform(-0.02, 0.02)
            pts += [last + o * 0.012 + np.array([0, -0.06, 0]), last + o * 0.016 + sw * 0.5 + np.array([0, -0.5 * L, 0]),
                    last + o * 0.022 + sw + np.array([0, -L, 0])]
            rr = [radius * 0.6] + [radius] * (len(pts) - 2) + [radius * 0.92]
            ropes.append(tube(pts, rr, rng, around=12, lobes=2, depth=0.15, twist=5.0 + rng.uniform(-1, 1), root=1, per=5,
                              end='round', fold=0.5))
    return [merge_parts(ropes)]


def extra_buns(rng, ctx):
    return [ellipsoid((s * 0.14, 1.03, -0.03), (0.07, 0.062, 0.07), rng, lobes=7, twist=s * 1.1, calm=1.6) for s in (1, -1)]


def extra_buns_puff(rng, ctx):
    return [puff((s * 0.16, 1.05, -0.02), (0.10, 0.095, 0.10), rng, pole=(-s * 0.5, -0.55, 0.65),
                 lumps=((36, 0.5, 0.016), (200, 0.18, 0.005)), lat=40, lon=80) for s in (1, -1)]


def slerp_dirs(a, b, n):
    a, b = unit(a), unit(b)
    om = math.acos(float(np.clip(a @ b, -1, 1)))
    return np.array([(math.sin((1 - x) * om) * a + math.sin(x * om) * b) / math.sin(om) for x in np.linspace(0, 1, n)])


def extra_updo(rng, ctx):
    """Chunky rolled twists from the front hairline back over the head into a tall crown set
    toward the back; each roll starts under the hairline and ends tucked into the crown."""
    head = Grid(ctx.top_r, ctx.r)
    mound = np.array([0, 1.0, -0.15])
    out = [puff(mound, (0.125, 0.115, 0.12), rng, pole=(0, -0.6, 0.8), lumps=((26, 0.6, 0.016), (160, 0.2, 0.004)), lat=36, lon=72)]
    for az in (-46, -16, 16, 46):
        # each roll swells out of the hair just behind the hairline and rises toward the crown
        start = dir_from(az * 1.05, 36)
        end = unit(mound + np.array([0.04 * math.copysign(1, az) + 0.0012 * az, 0.03, 0.035]) - CENTER)
        D = slerp_dirs(start, end, 8)
        lift = np.array([-0.035, -0.005, 0.022, 0.045, 0.065, 0.082, 0.09, 0.075])
        pts = CENTER + D * (head(D) + lift)[:, None]
        pts[-1] = pts[-1] + (mound - pts[-1]) * 0.35                 # the end sinks into the crown
        rad = 0.045 if abs(az) < 30 else 0.041
        out.append(tube(list(pts), [rad * 0.55, rad * 0.85] + [rad] * 5 + [rad * 0.5], rng, around=24, lobes=2, depth=0.24, twist=6.5,
                        per=8, end='round', start='round'))
    return out


def extra_ringlets(rng, ctx):
    """Corkscrew ringlets hanging from under the cap's edge round the back and sides."""
    out = []
    n = 17
    for k in range(n):
        az = 66 + (294 - 66) * k / (n - 1) + rng.uniform(-3, 3)
        a = math.radians(az)
        top = np.array([math.sin(a) * 0.228, 0.705 + rng.uniform(-0.012, 0.012), math.cos(a) * 0.228 - 0.01])
        # the ones beside the face stay above the shoulders; the ones at the back hang longer
        length = rng.uniform(0.22, 0.26) * (1 - 0.32 * smoothstep(-0.2, 0.42, math.cos(a)))
        turns, coil, m = 4.0, 0.017, 26
        ph0 = rng.uniform(0, 2 * math.pi)
        o = unit(np.array([math.sin(a), 0, math.cos(a)]))
        side = np.cross([0, 1.0, 0], o)
        pts = [top + np.array([0, 0.05, 0]) - o * 0.004]
        for i in range(m):
            t = i / (m - 1)
            ang = ph0 + 2 * math.pi * turns * t
            ramp = smoothstep(0.1, 0.45, t)
            pts.append(top + o * (0.004 + 0.012 * t) + (o * math.cos(ang) + side * math.sin(ang)) * coil * ramp + np.array([0, -length * t, 0]))
        rr = [0.02] + [0.024 * (1 - 0.35 * (i / (m - 1)) ** 2) for i in range(m)]
        out.append(tube(pts, rr, rng, around=10, lobes=3, depth=0.12, twist=1.0, root=1, per=2, end='round', fold=0.7))
    return [merge_parts(out)]


def extra_long(rng, ctx, style):
    # (height, half-width, half-depth): starts inside the cap, tucked under the cap's tips,
    # then out below them like a second layer
    return [curtain(112, 248, [(0.75, 0.19, 0.19), (0.60, 0.205, 0.188), (0.53, 0.24, 0.226), (0.465, 0.228, 0.212)], th=0.05, rng=rng,
                    creases=ctx.shell.crease_azimuths(0.62), width=24.0, wave=style.get('curtain_wave'))]


EXTRAS = {
    'bun': extra_bun, 'bun_puff': extra_bun_puff, 'ponytail': extra_ponytail, 'pigtails': extra_pigtails,
    'braids': extra_braids, 'cornrows': extra_cornrows, 'locs': extra_locs, 'buns': extra_buns,
    'buns_puff': extra_buns_puff, 'updo': extra_updo, 'ringlets': extra_ringlets,
}


# ---------------------------------------------------------------------------
# Baked occlusion: rays from every vertex against the head, the neck and the other parts.
# ---------------------------------------------------------------------------
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
# Output: split chart boundaries and u seams, merge the parts, write the quantized glTF.
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


def write_glb(path, name, style_id, texture, V, N, UV, C, F):
    """The contract format of hair.js: one node without a transform, KHR_mesh_quantization."""
    P = V - HEAD
    assert np.abs(P).max() < 1, f'{name}: a vertex is 1 m or more from the Head bone'
    assert np.abs(UV).max() < UV_SCALE, f'{name}: uv beyond +-{UV_SCALE}'
    assert len(V) <= 65535, f'{name}: {len(V)} vertices do not fit uint16 indices'
    qp = np.zeros((len(P), 4), np.int16); qp[:, :3] = np.round(P * 32767)
    qn = np.zeros((len(P), 4), np.int8); qn[:, :3] = np.round(unit(N) * 127)
    quv = np.round(UV / UV_SCALE * 32767).astype(np.int16)
    C8 = np.clip(np.round(C * 255), 0, 255).astype(np.uint8)
    I = F.astype(np.uint16).ravel()
    chunks = [qp.tobytes(), qn.tobytes(), quv.tobytes(), C8.tobytes(), I.tobytes()]
    offs = np.concatenate([[0], np.cumsum([len(c) for c in chunks])]).tolist()
    blob = b''.join(chunks)
    blob += b'\0' * (-len(blob) % 4)
    nv = len(P)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'stories/tools/build_hair.py'},
        'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
        'extras': {'attachTo': 'Head', 'style': style_id, 'texture': texture, 'tile': [TILE_U, TILE_V], 'uvScale': UV_SCALE},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': f'Hair_{name}', 'mesh': 0}],
        'meshes': [{'name': f'Hair_{name}', 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2, 'COLOR_0': 3}, 'indices': 4}]}],
        'buffers': [{'byteLength': len(blob)}],
        'bufferViews': [
            {'buffer': 0, 'byteOffset': offs[0], 'byteLength': len(chunks[0]), 'byteStride': 8, 'target': 34962},
            {'buffer': 0, 'byteOffset': offs[1], 'byteLength': len(chunks[1]), 'byteStride': 4, 'target': 34962},
            {'buffer': 0, 'byteOffset': offs[2], 'byteLength': len(chunks[2]), 'target': 34962},
            {'buffer': 0, 'byteOffset': offs[3], 'byteLength': len(chunks[3]), 'target': 34962},
            {'buffer': 0, 'byteOffset': offs[4], 'byteLength': len(chunks[4]), 'target': 34963},
        ],
        'accessors': [
            {'bufferView': 0, 'componentType': 5122, 'normalized': True, 'count': nv, 'type': 'VEC3',
             'min': qp[:, :3].min(0).tolist(), 'max': qp[:, :3].max(0).tolist()},
            {'bufferView': 1, 'componentType': 5120, 'normalized': True, 'count': nv, 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5122, 'normalized': True, 'count': nv, 'type': 'VEC2'},
            {'bufferView': 3, 'componentType': 5121, 'normalized': True, 'count': nv, 'type': 'VEC4'},
            {'bufferView': 4, 'componentType': 5123, 'count': len(I), 'type': 'SCALAR'},
        ],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js
                + struct.pack('<II', len(blob), 0x004E4942) + blob)


def build_parts(name, A, d, r, top_r):
    """The parts of one look (output file name): its shell and its extra shapes."""
    sid, texture, style = look(name)
    rng = np.random.default_rng(sum(map(ord, sid)))           # the style's stream: same every build
    sp = shell(sid, style, A, d, r, top_r, rng)
    ctx = SimpleNamespace(name=sid, A=A, d=d, r=r, top_r=top_r, shell=sp)
    parts = [sp]
    for e in style.get('extras', []):
        parts += extra_long(rng, ctx, style) if e == 'long' else EXTRAS[e](rng, ctx)
    return sid, texture, parts


def build_look(name, A, d, r, top_r, head_r):
    sid, texture, parts = build_parts(name, A, d, r, top_r)
    for part in parts[1:]:                        # extras: occlusion tests drawn once into a grid
        if part.occupancy is not None and not getattr(part.occupancy, 'voxels', False):
            lo, hi = part.V.min(0) - 0.004, part.V.max(0) + 0.004
            part.occupancy = voxelize([rasterizer(part.occupancy, part)], lo, hi)
    out = []
    for i, part in enumerate(parts):
        N = vertex_normals(part.V, part.F, part.weld)
        blockers = [head_r, body_occupancy] + [p.occupancy for j, p in enumerate(parts) if j != i and p.occupancy]
        if part.self_occlude:
            blockers.append(part.inner_union)
        ao = bake_ao(part.ao_origin, N, blockers)
        ao = smooth_on_mesh(ao, part.F, len(part.V), part.weld)
        shade = (1 - 0.6 * (1 - ao)) * part.occ * part.tint
        # Where the shell takes the skin colour it must not come out darker than the skin next
        # to it, or the hairline shows as a dark band.
        shade = shade + (1 - shade) * part.skin
        color = np.stack([shade, part.skin, np.zeros(len(shade))], -1)
        out.append(split(part, N, color))
    V = np.vstack([o[0] for o in out]); N = np.vstack([o[1] for o in out]); UV = np.vstack([o[2] for o in out])
    C = np.clip(np.vstack([o[3] for o in out]), 0, 1); G = np.concatenate([o[4] for o in out])
    Fs, off = [], 0
    for o in out:
        Fs.append(o[5] + off); off += len(o[0])
    C = np.concatenate([C, (np.clip(G, 0, 1) * (1 - C[:, 1]))[:, None]], 1)
    F = np.vstack(Fs)
    # Triangles of no area once quantized (the poles of a bun, the hem where a curtain's two
    # sheets meet) draw nothing: leave them out.
    Q = np.round((V - HEAD) * 32767).astype(np.int64)
    cross = np.cross(Q[F[:, 1]] - Q[F[:, 0]], Q[F[:, 2]] - Q[F[:, 0]])
    return sid, texture, V, N, UV, C, F[np.any(cross != 0, axis=1)]


ORDER = ['spiky', 'swept', 'buzz', 'fade', 'quiff', 'curls', 'shaggy', 'balding', 'bob', 'afro', 'long', 'parted',
         'ponytail', 'pigtails', 'braids', 'cornrows', 'locs', 'bun', 'buns', 'updo']
assert sorted(ORDER) == sorted(STYLES)
OUTPUTS = ORDER + list(VARIANTS)


def write_index(out_dir):
    index = [{'id': sid, 'label': STYLES[sid]['label'], 'textures': STYLES[sid]['textures'], 'files': FILES[sid]} for sid in ORDER]
    with open(os.path.join(out_dir, 'index.json'), 'w') as f:
        json.dump(index, f, indent=1)
        f.write('\n')


if __name__ == '__main__':
    obj, out_dir = sys.argv[1], sys.argv[2]
    only = sys.argv[3].split(',') if len(sys.argv) > 3 else OUTPUTS
    unknown = [n for n in only if n not in OUTPUTS]
    if unknown:
        sys.exit(f'unknown output(s): {", ".join(unknown)}; outputs are {", ".join(OUTPUTS)}')
    os.makedirs(out_dir, exist_ok=True)
    A, d, r, top_r, head_r = head_setup(obj)
    for name in OUTPUTS:
        if name not in only:
            continue
        sid, texture, V, N, UV, C, F = build_look(name, A, d, r, top_r, head_r)
        path = os.path.join(out_dir, f'{name}.glb')
        write_glb(path, name, sid, texture, V, N, UV, C, F)
        print(f'{name:10s} {len(V):6d} verts {len(F):6d} tris {os.path.getsize(path) / 1e6:5.2f} MB', flush=True)
    write_index(out_dir)
