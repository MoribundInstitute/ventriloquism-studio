const { invoke, convertFileSrc } = window.__TAURI__.core;
const { open, save } = window.__TAURI__.dialog;
const { listen } = window.__TAURI__.event;

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("btn-theme");
  if (btn) {
    btn.textContent = theme === "light" ? "☾" : "☀";
    btn.title = btn.ariaLabel = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  }
  localStorage.setItem("theme", theme);
}

applyTheme(
  localStorage.getItem("theme") ||
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
);

const SNAP_DIST = 14;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 20.0;
const ZOOM_FACTOR = 1.12;

let state = {
  imageObj: null,
  imagePath: null,
  audioPath: null,
  audioDuration: 0,
  points: [],
  isClosed: false,
  hoverPos: null,
  scale: 1.0,
  offsetX: 0,
  offsetY: 0,
  zoomLevel: 1.0,
  panX: 0,
  panY: 0,
  panLast: null,
  previewActive: false,
  previewImage: null,
  previewUrl: null,
  exporting: false,
};

const canvas = document.getElementById("viewport");
const ctx = canvas.getContext("2d");
const placeholder = document.querySelector(".placeholder-text");
const exportBtn = document.getElementById("btn-export");
const cancelBtn = document.getElementById("btn-cancel");
const progressWrap = document.getElementById("progress-wrap");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const statusbar = document.getElementById("statusbar");
const imgLabel = document.getElementById("img-label");
const audLabel = document.getElementById("aud-label");
const maskLabel = document.getElementById("mask-label");

function setStatus(msg, tone = "") {
  statusbar.textContent = msg;
  statusbar.className = "statusbar" + (tone ? ` ${tone}` : "");
}

function basename(path) {
  return path.split(/[/\\]/).pop();
}

function canvasToImg(cx, cy) {
  return {
    x: (cx - state.offsetX) / state.scale,
    y: (cy - state.offsetY) / state.scale,
  };
}

function imgToCanvas(ix, iy) {
  return {
    x: ix * state.scale + state.offsetX,
    y: iy * state.scale + state.offsetY,
  };
}

