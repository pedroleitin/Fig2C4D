// Fig2C4D — exports the selection as SVG with M/L/C/Z only (no arcs, no rects,
// no transforms), which is where Cinema 4D's importer chokes on border radius.
//
// Every <path> also carries, in data-*, a descriptor of the matching primitive
// (rect / circle / star / ngon). C4D uses the descriptor when it can build the
// parametric object and falls back to the exact path when it can't, so no shape
// ever arrives deformed.

var f3 = function (n) { return +n.toFixed(3); };

function toAbsCubic(d, t) {
  var a = t[0][0], c = t[0][1], e = t[0][2];
  var b = t[1][0], dd = t[1][1], f = t[1][2];
  var P = function (x, y) { return f3(a * x + c * y + e) + " " + f3(b * x + dd * y + f); };
  var out = [], cur = [0, 0], start = [0, 0], m, i;
  var re = /([MLCQZ])([^MLCQZ]*)/gi;
  while ((m = re.exec(d))) {
    var cmd = m[1].toUpperCase();
    var v = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    if (cmd === "M") {
      cur = [v[0], v[1]]; start = cur; out.push("M" + P(cur[0], cur[1]));
      for (i = 2; i < v.length; i += 2) { cur = [v[i], v[i + 1]]; out.push("L" + P(cur[0], cur[1])); }
    } else if (cmd === "L") {
      for (i = 0; i < v.length; i += 2) { cur = [v[i], v[i + 1]]; out.push("L" + P(cur[0], cur[1])); }
    } else if (cmd === "C") {
      for (i = 0; i + 5 < v.length; i += 6) {
        out.push("C" + P(v[i], v[i + 1]) + " " + P(v[i + 2], v[i + 3]) + " " + P(v[i + 4], v[i + 5]));
        cur = [v[i + 4], v[i + 5]];
      }
    } else if (cmd === "Q") {
      for (i = 0; i + 3 < v.length; i += 4) {
        var qx = v[i], qy = v[i + 1], ex = v[i + 2], ey = v[i + 3];
        out.push("C" +
          P(cur[0] + 2 / 3 * (qx - cur[0]), cur[1] + 2 / 3 * (qy - cur[1])) + " " +
          P(ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey)) + " " + P(ex, ey));
        cur = [ex, ey];
      }
    } else if (cmd === "Z") { out.push("Z"); cur = start; }
  }
  return out.join(" ");
}

// --------------------------------------------------------------------------
// parametric descriptors

// Node centre and rotation. Returns null if the matrix carries scale or skew —
// no C4D primitive can represent the shape in that case.
function basis(node) {
  var t = node.absoluteTransform;
  var a = t[0][0], c = t[0][1], b = t[1][0], d = t[1][1];
  if (Math.abs(a * a + b * b - 1) > 1e-4 || Math.abs(a * d - b * c - 1) > 1e-4) return null;
  var w = node.width, h = node.height;
  return {
    w: w, h: h,
    cx: a * (w / 2) + c * (h / 2) + t[0][2],
    cy: b * (w / 2) + d * (h / 2) + t[1][2],
    rot: Math.atan2(b, a) * 180 / Math.PI
  };
}

// Bounding box of a radius-1 polygon/star with one point up, which is how Figma
// draws them. Tells us how much the node was stretched away from regular.
function ngonBox(n, inner) {
  var k = inner ? 2 * n : n, xs = [], ys = [];
  for (var i = 0; i < k; i++) {
    var ang = Math.PI / 2 + i * 2 * Math.PI / k;
    var rr = (inner && i % 2) ? inner : 1;
    xs.push(rr * Math.cos(ang));
    ys.push(rr * Math.sin(ang));
  }
  return { w: Math.max.apply(null, xs) - Math.min.apply(null, xs),
           h: Math.max.apply(null, ys) - Math.min.apply(null, ys) };
}

// Uniform corner radius; 0 when there is none, -1 when no primitive will do.
function radius(node) {
  var r = node.cornerRadius;
  if (typeof r !== "number") return -1;   // figma.mixed = corners differ
  if (r <= 0) return 0;
  return node.cornerSmoothing ? -1 : r;   // a squircle is not a circular arc
}

