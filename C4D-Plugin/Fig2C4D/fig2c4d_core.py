# -*- coding: utf-8 -*-
"""Fig2C4D SVG parser + spline building in the scene.

This file is reloaded (importlib.reload) on every send, so editing it takes effect
immediately, with no Cinema 4D restart. The .pyp only holds the server.

Every <path> carries the exact geometry (M/L/C/Z) and, when a parametric
equivalent exists, a descriptor in data-*. The primitive is only used if C4D
exposes every parameter it needs; otherwise we fall back to the path, which is
always right.

The parser does not depend on c4d, so it runs standalone:
`python3 fig2c4d_core.py` runs the self-check at the bottom of this file.
"""
import math
import re

try:
    import c4d
except ImportError:  # running outside Cinema 4D, just for the self-check
    c4d = None

# Native orientation of each primitive, in C4D banking degrees. Measured: n-Side
# and Star are born with their first vertex at +X while Figma draws the point at
# +Y, and positive banking turns clockwise seen from the front — hence -90. If a
# shape still arrives rotated, just edit here: the core reloads without a restart.
VERSION = "1.4"
DEBUG = False  # prints each incoming path to the console; flip off when done

OFFSET = 0.1   # Extrude depth, in C4D units
# Z step between stacked objects, in C4D units. Items arrive back-to-front and the
# Front view looks along +Z, so the step is negative: the topmost Figma layer ends
# up closest to the camera. Flip the sign to reverse the stack.
STACK = -0.1

SPIN = {"rect": 0.0, "circle": 0.0, "star": -90.0, "ngon": -90.0}

# C4D draws a Bézier with handles 4/3 longer than the stored tangent, so an SVG
# control offset goes in scaled by 3/4 — C4D's own SVG importer does the same.
# Measured on 2026.3.1. If corners arrive too round on another version, set 1.0.
HANDLE = 0.75

TOK = re.compile(r"([MLCZ])([^MLCZ]*)", re.I)
NUM = re.compile(r"-?\d*\.?\d+(?:e[-+]?\d+)?", re.I)
EL = re.compile(r"<path\b([^>]*)>", re.I)
ATTR = re.compile(r'([\w:-]+)="([^"]*)"')
DATA = ("cx", "cy", "rot", "w", "h", "r", "ir", "n", "round")
TEXT = ("name", "fill", "stroke")
Z = (0.0, 0.0)


def unesc(s):
    return (s.replace("&quot;", '"').replace("&lt;", "<")
             .replace("&gt;", ">").replace("&amp;", "&"))


def _near(a, b):
    return abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6


def parse_d(d):
    """-> [(points, closed)], points = [((x, y), left_tangent, right_tangent)]"""
    subs, state = [], {"pts": [], "closed": False}

    def flush():
        pts, closed = state["pts"], state["closed"]
        if len(pts) > 1:
            # A Z that lands back on the start point: the last point IS the first,
            # so it goes away and hands its left tangent to the first one.
            if closed and _near(pts[0][0], pts[-1][0]):
                pts[0][1] = pts[-1][1]
                pts.pop()
            subs.append(([tuple(p) for p in pts], closed))
        state["pts"], state["closed"] = [], False

    for cmd, args in TOK.findall(d):
        v = [float(x) for x in NUM.findall(args)]
        c, pts = cmd.upper(), state["pts"]
        if c == "M":
            flush()
            pts = state["pts"]
            pts.append([(v[0], v[1]), Z, Z])
            for i in range(2, len(v) - 1, 2):
                pts.append([(v[i], v[i + 1]), Z, Z])
        elif c == "L":
            for i in range(0, len(v) - 1, 2):
                pts.append([(v[i], v[i + 1]), Z, Z])
        elif c == "C":
            for i in range(0, len(v) - 5, 6):
                p0 = pts[-1][0]
                pts[-1][2] = (v[i] - p0[0], v[i + 1] - p0[1])
                p3 = (v[i + 4], v[i + 5])
                pts.append([p3, (v[i + 2] - p3[0], v[i + 3] - p3[1]), Z])
        elif c == "Z":
            state["closed"] = True
            flush()
    flush()
    return subs


