var assert = require("assert");
var path = require("path");
var toAbsCubic = require("./code.js").toAbsCubic;
var I = [[1, 0, 0], [0, 1, 0]];

// Q becomes C (controls at 2/3 of the way), Z closes
assert.strictEqual(toAbsCubic("M0 0 Q3 3 6 0 Z", I), "M0 0 C2 2 4 2 6 0 Z");
// extra pairs after M become L, and the transform (scale 2 + translate 10/5) applies
assert.strictEqual(toAbsCubic("M0 0 1 1", [[2, 0, 10], [0, 2, 5]]), "M10 5 L12 7");
// C passes through; Z returns to the start point for a following Q
assert.strictEqual(toAbsCubic("M1 1 C1 2 2 3 3 3", I), "M1 1 C1 2 2 3 3 3");
// 90deg rotation: (1,0) -> (0,1)
assert.strictEqual(toAbsCubic("M1 0 L0 1", [[0, -1, 0], [1, 0, 0]]), "M0 1 L-1 0");
console.log("ok");

// --- parametric descriptors ---
var api = require("./code.js"), paramOf = api.paramOf, attrs = api.attrs, ngonBox = api.ngonBox;
var N = function (o) {
  return Object.assign({ cornerSmoothing: 0, absoluteTransform: I }, o);
};

// rectangle: equal corners (0 included) become a Rectangle; the rest falls back
var R = function (o) { return N(Object.assign({ type: "RECTANGLE", cornerRadius: 8, width: 100, height: 60 }, o)); };
var q = paramOf(R({ absoluteTransform: [[1, 0, 10], [0, 1, 20]] }));
assert.deepStrictEqual([q.c4d, q.w, q.h, q.r, q.cx, q.cy], ["rect", 100, 60, 8, 60, 50]);
assert.strictEqual(paramOf(R({ cornerRadius: 0 })).r, 0);          // no rounding, still parametric
assert.strictEqual(paramOf(R({ cornerRadius: 999 })).r, 30);       // raio limitado a metade do lado
assert.strictEqual(paramOf(R({ cornerRadius: Symbol("mixed") })), null);
assert.strictEqual(paramOf(R({ cornerRadius: 8, cornerSmoothing: 0.6 })), null);
assert.strictEqual(paramOf(R({ absoluteTransform: [[2, 0, 0], [0, 1, 0]] })), null);  // escala

// circle: only when round and whole
var E = function (o) { return N(Object.assign({ type: "ELLIPSE", width: 80, height: 80 }, o)); };
assert.deepStrictEqual(paramOf(E()).c4d, "circle");
assert.strictEqual(paramOf(E()).r, 40);
assert.strictEqual(paramOf(E({ height: 50 })), null);                                   // ellipse
assert.strictEqual(paramOf(E({ arcData: { startingAngle: 0, endingAngle: 3, innerRadius: 0 } })), null); // pie slice
assert.strictEqual(paramOf(E({ arcData: { startingAngle: 0, endingAngle: 2 * Math.PI, innerRadius: 0.5 } })), null); // donut

// reference bbox: a radius-1 hexagon is taller than it is wide
var hex = ngonBox(6, 0);
assert.ok(Math.abs(hex.w - Math.sqrt(3)) < 1e-9 && Math.abs(hex.h - 2) < 1e-9);

// polygon: regular becomes an n-Side, stretched stays parametric too
var P = function (o) { return N(Object.assign({ type: "POLYGON", pointCount: 6, cornerRadius: 0,
                                                width: 100 * Math.sqrt(3), height: 200 }, o)); };
q = paramOf(P());
assert.deepStrictEqual([q.c4d, q.n, Math.round(q.r), q.round], ["ngon", 6, 100, 0]);
assert.strictEqual(paramOf(P({ cornerRadius: 12 })).round, 12);
assert.strictEqual(paramOf(P({ cornerRadius: 12, cornerSmoothing: 0.6 })), null);

// stretched (the normal case in Figma): still parametric and regular, no scale
q = paramOf(P({ height: 100 }));                      // regular height would be 200
assert.strictEqual(q.c4d, "ngon");
assert.ok(Math.abs(q.r - Math.sqrt(100 * 50)) < 1e-9, q.r);   // geometric mean
assert.strictEqual(q.sy, undefined);

// star: proportions depend on the inner radius
var ib = ngonBox(5, 0.4);
var S = function (o) { return N(Object.assign({ type: "STAR", pointCount: 5, innerRadius: 0.4,
                                                width: 100 * ib.w, height: 100 * ib.h }, o)); };
q = paramOf(S());
assert.deepStrictEqual([q.c4d, q.n, Math.round(q.r), Math.round(q.ir)], ["star", 5, 100, 40]);
q = paramOf(S({ height: 100 * ib.h * 1.2 }));         // stretched 20% vertically
assert.ok(Math.abs(q.r - Math.sqrt(100 * 120)) < 1e-9, q.r);
assert.strictEqual(q.sy, undefined);