// Figma stretches polygons/stars to fill the bbox, but C4D's n-Side and Star have
// a single radius — the stretched shape doesn't exist there. Geometric mean of
// the two readings: splits the error between width and height instead of nailing
// one and missing the other, and the object arrives with scale 1 on all axes.
function fit(g, n, inner) {
  var b = ngonBox(n, inner);
  return Math.sqrt((g.w / b.w) * (g.h / b.h));
}

var PARAM = {
  RECTANGLE: function (node, g) {
    var r = radius(node);
    if (r < 0) return null;
    return { c4d: "rect", w: g.w, h: g.h, r: Math.min(r, Math.min(g.w, g.h) / 2) };
  },
  ELLIPSE: function (node, g) {
    if (Math.abs(g.w - g.h) > 1e-4) return null;          // ellipse: no primitive
    var a = node.arcData;
    if (a && (a.innerRadius > 0 ||
        Math.abs(a.endingAngle - a.startingAngle - 2 * Math.PI) > 1e-6)) return null;
    return { c4d: "circle", r: g.w / 2 };
  },
  STAR: function (node, g) {
    var r = fit(g, node.pointCount, node.innerRadius);
    return { c4d: "star", r: r, ir: r * node.innerRadius, n: node.pointCount };
  },
  POLYGON: function (node, g) {
    var rr = radius(node);
    if (rr < 0) return null;
    return { c4d: "ngon", r: fit(g, node.pointCount, 0), n: node.pointCount, round: rr };
  }
};

function paramOf(node) {
  var f = PARAM[node.type];
  if (!f) return null;
  var g = basis(node);
  if (!g) return null;
  var p = g && f(node, g);
  if (!p) return null;
  p.cx = g.cx; p.cy = g.cy; p.rot = g.rot;
  return p;
}

// --------------------------------------------------------------------------
// name and colours

function hex(c) {
  var f = function (v) {
    return ("0" + Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16)).slice(-2);
  };
  return "#" + f(c.r) + f(c.g) + f(c.b);
}

// First visible paint. A gradient comes in through its first stop — an approximate
// colour beats an object with no colour at all in C4D.
function paint(list) {
  if (!Array.isArray(list)) return null;   // figma.mixed
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (p.visible === false || p.opacity === 0) continue;
    var c = p.type === "SOLID" ? p.color
      : (p.gradientStops && p.gradientStops.length ? p.gradientStops[0].color : null);
    if (c) return hex(c);
  }
  return null;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
  });
}

function styleOf(node) {
  return {
    name: node.name || "",
    fill: paint(node.fills),
    stroke: paint(node.strokes),
    sw: typeof node.strokeWeight === "number" ? node.strokeWeight : 1
  };
}

function attrs(p, st) {
  var s = "";
  if (p) {
    s = ' data-c4d="' + p.c4d + '"';
    ["cx", "cy", "rot", "w", "h", "r", "ir", "n", "round"].forEach(function (k) {
      if (p[k] !== undefined && p[k] !== 0) s += ' data-' + k + '="' + f3(p[k]) + '"';
    });
  }
  if (st) {
    if (st.name) s += ' data-name="' + esc(st.name) + '"';
    if (st.fill) s += ' data-fill="' + st.fill + '"';
    if (st.stroke) s += ' data-stroke="' + st.stroke + '"';
  }
  return s;
}

// Paint on the SVG itself, so the downloaded file looks like the Figma original.
function paintAttrs(st) {
  if (!st || (!st.fill && !st.stroke)) return ' fill="none" stroke="#000000" stroke-width="1"';
  return ' fill="' + (st.fill || "none") + '"' +
    (st.stroke ? ' stroke="' + st.stroke + '" stroke-width="' + f3(st.sw) + '"' : ' stroke="none"');
}

// Leaf nodes in Figma stacking order: children[0] is the bottom-most layer, so
// walking children in order yields back-to-front — which is the order C4D uses to
// space the objects along Z.
var SOLID = { BOOLEAN_OPERATION: 1, VECTOR: 1 };

function leaves(node, acc) {
  if (node.visible === false) return acc;
  if ("children" in node && !SOLID[node.type] && node.children.length) {
    for (var i = 0; i < node.children.length; i++) leaves(node.children[i], acc);
  } else if (node.absoluteBoundingBox) acc.push(node);
  return acc;
}

