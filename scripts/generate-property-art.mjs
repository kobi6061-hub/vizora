/**
 * VIZORA property art generator.
 *
 * Produces the product's entire demo imagery as deterministic SVG
 * architectural renders — one collection, one cinematic grade
 * (see DESIGN-NOTES.md → Imagery system). Rerunning is stable.
 *
 * Usage: npm run art
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "public", "art");
const MANIFEST_PATH = join(root, "src", "lib", "data", "art-manifest.ts");

const W = 1600;
const H = 1000;

/* ------------------------------- utilities ------------------------------- */

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (r, a, b) => a + r() * (b - a);
const int = (r, a, b) => Math.floor(range(r, a, b + 1));
const chance = (r, p) => r() < p;
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

let uid = 0;
const gid = (name) => `${name}${(uid++).toString(36)}`;

function linGrad(id, stops, { x1 = 0, y1 = 0, x2 = 0, y2 = 1 } = {}) {
  const s = stops
    .map(([offset, color, opacity]) =>
      `<stop offset="${offset}" stop-color="${color}"${opacity !== undefined ? ` stop-opacity="${opacity}"` : ""}/>`)
    .join("");
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${s}</linearGradient>`;
}

function radGrad(id, stops, { cx = 0.5, cy = 0.5, r = 0.5 } = {}) {
  const s = stops
    .map(([offset, color, opacity]) =>
      `<stop offset="${offset}" stop-color="${color}"${opacity !== undefined ? ` stop-opacity="${opacity}"` : ""}/>`)
    .join("");
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${s}</radialGradient>`;
}

const rect = (x, y, w, h, fill, extra = "") =>
  `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" ${extra}/>`;

const poly = (points, fill, extra = "") =>
  `<polygon points="${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="${fill}" ${extra}/>`;

const ellipse = (cx, cy, rx, ry, fill, extra = "") =>
  `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${fill}" ${extra}/>`;

/** Film grain + vignette finish applied to every render. */
function finish(defs, { vignette = 0.52, grain = 0.05, tint } = {}) {
  const vid = gid("vg");
  const fid = gid("gr");
  defs.push(
    radGrad(vid, [
      [0, "#000000", 0],
      [0.62, "#000000", 0],
      [1, "#05060c", vignette],
    ], { cx: 0.5, cy: 0.46, r: 0.75 }),
  );
  defs.push(
    `<filter id="${fid}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.6 0"/></filter>`,
  );
  let out = "";
  if (tint) out += rect(0, 0, W, H, tint[0], `opacity="${tint[1]}"`);
  out += rect(0, 0, W, H, `url(#${vid})`);
  out += `<rect x="0" y="0" width="${W}" height="${H}" filter="url(#${fid})" opacity="${grain}"/>`;
  return out;
}

function svgDoc(defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs.join("")}</defs>${body}</svg>`;
}

/* --------------------------------- grades --------------------------------- */

const GRADES = {
  dusk: {
    sky: [["0", "#10142c"], ["0.45", "#2c2a4e"], ["0.78", "#6e5364"], ["1", "#9a6f66"]],
    sun: ["#f0b98a", 0.5],
    haze: "#383a5c",
    far: "#252a48",
    mid: "#1b1f38",
    near: "#12142a",
    lit: "#f3c489",
    dark: "#181c34",
    water: [["0", "#25294a"], ["1", "#0d0f22"]],
  },
  night: {
    sky: [["0", "#05070f"], ["0.6", "#0b1024"], ["1", "#1b2140"]],
    sun: ["#8a90c8", 0.22],
    haze: "#171c36",
    far: "#12162c",
    mid: "#0d1023",
    near: "#07091a",
    lit: "#eec07f",
    dark: "#0d1126",
    water: [["0", "#0d1128"], ["1", "#04050e"]],
  },
  golden: {
    sky: [["0", "#332742"], ["0.5", "#75484d"], ["0.82", "#c98a5e"], ["1", "#e8b476"]],
    sun: ["#f7cf96", 0.65],
    haze: "#5c4053",
    far: "#42324c",
    mid: "#2c2338",
    near: "#1b1626",
    lit: "#f7d49b",
    dark: "#241d33",
    water: [["0", "#5c4050"], ["1", "#160f1e"]],
  },
  marine: {
    sky: [["0", "#8fa7bd"], ["0.55", "#c2ccd2"], ["1", "#e2ded4"]],
    sun: ["#f4ead6", 0.5],
    haze: "#aab6bf",
    far: "#8795a3",
    mid: "#65758a",
    near: "#3e4d63",
    lit: "#f4ead6",
    dark: "#51617a",
    water: [["0", "#6e8496"], ["1", "#2c3d51"]],
  },
};

/* --------------------------- shared scene pieces --------------------------- */

function sky(defs, grade, { sunX = 0.62, sunY = 0.72, sunR = 0.34 } = {}) {
  const sid = gid("sky");
  const gid2 = gid("sun");
  defs.push(linGrad(sid, grade.sky));
  defs.push(
    radGrad(gid2, [
      [0, grade.sun[0], grade.sun[1]],
      [1, grade.sun[0], 0],
    ]),
  );
  return (
    rect(0, 0, W, H, `url(#${sid})`) +
    `<circle cx="${W * sunX}" cy="${H * sunY}" r="${W * sunR}" fill="url(#${gid2})"/>`
  );
}

function hazeBand(defs, grade, y, h, opacity = 0.5) {
  const id = gid("hz");
  defs.push(
    linGrad(id, [
      [0, grade.haze, 0],
      [0.55, grade.haze, opacity],
      [1, grade.haze, 0],
    ]),
  );
  return rect(0, y, W, h, `url(#${id})`);
}

/** Distant skyline silhouette. */
function skyline(r, grade, { baseY, minH, maxH, color, opacity = 1 }) {
  let out = "";
  let x = -40;
  while (x < W + 40) {
    const bw = range(r, 46, 150);
    const bh = range(r, minH, maxH);
    out += rect(x, baseY - bh, bw, bh + 4, color, `opacity="${opacity}"`);
    if (chance(r, 0.24)) {
      // rooftop mast
      out += rect(x + bw * 0.5, baseY - bh - range(r, 12, 34), 2.4, 40, color, `opacity="${opacity}"`);
    }
    x += bw + range(r, 8, 60);
  }
  return out;
}

/** Window grid on a facade. Returns lit-window positions for reflections. */
function windows(r, grade, { x, y, w, h, cols, rows, litProb, inset = 0.26, opMin = 0.5, opMax = 1 }) {
  let out = "";
  const lit = [];
  const cw = w / cols;
  const ch = h / rows;
  const ww = cw * (1 - inset);
  const wh = ch * (1 - inset * 1.15);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const wx = x + i * cw + (cw - ww) / 2;
      const wy = y + j * ch + (ch - wh) / 2;
      if (chance(r, litProb)) {
        const op = range(r, opMin, opMax);
        out += rect(wx, wy, ww, wh, grade.lit, `opacity="${op.toFixed(2)}"`);
        lit.push([wx + ww / 2, op]);
      } else {
        out += rect(wx, wy, ww, wh, grade.dark, `opacity="${range(r, 0.5, 0.9).toFixed(2)}"`);
      }
    }
  }
  return { out, lit };
}

function waterReflection(defs, grade, lit, waterY, depth) {
  const id = gid("wf");
  defs.push(linGrad(id, grade.water));
  let out = rect(0, waterY, W, H - waterY, `url(#${id})`);
  // bright water horizon line grounds the shoreline
  out += rect(0, waterY, W, 2.2, "#f4ead6", `opacity="0.22"`);
  for (const [x, op] of lit) {
    const len = depth * (0.14 + op * 0.2);
    const rid = gid("rf");
    defs.push(
      linGrad(rid, [
        [0, grade.lit, op * 0.28],
        [1, grade.lit, 0],
      ]),
    );
    out += rect(x - 3.6, waterY + 2, 7.2, len, `url(#${rid})`);
  }
  // ripples — denser near the shoreline
  const rr = mulberry32(hashSeed("ripple"));
  for (let i = 0; i < 34; i++) {
    const t = rr() ** 1.8;
    const ry = waterY + 4 + t * (H - waterY - 14);
    const rw = range(rr, 40, 240) * (0.5 + t);
    out += rect(range(rr, 0, W - rw), ry, rw, 1.5, "#000000", `opacity="${range(rr, 0.06, 0.18).toFixed(2)}"`);
  }
  return out;
}

/* ------------------------------ scene: tower ------------------------------ */