def parse_svg(svg):
    """-> (viewBox [x, y, w, h], items, meta {"name", "extrude"})

    Item: {"kind": rect|circle|star|ngon|path, "paths": [(pts, closed)], ...data}
    """
    vb = re.search(r'viewBox="([^"]+)"', svg)
    box = [float(x) for x in vb.group(1).split()] if vb else [0.0, 0.0, 0.0, 0.0]
    gn = re.search(r'<svg[^>]*\bdata-name="([^"]*)"', svg)
    meta = {"name": unesc(gn.group(1)) if gn else "",
            "extrude": bool(re.search(r'<svg[^>]*\bdata-extrude="1"', svg)),
            "stack": bool(re.search(r'<svg[^>]*\bdata-stack="1"', svg))}
    items = []
    for raw in EL.findall(svg):
        at = dict(ATTR.findall(raw))
        if DEBUG:
            print("Fig2C4D path %s: %s" % (at.get("data-name", "?"), at.get("d", "")[:600]))
        paths = parse_d(at.get("d", ""))
        if not paths:
            continue
        it = {"kind": at.get("data-c4d", "path"), "paths": paths}
        for k in DATA:
            it[k] = float(at.get("data-" + k, 0))
        for k in TEXT:
            it[k] = unesc(at.get("data-" + k, ""))
        items.append(it)
    return box, items, meta


# --------------------------------------------------------------------------
# scene


def setp(sp, name, val):
    """Sets a primitive parameter. False if this C4D version doesn't have it."""
    pid = getattr(c4d, name, None)
    if pid is None:
        return False
    sp[pid] = val
    return True


def prim(*names):
    for nm in names:
        t = getattr(c4d, nm, None)
        if t is not None:
            return c4d.BaseObject(t)
    return None


# What each primitive needs. If something is missing in this C4D version, build
# prints the exact missing name instead of letting the shape arrive wrong.
NEEDS = {
    "rect": ("Osplinerectangle", "PRIM_RECTANGLE_WIDTH", "PRIM_RECTANGLE_HEIGHT",
             "PRIM_RECTANGLE_ROUNDING", "PRIM_RECTANGLE_RADIUS"),
    "circle": ("Osplinecircle", "PRIM_CIRCLE_RADIUS"),
    "star": ("Osplinestar", "PRIM_STAR_POINTS", "PRIM_STAR_ORAD", "PRIM_STAR_IRAD"),
    "ngon": ("Osplinenside", "PRIM_NSIDE_SIDES", "PRIM_NSIDE_RADIUS"),
}


def missing(kind):
    return [n for n in NEEDS.get(kind, ()) if getattr(c4d, n, None) is None]


def rgb(h):
    h = h.lstrip("#")
    if len(h) != 6:
        return None
    return c4d.Vector(int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)


def dress(sp, it, fallback):
    """Node name, Display Color, and the Object Manager icon tinted with it.
    The fill wins; the stroke stands in."""
    sp.SetName(it["name"] or fallback)
    col = rgb(it["fill"] or it["stroke"] or "")
    if col is not None:
        sp[c4d.ID_BASEOBJECT_USECOLOR] = getattr(c4d, "ID_BASEOBJECT_USECOLOR_ALWAYS", 2)
        sp[c4d.ID_BASEOBJECT_COLOR] = col
        # Basic > Icon > Icon Color = Display Color, so the Object Manager icon
        # comes out tinted with the Figma colour.
        mode = getattr(c4d, "ID_BASELIST_ICON_COLORIZE_MODE_DISPLAYCOLOR", None)
        if mode is not None:
            setp(sp, "ID_BASELIST_ICON_COLORIZE_MODE", mode)


def set_interp(sp):
    sp[c4d.SPLINEOBJECT_INTERPOLATION] = c4d.SPLINEOBJECT_INTERPOLATION_ADAPTIVE
    sp[c4d.SPLINEOBJECT_ANGLE] = math.radians(0.5)


def make_rect(it):
    sp = prim("Osplinerectangle")
    if sp is None:
        return None
    setp(sp, "PRIM_RECTANGLE_WIDTH", it["w"])
    setp(sp, "PRIM_RECTANGLE_HEIGHT", it["h"])
    if it["round"] or it["r"]:
        setp(sp, "PRIM_RECTANGLE_ROUNDING", True)
        setp(sp, "PRIM_RECTANGLE_RADIUS", it["r"])
    return sp


def make_circle(it):
    sp = prim("Osplinecircle")
    if sp is None or not setp(sp, "PRIM_CIRCLE_RADIUS", it["r"]):
        return None
    return sp


def make_star(it):
    sp = prim("Osplinestar", "Osplinestars")
    if sp is None:
        return None
    ok = setp(sp, "PRIM_STAR_POINTS", int(it["n"]))
    ok &= setp(sp, "PRIM_STAR_ORAD", it["r"])
    ok &= setp(sp, "PRIM_STAR_IRAD", it["ir"])
    return sp if ok else None