function dist(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clearPreview() {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
  state.previewImage = null;
  state.previewActive = false;
}

function updateMaskLabel() {
  const n = state.points.length;
  maskLabel.className = "file-label italic";
  if (n === 0) {
    maskLabel.textContent = "No points placed";
  } else if (!state.isClosed) {
    maskLabel.textContent = `${n} point${n !== 1 ? "s" : ""} — not closed`;
    maskLabel.classList.add("warn");
  } else {
    maskLabel.textContent = `✓ Closed mask (${n} pts)`;
    maskLabel.classList.add("ok");
  }
}

function resetMask() {
  state.points = [];
  state.isClosed = false;
  clearPreview();
  updateMaskLabel();
}

function resetZoom() {
  state.zoomLevel = 1.0;
  state.panX = 0;
  state.panY = 0;
  setStatus("Zoom reset to fit.");
}

function getPhysicsParams() {
  return {
    animAmount: parseFloat(document.getElementById("slider-anim").value),
    jawDrop: parseFloat(document.getElementById("slider-drop").value),
    power: parseFloat(document.getElementById("slider-power").value),
    gate: parseFloat(document.getElementById("slider-gate").value),
    sensitivity: parseFloat(document.getElementById("slider-sensitivity").value),
    smoothing: parseFloat(document.getElementById("slider-smooth").value),
    fLow: parseFloat(document.getElementById("slider-flo").value),
    fHigh: parseFloat(document.getElementById("slider-fhi").value),
    offsetFrames: parseInt(document.getElementById("input-offset").value, 10) || 0,
    fps: parseInt(document.getElementById("select-fps").value, 10),
    crf: parseInt(document.getElementById("slider-crf").value, 10),
    innerColorHex: document.getElementById("input-color").value,
  };
}

let lastW = 0;
let lastH = 0;

function draw() {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (cw !== lastW || ch !== lastH) {
    canvas.width = cw;
    canvas.height = ch;
    lastW = cw;
    lastH = ch;
  }

  ctx.clearRect(0, 0, cw, ch);

  const source = state.previewActive && state.previewImage
    ? state.previewImage
    : state.imageObj;

  if (!source) {
    requestAnimationFrame(draw);
    return;
  }

  const iw = source.width;
  const ih = source.height;
  const baseScale = Math.min(cw / iw, ch / ih);
  state.scale = baseScale * state.zoomLevel;
  const dw = iw * state.scale;
  const dh = ih * state.scale;
  state.offsetX = (cw - dw) / 2 + state.panX;
  state.offsetY = (ch - dh) / 2 + state.panY;

  ctx.drawImage(source, state.offsetX, state.offsetY, dw, dh);

  if (!state.previewActive && state.points.length > 0) {
    const start = imgToCanvas(state.points[0].x, state.points[0].y);

    if (state.isClosed) {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < state.points.length; i++) {
        const p = imgToCanvas(state.points[i].x, state.points[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(65, 201, 240, 0.12)";
      ctx.fill();
    }

    ctx.strokeStyle = "#41c9f0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < state.points.length; i++) {
      const p = imgToCanvas(state.points[i].x, state.points[i].y);
      ctx.lineTo(p.x, p.y);
    }
    if (state.isClosed) ctx.lineTo(start.x, start.y);
    ctx.stroke();

    for (let i = 0; i < state.points.length; i++) {
      const p = imgToCanvas(state.points[i].x, state.points[i].y);
      const isFirst = i === 0;
      ctx.fillStyle = isFirst ? "#b9a8e8" : "#41c9f0";
      ctx.beginPath();
      ctx.arc(p.x, p.y, isFirst ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (!state.isClosed && state.points.length > 0 && state.hoverPos && !state.previewActive) {
    const last = imgToCanvas(
      state.points[state.points.length - 1].x,
      state.points[state.points.length - 1].y
    );
    const first = imgToCanvas(state.points[0].x, state.points[0].y);
    const isSnapping =
      state.points.length >= 3 && dist(state.hoverPos, first) <= SNAP_DIST;

    ctx.strokeStyle = isSnapping ? "#b9a8e8" : "#8d84ad";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(
      isSnapping ? first.x : state.hoverPos.x,
      isSnapping ? first.y : state.hoverPos.y
    );
    ctx.stroke();
    ctx.setLineDash([]);
  }

  requestAnimationFrame(draw);
}

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  state.hoverPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
});

canvas.addEventListener("mouseleave", () => {
  state.hoverPos = null;
});

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 1) {
    state.panLast = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = "grab";
    e.preventDefault();
    return;
  }

  if (!state.imageObj || state.isClosed || state.previewActive) return;

  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  if (e.button === 2) {
    undoPoint();
    return;
  }

  if (state.points.length >= 3) {
    const first = imgToCanvas(state.points[0].x, state.points[0].y);
    if (dist({ x: cx, y: cy }, first) <= SNAP_DIST) {
      closeMask();
      return;
    }
  }

  const pt = canvasToImg(cx, cy);
  const iw = state.imageObj.width;
  const ih = state.imageObj.height;
  state.points.push({
    x: Math.max(0, Math.min(pt.x, iw - 1)),
    y: Math.max(0, Math.min(pt.y, ih - 1)),
  });
  clearPreview();
  updateMaskLabel();
});

canvas.addEventListener("mousemove", (e) => {
  if (state.panLast !== null && state.imageObj) {
    const dx = e.clientX - state.panLast.x;
    const dy = e.clientY - state.panLast.y;
    state.panX += dx;
    state.panY += dy;
    state.panLast = { x: e.clientX, y: e.clientY };
  }
});

canvas.addEventListener("mouseup", (e) => {
  if (e.button === 1) {
    state.panLast = null;
    canvas.style.cursor = "crosshair";
  }
});

canvas.addEventListener("wheel", (e) => {
  if (!state.imageObj) return;
  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
  const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.zoomLevel * factor));
  if (newZoom === state.zoomLevel) return;

  const ix = (cx - state.offsetX) / state.scale;
  const iy = (cy - state.offsetY) / state.scale;
  state.zoomLevel = newZoom;

  const iw = state.imageObj.width;
  const ih = state.imageObj.height;
  const baseScale = Math.min(canvas.clientWidth / iw, canvas.clientHeight / ih);
  const newScale = baseScale * state.zoomLevel;
  const dw = iw * newScale;
  const dh = ih * newScale;

  state.panX = cx - ix * newScale - (canvas.clientWidth - dw) / 2;
  state.panY = cy - iy * newScale - (canvas.clientHeight - dh) / 2;

  setStatus(`Zoom: ${Math.round(state.zoomLevel * 100)}% (scroll to zoom, MMB-drag to pan)`);
}, { passive: false });

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("dblclick", () => {
  if (!state.imageObj || state.isClosed || state.previewActive) return;
  if (state.points.length > 0) state.points.pop();
  closeMask();
});

