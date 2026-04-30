const { invoke, convertFileSrc } = window.__TAURI__.core;
const { open, save } = window.__TAURI__.dialog;
const { listen } = window.__TAURI__.event;

// --- APP STATE ---
let state = {
  imageObj: null,
  imagePath: null,
  audioPath: null,
  points: [],
  isClosed: false,
  hoverPos: null,
  scale: 1.0,
  offsetX: 0,
  offsetY: 0,
};

const SNAP_DIST = 14;

// --- DOM ELEMENTS ---
const canvas        = document.getElementById("viewport");
const ctx           = canvas.getContext("2d");
const placeholder   = document.querySelector(".placeholder-text");
const exportBtn     = document.getElementById("btn-export");
const progressWrap  = document.getElementById("progress-wrap");
const progressBar   = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");

// --- COORDINATE MATH ---
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
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// --- RENDERING ENGINE ---
let lastW = 0, lastH = 0;

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

  if (!state.imageObj) {
    requestAnimationFrame(draw);
    return;
  }

  const iw = state.imageObj.width;
  const ih = state.imageObj.height;

  state.scale = Math.min(cw / iw, ch / ih, 1.0);
  const dw = iw * state.scale;
  const dh = ih * state.scale;
  state.offsetX = (cw - dw) / 2;
  state.offsetY = (ch - dh) / 2;

  ctx.drawImage(state.imageObj, state.offsetX, state.offsetY, dw, dh);

  if (state.points.length > 0) {
    const start = imgToCanvas(state.points[0].x, state.points[0].y);

    // Polygon fill when closed
    if (state.isClosed) {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < state.points.length; i++) {
        const p = imgToCanvas(state.points[i].x, state.points[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(0, 229, 160, 0.12)";
      ctx.fill();
    }

    // Polygon outline
    ctx.strokeStyle = "#00e5a0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < state.points.length; i++) {
      const p = imgToCanvas(state.points[i].x, state.points[i].y);
      ctx.lineTo(p.x, p.y);
    }
    if (state.isClosed) ctx.lineTo(start.x, start.y);
    ctx.stroke();

    // Vertex dots
    for (let i = 0; i < state.points.length; i++) {
      const p = imgToCanvas(state.points[i].x, state.points[i].y);
      const isFirst = i === 0;
      ctx.fillStyle = isFirst ? "#f5c542" : "#00e5a0";
      ctx.beginPath();
      ctx.arc(p.x, p.y, isFirst ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Rubber-band line while drawing
  if (!state.isClosed && state.points.length > 0 && state.hoverPos) {
    const last = imgToCanvas(
      state.points[state.points.length - 1].x,
      state.points[state.points.length - 1].y
    );
    const first = imgToCanvas(state.points[0].x, state.points[0].y);
    const isSnapping =
      state.points.length >= 3 && dist(state.hoverPos, first) <= SNAP_DIST;

    ctx.strokeStyle = isSnapping ? "#f5c542" : "#666680";
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

// --- CANVAS EVENTS ---
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  state.hoverPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
});

canvas.addEventListener("mouseleave", () => {
  state.hoverPos = null;
});

canvas.addEventListener("mousedown", (e) => {
  if (!state.imageObj || state.isClosed) return;

  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  if (e.button === 2) {
    state.points.pop();
    return;
  }

  if (state.points.length >= 3) {
    const first = imgToCanvas(state.points[0].x, state.points[0].y);
    if (dist({ x: cx, y: cy }, first) <= SNAP_DIST) {
      state.isClosed = true;
      return;
    }
  }

  state.points.push(canvasToImg(cx, cy));
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("dblclick", () => {
  if (state.isClosed) resetMask();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") resetMask();
  if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!state.isClosed) state.points.pop();
  }
});

function resetMask() {
  state.points = [];
  state.isClosed = false;
}

// --- FILE PROCESSORS ---
function processImage(path) {
  try {
    state.imagePath = path;
    const img = new Image();
    img.onload = () => {
      state.imageObj = img;
      resetMask();
      if (placeholder) placeholder.style.display = "none";
    };
    img.onerror = () => console.error("Failed to load image:", path);
    img.src = convertFileSrc(path);
  } catch (error) {
    console.error("Failed to process image:", error);
  }
}

function processAudio(path) {
  state.audioPath = path;
  const audBtn = document.getElementById("btn-load-audio");
  if (audBtn) {
    audBtn.textContent = "🎵 Audio Loaded!";
    audBtn.title = path;
  }
}

// --- PROGRESS BAR ---
function setProgress(pct) {
  progressWrap.style.display = "block";
  progressBar.style.width = pct + "%";
  progressLabel.textContent = pct + "%";
  if (pct >= 100) {
    setTimeout(() => {
      progressWrap.style.display = "none";
      progressBar.style.width = "0%";
      progressLabel.textContent = "0%";
    }, 1500);
  }
}

function setExportBusy(busy) {
  exportBtn.textContent = busy ? "⏳ Exporting..." : "🎬 Export Video";
  exportBtn.style.pointerEvents = busy ? "none" : "auto";
  exportBtn.style.opacity = busy ? "0.6" : "1";
  if (busy) {
    progressBar.style.width = "0%";
    progressLabel.textContent = "0%";
    progressWrap.style.display = "block";
  }
}

// --- UI BINDINGS ---
window.addEventListener("DOMContentLoaded", () => {
  requestAnimationFrame(draw);

  // Listen for progress events from Rust
  listen("export-progress", (event) => {
    setProgress(event.payload);
  }).catch((e) => console.error("Progress listener failed:", e));

  const bindSlider = (id, valId) => {
    const s = document.getElementById(id);
    const l = document.getElementById(valId);
    if (s && l) s.addEventListener("input", (e) => {
      l.textContent = parseFloat(e.target.value).toFixed(2);
    });
  };
  bindSlider("slider-anim", "val-anim");
  bindSlider("slider-drop", "val-drop");
  bindSlider("slider-power", "val-power");
  bindSlider("slider-gate", "val-gate");

  document.getElementById("btn-load-image").addEventListener("click", async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (path) processImage(path);
    } catch (e) {
      console.error("Image dialog error:", e);
    }
  });

  document.getElementById("btn-load-audio").addEventListener("click", async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "ogg", "flac"] }],
      });
      if (path) processAudio(path);
    } catch (e) {
      console.error("Audio dialog error:", e);
    }
  });

  // Drag and drop
  listen("tauri://file-drop", (event) => {
    const paths = event.payload.paths ?? event.payload;
    if (!paths?.length) return;
    const path = paths[0];
    const ext = path.split(".").pop().toLowerCase();
    if (["png", "jpg", "jpeg", "webp"].includes(ext)) processImage(path);
    else if (["wav", "mp3", "m4a", "ogg", "flac"].includes(ext)) processAudio(path);
  }).catch((e) => console.error("Drag & drop listener failed:", e));

  // Export
  exportBtn.addEventListener("click", async () => {
    if (!state.imagePath || !state.audioPath) {
      return alert("Load an image and audio file first.");
    }
    if (state.points.length < 3 || !state.isClosed) {
      return alert("Please draw and close the jaw mask first.");
    }

    try {
      const outPath = await save({
        filters: [{ name: "Video", extensions: ["mkv", "mp4"] }],
        defaultPath: "output.mkv",
      });
      if (!outPath) return;

      setExportBusy(true);

      const response = await invoke("export_video", {
        imagePath: state.imagePath,
        audioPath: state.audioPath,
        outPath,
        points: state.points,
        animAmount: parseFloat(document.getElementById("slider-anim").value),
        jawDrop:    parseFloat(document.getElementById("slider-drop").value),
        power:      parseFloat(document.getElementById("slider-power").value),
        gate:       parseFloat(document.getElementById("slider-gate").value),
        smoothing:  0.15,
        fps:        24,
        crf:        20,
        innerColorHex: "#000000",
      });

      alert("Export complete!\nSaved to: " + response);
    } catch (e) {
      console.error("Export failed:", e);
      alert("Export failed:\n" + e);
    } finally {
      setExportBusy(false);
    }
  });
});