def make_ngon(it):
    sp = prim("Osplinenside", "Osplinengon", "Osplinen_side")
    if sp is None:
        return None
    ok = setp(sp, "PRIM_NSIDE_SIDES", int(it["n"]))
    ok &= setp(sp, "PRIM_NSIDE_RADIUS", it["r"])
    if it["round"]:
        # ponytail: if this version's n-Side has no rounding, the polygon would
        # arrive with sharp corners — better to fall back to the always-right path.
        ok &= setp(sp, "PRIM_NSIDE_ROUNDING", True)
        ok &= setp(sp, "PRIM_NSIDE_RADIUS_ROUNDING", it["round"])
    return sp if ok else None


MAKERS = {"rect": make_rect, "circle": make_circle, "star": make_star, "ngon": make_ngon}


def wrap_extrude():
    """Extrude with Direction Z and Offset. If no known parameter name works, it
    prints the candidates to the console instead of silently letting the 100 cm
    default through."""
    ex = prim("Oextrude")
    if ex is None:
        return None
    zdir = getattr(c4d, "EXTRUDEOBJECT_DIRECTION_Z", None)
    if zdir is not None:
        setp(ex, "EXTRUDEOBJECT_DIRECTION", zdir)
    if not (setp(ex, "EXTRUDEOBJECT_OFFSET", OFFSET)
            or setp(ex, "EXTRUDEOBJECT_EXTRUSIONOFFSET", OFFSET)
            or setp(ex, "EXTRUDEOBJECT_MOVE", c4d.Vector(0.0, 0.0, OFFSET))):
        print("Fig2C4D: could not find the Extrude Offset parameter. Candidates:",
              [n for n in dir(c4d) if "EXTRUDE" in n.upper()])
    return ex