function closeMask() {
  if (state.points.length < 3) {
    setStatus("Need at least 3 points to close mask.", "warn");
    return;
  }
  state.isClosed = true;
  clearPreview();
  updateMaskLabel();
  setStatus(`Mask closed — ${state.points.length} points.`, "ok");
}

function undoPoint() {
  if (state.isClosed) {
    state.isClosed = false;
    setStatus("Mask reopened — add or remove points, then close again.");
  } else if (state.points.length) {
    state.points.pop();
  }
  clearPreview();
  updateMaskLabel();
}

function processImage(path) {
  try {
    state.imagePath = path;
    const img = new Image();
    img.onload = () => {
      state.imageObj = img;
      resetMask();
      resetZoom();
      if (placeholder) placeholder.style.display = "none";
      imgLabel.textContent = `${basename(path)}\n${img.width}×${img.height} px`;
      imgLabel.className = "file-label loaded";
      setStatus(`Image loaded: ${basename(path)} (${img.width}×${img.height})`, "ok");
    };
    img.onerror = () => {
      setStatus("Failed to load image.", "error");
    };
    img.src = convertFileSrc(path);
  } catch (error) {
    setStatus("Failed to process image.", "error");
    console.error(error);
  }
}

function processAudio(path) {
  state.audioPath = path;
  const audio = new Audio(convertFileSrc(path));
  audio.addEventListener("loadedmetadata", () => {
    state.audioDuration = audio.duration;
    audLabel.textContent = `${basename(path)}\n${audio.duration.toFixed(1)}s`;
    audLabel.className = "file-label loaded";
    setStatus(`Audio loaded: ${basename(path)} (${audio.duration.toFixed(1)}s)`, "ok");
  });
  audio.addEventListener("error", () => {
    audLabel.textContent = `${basename(path)} (loaded)`;
    audLabel.className = "file-label loaded";
    setStatus(`Audio loaded: ${basename(path)}`, "ok");
  });
}

function setProgress(pct, label) {
  progressWrap.style.display = "block";
  progressBar.style.width = pct + "%";
  progressLabel.textContent = label || `${pct}%`;
}

function setExportBusy(busy) {
  state.exporting = busy;
  exportBtn.disabled = busy;
  cancelBtn.disabled = !busy;
  exportBtn.textContent = busy ? "Exporting…" : "Export Video";
  if (busy) {
    progressBar.style.width = "0%";
    progressLabel.textContent = "Starting…";
    progressWrap.style.display = "block";
  }
}

