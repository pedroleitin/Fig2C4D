# Fig2C4D — details

## How it works

Figma's normal SVG export turns border radius into `<rect rx>` or elliptical arcs
(`A`), and that is exactly where Cinema 4D's importer breaks. Fig2C4D reads the
geometry Figma has already resolved and sends nothing but cubic Bézier curves
(`M/L/C/Z`), in absolute coordinates and with no `transform`. What lands in C4D
are clean splines.

Two plugins talking over HTTP on `localhost`:

```
Figma/                    Figma plugin: converts the selection and sends it
C4D-Plugin/Fig2C4D/       Cinema 4D plugin: receives it and builds the splines
```

## Requirements

- **Cinema 4D** — tested on **Cinema 4D 2026**. Earlier versions should work (the
  code looks each parameter up by name and falls back when one is missing), but
  they have not been tested.
- **Figma** — desktop app, in plugin development mode.

## Installing from the terminal

You install the **`Fig2C4D` folder from inside `C4D-Plugin/`** — not `C4D-Plugin`
itself. You should end up with:

```
plugins/
└── Fig2C4D/
    ├── fig2c4d.pyp
    └── fig2c4d_core.py
```

**macOS.** Each C4D install has its own preferences folder, with a hash in the
name. List them:

```bash
ls -d ~/Library/Preferences/Maxon/*/plugins
```

Then copy into the one you use — this works both for installing and for updating:

```bash
DEST="$HOME/Library/Preferences/Maxon/Maxon Cinema 4D 2026_XXXXXXXX/plugins/Fig2C4D"
mkdir -p "$DEST" && cp C4D-Plugin/Fig2C4D/* "$DEST/"
```

**Windows.** The folder is:

```
%APPDATA%\Maxon\<your C4D version>\plugins\
```

## Checking it loaded

Open the console (`Extensions → Console`, or `Shift+F10`) and look for:

```
Fig2C4D: listening on http://localhost:8787
```

Nothing there? The two files are probably not in the same folder, or they landed
in the preferences folder of a version you're not running.

## Usage details

The splines show up in C4D inside a null named `Fig2C4D - 3 items`, centred on the
origin, with undo working. The panel's footer shows the connection state.

The text field suggests the selected layer's name and doubles as an override for
the group name in C4D. Enter sends too.

**Extrude fills** uses Direction Z and Offset 0.1. **Stack in Z** spaces objects
0.1 apart; off, everything sits at Z 0.

## What carries over

**Name and colour** — the object is born with the Figma layer's name, with
`Basic → Use Color` enabled and `Display Color` set from the fill (the stroke
stands in when there is no fill). `Icon Color` is set to *Display Color* as well,
so the Object Manager icon is tinted too.

**Parametric shapes** (with **Primitives** on):

| Figma | Cinema 4D | Falls back to Bézier when |
|---|---|---|
| Rectangle | Rectangle spline (Rounding + Radius) | corners differ from each other |
| Ellipse | Circle spline (Radius) | not round, or it's an arc/donut |
| Star | Star spline (Points, Inner/Outer Radius) | — |
| Polygon | n-Side spline (Sides, Radius, Rounding) | — |

Any node with scale or skew in its matrix also falls back to Bézier. Figma's
*corner smoothing* (the iOS squircle) is ignored: corners always arrive as true
circular arcs with the nominal radius. The primitive's descriptor travels in
`data-*` attributes **alongside the exact path**, so if your C4D version doesn't
expose one of the parameters, the shape falls back to Bézier rather than arriving
deformed — and the console says which parameter was missing.

**Stretched stars and polygons.** Figma stretches them to fill the bounding box;
C4D's Star and n-Side have a single radius. They arrive regular, with scale 1.

## Bézier handles (`HANDLE`)

Cinema 4D 2026.3.1 draws a Bézier with handles 4/3 longer than the stored
tangent, and its own SVG importer compensates by scaling tangents by 3/4. The
core does the same (`HANDLE = 0.75` in `fig2c4d_core.py`). If corners arrive too
round on another version, set it to `1.0`.

This likely also means C4D's Rectangle fillet (tangents of `0.415 × radius`) is a
true circular arc, not ~7.8% off as previously noted — not yet verified.

## Development

`fig2c4d_core.py` (parser + spline building) is reloaded on every send — copy it
over and the next click already uses it, no C4D restart. On a syntax error C4D
keeps the previous version and prints the traceback.

```bash
cp C4D-Plugin/Fig2C4D/fig2c4d_core.py ~/Library/Preferences/Maxon/*/plugins/Fig2C4D/
```

`fig2c4d.pyp` holds the socket, so changing it does need a restart. If a shape
arrives rotated, the `SPIN` dict at the top of the core fixes each primitive's
orientation in degrees.

```bash
node Figma/test.js && python3 C4D-Plugin/Fig2C4D/fig2c4d_core.py
```

Tests cover path conversion, the primitive detectors, colours, the SVG parser and
the tangents. Neither needs Figma or C4D running.

## Security

The server listens on `127.0.0.1:8787` only — it is never exposed to the network.
The Figma plugin declares that address under `networkAccess` in its manifest and
reaches nothing else.
