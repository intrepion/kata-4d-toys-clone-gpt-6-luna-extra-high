(() => {
  "use strict";

  const canvas = document.getElementById("world");
  const wrap = document.getElementById("canvasWrap");
  const ctx = canvas.getContext("2d");
  const ui = {
    slice: document.getElementById("sliceSlider"),
    sliceValue: document.getElementById("sliceValue"),
    sliceReadout: document.getElementById("sliceReadout"),
    xw: document.getElementById("xwSlider"),
    yw: document.getElementById("ywSlider"),
    xwOutput: document.getElementById("xwOutput"),
    ywOutput: document.getElementById("ywOutput"),
    caption: document.getElementById("stageCaption"),
    worldLabel: document.getElementById("worldObjectLabel"),
    toyCount: document.getElementById("toyCount"),
    pause: document.getElementById("pauseButton"),
    pauseText: document.getElementById("pauseText"),
    pauseSymbol: document.getElementById("pauseSymbol"),
    hint: document.getElementById("gestureHint"),
    zoom: document.getElementById("zoomReadout"),
    gravity: document.getElementById("gravityToggle"),
    spin: document.getElementById("spinToggle"),
  };

  const shapeInfo = {
    hypercube: { title: "TESSERACT · 4-CUBE", label: "HYPERCUBE", radius: 1.23, color: [102, 201, 225] },
    hypersphere: { title: "HYPERSPHERE · 4-BALL", label: "HYPERSPHERE", radius: 1.28, color: [240, 163, 130] },
    simplex: { title: "5-CELL · 4-SIMPLEX", label: "5-CELL", radius: 1.25, color: [185, 157, 235] },
    cross: { title: "16-CELL · CROSS-POLYTOPE", label: "16-CELL", radius: 1.26, color: [200, 220, 122] },
  };

  const state = {
    bodies: [], selected: 0, slice: 0, xw: 18 * Math.PI / 180, yw: -12 * Math.PI / 180,
    yaw: -0.26, pitch: 0.38, zoom: 1, gravity: true, spinning: true, paused: false,
    pointer: null, dragging: null, soundOn: false, audio: null, lastTime: performance.now(),
    elapsed: 0, dpr: 1, width: 0, height: 0, hintSeen: false,
  };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const sub = (a, b) => a.map((value, i) => value - b[i]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = (a) => Math.hypot(...a);
  const normalize = (a) => { const m = length(a) || 1; return a.map((v) => v / m); };
  const fmt = (v) => `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;

  function completeEdges(indices) {
    const edges = [];
    for (let i = 0; i < indices.length; i++) for (let j = i + 1; j < indices.length; j++) edges.push([indices[i], indices[j]]);
    return edges;
  }

  function hypercubeGeometry() {
    const vertices = [];
    for (let mask = 0; mask < 16; mask++) vertices.push([0, 1, 2, 3].map((axis) => (mask & (1 << axis)) ? 1 : -1));
    const edges = [];
    for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) {
      let delta = 0;
      for (let d = 0; d < 4; d++) if (vertices[i][d] !== vertices[j][d]) delta++;
      if (delta === 1) edges.push([i, j]);
    }
    const facets = [];
    for (let axis = 0; axis < 4; axis++) for (const sign of [-1, 1]) {
      const ids = vertices.map((v, i) => Math.abs(v[axis] - sign) < 0.01 ? i : -1).filter((i) => i >= 0);
      facets.push({ edges: edges.filter(([a, b]) => ids.includes(a) && ids.includes(b)) });
    }
    return { vertices, edges, facets };
  }

  function simplexGeometry() {
    const rt3 = Math.sqrt(3), rt23 = Math.sqrt(2 / 3), rt524 = Math.sqrt(5 / 24), rt58 = Math.sqrt(5 / 8);
    const vertices = [
      [0, 0, 0, 0],
      [1, 0, 0, 0],
      [0.5, rt3 / 2, 0, 0],
      [0.5, rt3 / 6, rt23, 0],
      [0.5, rt3 / 6, rt23 / 4, rt58],
    ];
    // The final coordinate completes the regular simplex; center it and give it toybox scale.
    vertices[4][2] = Math.sqrt(1 / 24);
    vertices[4][3] = Math.sqrt(5 / 8);
    const center = [0, 1, 2, 3].map((d) => vertices.reduce((s, v) => s + v[d], 0) / vertices.length);
    const scale = 2.12;
    for (const v of vertices) for (let d = 0; d < 4; d++) v[d] = (v[d] - center[d]) * scale;
    const all = vertices.map((_, i) => i);
    const edges = completeEdges(all);
    const facets = vertices.map((_, missing) => ({ edges: completeEdges(all.filter((i) => i !== missing)) }));
    return { vertices, edges, facets };
  }

  function crossPolytopeGeometry() {
    const vertices = [];
    for (let axis = 0; axis < 4; axis++) for (const sign of [-1, 1]) {
      const point = [0, 0, 0, 0]; point[axis] = sign * 1.35; vertices.push(point);
    }
    const edges = [];
    for (let i = 0; i < vertices.length; i++) for (let j = i + 1; j < vertices.length; j++) {
      if (dot(vertices[i], vertices[j]) === 0) edges.push([i, j]);
    }
    const facets = [];
    // Each tetrahedral facet chooses one pole from each of the four coordinate axes.
    for (let mask = 0; mask < 16; mask++) {
      const ids = [0, 1, 2, 3].map((axis) => axis * 2 + ((mask >> axis) & 1));
      facets.push({ edges: completeEdges(ids) });
    }
    return { vertices, edges, facets };
  }

  const geometries = {
    hypercube: hypercubeGeometry(),
    simplex: simplexGeometry(),
    cross: crossPolytopeGeometry(),
  };

  function makeBody(shape, index = 0) {
    return {
      shape, pos: [(index % 3 - 1) * 0.16, (index % 2 ? 0.23 : -0.08), 0.72 + (index % 3) * 0.18, 0],
      vel: [index ? (Math.random() - 0.5) * 1.3 : 0, (Math.random() - 0.5) * 0.6, index ? 1.1 + Math.random() * 0.8 : 0, 0],
      turn: Math.random() * Math.PI * 2, hue: index % 2 ? 1 : 0,
    };
  }

  state.bodies.push(makeBody("hypercube"));

  function rotate4(v, ax, ay, yz) {
    let [x, y, z, w] = v;
    let c = Math.cos(ax), s = Math.sin(ax);
    [x, w] = [x * c - w * s, x * s + w * c];
    c = Math.cos(ay); s = Math.sin(ay);
    [y, w] = [y * c - w * s, y * s + w * c];
    c = Math.cos(yz); s = Math.sin(yz);
    [y, z] = [y * c - z * s, y * s + z * c];
    return [x, y, z, w];
  }

  function transformedVertices(body, geom) {
    const size = body.shape === "hypercube" ? .68 : shapeInfo[body.shape].radius / 1.35;
    const bodyTurn = body.turn;
    const ax = state.xw + (state.spinning ? Math.sin(state.elapsed * 0.52 + bodyTurn) * 0.09 : 0);
    const ay = state.yw + (state.spinning ? Math.cos(state.elapsed * 0.37 + bodyTurn) * 0.08 : 0);
    const yz = state.spinning ? Math.sin(state.elapsed * 0.3 + bodyTurn) * 0.14 : 0;
    return geom.vertices.map((v) => {
      const r = rotate4(v.map((n) => n * size), ax, ay, yz);
      return [r[0] + body.pos[0], r[1] + body.pos[1], r[2] + body.pos[2], r[3] + body.pos[3]];
    });
  }

  function addUnique(points, p, eps = 1e-5) {
    if (!points.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < eps)) points.push(p);
  }

  function sliceEdge(a, b, plane) {
    const da = a[3] - plane, db = b[3] - plane;
    if (Math.abs(da) < 1e-7 && Math.abs(db) < 1e-7) return [a.slice(0, 3), b.slice(0, 3)];
    if (Math.abs(da) < 1e-7) return [a.slice(0, 3)];
    if (Math.abs(db) < 1e-7) return [b.slice(0, 3)];
    if (da * db > 0) return [];
    const t = da / (da - db);
    return [[0, 1, 2].map((d) => a[d] + (b[d] - a[d]) * t)];
  }

  function orderPolygon(points) {
    if (points.length < 3) return points;
    const center = [0, 1, 2].map((d) => points.reduce((sum, p) => sum + p[d], 0) / points.length);
    let normal = [0, 0, 0];
    for (let i = 1; i < points.length - 1 && length(normal) < 1e-6; i++) normal = cross(sub(points[i], points[0]), sub(points[i + 1], points[0]));
    if (length(normal) < 1e-8) return points;
    normal = normalize(normal);
    const u = normalize(sub(points[0], center));
    const v = cross(normal, u);
    return points.slice().sort((a, b) => {
      const aa = sub(a, center), bb = sub(b, center);
      return Math.atan2(dot(aa, v), dot(aa, u)) - Math.atan2(dot(bb, v), dot(bb, u));
    });
  }

  function polytopeSection(body) {
    const geom = geometries[body.shape];
    const vertices = transformedVertices(body, geom);
    const facets = [];
    const allPoints = [];
    for (const facet of geom.facets) {
      const points = [];
      for (const [ia, ib] of facet.edges) for (const p of sliceEdge(vertices[ia], vertices[ib], state.slice)) addUnique(points, p);
      if (points.length) for (const p of points) addUnique(allPoints, p);
      if (points.length >= 3) facets.push(orderPolygon(points));
    }
    return { facets, points: allPoints };
  }

  function sphereSection(body) {
    const diff = state.slice - body.pos[3];
    const radius4 = shapeInfo.hypersphere.radius;
    if (Math.abs(diff) >= radius4) return { facets: [], points: [], sphereRadius: 0 };
    const radius = Math.sqrt(Math.max(0, radius4 * radius4 - diff * diff));
    return { facets: [], points: [], sphereRadius: radius, center: body.pos.slice(0, 3) };
  }

  function project(point) {
    const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
    const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    const xx = point[0] * cy - point[1] * sy;
    const yy = point[0] * sy + point[1] * cy;
    const depth = point[2] * sp + yy * cp;
    const perspective = 4.5 / (4.5 + depth * 0.12);
    const scale = Math.min(state.width, state.height) * 0.355 * state.zoom * perspective;
    return { x: state.width * 0.5 + xx * scale, y: state.height * 0.455 - (point[2] * cp - yy * sp) * scale, depth, scale };
  }

  function rgb([r, g, b], alpha = 1) { return `rgba(${r}, ${g}, ${b}, ${alpha})`; }

  function drawBackdrop() {
    const w = state.width, h = state.height;
    const sky = ctx.createLinearGradient(0, 0, w * 0.7, h);
    sky.addColorStop(0, "#141a39"); sky.addColorStop(0.48, "#172444"); sky.addColorStop(1, "#11182f");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * .5, h * .44, 5, w * .5, h * .44, Math.min(w, h) * .55);
    glow.addColorStop(0, "#31536d23"); glow.addColorStop(.55, "#1a284010"); glow.addColorStop(1, "#11162d00");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    // Fine stars and registration marks give the section a quiet laboratory field.
    for (let i = 0; i < 56; i++) {
      const x = ((i * 173.3 + 31) % w), y = ((i * 89.7 + 19) % (h * .78));
      const a = .12 + ((i * 7) % 10) / 60;
      ctx.fillStyle = `rgba(194, 220, 240, ${a})`;
      ctx.beginPath(); ctx.arc(x, y, i % 9 === 0 ? 1.2 : .7, 0, Math.PI * 2); ctx.fill();
    }
    // A perspective grid on the floor anchors the freely moving slice in a toybox.
    ctx.save(); ctx.lineWidth = 1;
    for (let n = -6; n <= 6; n++) {
      const color = n === 0 ? "rgba(113, 204, 211, .16)" : "rgba(117, 164, 196, .08)";
      ctx.strokeStyle = color;
      let a = project([-3, n * .47, -1.48]), b = project([3, n * .47, -1.48]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      a = project([n * .47, -2.7, -1.48]); b = project([n * .47, 2.7, -1.48]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const horizon = project([0, 0, -1.48]).y;
    const floorFade = ctx.createLinearGradient(0, horizon - 40, 0, h);
    floorFade.addColorStop(0, "rgba(24, 43, 64, 0)"); floorFade.addColorStop(1, "rgba(9, 13, 29, .52)");
    ctx.fillStyle = floorFade; ctx.fillRect(0, horizon - 40, w, h - horizon + 40);
    ctx.restore();
    const crosshair = project([0, 0, -.5]);
    ctx.save(); ctx.globalAlpha = .2; ctx.strokeStyle = "#99bdd7"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(crosshair.x, crosshair.y, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(crosshair.x - 10, crosshair.y); ctx.lineTo(crosshair.x - 5, crosshair.y); ctx.moveTo(crosshair.x + 5, crosshair.y); ctx.lineTo(crosshair.x + 10, crosshair.y); ctx.stroke();
    ctx.restore();
  }

  function drawShadow(body, radius) {
    const p = project([body.pos[0], body.pos[1], -1.43]);
    const width = clamp(radius * p.scale * .92, 14, 150);
    const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, width);
    g.addColorStop(0, "rgba(3, 8, 22, .39)"); g.addColorStop(.55, "rgba(3, 8, 22, .19)"); g.addColorStop(1, "rgba(3, 8, 22, 0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y, width, width * .24, -.1, 0, Math.PI * 2); ctx.fill();
  }

  function drawPolytope(body, isSelected) {
    const shape = shapeInfo[body.shape];
    const section = polytopeSection(body);
    const opacity = isSelected ? .86 : .35;
    drawShadow(body, shape.radius);
    const faces = section.facets.map((poly) => {
      const projected = poly.map(project);
      return { poly, projected, depth: projected.reduce((s, p) => s + p.depth, 0) / projected.length };
    }).sort((a, b) => a.depth - b.depth);
    for (const face of faces) {
      const points = face.projected;
      if (points.length < 3) continue;
      const light = clamp(.57 + face.depth * .05, .43, .73);
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
      ctx.fillStyle = rgb(shape.color, opacity * .17 * light); ctx.fill();
      ctx.strokeStyle = rgb(shape.color, opacity * .43); ctx.lineWidth = isSelected ? 1.05 : .85; ctx.stroke();
    }
    const unique = section.points.map(project);
    ctx.save();
    ctx.globalAlpha = opacity;
    for (const p of unique) {
      const r = isSelected ? 2.3 : 1.7;
      ctx.beginPath(); ctx.fillStyle = rgb(shape.color, .95); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.fillStyle = "rgba(237, 249, 255, .8)"; ctx.arc(p.x - .5, p.y - .7, .8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (!section.points.length) drawGhost(body, shape);
  }

  function drawGhost(body, shape) {
    // Show the toy's projected 4D wireframe faintly while the movable section misses it.
    const geom = geometries[body.shape];
    const verts = transformedVertices(body, geom);
    const points = verts.map((v) => project(v));
    ctx.save(); ctx.strokeStyle = rgb(shape.color, .17); ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
    for (const [a, b] of geom.edges) {
      ctx.beginPath(); ctx.moveTo(points[a].x, points[a].y); ctx.lineTo(points[b].x, points[b].y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawHypersphere(body, isSelected) {
    const section = sphereSection(body), radius = section.sphereRadius;
    drawShadow(body, radius || .2);
    if (radius < .005) {
      if (Math.abs(state.slice - body.pos[3]) <= shapeInfo.hypersphere.radius + .025) {
        const p = project(section.center);
        ctx.save(); ctx.shadowColor = "#f9ac85"; ctx.shadowBlur = 25; ctx.fillStyle = "#ffd3a4";
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      return;
    }
    const nLat = 13, nLon = 22, verts = [];
    for (let lat = 0; lat <= nLat; lat++) {
      const phi = -Math.PI / 2 + Math.PI * lat / nLat;
      for (let lon = 0; lon <= nLon; lon++) {
        const theta = Math.PI * 2 * lon / nLon;
        verts.push([section.center[0] + radius * Math.cos(phi) * Math.cos(theta), section.center[1] + radius * Math.cos(phi) * Math.sin(theta), section.center[2] + radius * Math.sin(phi)]);
      }
    }
    const faces = [];
    for (let lat = 0; lat < nLat; lat++) for (let lon = 0; lon < nLon; lon++) {
      const a = lat * (nLon + 1) + lon, b = a + nLon + 1;
      for (const ids of [[a, b, a + 1], [a + 1, b, b + 1]]) {
        const ps = ids.map((i) => project(verts[i]));
        faces.push({ ps, depth: ps.reduce((s, p) => s + p.depth, 0) / 3 });
      }
    }
    faces.sort((a, b) => a.depth - b.depth);
    const color = shapeInfo.hypersphere.color;
    for (const face of faces) {
      const [a, b, c] = face.ps;
      const shade = clamp(.42 + face.depth * .07, .28, .74);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath();
      ctx.fillStyle = rgb(color, (isSelected ? .2 : .095) * shade); ctx.fill();
      ctx.strokeStyle = rgb(color, isSelected ? .11 : .055); ctx.lineWidth = .55; ctx.stroke();
    }
    const center = project(section.center), r = radius * center.scale;
    const glow = ctx.createRadialGradient(center.x - r * .27, center.y - r * .32, r * .08, center.x, center.y, r * 1.03);
    glow.addColorStop(0, "rgba(255, 218, 181, .35)"); glow.addColorStop(.35, "rgba(246, 164, 128, .09)"); glow.addColorStop(1, "rgba(238, 139, 116, .015)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(center.x, center.y, r, 0, Math.PI * 2); ctx.fill();
  }

  function drawBody(body, isSelected) {
    if (body.shape === "hypersphere") drawHypersphere(body, isSelected);
    else drawPolytope(body, isSelected);
  }

  function updatePhysics(dt) {
    if (state.paused || state.dragging) return;
    state.elapsed += dt;
    for (const body of state.bodies) {
      if (state.gravity) body.vel[2] -= 1.7 * dt;
      for (let d = 0; d < 4; d++) body.pos[d] += body.vel[d] * dt;
      body.vel = body.vel.map((v, i) => v * Math.pow(i === 2 ? .998 : .992, dt * 60));
      const bounds = [2.2, 2.0, 1.55, 2.25];
      const radius = body.shape === "hypercube" ? 1.36 : shapeInfo[body.shape].radius;
      for (let d = 0; d < 4; d++) {
        const low = d === 2 ? -1.48 + radius * .96 : -bounds[d];
        const high = bounds[d];
        if (body.pos[d] < low) { body.pos[d] = low; body.vel[d] = Math.abs(body.vel[d]) * (d === 2 ? .46 : .72); }
        if (body.pos[d] > high) { body.pos[d] = high; body.vel[d] = -Math.abs(body.vel[d]) * .74; }
      }
      body.turn += dt * (state.spinning ? .12 : 0);
    }
  }

  function draw() {
    const w = state.width, h = state.height;
    if (!w || !h) return;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawBackdrop();
    const sorted = state.bodies.slice().sort((a, b) => a.pos[1] - b.pos[1]);
    for (const body of sorted) drawBody(body, body === state.bodies[state.selected]);
    if (!state.bodies.length) drawEmptyState();
    updateUi();
  }

  function drawEmptyState() {
    const x = state.width / 2, y = state.height * .43;
    ctx.save(); ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(139, 176, 204, .28)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 37, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#9cb4c8"; ctx.font = "11px 'DM Mono', monospace"; ctx.fillText("THE BOX IS QUIET", x, y + 62);
    ctx.fillStyle = "#6e8299"; ctx.font = "9px 'DM Sans', sans-serif"; ctx.fillText("Add a toy to start exploring the fourth axis.", x, y + 81);
    ctx.restore();
  }

  function updateUi() {
    const count = String(state.bodies.length).padStart(2, "0");
    ui.toyCount.textContent = count;
    const body = state.bodies[state.selected];
    if (body) {
      const info = shapeInfo[body.shape];
      ui.caption.textContent = info.title;
      ui.worldLabel.innerHTML = `${String(state.selected + 1).padStart(2, "0")} &nbsp; ${info.label}`;
    } else {
      ui.caption.textContent = "EMPTY TOYBOX";
      ui.worldLabel.textContent = "NO TOYS IN THE BOX";
    }
    const val = fmt(state.slice);
    ui.sliceValue.textContent = `w = ${val}`;
    ui.sliceReadout.innerHTML = `W&nbsp; ${val}`;
    ui.xwOutput.textContent = `${Math.round(state.xw * 180 / Math.PI)}°`;
    ui.ywOutput.textContent = `${Math.round(state.yw * 180 / Math.PI)}°`;
    ui.zoom.textContent = `${Math.round(state.zoom * 100)}%`;
    ui.pauseText.textContent = state.paused ? "RESUME" : "PAUSE";
    ui.pauseSymbol.textContent = state.paused ? "▶" : "Ⅱ";
    ui.pause.setAttribute("aria-pressed", String(state.paused));
  }

  function resize() {
    const rect = wrap.getBoundingClientRect();
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = rect.width; state.height = rect.height;
    canvas.width = Math.max(1, Math.floor(rect.width * state.dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * state.dpr));
    canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
    draw();
  }

  function loop(now) {
    const dt = Math.min(.04, Math.max(0, (now - state.lastTime) / 1000));
    state.lastTime = now;
    updatePhysics(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function setShape(shape) {
    if (!shapeInfo[shape]) return;
    let body = state.bodies[state.selected];
    if (!body) {
      body = makeBody(shape, 0); state.bodies.push(body); state.selected = state.bodies.length - 1;
    } else {
      body.shape = shape; body.vel[2] = Math.max(body.vel[2], .35);
    }
    document.querySelectorAll(".shape-card").forEach((card) => {
      const selected = card.dataset.shape === shape;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    });
    playTick(600, .035);
  }

  function reflectSelectedShape(shape) {
    document.querySelectorAll(".shape-card").forEach((card) => {
      const selected = card.dataset.shape === shape;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    });
  }

  function addToy() {
    const selectedBody = state.bodies[state.selected];
    const shape = selectedBody ? selectedBody.shape : document.querySelector(".shape-card.selected")?.dataset.shape || "hypercube";
    const b = makeBody(shape, state.bodies.length);
    b.pos[0] = (Math.random() - .5) * 1.25;
    b.pos[1] = (Math.random() - .5) * 1.15;
    b.pos[2] = .55 + Math.random() * .65;
    b.pos[3] = (Math.random() - .5) * .55;
    b.vel = [(Math.random() - .5) * 1.4, (Math.random() - .5) * .9, 1.35 + Math.random() * 1.2, (Math.random() - .5) * .8];
    state.bodies.push(b); state.selected = state.bodies.length - 1;
    playTick(700, .055);
  }

  function resetToybox() {
    const current = state.bodies[state.selected];
    const shape = current?.shape || document.querySelector(".shape-card.selected")?.dataset.shape || "hypercube";
    state.bodies = [makeBody(shape)]; state.selected = 0; state.slice = 0;
    ui.slice.value = "0"; state.paused = false;
    document.querySelectorAll(".shape-card").forEach((card) => {
      const selected = card.dataset.shape === shape;
      card.classList.toggle("selected", selected); card.setAttribute("aria-pressed", String(selected));
    });
    playTick(430, .07);
  }

  function toggleSwitch(button, key) {
    state[key] = !state[key];
    button.classList.toggle("is-on", state[key]);
    button.setAttribute("aria-checked", String(state[key]));
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pickBody(point) {
    let closest = -1, distance = Infinity;
    state.bodies.forEach((body, i) => {
      const p = project(body.pos);
      const d = Math.hypot(point.x - p.x, point.y - p.y);
      if (d < distance) { closest = i; distance = d; }
    });
    const threshold = Math.max(42, Math.min(state.width, state.height) * .2 * state.zoom);
    return distance < threshold ? closest : -1;
  }

  function pointerDown(event) {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    const p = pointerPosition(event);
    const picked = pickBody(p);
    wrap.setPointerCapture(event.pointerId);
    state.pointer = { ...p, lastX: p.x, lastY: p.y, moved: false };
    if (picked >= 0) {
      state.selected = picked;
      const body = state.bodies[picked];
      reflectSelectedShape(body.shape);
      state.dragging = { index: picked, body, lastX: p.x, lastY: p.y, vx: 0, vz: 0 };
      body.vel = [0, 0, 0, 0];
      wrap.classList.add("dragging");
      ui.hint.classList.add("hidden"); state.hintSeen = true;
    } else {
      state.dragging = { orbit: true, lastX: p.x, lastY: p.y };
      wrap.classList.add("dragging");
    }
    event.preventDefault();
  }

  function pointerMove(event) {
    if (!state.pointer || !state.dragging) return;
    const p = pointerPosition(event);
    const dx = p.x - state.dragging.lastX, dy = p.y - state.dragging.lastY;
    if (Math.abs(p.x - state.pointer.x) + Math.abs(p.y - state.pointer.y) > 4) state.pointer.moved = true;
    if (state.dragging.orbit) {
      state.yaw += dx * .0065;
      state.pitch = clamp(state.pitch + dy * .0055, -.6, 1.05);
    } else {
      const drag = state.dragging;
      const centerX = state.width * .5, centerY = state.height * .455;
      const scale = Math.min(state.width, state.height) * .355 * state.zoom;
      drag.body.pos[0] = clamp((p.x - centerX) / scale, -2.15, 2.15);
      drag.body.pos[2] = clamp((centerY - p.y) / scale, -.65, 1.55);
      drag.body.pos[1] = .05;
      drag.vx = dx / scale * 14;
      drag.vz = -dy / scale * 14;
      drag.lastX = p.x; drag.lastY = p.y;
    }
    state.dragging.lastX = p.x; state.dragging.lastY = p.y;
    state.pointer.lastX = p.x; state.pointer.lastY = p.y;
  }

  function pointerUp(event) {
    if (!state.pointer) return;
    if (!state.dragging?.orbit) {
      const d = state.dragging;
      if (d?.body && state.pointer.moved) {
        d.body.vel[0] = clamp(d.vx, -5.2, 5.2);
        d.body.vel[2] = clamp(d.vz, -5.2, 5.2);
        d.body.vel[3] = clamp((state.pointer.lastX - state.pointer.x) * .01, -1.4, 1.4);
        playTick(760, .055);
      }
    }
    state.pointer = null; state.dragging = null; wrap.classList.remove("dragging");
    try { wrap.releasePointerCapture(event.pointerId); } catch (_) { /* capture may already be released */ }
  }

  function playTick(frequency = 520, duration = .04) {
    if (!state.soundOn) return;
    try {
      state.audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (state.audio.state === "suspended") state.audio.resume();
      const osc = state.audio.createOscillator(), gain = state.audio.createGain();
      osc.type = "sine"; osc.frequency.setValueAtTime(frequency, state.audio.currentTime);
      gain.gain.setValueAtTime(.018, state.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001, state.audio.currentTime + duration);
      osc.connect(gain); gain.connect(state.audio.destination); osc.start(); osc.stop(state.audio.currentTime + duration);
    } catch (_) { /* audio is optional */ }
  }

  document.querySelectorAll(".shape-card").forEach((card) => card.addEventListener("click", () => setShape(card.dataset.shape)));
  ui.slice.addEventListener("input", () => { state.slice = Number(ui.slice.value); });
  ui.xw.addEventListener("input", () => { state.xw = Number(ui.xw.value) * Math.PI / 180; });
  ui.yw.addEventListener("input", () => { state.yw = Number(ui.yw.value) * Math.PI / 180; });
  ui.pause.addEventListener("click", () => { state.paused = !state.paused; playTick(state.paused ? 390 : 560); });
  document.getElementById("resetButton").addEventListener("click", resetToybox);
  document.getElementById("addToyButton").addEventListener("click", addToy);
  document.getElementById("clearButton").addEventListener("click", () => { state.bodies = []; state.selected = 0; });
  ui.gravity.addEventListener("click", () => toggleSwitch(ui.gravity, "gravity"));
  ui.spin.addEventListener("click", () => toggleSwitch(ui.spin, "spinning"));
  document.getElementById("rotationReset").addEventListener("click", () => {
    state.xw = 18 * Math.PI / 180; state.yw = -12 * Math.PI / 180;
    ui.xw.value = "18"; ui.yw.value = "-12";
  });
  document.getElementById("zoomIn").addEventListener("click", () => { state.zoom = clamp(state.zoom * 1.12, .65, 1.8); });
  document.getElementById("zoomOut").addEventListener("click", () => { state.zoom = clamp(state.zoom / 1.12, .65, 1.8); });
  document.getElementById("fitView").addEventListener("click", () => { state.zoom = 1; state.yaw = -.26; state.pitch = .38; });
  document.getElementById("soundButton").addEventListener("click", (event) => {
    state.soundOn = !state.soundOn;
    event.currentTarget.classList.toggle("is-muted", !state.soundOn);
    event.currentTarget.setAttribute("aria-label", state.soundOn ? "Mute sound" : "Enable sound");
    if (state.soundOn) playTick(660, .08);
  });
  wrap.addEventListener("pointerdown", pointerDown);
  wrap.addEventListener("pointermove", pointerMove);
  wrap.addEventListener("pointerup", pointerUp);
  wrap.addEventListener("pointercancel", pointerUp);
  wrap.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.zoom = clamp(state.zoom * (event.deltaY > 0 ? .94 : 1.06), .65, 1.8);
  }, { passive: false });
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" && event.key === " ") return;
    if (event.code === "Space") { event.preventDefault(); state.paused = !state.paused; }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const dir = event.key === "ArrowLeft" ? -1 : 1;
      state.slice = clamp(state.slice + dir * (event.shiftKey ? .15 : .04), -2.2, 2.2);
      ui.slice.value = String(state.slice); event.preventDefault();
    }
  });

  resize();
  requestAnimationFrame(loop);
})();