async function previewFrame() {
  if (!state.imagePath) {
    setStatus("Load an image first.", "warn");
    return;
  }
  if (state.points.length < 3 || !state.isClosed) {
    setStatus("Draw and close the jaw mask first.", "warn");
    return;
  }

  if (state.previewActive) {
    clearPreview();
    setStatus("Preview cleared — showing original image.");
    return;
  }

  try {
    setStatus("Rendering preview at 75% amplitude…");
    const params = getPhysicsParams();
    const bytes = await invoke("preview_frame", {
      imagePath: state.imagePath,
      points: state.points,
      amplitude: 0.75,
      jawDrop: params.jawDrop,
      innerColorHex: params.innerColorHex,
    });

    const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
    clearPreview();
    state.previewUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      state.previewImage = img;
      state.previewActive = true;
      setStatus("Preview rendered at 75% amplitude. Click Preview again to exit.", "ok");
    };
    img.src = state.previewUrl;
  } catch (e) {
    setStatus("Preview failed: " + e, "error");
    console.error(e);
  }
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.previewActive) {
      clearPreview();
      setStatus("Preview cleared.");
    } else {
      resetMask();
      setStatus("Mask cleared.");
    }
  }
  if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    undoPoint();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  requestAnimationFrame(draw);
  updateMaskLabel();

  listen("export-progress", (event) => {
    setProgress(event.payload, `Rendering… ${event.payload}%`);
  }).catch((e) => console.error("Progress listener failed:", e));

  const bindSlider = (id, valId, fmt) => {
    const s = document.getElementById(id);
    const l = document.getElementById(valId);
    if (!s || !l) return;
    const update = () => {
      l.textContent = fmt(parseFloat(s.value));
      const pct = ((s.value - s.min) / (s.max - s.min)) * 100;
      s.style.setProperty("--fill", pct + "%");
      if (state.previewActive) clearPreview();
    };
    s.addEventListener("input", update);
    update();
  };

  bindSlider("slider-anim", "val-anim", (v) => v.toFixed(2));
  bindSlider("slider-sensitivity", "val-sensitivity", (v) => v.toFixed(2) + "x");
  bindSlider("slider-drop", "val-drop", (v) => v.toFixed(2));
  bindSlider("slider-power", "val-power", (v) => v.toFixed(2));
  bindSlider("slider-gate", "val-gate", (v) => v.toFixed(3));
  bindSlider("slider-smooth", "val-smooth", (v) => v.toFixed(2));
  bindSlider("slider-flo", "val-flo", (v) => Math.round(v) + " Hz");
  bindSlider("slider-fhi", "val-fhi", (v) => Math.round(v) + " Hz");
  bindSlider("slider-crf", "val-crf", (v) => String(Math.round(v)));

  document.getElementById("input-color").addEventListener("input", () => {
    if (state.previewActive) clearPreview();
  });

  document.getElementById("btn-load-image").addEventListener("click", async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "tiff"] }],
      });
      if (path) processImage(path);
    } catch (e) {
      console.error(e);
    }
  });

  document.getElementById("btn-load-audio").addEventListener("click", async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "ogg", "flac", "aac"] }],
      });
      if (path) processAudio(path);
    } catch (e) {
      console.error(e);
    }
  });

  document.getElementById("btn-theme").addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  });

  document.getElementById("btn-close-mask").addEventListener("click", closeMask);
  document.getElementById("btn-undo-mask").addEventListener("click", undoPoint);
  document.getElementById("btn-clear-mask").addEventListener("click", () => {
    resetMask();
    setStatus("Mask cleared.");
  });
  document.getElementById("btn-preview").addEventListener("click", previewFrame);
  document.getElementById("btn-reset-zoom").addEventListener("click", resetZoom);

  cancelBtn.addEventListener("click", async () => {
    try {
      await invoke("cancel_export");
      progressLabel.textContent = "Cancelling…";
      setStatus("Cancelling export…", "warn");
    } catch (e) {
      console.error(e);
    }
  });

  listen("tauri://file-drop", (event) => {
    const paths = event.payload.paths ?? event.payload;
    if (!paths?.length) return;
    const path = paths[0];
    const ext = path.split(".").pop().toLowerCase();
    if (["png", "jpg", "jpeg", "webp", "bmp", "tiff"].includes(ext)) processImage(path);
    else if (["wav", "mp3", "m4a", "ogg", "flac", "aac"].includes(ext)) processAudio(path);
    else setStatus(`Unsupported file type: .${ext}`, "warn");
  }).catch((e) => console.error("Drag & drop listener failed:", e));

  exportBtn.addEventListener("click", async () => {
    if (!state.imagePath || !state.audioPath) {
      setStatus("Load an image and audio file first.", "warn");
      return;
    }
    if (state.points.length < 3 || !state.isClosed) {
      setStatus("Draw and close the jaw mask first.", "warn");
      return;
    }

    try {
      const outPath = await save({
        filters: [{ name: "Video", extensions: ["mkv", "mp4"] }],
        defaultPath: "output.mkv",
      });
      if (!outPath) return;

      setExportBusy(true);
      clearPreview();

      const p = getPhysicsParams();
      const response = await invoke("export_video", {
        imagePath: state.imagePath,
        audioPath: state.audioPath,
        outPath,
        points: state.points,
        animAmount: p.animAmount,
        jawDrop: p.jawDrop,
        power: p.power,
        gate: p.gate,
        sensitivity: p.sensitivity,
        smoothing: p.smoothing,
        fLow: p.fLow,
        fHigh: p.fHigh,
        offsetFrames: p.offsetFrames,
        fps: p.fps,
        crf: p.crf,
        innerColorHex: p.innerColorHex,
      });

      setProgress(100, "✔ Export complete!");
      setStatus(`Exported: ${basename(outPath)}`, "ok");
      console.log(response);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("cancelled")) {
        setProgress(0, "Cancelled.");
        setStatus("Export cancelled.", "warn");
      } else {
        setProgress(0, "Export failed.");
        setStatus("Export failed: " + msg, "error");
        console.error(e);
      }
    } finally {
      setExportBusy(false);
    }
  });
});