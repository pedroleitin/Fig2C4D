# Fig2C4D

![version](https://img.shields.io/badge/version-1.4-blue)
![Cinema 4D](https://img.shields.io/badge/Cinema%204D-2026-orange)

Send Figma vectors straight into Cinema 4D with one click — no exporting or
importing files.

## Install

**Cinema 4D**

1. `Edit → Preferences…` → **Open Preferences Folder**.
2. Copy the `C4D-Plugin/Fig2C4D` folder into `plugins/` (create it if needed).
3. Restart Cinema 4D.

**Figma** (desktop app)

1. `Plugins → Development → Import plugin from manifest…`
2. Pick `Figma/manifest.json`.

## Use

1. Keep Cinema 4D open.
2. Select something in Figma.
3. Run **Fig2C4D** and hit **Send to C4D**.

Cinema 4D closed? The button saves an `.svg` instead.

| Option | What it does |
|---|---|
| **Primitives** | Rectangles, circles, stars and polygons arrive as editable C4D shapes. |
| **Extrude fills** | Shapes with a fill arrive inside an Extrude. |
| **Stack in Z** | Keeps Figma's layer order as depth. |

---

Troubleshooting, how it works and development notes: [DETAILS.md](DETAILS.md).