def centre(pts):
    """Centre of the anchor points' bounding box, in SVG space. Tangents are
    relative, so shifting the anchors by this puts the object axis mid-shape."""
    xs = [p[0][0] for p in pts]
    ys = [p[0][1] for p in pts]
    return (min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0


def make_path(pts, closed):
    """Bezier spline with its axis at the shape's centre. Returns (spline, centre)
    so the caller can place the object where the shape was."""
    mx, my = centre(pts)
    sp = c4d.SplineObject(len(pts), c4d.SPLINETYPE_BEZIER)
    sp[c4d.SPLINEOBJECT_CLOSED] = closed
    for j, (p, vl, vr) in enumerate(pts):
        sp.SetPoint(j, c4d.Vector(p[0] - mx, -(p[1] - my), 0.0))
        sp.SetTangent(j, c4d.Vector(vl[0], -vl[1], 0.0) * HANDLE,
                      c4d.Vector(vr[0], -vr[1], 0.0) * HANDLE)
    sp.Message(c4d.MSG_UPDATE)
    return sp, (mx, my)


def host(root, it, meta, sp):
    """Where the spline goes: inside an Extrude if the node has a fill, else root."""
    if not (meta["extrude"] and it["fill"]):
        return root
    ex = wrap_extrude()
    if ex is None:
        print("Fig2C4D: c4d.Oextrude not found in this version, '%s' left as a spline"
              % sp.GetName())
        return root
    dress(ex, it, sp.GetName())   # same name, same Display Color, same icon
    ex.InsertUnder(root)
    return ex


def build(svg):
    box, items, meta = parse_svg(svg)
    if not items:
        return 0
    # SVG has Y going down and its origin in the corner; C4D has Y going up.
    # Centre on the viewBox so the shape is born at the origin.
    cx, cy = box[0] + box[2] / 2.0, box[1] + box[3] / 2.0
    doc = c4d.documents.GetActiveDocument()
    root = c4d.BaseObject(c4d.Onull)

    doc.StartUndo()
    doc.InsertObject(root)
    doc.AddUndo(c4d.UNDOTYPE_NEWOBJ, root)
    made = 0
    for i, it in enumerate(items):
        maker = MAKERS.get(it["kind"])
        sp = maker(it) if maker else None
        z = i * STACK if meta["stack"] else 0.0
        if sp is not None:
            dress(sp, it, "%s.%03d" % (it["kind"], i))
            sp.SetAbsPos(c4d.Vector(it["cx"] - cx, -(it["cy"] - cy), z))
            # Figma measures the angle with Y down (positive = clockwise on screen)
            # and C4D banking also turns clockwise, so the two simply add up.
            ang = math.radians(SPIN.get(it["kind"], 0.0) + it["rot"])
            if ang:
                sp.SetAbsRot(c4d.Vector(0.0, 0.0, ang))
            set_interp(sp)
            sp.InsertUnder(host(root, it, meta, sp))
            made += 1
        else:
            if maker:
                print("Fig2C4D: '%s' fell back to Bézier, missing from c4d: %s"
                      % (it["kind"], ", ".join(missing(it["kind"])) or "(unknown parameter)"))
            for j, (pts, closed) in enumerate(it["paths"]):
                sp, (mx, my) = make_path(pts, closed)
                base = it["name"] or "path.%03d" % i
                dress(sp, it, base)
                if len(it["paths"]) > 1:
                    sp.SetName("%s.%d" % (sp.GetName(), j))
                sp.SetAbsPos(c4d.Vector(mx - cx, -(my - cy), z))
                set_interp(sp)
                sp.InsertUnder(host(root, it, meta, sp))
                made += 1
    root.SetName(meta["name"] or
                 "Fig2C4D - %d %s" % (made, "item" if made == 1 else "items"))
    doc.EndUndo()
    c4d.EventAdd()
    # One line per send in the console, so a "nothing happened" report can be
    # checked against what was actually requested and built.
    filled = sum(1 for it in items if it["fill"])
    print("Fig2C4D: %d spline(s), %d with fill | extrude=%s stack=%s | core %s"
          % (made, filled, "on" if meta["extrude"] else "off",
             "on" if meta["stack"] else "off", VERSION))
    c4d.StatusSetText("Fig2C4D: %d spline(s)" % made)
    return made


if __name__ == "__main__":
    box, items, _m = parse_svg('<svg viewBox="0 0 10 10"><path d="M0 0 C0 5 5 10 10 10 L10 0 Z"/></svg>')
    assert box == [0, 0, 10, 10]
    pts, closed = items[0]["paths"][0]
    assert closed and len(pts) == 3 and items[0]["kind"] == "path"
    assert pts[0][0] == (0.0, 0.0) and pts[0][2] == (0.0, 5.0)      # right tangent
    assert pts[1][0] == (10.0, 10.0) and pts[1][1] == (-5.0, 0.0)   # left tangent

    # closed square: the point repeated by Z is dropped
    _, items, _m = parse_svg('<path d="M0 0 L4 0 L4 4 L0 4 L0 0 Z"/>')
    assert len(items[0]["paths"][0][0]) == 4 and items[0]["paths"][0][1]

    # two subpaths in a single d, the second open — one item, two paths
    _, items, _m = parse_svg('<path d="M0 0 L1 0 Z M5 5 L6 6"/>')
    assert len(items) == 1 and len(items[0]["paths"]) == 2
    assert items[0]["paths"][0][1] and not items[0]["paths"][1][1]

    # the parametric descriptor travels alongside the exact geometry
    _, items, _m = parse_svg('<path d="M0 0 L1 1" data-c4d="star" data-n="5" data-r="100"'
                         ' data-ir="40" data-cx="7" data-cy="8" data-rot="30"/>')
    it = items[0]
    assert it["kind"] == "star" and (it["n"], it["r"], it["ir"]) == (5.0, 100.0, 40.0)
    assert (it["cx"], it["cy"], it["rot"]) == (7.0, 8.0, 30.0)
    assert it["paths"], "the exact path is still there for the fallback"

    # missing data-* becomes 0 / "", not a KeyError
    _, items, _m = parse_svg('<path d="M0 0 L1 1" data-c4d="circle" data-r="5"/>')
    assert items[0]["round"] == 0 and items[0]["n"] == 0
    assert items[0]["name"] == "" and items[0]["fill"] == ""

    # an escaped name comes back intact, along with the colours
    _, items, _m = parse_svg('<path d="M0 0 L1 1" data-name="Bot&amp;o &lt;ok&gt;"'
                         ' data-fill="#ff0000" data-stroke="#0080ff"/>')
    assert items[0]["name"] == "Bot&o <ok>", items[0]["name"]
    assert (items[0]["fill"], items[0]["stroke"]) == ("#ff0000", "#0080ff")

    # axis lands mid-shape: the anchors' bbox centre, tangents untouched
    pts = [((10.0, 20.0), (0, 0), (1, 1)), ((30.0, 60.0), (2, 2), (0, 0)), ((20.0, 40.0), (0, 0), (0, 0))]
    assert centre(pts) == (20.0, 40.0)
    assert centre([((5.0, 5.0), (0, 0), (0, 0))]) == (5.0, 5.0)

    # the group name comes from the <svg> itself
    _, _, m = parse_svg('<svg viewBox="0 0 1 1" data-name="Meu &amp; grupo" data-extrude="1">'
                        '<path d="M0 0 L1 1"/></svg>')
    assert m == {"name": "Meu & grupo", "extrude": True, "stack": False}, m
    _, _, m = parse_svg('<svg viewBox="0 0 1 1"><path d="M0 0 L1 1"/></svg>')
    assert m == {"name": "", "extrude": False, "stack": False}, m

    _, _, m = parse_svg('<svg viewBox="0 0 1 1" data-stack="1"><path d="M0 0 L1 1"/></svg>')
    assert m["stack"] is True
    print("ok")