if (typeof module !== "undefined")
  module.exports = { toAbsCubic: toAbsCubic, paramOf: paramOf, attrs: attrs,
                     ngonBox: ngonBox, styleOf: styleOf, paint: paint,
                     paintAttrs: paintAttrs, leaves: leaves };

// --------------------------------------------------------------------------

if (typeof figma !== "undefined") (function () {
  function selected() {
    var sel = figma.currentPage.selection, acc = [];
    for (var i = 0; i < sel.length; i++) leaves(sel[i], acc);
    return acc;
  }

  // Non-vector nodes (rect, ellipse, text, boolean) become vectors via flatten on
  // a throwaway clone — Figma resolves the corners into Bézier for us.
  function pathsOf(node) {
    if (node.type === "VECTOR") return { paths: node.vectorPaths, m: node.absoluteTransform };
    var parent = node.parent, clone = node.clone();
    parent.appendChild(clone);
    var v = figma.flatten([clone], parent);
    var r = { paths: v.vectorPaths.map(function (p) { return { data: p.data }; }), m: v.absoluteTransform };
    v.remove();
    return r;
  }

  function build(nodes, param, group, extrude, stack) {
    var els = [], box = null;
    for (var j = 0; j < nodes.length; j++) {
      var n = nodes[j];
      try {
        var q = param ? paramOf(n) : null;
        var st = styleOf(n);
        var r = pathsOf(n);
        for (var k = 0; k < r.paths.length; k++) {
          var d = toAbsCubic(r.paths[k].data, r.m);
          if (d) els.push('<path d="' + d + '"' + (k ? ' data-name="' + esc(st.name) + '"' : attrs(q, st)) +
            paintAttrs(st) + "/>");
        }
      } catch (err) { continue; }
      var bb = n.absoluteBoundingBox;
      box = box
        ? { x: Math.min(box.x, bb.x), y: Math.min(box.y, bb.y),
            r: Math.max(box.r, bb.x + bb.width), b: Math.max(box.b, bb.y + bb.height) }
        : { x: bb.x, y: bb.y, r: bb.x + bb.width, b: bb.y + bb.height };
    }
    if (!els.length) return null;
    var w = f3(box.r - box.x), h = f3(box.b - box.y);
    return {
      count: els.length,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
        '" viewBox="' + f3(box.x) + " " + f3(box.y) + " " + w + " " + h + '"' +
        (group ? ' data-name="' + esc(group) + '"' : "") +
        (extrude ? ' data-extrude="1"' : "") +
        (stack ? ' data-stack="1"' : "") + ">\n" +
        els.join("\n") + "\n</svg>\n"
    };
  }

  function sync() {
    var sel = figma.currentPage.selection;
    figma.ui.postMessage({ type: "sel", n: selected().length, name: sel.length === 1 ? sel[0].name : "" });
  }

  figma.showUI(__html__, { width: 300, height: 243, themeColors: true });
  figma.on("selectionchange", sync);
  sync();
  Promise.all(["param", "extrude", "stack"].map(function (k) { return figma.clientStorage.getAsync(k); }))
    .then(function (v) {
      figma.ui.postMessage({ type: "opt", param: v[0] !== false,
                             extrude: v[1] === true, stack: v[2] !== false });
    });

  figma.ui.onmessage = function (msg) {
    if (msg.type !== "send") return;
    figma.clientStorage.setAsync("param", msg.param !== false);
    figma.clientStorage.setAsync("extrude", !!msg.extrude);
    figma.clientStorage.setAsync("stack", msg.stack !== false);
    // the name is only an override: left alone, C4D names the group by count
    var typed = (msg.name || "").trim();
    var out = build(selected(), msg.param !== false, msg.auto ? "" : typed,
                    !!msg.extrude, msg.stack !== false);
    if (!out) { figma.notify("Nothing exportable in the selection."); return sync(); }
    figma.ui.postMessage({
      type: "file",
      svg: out.svg,
      count: out.count,
      name: (typed || "figma").replace(/[^\w.-]+/g, "_") + "_c4d.svg"
    });
  };
})();