function sceneTower(seedName, gradeName, { water = true } = {}) {
  uid = 0;
  const r = mulberry32(hashSeed(seedName));
  const grade = GRADES[gradeName];
  const defs = [];
  let body = sky(defs, grade, { sunX: range(r, 0.3, 0.72), sunY: range(r, 0.6, 0.72) });

  const horizon = H * (water ? 0.72 : 0.86);
  body += skyline(r, grade, { baseY: horizon, minH: 70, maxH: 240, color: grade.far, opacity: 0.85 });
  body += hazeBand(defs, grade, horizon - 170, 190, 0.55);

  // mid-ground towers
  const towers = [];
  const count = int(r, 3, 4);
  for (let i = 0; i < count; i++) {
    towers.push({
      x: (W / count) * i + range(r, -60, 90),
      w: range(r, 130, 210),
      h: range(r, 300, 480),
    });
  }
  for (const t of towers) {
    body += rect(t.x, horizon - t.h, t.w, t.h, grade.mid);
    const { out } = windows(r, grade, {
      x: t.x + 8, y: horizon - t.h + 14, w: t.w - 16, h: t.h - 22,
      cols: int(r, 4, 6), rows: int(r, 10, 15), litProb: 0.32, opMin: 0.3, opMax: 0.75,
    });
    body += out;
  }
  body += hazeBand(defs, grade, horizon - 120, 140, 0.32);

  // hero tower
  const hw = range(r, 300, 360);
  const hx = range(r, W * 0.52, W * 0.62);
  const hh = range(r, 640, 760);
  const hy = horizon - hh;
  body += rect(hx, hy, hw, hh, grade.near);
  // vertical fins
  body += rect(hx, hy, 10, hh, "#000000", `opacity="0.35"`);
  body += rect(hx + hw - 10, hy, 10, hh, "#ffffff", `opacity="0.05"`);
  const hero = windows(r, grade, {
    x: hx + 16, y: hy + 26, w: hw - 32, h: hh - 40,
    cols: 6, rows: 16, litProb: 0.46, opMin: 0.55, opMax: 1,
  });
  body += hero.out;
  // rooftop crown light
  body += rect(hx + hw * 0.32, hy - 8, hw * 0.36, 8, grade.lit, `opacity="0.7"`);

  // second foreground tower (partial, frame-left)
  const fw = range(r, 200, 260);
  const fh = range(r, 460, 560);
  body += rect(-40, horizon - fh, fw, fh, grade.near);
  const second = windows(r, grade, {
    x: -20, y: horizon - fh + 22, w: fw - 40, h: fh - 36,
    cols: 4, rows: 12, litProb: 0.4, opMin: 0.5, opMax: 0.95,
  });
  body += second.out;

  if (water) {
    const lits = [...hero.lit, ...second.lit].filter(() => chance(r, 0.6));
    body += waterReflection(defs, grade, lits, horizon, H - horizon);
  } else {
    const gid2 = gid("gnd");
    defs.push(linGrad(gid2, [[0, grade.near], [1, "#07080f"]]));
    body += rect(0, horizon, W, H - horizon, `url(#${gid2})`);
  }

  body += finish(defs, { vignette: 0.55 });
  return svgDoc(defs, body);
}

/* ------------------------------ scene: villa ------------------------------ */

function sceneVilla(seedName, gradeName) {
  uid = 0;
  const r = mulberry32(hashSeed(seedName));
  const grade = GRADES[gradeName];
  const defs = [];
  let body = sky(defs, grade, { sunX: range(r, 0.6, 0.78), sunY: 0.52, sunR: 0.4 });

  const horizon = H * 0.58;
  // distant hills
  body += poly(
    [[0, horizon], [0, horizon - 90], [W * 0.3, horizon - 150], [W * 0.62, horizon - 70], [W, horizon - 120], [W, horizon]],
    grade.far, `opacity="0.7"`,
  );
  body += hazeBand(defs, grade, horizon - 90, 110, 0.5);

  // villa platform
  const py = H * 0.62;
  body += rect(0, py, W, H - py, grade.near);

  // main volume (two stacked boxes)
  const vx = W * 0.16;
  const vw = W * 0.52;
  const upperH = 170;
  const lowerH = 220;
  const wallId = gid("wall");
  defs.push(linGrad(wallId, [[0, "#3a3350"], [1, "#241f36"]], { x2: 1, y2: 0.2 }));
  // upper floor
  body += rect(vx + 70, py - upperH - lowerH, vw * 0.62, upperH, `url(#${wallId})`);
  // roof slab overhangs
  body += rect(vx + 50, py - upperH - lowerH - 14, vw * 0.62 + 60, 14, "#191428");
  // lower floor
  body += rect(vx, py - lowerH, vw, lowerH, `url(#${wallId})`);
  body += rect(vx - 20, py - lowerH - 12, vw + 60, 12, "#191428");

  // glass walls (lit interior)
  const glassId = gid("glass");
  defs.push(linGrad(glassId, [[0, grade.lit, 0.95], [1, "#b57f4e", 0.85]]));
  const panes = int(r, 4, 5);
  const gx = vx + 30;
  const gw = vw * 0.7;
  for (let i = 0; i < panes; i++) {
    body += rect(gx + (gw / panes) * i, py - lowerH + 26, (gw / panes) - 8, lowerH - 40, `url(#${glassId})`, `opacity="${range(r, 0.75, 1).toFixed(2)}"`);
  }
  const upanes = 3;
  for (let i = 0; i < upanes; i++) {
    body += rect(vx + 100 + i * 90, py - upperH - lowerH + 30, 70, upperH - 55, `url(#${glassId})`, `opacity="${range(r, 0.5, 0.85).toFixed(2)}"`);
  }
  // interior figures of furniture (soft masses seen through glass)
  body += rect(gx + 30, py - 82, 90, 36, "#5c3f2e", `opacity="0.65"`);
  body += rect(gx + gw * 0.55, py - 96, 8, 52, "#33241c", `opacity="0.7"`);

  // infinity pool
  const poolY = py + 60;
  const pid = gid("pool");
  defs.push(linGrad(pid, [[0, "#3d4e6b"], [0.6, "#22304a"], [1, "#141d30"]]));
  body += rect(W * 0.1, poolY, W * 0.74, H - poolY - 40, `url(#${pid})`);
  // pool glow reflection of glass
  const prId = gid("pr");
  defs.push(linGrad(prId, [[0, grade.lit, 0.4], [1, grade.lit, 0]]));
  body += rect(gx + 10, poolY, gw * 0.8, 130, `url(#${prId})`);
  for (let i = 0; i < 14; i++) {
    body += rect(range(r, W * 0.12, W * 0.8), poolY + range(r, 10, 200), range(r, 40, 160), 1.4, "#000000", `opacity="${range(r, 0.06, 0.16).toFixed(2)}"`);
  }
  body += rect(W * 0.1, poolY, W * 0.74, 3, "#e8e2d2", `opacity="0.18"`);

  // cypress / palm silhouettes
  const treeColor = "#0b0d18";
  for (let i = 0; i < 3; i++) {
    const tx = pick(r, [W * 0.06, W * 0.9, W * 0.96, W * 0.86]);
    const th = range(r, 150, 260);
    body += ellipse(tx, py - th + 60, range(r, 16, 26), th * 0.55, treeColor, `opacity="0.9"`);
    body += rect(tx - 3, py - 40, 6, 60, treeColor, `opacity="0.9"`);
  }

  body += finish(defs, { vignette: 0.5 });
  return svgDoc(defs, body);
}

/* ---------------------------- scene: interiors ---------------------------- */

