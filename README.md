# Fig2C4D

![version](https://img.shields.io/badge/version-1.2-blue)
![Cinema 4D](https://img.shields.io/badge/Cinema%204D-2026-orange)

Send Figma vectors straight into Cinema 4D with one click — no exporting, saving
or importing files.

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

---

## Requirements

- **Cinema 4D** — tested on **Cinema 4D 2026**. Earlier versions should work (the
  code looks each parameter up by name and falls back when one is missing), but
  they have not been tested.
- **Figma** — desktop app, in plugin development mode.

---

## Installation

### 1. Cinema 4D

You install the **`Fig2C4D` folder from inside `C4D-Plugin/`** — not `C4D-Plugin`
itself.

**macOS.** Each C4D install has its own preferences folder, with a hash in the
name, so let C4D point you at the right one:

1. In Cinema 4D: `Edit → Preferences…`, then click **Open Preferences Folder** at
   the bottom left. Finder opens on the correct folder for your version.
2. Go into `plugins/` (create it if it isn't there).
3. Drag `C4D-Plugin/Fig2C4D` into it.

Prefer the terminal? List the preference folders you have:

```bash
ls -d ~/Library/Preferences/Maxon/*/plugins
```

Then copy into the one you use — this works both for installing and for updating:

```bash
DEST="$HOME/Library/Preferences/Maxon/Maxon Cinema 4D 2026_XXXXXXXX/plugins/Fig2C4D"
mkdir -p "$DEST" && cp C4D-Plugin/Fig2C4D/* "$DEST/"
```

**Windows.** Drop `C4D-Plugin\Fig2C4D` into:

```
%APPDATA%\Maxon\<your C4D version>\plugins\
```

Either way, you should end up with:

```
plugins/
└── Fig2C4D/
    ├── fig2c4d.pyp
    └── fig2c4d_core.py
```

**Restart Cinema 4D.** Open the console (`Extensions → Console`, or `Shift+F10`)
and look for:

```
Fig2C4D: listening on http://localhost:8787
```

Nothing there? The two files are probably not in the same folder, or they landed
in the preferences folder of a version you're not running.

### 2. Figma

1. Open the Figma desktop app
2. Menu → `Plugins` → `Development` → `Import plugin from manifest…`
3. Pick `Figma/manifest.json`

The plugin shows up under `Plugins → Development → Fig2C4D`.

---

## Usage

1. Keep Cinema 4D open, with a document.
2. In Figma, select what you want to send — a single shape, a group, a whole
   frame, or several items at once.
3. Run the plugin and hit **Send to C4D**.

The splines show up in C4D inside a null named `Fig2C4D - 3 items`, centred on the
origin, with undo working. The panel's footer shows the connection state.

**With Cinema 4D closed**, the button still works: the plugin saves the converted
`.svg` instead — same geometry, ready to import by hand later.

### Options

| Option | What it does |
|---|---|
| **Primitives** | Shapes with a C4D equivalent arrive as editable parametric objects instead of point splines. |
| **Extrude fills** | Every node that has a fill goes inside an Extrude with Direction Z and Offset 0.1. |

The text field suggests the selected layer's name and doubles as an override for
the group name in C4D. Enter sends too.

---

## What carries over

**Name and colour** — the object is born with the Figma layer's name, with
`Basic → Use Color` enabled and `Display Color` set from the fill (the stroke
stands in when there is no fill). `Icon Color` is set to *Display Color* as well,
so the Object Manager icon is tinted too.

**Parametric shapes** (with **Primitives** on):

| Figma | Cinema 4D | Falls back to Bézier when |
|---|---|---|
| Rectangle | Rectangle spline (Rounding + Radius) | corners differ from each other, or corner smoothing is on |
| Ellipse | Circle spline (Radius) | not round, or it's an arc/donut |
| Star | Star spline (Points, Inner/Outer Radius) | — |
| Polygon | n-Side spline (Sides, Radius, Rounding) | corner smoothing is on |

Any node with scale or skew in its matrix also falls back to Bézier. The
primitive's descriptor travels in `data-*` attributes **alongside the exact
path**, so if your C4D version doesn't expose one of the parameters, the shape
falls back to Bézier rather than arriving deformed — and the console says which
parameter was missing.

### Two caveats

**Rectangle corners.** C4D's fillet uses handles of `0.415 × radius`, Figma draws
a true circular arc (`0.5523 × radius`), so the corner lands about 7.8% of the
radius off. Turn **Primitives** off when the silhouette has to match exactly.

**Stretched stars and polygons.** Figma stretches them to fill the bounding box;
C4D's Star and n-Side have a single radius. They arrive regular, with scale 1.

---

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

---

## Security

The server listens on `127.0.0.1:8787` only — it is never exposed to the network.
The Figma plugin declares that address under `networkAccess` in its manifest and
reaches nothing else.
