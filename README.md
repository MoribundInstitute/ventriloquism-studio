# 🎭 Ventriloquism Studio

**Make any photo talk.**

Ventriloquism Studio is a free, open-source desktop app that animates a still image in sync with an audio file — like a puppet whose jaw moves when it speaks. Point it at a photo, draw around the mouth, load a voice recording, and export a video. That's it.

---

## What It Does

You give it two things:

- **A still image** — a photo, illustration, portrait, anything with a face
- **An audio file** — a speech recording, a song, a podcast clip

It gives you back a **video** where the jaw/chin area of the image opens and closes in sync with the audio, like a talking puppet or ventriloquist dummy.

---

## How To Use It

### 1. Load Your Image
Click **Load Image** or drag and drop a photo onto the canvas. Supported formats: PNG, JPG, WEBP.

### 2. Load Your Audio
Click **Load Audio** or drag and drop a sound file. Supported formats: WAV, MP3, OGG, M4A, FLAC.

### 3. Draw the Jaw Mask
This is the only slightly tricky step — you need to tell the app *which part of the face moves*.

- **Click** around the chin/jaw area to place points
- The **first point you place** (shown in gold) is the **hinge** — the part that stays still while the jaw drops below it. Place it at the corners of the mouth.
- Work your way around the chin and back up to the first point
- When you get close to the first point, it will snap — **click it to close the shape**
- **Right-click** to undo your last point
- **Double-click** the canvas or press **Escape** to start over

> **Tip:** Trace only the chin/lower jaw — not the whole mouth. The top edge of your shape is treated as the hinge point.

### 4. Adjust the Physics (Optional)
Use the sliders to tune how the mouth moves:

| Slider | What It Does |
|---|---|
| **Animation Amount** | How wide the mouth opens overall |
| **Jaw Drop** | How far the chin physically drops down |
| **Response Curve** | Higher = snappier, punchier opening. Lower = smoother |
| **Silence Gate** | Cuts out tiny movements during quiet/silent moments |

### 5. Export
Click **Export Video**. Choose where to save it. The app will render every frame and mux it with your audio into a `.mkv` file ready to drop into any video editor.

---

## Installation

### Requirements
- [FFmpeg](https://ffmpeg.org/download.html) must be installed and available on your system PATH

### Download
Grab the latest release from the [Releases page](#) for your platform.

### Build From Source
If you'd rather build it yourself:

```bash
# Clone the repo
git clone https://github.com/yourname/ventriloquism.git
cd ventriloquism

# Install frontend dependencies
npm install

# Run in development mode
npm run tauri dev

# Build a release binary
npm run tauri build
```

You'll need [Node.js](https://nodejs.org) and [Rust](https://rustup.rs) installed to build from source.

---

## Tips For Best Results

- **Use a high contrast image** — photos with a clear distinction between the chin and neck work best
- **Trace tightly** — the tighter your mask, the more natural the movement looks
- **The hinge matters** — placing your first point at the corner of the mouth gives the most realistic jaw pivot
- **Silence Gate** is your friend — if the mouth is twitching when nobody's talking, raise this slider slightly
- **Response Curve** around 2.0 gives a natural "pop" — lower values make it feel more sluggish

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl + Z` | Undo last mask point |
| `Escape` | Clear the mask and start over |
| `Double-click` canvas | Clear a completed mask to redraw |
| `Right-click` canvas | Remove the last point while drawing |

---

## How It Works (For The Curious)

Under the hood, the app:

1. Runs your audio through a **bandpass filter** (80Hz–3500Hz) to isolate the speech frequencies that actually drive jaw movement
2. Calculates a per-frame **volume envelope** — essentially a number between 0 and 1 for how loud each frame of audio is
3. For each video frame, it takes your image, fills the masked jaw region with black, then **shifts the jaw pixels downward** by an amount proportional to that frame's volume
4. Pipes all the raw frames into **FFmpeg** which encodes them alongside the original audio into a finished video file

Everything runs locally on your machine. No internet connection, no accounts, no upload.

---

## License

MIT — free to use, modify, and distribute.

---

*Built with [Tauri](https://tauri.app), [Rust](https://rust-lang.org), and [FFmpeg](https://ffmpeg.org).*