function sceneInterior(seedName, kind) {
  uid = 0;
  const r = mulberry32(hashSeed(seedName));
  const defs = [];
  // Warm interior palette, view grade dusk/marine
  const wallTop = "#332e3e";
  const wallBottom = "#211d2b";
  const floorA = "#4a3a30";
  const floorB = "#241a15";
  const glow = "#f2c489";

  const wallId = gid("wl");
  defs.push(linGrad(wallId, [[0, wallTop], [1, wallBottom]]));
  let body = rect(0, 0, W, H, `url(#${wallId})`);
  // subtle wall panel seams
  for (const px of [0.12, 0.3, 0.48]) {
    body += rect(W * px, H * 0.06, 1.6, H * 0.58, "#000", `opacity="0.16"`);
  }

  // floor with perspective — lighter wood so furniture reads against it
  const floorY = H * 0.66;
  const fid = gid("fl");
  defs.push(linGrad(fid, [[0, "#6b543f"], [0.55, floorA], [1, floorB]]));
  body += rect(0, floorY, W, H - floorY, `url(#${fid})`);
  body += rect(0, floorY, W, 2.4, "#000", `opacity="0.4"`);
  // floorboards
  for (let i = 0; i < 9; i++) {
    const t = i / 9;
    body += rect(0, floorY + t * t * (H - floorY), W, 1.8, "#000000", `opacity="${(0.18 + t * 0.12).toFixed(2)}"`);
  }
  // board seams fanning toward the viewer
  for (const px of [0.1, 0.28, 0.46, 0.64, 0.82]) {
    const drift = (px - 0.45) * 300;
    body += poly(
      [[W * px, floorY], [W * px + 2.4, floorY], [W * px + drift + 3, H], [W * px + drift, H]],
      "#000",
      `opacity="0.18"`,
    );
  }

  // window wall with view
  const winX = W * 0.52;
  const winW = W * 0.4;
  const winY = H * 0.1;
  const winH = floorY - winY - 6;
  const view = GRADES[kind === "bedroom" ? "marine" : "dusk"];
  const vid = gid("vw");
  defs.push(linGrad(vid, view.sky));
  body += rect(winX, winY, winW, winH, `url(#${vid})`);
  // sun in view (behind skyline)
  const sunId = gid("vsun");
  defs.push(radGrad(sunId, [[0, view.sun[0], 0.7], [1, view.sun[0], 0]]));
  body += `<circle cx="${winX + winW * 0.6}" cy="${winY + winH * 0.58}" r="${winW * 0.34}" fill="url(#${sunId})"/>`;
  const vr = mulberry32(hashSeed(seedName + "view"));
  body += skyline(vr, view, { baseY: winY + winH * 0.62, minH: 26, maxH: 90, color: view.far, opacity: 0.85 });
  // sea band in view
  const seaId = gid("sea");
  defs.push(linGrad(seaId, view.water));
  body += rect(winX, winY + winH * 0.62, winW, winH * 0.38, `url(#${seaId})`);
  body += rect(winX, winY + winH * 0.62, winW, 2.2, "#f4ead6", `opacity="0.4"`);
  // sun path on the water
  const vpath = gid("vp");
  defs.push(linGrad(vpath, [[0, view.lit, 0.4], [1, view.lit, 0]]));
  body += poly(
    [[winX + winW * 0.55, winY + winH * 0.62], [winX + winW * 0.66, winY + winH * 0.62], [winX + winW * 0.72, winY + winH], [winX + winW * 0.47, winY + winH]],
    `url(#${vpath})`,
  );
  // glass tint + reflection streak
  body += rect(winX, winY, winW, winH, "#1c2438", `opacity="0.12"`);
  body += poly([[winX + winW * 0.08, winY], [winX + winW * 0.2, winY], [winX + winW * 0.02, winY + winH], [winX - winW * 0.1 + winW * 0.08, winY + winH]], "#ffffff", `opacity="0.05"`);
  // mullions
  body += rect(winX, winY, winW, winH, "none", `stroke="#14101c" stroke-width="12"`);
  body += rect(winX + winW / 2 - 4, winY, 8, winH, "#14101c");
  body += rect(winX + winW / 4 - 2.5, winY, 5, winH, "#14101c", `opacity="0.9"`);
  body += rect(winX + winW * 0.75 - 2.5, winY, 5, winH, "#14101c", `opacity="0.9"`);
  // floor glow spill from the view
  const spillId = gid("spl");
  defs.push(linGrad(spillId, [[0, view.sun[0], 0.16], [1, view.sun[0], 0]]));
  body += poly([[winX - 30, floorY], [winX + winW, floorY], [winX + winW + 80, H], [winX - 180, H]], `url(#${spillId})`);

  // light shaft from window
  const shaftId = gid("sh");
  defs.push(linGrad(shaftId, [[0, glow, 0.2], [1, glow, 0]], { x1: 1, y1: 0, x2: 0, y2: 0.4 }));
  body += poly([[winX, winY + 40], [winX, floorY + 90], [winX - W * 0.34, H], [winX - W * 0.14, H]], `url(#${shaftId})`);

  if (kind === "living") {
    // rug first, under everything
    body += ellipse(W * 0.28, H * 0.83, W * 0.24, 52, "#332a3e", `opacity="0.6"`);
    body += ellipse(W * 0.28, H * 0.83, W * 0.24, 52, "none", `stroke="#4a3f58" stroke-opacity="0.4" stroke-width="2"`);
    // sofa — contact shadow, base, seat, back, arms
    body += ellipse(W * 0.245, H * 0.675, W * 0.19, 22, "#000", `opacity="0.45"`);
    const sofaId = gid("sf");
    defs.push(linGrad(sofaId, [[0, "#6e6152"], [1, "#3d342c"]]));
    body += `<rect x="${W * 0.09}" y="${H * 0.535}" width="${W * 0.32}" height="${H * 0.115}" rx="16" fill="url(#${sofaId})"/>`;
    body += `<rect x="${W * 0.095}" y="${H * 0.465}" width="${W * 0.31}" height="${H * 0.075}" rx="12" fill="#54483d"/>`;
    body += rect(W * 0.25, H * 0.468, 3, H * 0.07, "#000", `opacity="0.25"`); // back cushion split
    body += `<rect x="${W * 0.075}" y="${H * 0.5}" width="${W * 0.032}" height="${H * 0.14}" rx="10" fill="#4a4036"/>`;
    body += `<rect x="${W * 0.395}" y="${H * 0.5}" width="${W * 0.032}" height="${H * 0.14}" rx="10" fill="#4a4036"/>`;
    body += rect(W * 0.1, H * 0.545, W * 0.3, 3.5, "#000000", `opacity="0.3"`); // seat shadow line
    // throw cushions
    body += `<rect x="${W * 0.12}" y="${H * 0.49}" width="${W * 0.05}" height="${H * 0.05}" rx="8" fill="#8a7358"/>`;
    body += `<rect x="${W * 0.34}" y="${H * 0.49}" width="${W * 0.05}" height="${H * 0.05}" rx="8" fill="#2e2a3c"/>`;
    // coffee table with contact shadow
    body += ellipse(W * 0.31, H * 0.77, 96, 18, "#000", `opacity="0.45"`);
    body += rect(W * 0.31 - 4, H * 0.71, 8, H * 0.055, "#14100c");
    body += ellipse(W * 0.31, H * 0.71, 92, 17, "#4a3a2c");
    body += ellipse(W * 0.31, H * 0.705, 92, 16, "#5c4936");
    body += ellipse(W * 0.28, H * 0.7, 16, 5, "#1c1712"); // small object
    // floor lamp with glow
    body += ellipse(W * 0.468, H * 0.665, 34, 8, "#000", `opacity="0.45"`);
    body += rect(W * 0.465, H * 0.36, 4, H * 0.3, "#0f0c16");
    const lampId = gid("lp");
    defs.push(radGrad(lampId, [[0, glow, 0.8], [1, glow, 0]]));
    body += `<circle cx="${W * 0.467}" cy="${H * 0.345}" r="80" fill="url(#${lampId})"/>`;
    body += poly([[W * 0.467 - 26, H * 0.365], [W * 0.467 + 26, H * 0.365], [W * 0.467 + 18, H * 0.325], [W * 0.467 - 18, H * 0.325]], "#f6d3a0", `opacity="0.95"`);
    // plant
    body += ellipse(W * 0.052, H * 0.66, 40, 9, "#000", `opacity="0.45"`);
    body += poly([[W * 0.035, H * 0.585], [W * 0.069, H * 0.585], [W * 0.063, H * 0.655], [W * 0.041, H * 0.655]], "#241b13");
    body += ellipse(W * 0.052, H * 0.52, 44, 66, "#13200f", `opacity="0.95"`);
    body += ellipse(W * 0.038, H * 0.545, 26, 44, "#0d1a0c", `opacity="0.9"`);
    // pendant lights
    for (const px of [0.14, 0.22]) {
      body += rect(W * px, 0, 2, H * 0.16, "#0f0c16");
      const pgl = gid("pg");
      defs.push(radGrad(pgl, [[0, glow, 0.5], [1, glow, 0]]));
      body += `<circle cx="${W * px + 1}" cy="${H * 0.168}" r="52" fill="url(#${pgl})"/>`;
      body += poly([[W * px - 13, H * 0.175], [W * px + 15, H * 0.175], [W * px + 9, H * 0.15], [W * px - 7, H * 0.15]], "#f6d3a0", `opacity="0.92"`);
    }
  }

  if (kind === "bedroom") {
    // rug
    body += ellipse(W * 0.28, H * 0.85, W * 0.26, 48, "#3a3444", `opacity="0.5"`);
    // bed contact shadow
    body += ellipse(W * 0.275, H * 0.79, W * 0.21, 26, "#000000", `opacity="0.45"`);
    // bed base + duvet
    body += rect(W * 0.105, H * 0.68, W * 0.34, H * 0.075, "#2c2536");
    const bedId = gid("bd");
    defs.push(linGrad(bedId, [[0, "#e2d8c8"], [1, "#9a8f82"]]));
    body += `<rect x="${W * 0.1}" y="${H * 0.565}" width="${W * 0.35}" height="${H * 0.15}" rx="14" fill="url(#${bedId})"/>`;
    body += `<path d="M ${W * 0.1} ${H * 0.63} Q ${W * 0.28} ${H * 0.615} ${W * 0.45} ${H * 0.635}" stroke="#6e675e" stroke-width="3" fill="none" opacity="0.6"/>`;
    // headboard
    body += `<rect x="${W * 0.095}" y="${H * 0.465}" width="${W * 0.36}" height="${H * 0.115}" rx="10" fill="#3a3244"/>`;
    // pillows
    body += `<rect x="${W * 0.13}" y="${H * 0.53}" width="${W * 0.12}" height="${H * 0.05}" rx="10" fill="#efe6d6"/>`;
    body += `<rect x="${W * 0.29}" y="${H * 0.53}" width="${W * 0.12}" height="${H * 0.05}" rx="10" fill="#e6dccb"/>`;
    body += `<rect x="${W * 0.17}" y="${H * 0.55}" width="${W * 0.09}" height="${H * 0.038}" rx="8" fill="#8a7358"/>`;
    // throw across foot
    body += poly([[W * 0.1, H * 0.665], [W * 0.45, H * 0.675], [W * 0.45, H * 0.71], [W * 0.1, H * 0.7]], "#5c4b5e", `opacity="0.9"`);
    // bedside tables + lamps
    for (const bx of [0.06, 0.475]) {
      body += ellipse(W * bx + 20, H * 0.71, 34, 8, "#000", `opacity="0.4"`);
      body += rect(W * bx, H * 0.63, 44, H * 0.075, "#241e2e");
      body += rect(W * bx, H * 0.63, 44, 4, "#3d3450");
      body += rect(W * bx + 18, H * 0.585, 6, H * 0.045, "#171221");
      const lgl = gid("bg");
      defs.push(radGrad(lgl, [[0, glow, 0.6], [1, glow, 0]]));
      body += `<circle cx="${W * bx + 21}" cy="${H * 0.572}" r="56" fill="url(#${lgl})"/>`;
      body += poly([[W * bx + 4, H * 0.588], [W * bx + 38, H * 0.588], [W * bx + 32, H * 0.552], [W * bx + 10, H * 0.552]], "#f6d3a0", `opacity="0.92"`);
    }
    // artwork
    body += rect(W * 0.19, H * 0.17, W * 0.17, H * 0.2, "#1c1826");
    body += rect(W * 0.198, H * 0.181, W * 0.154, H * 0.178, "#4a3f5c");
    body += ellipse(W * 0.245, H * 0.28, 40, 30, "#6e5a70", `opacity="0.5"`);
  }

  if (kind === "kitchen") {
    // island with grounded base
    body += ellipse(W * 0.27, H * 0.845, W * 0.2, 22, "#000000", `opacity="0.45"`);
    body += rect(W * 0.11, H * 0.655, W * 0.32, H * 0.175, "#2b2433");
    body += rect(W * 0.11, H * 0.655, W * 0.32, 5, "#000", `opacity="0.4"`);
    const islId = gid("is");
    defs.push(linGrad(islId, [[0, "#d6cfc0"], [1, "#8a8375"]]));
    body += `<rect x="${W * 0.095}" y="${H * 0.605}" width="${W * 0.35}" height="${H * 0.052}" rx="7" fill="url(#${islId})"/>`;
    // counter objects: bowl + board
    body += ellipse(W * 0.2, H * 0.605, 26, 8, "#3d3226");
    body += rect(W * 0.31, H * 0.596, 60, 8, "#4a3a2a", `rx="3"`);
    // faucet silhouette
    body += `<path d="M ${W * 0.42} ${H * 0.605} v ${-H * 0.05} q 0 -14 -14 -14 h -12" stroke="#171221" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    // back cabinetry wall
    body += rect(0, H * 0.24, W * 0.1, H * 0.42, "#241f2e");
    body += rect(W * 0.004, H * 0.25, W * 0.09, H * 0.4, "#332c40");
    for (let i = 1; i < 4; i++) body += rect(0, H * (0.24 + i * 0.105), W * 0.1, 2, "#000", `opacity="0.3"`);
    // pendants over island
    for (const px of [0.19, 0.27, 0.35]) {
      body += rect(W * px, 0, 2, H * 0.3, "#0f0c16");
      const pgl = gid("kg");
      defs.push(radGrad(pgl, [[0, glow, 0.6], [1, glow, 0]]));
      body += `<circle cx="${W * px + 1}" cy="${H * 0.31}" r="62" fill="url(#${pgl})"/>`;
      body += poly([[W * px - 12, H * 0.318], [W * px + 14, H * 0.318], [W * px + 8, H * 0.29], [W * px - 6, H * 0.29]], "#f6d3a0", `opacity="0.95"`);
    }
    // stools with contact shadows
    for (const sx of [0.16, 0.245, 0.33]) {
      body += ellipse(W * sx + 22, H * 0.855, 30, 7, "#000", `opacity="0.4"`);
      body += `<rect x="${W * sx}" y="${H * 0.73}" width="46" height="11" rx="5" fill="#54483a"/>`;
      body += rect(W * sx + 19, H * 0.74, 7, H * 0.11, "#241e18");
      body += ellipse(W * sx + 22.5, H * 0.85, 22, 4.5, "#241e18");
    }
  }

  body += finish(defs, { vignette: 0.5, grain: 0.045 });
  return svgDoc(defs, body);
}

/* ----------------------------- scene: terrace ----------------------------- */

function sceneTerrace(seedName, gradeName) {
  uid = 0;
  const r = mulberry32(hashSeed(seedName));
  const grade = GRADES[gradeName];
  const defs = [];
  let body = sky(defs, grade, { sunX: 0.6, sunY: 0.5, sunR: 0.42 });

  const horizon = H * 0.52;
  const seaId = gid("sea");
  defs.push(linGrad(seaId, grade.water));
  body += rect(0, horizon, W, H * 0.24, `url(#${seaId})`);
  body += rect(0, horizon, W, 2.4, "#f4ead6", `opacity="0.4"`);
  // sun path on water
  const spId = gid("sp");
  defs.push(linGrad(spId, [[0, grade.lit, 0.4], [1, grade.lit, 0]]));
  body += poly([[W * 0.56, horizon], [W * 0.64, horizon], [W * 0.7, horizon + H * 0.24], [W * 0.5, horizon + H * 0.24]], `url(#${spId})`);
  for (let i = 0; i < 16; i++) {
    body += rect(range(r, W * 0.1, W * 0.86), horizon + range(r, 8, H * 0.2), range(r, 26, 130), 1.4, "#000", `opacity="${range(r, 0.05, 0.14).toFixed(2)}"`);
  }

  // terrace deck
  const deckY = horizon + H * 0.24;
  const dkId = gid("dk");
  defs.push(linGrad(dkId, [[0, "#5a463a"], [1, "#1a130e"]]));
  body += rect(0, deckY, W, H - deckY, `url(#${dkId})`);
  for (let i = 0; i < 9; i++) {
    const t = i / 9;
    body += rect(0, deckY + t * t * (H - deckY), W, 2, "#000", `opacity="${(0.22 + t * 0.1).toFixed(2)}"`);
  }
  // long deck-board seams for perspective
  for (const px of [0.18, 0.36, 0.55, 0.74, 0.9]) {
    const drift = (px - 0.5) * 260;
    body += poly(
      [[W * px, deckY], [W * px + 3, deckY], [W * px + drift + 4, H], [W * px + drift, H]],
      "#000",
      `opacity="0.2"`,
    );
  }

  // glass balustrade with visible rail and posts
  const glId = gid("bal");
  defs.push(linGrad(glId, [[0, "#aebfca", 0.2], [1, "#aebfca", 0.06]]));
  body += rect(0, deckY - 118, W, 118, `url(#${glId})`);
  body += rect(0, deckY - 124, W, 7, "#12151d");
  body += rect(0, deckY - 118, W, 1.6, "#f4ead6", `opacity="0.3"`);
  for (const px of [0.08, 0.3, 0.52, 0.74, 0.95]) {
    body += rect(W * px, deckY - 118, 4.5, 118, "#12151d", `opacity="0.95"`);
  }
  body += rect(0, deckY - 2, W, 4, "#0d0f15");

  // pergola frame overhead — cinematic depth framing
  const beam = "#0e0a12";
  body += rect(0, 0, W, 26, beam);
  for (const bx of [0.1, 0.32, 0.54, 0.76, 0.96]) {
    body += rect(W * bx, 0, 26, H * 0.1, beam);
  }
  body += rect(0, H * 0.095, W, 14, beam);
  // hanging string lights under the pergola
  const sr = mulberry32(hashSeed(seedName + "lights"));
  for (let i = 0; i < 7; i++) {
    const lx = W * (0.1 + i * 0.135);
    const ly = H * 0.115 + Math.sin(i * 1.7) * 10 + range(sr, 0, 8);
    const lgl = gid("tl");
    defs.push(radGrad(lgl, [[0, grade.lit, 0.6], [1, grade.lit, 0]]));
    body += rect(lx, H * 0.095, 1.4, ly - H * 0.095, "#0e0a12", `opacity="0.8"`);
    body += `<circle cx="${lx}" cy="${ly}" r="26" fill="url(#${lgl})"/>`;
    body += ellipse(lx, ly, 4, 5, "#ffe4b0");
  }

  // lounge set — grounded with contact shadows
  const cushion = "#3d3126";
  const frame = "#17110c";
  // left sofa
  body += ellipse(W * 0.19, deckY + 132, W * 0.13, 18, "#000", `opacity="0.4"`);
  body += `<rect x="${W * 0.07}" y="${deckY + 66}" width="${W * 0.24}" height="${H * 0.062}" rx="12" fill="${frame}"/>`;
  body += `<rect x="${W * 0.075}" y="${deckY + 40}" width="${W * 0.23}" height="${H * 0.038}" rx="9" fill="${cushion}"/>`;
  body += `<rect x="${W * 0.06}" y="${deckY + 30}" width="${W * 0.028}" height="${H * 0.09}" rx="8" fill="${frame}"/>`;
  body += `<rect x="${W * 0.3}" y="${deckY + 30}" width="${W * 0.028}" height="${H * 0.09}" rx="8" fill="${frame}"/>`;
  // right lounger pair
  body += ellipse(W * 0.83, deckY + 150, W * 0.12, 16, "#000", `opacity="0.4"`);
  body += poly([[W * 0.73, deckY + 118], [W * 0.79, deckY + 74], [W * 0.805, deckY + 78], [W * 0.75, deckY + 122]], cushion);
  body += `<rect x="${W * 0.74}" y="${deckY + 112}" width="${W * 0.17}" height="${H * 0.03}" rx="8" fill="${frame}"/>`;
  body += poly([[W * 0.87, deckY + 132], [W * 0.93, deckY + 88], [W * 0.955, deckY + 92], [W * 0.89, deckY + 136]], cushion);
  body += `<rect x="${W * 0.88}" y="${deckY + 126}" width="${W * 0.17}" height="${H * 0.03}" rx="8" fill="${frame}"/>`;

  // low table + candle glow
  body += ellipse(W * 0.47, deckY + 150, 66, 14, "#000", `opacity="0.45"`);
  body += rect(W * 0.47 - 56, deckY + 116, 112, 26, "#2a211a");
  body += rect(W * 0.47 - 56, deckY + 114, 112, 4, "#4a3b2e");
  const cgl = gid("cn");
  defs.push(radGrad(cgl, [[0, grade.lit, 0.8], [1, grade.lit, 0]]));
  body += `<circle cx="${W * 0.47}" cy="${deckY + 102}" r="52" fill="url(#${cgl})"/>`;
  body += ellipse(W * 0.47, deckY + 108, 6, 9, "#f6d3a0");

  // potted olive silhouette (frame right)
  body += ellipse(W * 0.955, deckY + 40, 46, 12, "#000", `opacity="0.4"`);
  body += rect(W * 0.93, deckY - 26, 64, 62, "#151009");
  body += ellipse(W * 0.962, deckY - 106, 78, 92, "#0e140d", `opacity="0.94"`);

  body += finish(defs, { vignette: 0.52 });
  return svgDoc(defs, body);
}

/* ------------------------- scene: rooftop pool ------------------------- */

function scenePool(seedName, gradeName) {
  uid = 0;
  const r = mulberry32(hashSeed(seedName));
  const grade = GRADES[gradeName];
  const defs = [];
  let body = sky(defs, grade, { sunX: 0.5, sunY: 0.58, sunR: 0.4 });

  const horizon = H * 0.56;
  body += skyline(r, grade, { baseY: horizon, minH: 60, maxH: 220, color: grade.far, opacity: 0.85 });
  body += skyline(r, grade, { baseY: horizon, minH: 30, maxH: 120, color: grade.mid, opacity: 0.9 });
  body += hazeBand(defs, grade, horizon - 130, 150, 0.5);

  // deck
  const deckY = horizon + 8;
  const dkg = gid("dg");
  defs.push(linGrad(dkg, [[0, "#2e2638"], [1, "#151020"]]));
  body += rect(0, deckY, W, H - deckY, `url(#${dkg})`);
  // pool — infinity edge running toward the skyline, off-centre
  const pid = gid("pw");
  defs.push(linGrad(pid, [[0, "#54809b"], [0.5, "#2e4f6d"], [1, "#16273e"]]));
  body += poly([[W * 0.06, deckY + 26], [W * 0.72, deckY + 26], [W * 0.94, H], [W * -0.12, H]], `url(#${pid})`);
  // infinity edge highlight
  body += poly([[W * 0.06, deckY + 26], [W * 0.72, deckY + 26], [W * 0.724, deckY + 33], [W * 0.055, deckY + 33]], "#e8e2d2", `opacity="0.35"`);
  // sky reflection streak in pool
  const srId = gid("sr");
  defs.push(linGrad(srId, [[0, grade.sun[0], 0.45], [1, grade.sun[0], 0]]));
  body += poly([[W * 0.34, deckY + 33], [W * 0.48, deckY + 33], [W * 0.56, H], [W * 0.24, H]], `url(#${srId})`);
  // lane shimmer
  for (let i = 0; i < 22; i++) {
    const t = r() ** 1.6;
    const ry = deckY + 40 + t * (H - deckY - 70);
    body += rect(range(r, W * 0.02, W * 0.7), ry, range(r, 30, 170) * (0.5 + t), 1.8, "#0a1520", `opacity="${range(r, 0.14, 0.32).toFixed(2)}"`);
  }
  // wet-deck reflection along right edge
  const wdId = gid("wd");
  defs.push(linGrad(wdId, [[0, grade.sun[0], 0.14], [1, grade.sun[0], 0]]));
  body += rect(W * 0.74, deckY + 20, W * 0.24, 140, `url(#${wdId})`);

  // loungers along the right deck, larger and angled
  for (const [lx, ly] of [[0.8, 60], [0.87, 110], [0.94, 165]]) {
    body += ellipse(W * lx + 34, deckY + ly + 34, 44, 9, "#000", `opacity="0.45"`);
    body += poly([[W * lx, deckY + ly + 24], [W * lx + 20, deckY + ly - 8], [W * lx + 30, deckY + ly - 4], [W * lx + 10, deckY + ly + 28]], "#2c2438");
    body += `<rect x="${W * lx}" y="${deckY + ly + 18}" width="82" height="13" rx="6" fill="#191420"/>`;
  }
  // side table + plant pots
  body += ellipse(W * 0.77, deckY + 46, 18, 5, "#000", `opacity="0.4"`);
  body += rect(W * 0.762, deckY + 24, 16, 20, "#241d30");
  body += ellipse(W * 0.955, deckY + 30, 30, 7, "#000", `opacity="0.4"`);
  body += rect(W * 0.94, deckY - 20, 30, 46, "#171126");
  body += ellipse(W * 0.955, deckY - 52, 38, 42, "#0e140f", `opacity="0.92"`);

  body += finish(defs, { vignette: 0.52 });
  return svgDoc(defs, body);
}

/* ---------------------------- scene: construction --------------------------- */

function sceneConstruction(seedName) {
  uid = 0;
  const r = mulberry32(hashSeed(seedName));
  const grade = GRADES.golden;
  const defs = [];
  let body = sky(defs, grade, { sunX: 0.34, sunY: 0.62, sunR: 0.44 });

  const horizon = H * 0.78;
  body += skyline(r, grade, { baseY: horizon, minH: 50, maxH: 170, color: grade.far, opacity: 0.7 });
  body += hazeBand(defs, grade, horizon - 140, 160, 0.55);

  // concrete frame building under construction (silhouette against sun)
  const bx = W * 0.5;
  const bw = W * 0.34;
  const bh = H * 0.52;
  const by = horizon - bh;
  const frame = "#221a28";
  const floors = 8;
  const cols2 = 6;
  // slabs
  for (let i = 0; i <= floors; i++) {
    body += rect(bx, by + (bh / floors) * i - 5, bw, 10, frame);
  }
  // columns
  for (let i = 0; i <= cols2; i++) {
    body += rect(bx + (bw / cols2) * i - 3.5, by, 7, bh, frame);
  }
  // core
  body += rect(bx + bw * 0.4, by - 40, bw * 0.16, bh + 40, frame);
  // scattered work lights
  for (let i = 0; i < 7; i++) {
    const lx = bx + range(r, 10, bw - 10);
    const ly = by + range(r, 20, bh - 20);
    const wgl = gid("wl");
    defs.push(radGrad(wgl, [[0, grade.lit, 0.8], [1, grade.lit, 0]]));
    body += `<circle cx="${lx}" cy="${ly}" r="${range(r, 16, 30)}" fill="url(#${wgl})"/>`;
    body += ellipse(lx, ly, 3.4, 3.4, "#ffe4b0");
  }

  // tower cranes
  for (const [cx, ch, dir] of [[W * 0.24, H * 0.62, 1], [W * 0.86, H * 0.5, -1]]) {
    const crane = "#160f1c";
    body += rect(cx - 5, horizon - ch, 10, ch, crane);
    // lattice hints
    for (let i = 0; i < ch / 34; i++) {
      body += rect(cx - 5, horizon - ch + i * 34, 10, 2.2, "#000", `opacity="0.5"`);
    }
    const jib = 300 * dir;
    body += poly([[cx, horizon - ch], [cx + jib, horizon - ch + 16], [cx + jib, horizon - ch + 22], [cx, horizon - ch + 8]], crane);
    body += poly([[cx, horizon - ch - 46], [cx + jib * 0.6, horizon - ch + 10], [cx + jib * 0.6 - 8 * dir, horizon - ch + 12], [cx - 3, horizon - ch - 40]], crane, `opacity="0.9"`);
    body += rect(cx + jib * 0.85 - 2, horizon - ch + 20, 4, ch * 0.4, crane); // cable
    body += rect(cx + jib * 0.85 - 12, horizon - ch + 20 + ch * 0.4, 24, 18, crane); // load
    // beacon
    body += ellipse(cx, horizon - ch - 48, 4, 4, "#e06a52");
  }

  // ground: site with container + light
  const gndId = gid("gd");
  defs.push(linGrad(gndId, [[0, "#2c2130"], [1, "#120d16"]]));
  body += rect(0, horizon, W, H - horizon, `url(#${gndId})`);
  body += rect(W * 0.08, horizon + 40, 130, 54, "#1c1524");
  body += rect(W * 0.08, horizon + 40, 130, 8, "#2e2438");
  const sgl = gid("sg");
  defs.push(radGrad(sgl, [[0, grade.lit, 0.5], [1, grade.lit, 0]]));
  body += `<circle cx="${W * 0.3}" cy="${horizon + 50}" r="80" fill="url(#${sgl})"/>`;
  body += rect(W * 0.3 - 2, horizon + 30, 4, 60, "#160f1c");
  body += ellipse(W * 0.3, horizon + 28, 8, 6, "#ffe4b0");

  body += finish(defs, { vignette: 0.55 });
  return svgDoc(defs, body);
}

/* ------------------------------ scene: lobby ------------------------------ */

function sceneLobby(seedName) {
  uid = 0;
  const r = mulberry32(hashSeed(seedName));
  const defs = [];
  const glow = "#f2c489";

  // double-height space, warm stone
  const wallId = gid("lw");
  defs.push(linGrad(wallId, [[0, "#3b3345"], [1, "#251f30"]]));
  let body = rect(0, 0, W, H, `url(#${wallId})`);

  // slatted feature wall
  for (let i = 0; i < 40; i++) {
    const x = W * 0.06 + i * 14;
    body += rect(x, H * 0.08, 6, H * 0.62, i % 2 ? "#4a3c33" : "#3a2e27");
  }
  // reception desk
  const dsId = gid("ds");
  defs.push(linGrad(dsId, [[0, "#8a7358"], [1, "#4c3d2e"]]));
  body += `<rect x="${W * 0.14}" y="${H * 0.56}" width="${W * 0.34}" height="${H * 0.14}" rx="8" fill="url(#${dsId})"/>`;
  body += rect(W * 0.14, H * 0.56, W * 0.34, 5, glow, `opacity="0.5"`);
  // under-counter light
  const ucl = gid("uc");
  defs.push(linGrad(ucl, [[0, glow, 0.4], [1, glow, 0]]));
  body += rect(W * 0.14, H * 0.7, W * 0.34, 60, `url(#${ucl})`);

  // floor: polished stone with reflections
  const flId = gid("lf");
  defs.push(linGrad(flId, [[0, "#26202f"], [1, "#0e0b14"]]));
  body += rect(0, H * 0.7, W, H * 0.3, `url(#${flId})`);
  const rfl = gid("rl");
  defs.push(linGrad(rfl, [[0, "#8a7358", 0.25], [1, "#8a7358", 0]]));
  body += rect(W * 0.14, H * 0.7, W * 0.34, 90, `url(#${rfl})`);

  // glass entrance on right with dusk view
  const view = GRADES.dusk;
  const vid = gid("lv");
  defs.push(linGrad(vid, view.sky));
  body += rect(W * 0.62, H * 0.1, W * 0.32, H * 0.6, `url(#${vid})`);
  const vsk = mulberry32(hashSeed(seedName + "v"));
  body += skyline(vsk, view, { baseY: H * 0.58, minH: 40, maxH: 140, color: view.far, opacity: 0.85 });
  body += rect(W * 0.62, H * 0.58, W * 0.32, H * 0.12, "#131022");
  body += rect(W * 0.62, H * 0.1, W * 0.32, H * 0.6, "none", `stroke="#151019" stroke-width="12"`);
  body += rect(W * 0.62 + W * 0.16 - 4, H * 0.1, 8, H * 0.6, "#151019");
  // door glow spill on floor
  const spill = gid("sp");
  defs.push(linGrad(spill, [[0, "#6e5364", 0.3], [1, "#6e5364", 0]]));
  body += poly([[W * 0.62, H * 0.7], [W * 0.94, H * 0.7], [W * 1.02, H], [W * 0.56, H]], `url(#${spill})`);

  // pendant cluster
  for (const [px, py2, pr2] of [[0.3, 0.24, 16], [0.36, 0.3, 12], [0.25, 0.32, 10]]) {
    body += rect(W * px, 0, 2, H * py2, "#0f0c16");
    body += ellipse(W * px + 1, H * py2 + 8, pr2, pr2, "#f6d3a0", `opacity="0.95"`);
    const pgl = gid("lg");
    defs.push(radGrad(pgl, [[0, glow, 0.5], [1, glow, 0]]));
    body += `<circle cx="${W * px + 1}" cy="${H * py2 + 8}" r="${pr2 * 4.6}" fill="url(#${pgl})"/>`;
  }

  body += finish(defs, { vignette: 0.5 });
  return svgDoc(defs, body);
}

/* --------------------------- scene: coastal town --------------------------- */

function sceneCoast(seedName, gradeName) {
  uid = 0;
  const r = mulberry32(hashSeed(seedName));
  const grade = GRADES[gradeName];
  const defs = [];
  let body = sky(defs, grade, { sunX: 0.7, sunY: 0.55, sunR: 0.4 });

  const horizon = H * 0.6;
  const seaId = gid("cs");
  defs.push(linGrad(seaId, grade.water));
  body += rect(0, horizon, W, H - horizon, `url(#${seaId})`);
  body += rect(0, horizon, W, 2.4, "#f4ead6", `opacity="0.35"`);
  // sun path
  const spId = gid("cp");
  defs.push(linGrad(spId, [[0, grade.lit, 0.35], [1, grade.lit, 0]]));
  body += poly([[W * 0.66, horizon], [W * 0.74, horizon], [W * 0.82, H], [W * 0.58, H]], `url(#${spId})`);

  // hillside descending from left with terraced buildings
  body += poly([[0, H], [0, H * 0.3], [W * 0.14, H * 0.34], [W * 0.34, H * 0.48], [W * 0.52, H * 0.58], [W * 0.6, horizon], [W * 0.4, H]], "#161226");
  const hr = mulberry32(hashSeed(seedName + "h"));
  // terraced building clusters on the hill
  for (let i = 0; i < 16; i++) {
    const t = i / 16;
    const hx = W * (0.02 + t * 0.5) + range(hr, -20, 20);
    const hy = H * (0.36 + t * 0.26) + range(hr, -14, 14);
    const bw2 = range(hr, 40, 90);
    const bh2 = range(hr, 30, 60);
    body += rect(hx, hy - bh2, bw2, bh2, pick(hr, ["#241e36", "#2b2440", "#1d1830"]));
    const wn = windows(hr, grade, {
      x: hx + 4, y: hy - bh2 + 5, w: bw2 - 8, h: bh2 - 10,
      cols: int(hr, 2, 4), rows: int(hr, 1, 3), litProb: 0.55, opMin: 0.5, opMax: 1,
    });
    body += wn.out;
  }
  body += hazeBand(defs, grade, horizon - 100, 120, 0.4);

  // waterfront promenade lights
  for (let i = 0; i < 9; i++) {
    const lx = W * 0.05 + i * (W * 0.06);
    const ly = H * (0.68 + i * 0.008);
    const lgl = gid("pl");
    defs.push(radGrad(lgl, [[0, grade.lit, 0.6], [1, grade.lit, 0]]));
    body += `<circle cx="${lx}" cy="${ly}" r="26" fill="url(#${lgl})"/>`;
    body += ellipse(lx, ly, 2.6, 2.6, "#ffe4b0");
  }
  // reflections
  for (let i = 0; i < 20; i++) {
    body += rect(range(r, 0, W * 0.9), horizon + range(r, 10, H - horizon - 20), range(r, 30, 140), 1.5, "#000", `opacity="${range(r, 0.05, 0.14).toFixed(2)}"`);
  }

  body += finish(defs, { vignette: 0.52 });
  return svgDoc(defs, body);
}

/* ---------------------------- scene: office glass ---------------------------- */

function sceneOffice(seedName) {
  uid = 0;
  const r = mulberry32(hashSeed(seedName));
  const grade = GRADES.golden;
  const defs = [];
  let body = sky(defs, grade, { sunX: 0.24, sunY: 0.6, sunR: 0.4 });

  const horizon = H * 0.86;
  body += skyline(r, grade, { baseY: horizon, minH: 80, maxH: 260, color: grade.far, opacity: 0.75 });
  body += hazeBand(defs, grade, horizon - 190, 210, 0.5);

  // hero glass tower — curtain wall reflecting the sunset gradient
  const bx = W * 0.42;
  const bw = W * 0.3;
  const by = H * 0.06;
  const bh = horizon - by;
  const glassId = gid("og");
  defs.push(linGrad(glassId, [[0, "#3a2f4e"], [0.5, "#6b4553"], [0.8, "#b0765c"], [1, "#463349"]]));
  body += rect(bx, by, bw, bh, `url(#${glassId})`);
  // mullion grid
  for (let i = 1; i < 8; i++) body += rect(bx + (bw / 8) * i - 1.2, by, 2.4, bh, "#171224", `opacity="0.8"`);
  for (let j = 1; j < 22; j++) body += rect(bx, by + (bh / 22) * j - 1, bw, 2, "#171224", `opacity="0.65"`);
  // sun flare on glass — broad and soft, following the mullion grid
  const flare = gid("fl");
  defs.push(radGrad(flare, [[0, "#f7cf96", 0.38], [0.55, "#f7cf96", 0.14], [1, "#f7cf96", 0]]));
  body += `<circle cx="${bx + bw * 0.28}" cy="${by + bh * 0.44}" r="240" fill="url(#${flare})"/>`;
  const streak = gid("fs");
  defs.push(linGrad(streak, [[0, "#f7cf96", 0], [0.5, "#f7cf96", 0.22], [1, "#f7cf96", 0]]));
  body += rect(bx, by + bh * 0.38, bw, 44, `url(#${streak})`);
  // neighbouring lower blocks
  body += rect(W * 0.16, horizon - 300, 200, 300, grade.mid);
  const nb = windows(r, grade, { x: W * 0.16 + 10, y: horizon - 290, w: 180, h: 280, cols: 4, rows: 8, litProb: 0.3, opMin: 0.4, opMax: 0.8 });
  body += nb.out;
  body += rect(W * 0.78, horizon - 380, 230, 380, grade.mid);
  const nb2 = windows(r, grade, { x: W * 0.78 + 12, y: horizon - 368, w: 206, h: 350, cols: 5, rows: 10, litProb: 0.34, opMin: 0.4, opMax: 0.85 });
  body += nb2.out;

  // street level
  const gndId = gid("st");
  defs.push(linGrad(gndId, [[0, "#241d2e"], [1, "#0e0b14"]]));
  body += rect(0, horizon, W, H - horizon, `url(#${gndId})`);
  // lit lobby line
  body += rect(bx, horizon - 34, bw, 34, grade.lit, `opacity="0.55"`);
  const lbr = gid("lr");
  defs.push(linGrad(lbr, [[0, grade.lit, 0.3], [1, grade.lit, 0]]));
  body += rect(bx, horizon, bw, 70, `url(#${lbr})`);

  body += finish(defs, { vignette: 0.52 });
  return svgDoc(defs, body);
}

/* ------------------------------ scene: aerial ------------------------------ */

function sceneAerial(seedName) {
  uid = 0;
  const r = mulberry32(hashSeed(seedName));
  const grade = GRADES.dusk;
  const defs = [];
  let body = sky(defs, grade, { sunX: 0.5, sunY: 0.4, sunR: 0.5 });

  const horizon = H * 0.34;
  body += hazeBand(defs, grade, horizon - 60, 120, 0.6);

  // receding rows of development blocks (elevated view)
  const rows = 6;
  for (let j = 0; j < rows; j++) {
    const t = j / (rows - 1);
    const y = horizon + t * t * (H - horizon) * 0.92;
    const scale = 0.35 + t * 0.85;
    const color = [grade.far, grade.far, grade.mid, grade.mid, grade.near, grade.near][j];
    let x = -80 + range(r, 0, 60);
    while (x < W + 80) {
      const bw = range(r, 60, 130) * scale;
      const bh = range(r, 50, 130) * scale;
      body += rect(x, y - bh, bw, bh, color);
      if (t > 0.3) {
        const wn = windows(r, grade, {
          x: x + 4 * scale, y: y - bh + 6 * scale, w: bw - 8 * scale, h: bh - 12 * scale,
          cols: Math.max(2, Math.round(3 * scale + 1)), rows: Math.max(2, Math.round(3 * scale + 1)),
          litProb: 0.4, opMin: 0.4, opMax: 0.95,
        });
        body += wn.out;
      }
      x += bw + range(r, 20, 70) * scale;
    }
    // street glow between rows
    if (j > 0) {
      const sgl = gid("stg");
      defs.push(linGrad(sgl, [[0, grade.lit, 0.16 * t], [1, grade.lit, 0]]));
      body += rect(0, y, W, 26 * scale, `url(#${sgl})`);
    }
  }

  body += finish(defs, { vignette: 0.58 });
  return svgDoc(defs, body);
}

/* ------------------------------ scene: penthouse ---------------------------- */

function scenePenthouse(seedName) {
  uid = 0;
  const r = mulberry32(hashSeed(seedName));
  const defs = [];
  const glow = "#f2c489";
  const view = GRADES.night;

  // full-width window with night city, interior in silhouette
  const vid = gid("pv");
  defs.push(linGrad(vid, view.sky));
  let body = rect(0, 0, W, H, `url(#${vid})`);
  const vr = mulberry32(hashSeed(seedName + "c"));
  body += skyline(vr, view, { baseY: H * 0.66, minH: 90, maxH: 300, color: "#141a33", opacity: 1 });
  // lit windows scattered on skyline buildings
  for (let i = 0; i < 240; i++) {
    body += rect(range(vr, 0, W), H * 0.66 - range(vr, 8, 280), 3.4, 4.6, view.lit, `opacity="${range(vr, 0.15, 0.8).toFixed(2)}"`);
  }
  body += hazeBand(defs, view, H * 0.5, 180, 0.35);

  // interior floor
  const flId = gid("pf");
  defs.push(linGrad(flId, [[0, "#2a2233"], [1, "#0f0b14"]]));
  body += rect(0, H * 0.66, W, H * 0.34, `url(#${flId})`);
  // city reflection on polished floor
  for (let i = 0; i < 60; i++) {
    body += rect(range(vr, 0, W), H * 0.66 + range(vr, 4, 90), 2.6, range(vr, 10, 40), view.lit, `opacity="${range(vr, 0.04, 0.16).toFixed(2)}"`);
  }

  // window mullions
  for (const px of [0.25, 0.5, 0.75]) body += rect(W * px - 3, 0, 6, H * 0.66, "#0a0812");
  body += rect(0, H * 0.655, W, 12, "#0a0812");

  // furniture silhouettes against the view
  body += `<rect x="${W * 0.1}" y="${H * 0.56}" width="${W * 0.3}" height="${H * 0.1}" rx="12" fill="#0d0a13"/>`;
  body += `<rect x="${W * 0.13}" y="${H * 0.51}" width="${W * 0.24}" height="${H * 0.06}" rx="10" fill="#120e1a"/>`;
  body += ellipse(W * 0.55, H * 0.78, 100, 22, "#000", `opacity="0.5"`);
  body += ellipse(W * 0.55, H * 0.765, 100, 20, "#221a2c");
  // single warm lamp
  body += rect(W * 0.7, H * 0.4, 4, H * 0.26, "#0a0812");
  const lgl = gid("pl");
  defs.push(radGrad(lgl, [[0, glow, 0.7], [1, glow, 0]]));
  body += `<circle cx="${W * 0.702}" cy="${H * 0.39}" r="80" fill="url(#${lgl})"/>`;
  body += ellipse(W * 0.702, H * 0.395, 24, 16, "#f6d3a0", `opacity="0.95"`);

  body += finish(defs, { vignette: 0.55, grain: 0.05 });
  return svgDoc(defs, body);
}

/* ------------------------------- scene: plan ------------------------------- */

function scenePlan(seedName) {
  uid = 0;
  const r = mulberry32(hashSeed(seedName));
  const defs = [];
  const paper = "#131a2e";
  const line = "#8fa3d9";
  let body = rect(0, 0, W, H, paper);
  // subtle grid
  for (let x = 0; x < W; x += 40) body += rect(x, 0, 1, H, line, `opacity="0.05"`);
  for (let y = 0; y < H; y += 40) body += rect(0, y, W, 1, line, `opacity="0.05"`);

  // apartment outline
  const px = W * 0.22, py = H * 0.16, pw = W * 0.56, ph = H * 0.66;
  const wall = (x, y, w, h) => rect(x, y, w, h, line, `opacity="0.9"`);
  const t = 5;
  body += wall(px, py, pw, t) + wall(px, py + ph - t, pw, t) + wall(px, py, t, ph) + wall(px + pw - t, py, t, ph);
  // internal walls
  body += wall(px + pw * 0.42, py, t, ph * 0.5);
  body += wall(px, py + ph * 0.5, pw * 0.42, t);
  body += wall(px + pw * 0.66, py + ph * 0.5, pw * 0.34, t);
  body += wall(px + pw * 0.66, py + ph * 0.5, t, ph * 0.5);
  // door arcs
  const arc = (cx, cy, rad, a1, a2) => {
    const p1 = [cx + rad * Math.cos(a1), cy + rad * Math.sin(a1)];
    const p2 = [cx + rad * Math.cos(a2), cy + rad * Math.sin(a2)];
    return `<path d="M ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} A ${rad} ${rad} 0 0 1 ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}" stroke="${line}" stroke-opacity="0.6" fill="none" stroke-width="2"/>`;
  };
  body += arc(px + pw * 0.42 + t, py + ph * 0.36, 60, -Math.PI / 2, 0);
  body += arc(px + pw * 0.2, py + ph * 0.5 + t, 56, -Math.PI / 2, 0);
  // furniture hints
  body += rect(px + 30, py + 40, 150, 80, line, `opacity="0.16"`); // bed
  body += rect(px + pw * 0.5, py + ph * 0.62, 190, 70, line, `opacity="0.16"`); // sofa
  body += ellipse(px + pw * 0.56 + 40, py + ph * 0.3, 46, 46, line, `opacity="0.12"`); // table
  // balcony
  body += rect(px + pw, py + ph * 0.25, 60, ph * 0.4, line, `opacity="0.14"`);
  body += wall(px + pw + 58, py + ph * 0.25, 3, ph * 0.4);
  // dims
  for (const [dx, dy, dw2] of [[px, py - 30, pw], [px, py + ph + 26, pw * 0.42]]) {
    body += rect(dx, dy, dw2, 1.6, line, `opacity="0.5"`);
    body += rect(dx, dy - 5, 1.6, 12, line, `opacity="0.5"`);
    body += rect(dx + dw2, dy - 5, 1.6, 12, line, `opacity="0.5"`);
  }
  // title block
  body += rect(W * 0.8, H * 0.84, W * 0.14, H * 0.09, line, `opacity="0.08"`);
  body += rect(W * 0.81, H * 0.86, W * 0.1, 3, line, `opacity="0.5"`);
  body += rect(W * 0.81, H * 0.885, W * 0.07, 2.4, line, `opacity="0.3"`);
  void r;
  body += finish(defs, { vignette: 0.4, grain: 0.04 });
  return svgDoc(defs, body);
}

/* -------------------------------- manifest -------------------------------- */

const IMAGES = [
  // Azure Residences — Limassol (coastal development)
  { id: "azure-exterior", kind: "exterior", make: () => sceneTower("azure-1", "dusk"), alt: "Seafront residential tower at dusk with lit windows reflected in the water" },
  { id: "azure-coast", kind: "aerial", make: () => sceneCoast("azure-coast", "dusk"), alt: "Coastal hillside with terraced residences descending to a promenade at dusk" },
  { id: "azure-terrace", kind: "terrace", make: () => sceneTerrace("azure-terr", "golden"), alt: "Terrace with glass balustrade facing the sea at golden hour" },
  { id: "azure-living", kind: "interior", make: () => sceneInterior("azure-liv", "living"), alt: "Living room with warm lamps and a dusk sea view through floor-to-ceiling glass" },
  { id: "azure-pool", kind: "amenity", make: () => scenePool("azure-pool", "dusk"), alt: "Rooftop infinity pool at dusk overlooking a city skyline" },

  // Park Avenue Residence — New York (luxury apartment)
  { id: "park-exterior", kind: "exterior", make: () => sceneTower("park-1", "night"), alt: "Manhattan residential tower at night, windows glowing warm" },
  { id: "park-penthouse", kind: "interior", make: () => scenePenthouse("park-pent"), alt: "Penthouse interior in silhouette against a night city skyline" },
  { id: "park-bedroom", kind: "interior", make: () => sceneInterior("park-bed", "bedroom"), alt: "Bedroom in soft morning light with bedside lamps" },
  { id: "park-lobby", kind: "amenity", make: () => sceneLobby("park-lobby"), alt: "Double-height lobby with warm slatted wall and glass entrance at dusk" },

  // Casa Marina — Marbella (luxury villa)
  { id: "marina-villa", kind: "exterior", make: () => sceneVilla("marina-1", "dusk"), alt: "Modern villa at dusk with glowing glass walls and an infinity pool" },
  { id: "marina-villa-golden", kind: "exterior", make: () => sceneVilla("marina-2", "golden"), alt: "Villa exterior at golden hour with cypress silhouettes" },
  { id: "marina-kitchen", kind: "interior", make: () => sceneInterior("marina-kit", "kitchen"), alt: "Kitchen island under three warm pendant lights" },
  { id: "marina-terrace", kind: "terrace", make: () => sceneTerrace("marina-terr", "dusk"), alt: "Sea-view terrace at dusk with a candle-lit table" },

  // The Grove — London (new development)
  { id: "grove-aerial", kind: "aerial", make: () => sceneAerial("grove-a"), alt: "Aerial view of a residential development at dusk, streets glowing" },
  { id: "grove-exterior", kind: "exterior", make: () => sceneTower("grove-1", "golden"), alt: "Residential quarter at golden hour with warm lit facades" },
  { id: "grove-construction", kind: "construction", make: () => sceneConstruction("grove-c"), alt: "Construction site at dawn with tower cranes and work lights" },
  { id: "grove-living", kind: "interior", make: () => sceneInterior("grove-liv", "living"), alt: "Show-apartment living room with a city view at dusk" },
  { id: "grove-plan", kind: "plan", make: () => scenePlan("grove-p"), alt: "Apartment floor plan drawn in light lines on deep blue paper" },

  // Meridian Tower — Dubai (investor / commercial flavour)
  { id: "meridian-exterior", kind: "exterior", make: () => sceneOffice("meridian-1"), alt: "Glass tower reflecting the sunset in its curtain wall" },
  { id: "meridian-skyline", kind: "exterior", make: () => sceneTower("meridian-2", "dusk", { water: true }), alt: "Waterfront skyline at dusk with reflections" },
  { id: "meridian-pool", kind: "amenity", make: () => scenePool("meridian-pool", "golden"), alt: "Rooftop pool at golden hour above the skyline" },

  // Standalone extras for templates / examples / assets
  { id: "villa-night", kind: "exterior", make: () => sceneVilla("villa-n", "night"), alt: "Villa at night, interior light spilling onto the pool" },
  { id: "coast-marine", kind: "aerial", make: () => sceneCoast("coast-m", "marine"), alt: "Misty morning coastal town by a calm sea" },
  { id: "tower-marine", kind: "exterior", make: () => sceneTower("tower-m", "marine", { water: true }), alt: "Seafront towers on a soft misty morning" },
  { id: "interior-bed-2", kind: "interior", make: () => sceneInterior("bed-2", "bedroom"), alt: "Calm bedroom with sea light" },
  { id: "interior-living-2", kind: "interior", make: () => sceneInterior("living-2", "living"), alt: "Living room at dusk with pendant lights" },
  { id: "construction-2", kind: "construction", make: () => sceneConstruction("constr-2"), alt: "Concrete frame and cranes against a dawn sky" },
  { id: "penthouse-2", kind: "interior", make: () => scenePenthouse("pent-2"), alt: "Night penthouse with city lights reflected in the floor" },
  { id: "lobby-2", kind: "amenity", make: () => sceneLobby("lobby-2"), alt: "Hotel lobby with warm pendants and city dusk beyond" },
  { id: "aerial-2", kind: "aerial", make: () => sceneAerial("aerial-2"), alt: "Development masterplan seen from above at dusk" },
  { id: "office-2", kind: "exterior", make: () => sceneOffice("office-2"), alt: "Office tower catching the last light" },
  { id: "terrace-2", kind: "terrace", make: () => sceneTerrace("terr-2", "marine"), alt: "Morning terrace over a calm sea" },
  { id: "plan-2", kind: "plan", make: () => scenePlan("plan-2"), alt: "Floor plan sheet with balcony detail" },
];

/* ---------------------------------- write ---------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });
const manifest = [];
for (const image of IMAGES) {
  const svg = image.make();
  const file = `${image.id}.svg`;
  writeFileSync(join(OUT_DIR, file), svg);
  manifest.push({ id: image.id, kind: image.kind, src: `/art/${file}`, alt: image.alt });
  console.log(`✓ ${file} (${(svg.length / 1024).toFixed(1)} KB)`);
}

mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
const ts = `/**
 * Generated by scripts/generate-property-art.mjs — do not edit by hand.
 * Regenerate with \`npm run art\`.
 */

export type ArtKind =
  | "exterior"
  | "interior"
  | "terrace"
  | "amenity"
  | "aerial"
  | "construction"
  | "plan";

export interface ArtImage {
  id: string;
  kind: ArtKind;
  src: string;
  alt: string;
}

export const ART: readonly ArtImage[] = ${JSON.stringify(manifest, null, 2)};

export const artById = (id: string): ArtImage => {
  const found = ART.find((image) => image.id === id);
  if (!found) throw new Error(\`Unknown art id: \${id}\`);
  return found;
};
`;
writeFileSync(MANIFEST_PATH, ts);
console.log(`\n✓ manifest → src/lib/data/art-manifest.ts (${manifest.length} images)`);