// the data-* that travel in the SVG (zeros are left out)
assert.strictEqual(attrs(paramOf(R({ cornerRadius: 0, absoluteTransform: [[1, 0, 0], [0, 1, 0]] }))),
  ' data-c4d="rect" data-cx="50" data-cy="30" data-w="100" data-h="60"');
assert.strictEqual(attrs(null), "");
console.log("ok");

// --- name and colours ---
var styleOf = api.styleOf, paint = api.paint, paintAttrs = api.paintAttrs;
var SOLID = function (r, g, b) { return { type: "SOLID", color: { r: r, g: g, b: b } }; };

assert.strictEqual(paint([SOLID(1, 0, 0)]), "#ff0000");
assert.strictEqual(paint([SOLID(0, 0.5, 1)]), "#0080ff");
assert.strictEqual(paint([]), null);
assert.strictEqual(paint(Symbol("mixed")), null);                       // figma.mixed
assert.strictEqual(paint([{ type: "SOLID", visible: false, color: { r: 1, g: 1, b: 1 } },
                          SOLID(0, 0, 0)]), "#000000");                 // skips invisible
assert.strictEqual(paint([{ type: "SOLID", opacity: 0, color: { r: 1, g: 1, b: 1 } }]), null);
assert.strictEqual(paint([{ type: "GRADIENT_LINEAR",
                            gradientStops: [{ color: { r: 0, g: 1, b: 0 } }] }]), "#00ff00");

var st = styleOf({ name: "Botão <ok>", fills: [SOLID(1, 1, 1)], strokes: [SOLID(0, 0, 0)], strokeWeight: 2 });
assert.deepStrictEqual(st, { name: "Botão <ok>", fill: "#ffffff", stroke: "#000000", sw: 2 });
assert.strictEqual(attrs(null, st),
  ' data-name="Botão &lt;ok&gt;" data-fill="#ffffff" data-stroke="#000000"');
assert.strictEqual(paintAttrs(st), ' fill="#ffffff" stroke="#000000" stroke-width="2"');

// no paint at all: black outline, as before
assert.strictEqual(paintAttrs(styleOf({ name: "x", fills: [], strokes: [] })),
  ' fill="none" stroke="#000000" stroke-width="1"');
// fill only: no stroke in the SVG
assert.strictEqual(paintAttrs(styleOf({ name: "x", fills: [SOLID(1, 0, 0)], strokes: [] })),
  ' fill="#ff0000" stroke="none"');
console.log("ok");

// --- ui.html: global variable clashing with a window property ---
// window.name, window.status and friends are accessors that coerce to string:
// `var name = document.getElementById(...)` becomes "[object HTMLInputElement]"
// and every access after that fails silently.
var fs = require("fs");
var WINDOW_PROPS = ["name", "status", "length", "top", "self", "parent", "origin",
                    "closed", "frames", "history", "location", "screen", "event",
                    "external", "toolbar", "menubar", "scrollbars", "opener"];
var declared = [];
fs.readFileSync(process.env.UI || path.join(__dirname, "ui.html"), "utf8").replace(/\bvar\s+([A-Za-z_$][\w$]*)/g, function (_, v) {
  declared.push(v);
});
var clash = declared.filter(function (v) { return WINDOW_PROPS.indexOf(v) >= 0; });
assert.deepStrictEqual(clash, [], "ui.html declares a global clashing with window: " + clash);
assert.ok(declared.length > 3, "the ui.html variable scan found nothing — broken regex?");
console.log("ok");

// --- stacking order: back to front ---
var leaves = api.leaves;
var box = { x: 0, y: 0, width: 1, height: 1 };
var leaf = function (n) { return { name: n, type: "RECTANGLE", absoluteBoundingBox: box }; };
var grp = function (n, kids) { return { name: n, type: "GROUP", children: kids }; };

// children[0] is the bottom-most layer in Figma, so the walk yields back to front
assert.deepStrictEqual(
  leaves(grp("g", [leaf("bottom"), leaf("middle"), leaf("top")]), []).map(function (n) { return n.name; }),
  ["bottom", "middle", "top"]);

// nested groups keep the same order, flattened
assert.deepStrictEqual(
  leaves(grp("root", [leaf("a"), grp("g", [leaf("b"), leaf("c")]), leaf("d")]), [])
    .map(function (n) { return n.name; }),
  ["a", "b", "c", "d"]);

// hidden nodes and whole hidden groups drop out, order of the rest intact
assert.deepStrictEqual(
  leaves(grp("root", [leaf("a"),
                      Object.assign(leaf("hidden"), { visible: false }),
                      Object.assign(grp("gone", [leaf("x")]), { visible: false }),
                      leaf("b")]), []).map(function (n) { return n.name; }),
  ["a", "b"]);

// a boolean op is a leaf: its children do not become separate objects
assert.deepStrictEqual(
  leaves(Object.assign(grp("bool", [leaf("x"), leaf("y")]),
                       { type: "BOOLEAN_OPERATION", absoluteBoundingBox: box }), [])
    .map(function (n) { return n.name; }),
  ["bool"]);
console.log("ok");
