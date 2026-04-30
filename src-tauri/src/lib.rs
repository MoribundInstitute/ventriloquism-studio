use image::{DynamicImage, GenericImageView, ImageBuffer, Rgba};
use serde::Deserialize;
use std::f64::consts::PI;
use std::io::Write;
use std::process::{Command, Stdio};
use std::io::Read;
use tauri::Emitter;

#[derive(Deserialize, Clone, Copy)]
pub struct Point {
    x: f32,
    y: f32,
}

fn hex_to_rgba(hex: &str) -> Rgba<u8> {
    let hex = hex.trim_start_matches('#');
    if hex.len() == 6 {
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
        let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
        let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
        Rgba([r, g, b, 255])
    } else {
        Rgba([0, 0, 0, 255])
    }
}

// --- 1. IMAGE MASKING (RAY-CASTING) ---
fn is_point_in_polygon(px: f32, py: f32, poly: &[Point]) -> bool {
    let mut inside = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        if ((poly[i].y > py) != (poly[j].y > py))
            && (px < (poly[j].x - poly[i].x) * (py - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn render_frame_puppet(
    base_img: &DynamicImage,
    points: &[Point],
    amplitude: f64,
    jaw_drop_pct: f64,
    inner_color: Rgba<u8>,
) -> ImageBuffer<Rgba<u8>, Vec<u8>> {
    let (width, height) = base_img.dimensions();
    let mut result = base_img.to_rgba8();
    if points.len() < 3 || amplitude <= 0.001 { return result; }

    let mut min_y = points[0].y;
    let mut max_y = points[0].y;
    for p in points {
        if p.y < min_y { min_y = p.y; }
        if p.y > max_y { max_y = p.y; }
    }

    let mask_height = (max_y - min_y).max(1.0) as f64;
    let drop_pixels = (mask_height * jaw_drop_pct * amplitude).round() as u32;
    if drop_pixels < 1 { return result; }

    // Pass 1: fill the entire mask region with inner_color
    for y in 0..height {
        for x in 0..width {
            if is_point_in_polygon(x as f32, y as f32, points) {
                result.put_pixel(x, y, inner_color);
            }
        }
    }

    // Pass 2: shift jaw pixels DOWN — iterate bottom-to-top to avoid
    // overwriting pixels we haven't shifted yet
    for y in (0..height).rev() {
        for x in 0..width {
            if is_point_in_polygon(x as f32, y as f32, points) {
                let shifted_y = y + drop_pixels;
                if shifted_y < height {
                    let original_pixel = base_img.get_pixel(x, y);
                    if original_pixel[3] > 0 {
                        result.put_pixel(x, shifted_y, original_pixel);
                    }
                }
            }
        }
    }

    result
}

// --- 2. AUDIO ENVELOPE MATH ---
fn gaussian_blur_1d(data: &[f64], sigma: f64) -> Vec<f64> {
    if sigma <= 0.0 { return data.to_vec(); }
    let radius = (sigma * 3.0).ceil() as i32;
    let mut kernel = Vec::new();
    let mut sum = 0.0;
    for i in -radius..=radius {
        let x = i as f64;
        let val = (-x * x / (2.0 * sigma * sigma)).exp();
        kernel.push(val);
        sum += val;
    }
    for k in &mut kernel { *k /= sum; }
    let mut out = vec![0.0; data.len()];
    for i in 0..data.len() {
        let mut v = 0.0;
        for j in -radius..=radius {
            let idx = (i as i32 + j).clamp(0, data.len() as i32 - 1) as usize;
            v += data[idx] * kernel[(j + radius) as usize];
        }
        out[i] = v;
    }
    out
}

struct Biquad {
    b0: f64, b1: f64, b2: f64, a1: f64, a2: f64, x1: f64, x2: f64, y1: f64, y2: f64,
}

impl Biquad {
    fn bandpass(fs: f64, f_low: f64, f_high: f64) -> Self {
        let f0 = (f_low * f_high).sqrt();
        let bw = (f_high - f_low) / f0;
        let w0 = 2.0 * PI * f0 / fs;
        let alpha = w0.sin() * (2.0f64.ln() / 2.0 * bw * w0 / w0.sin()).sinh();
        let a0 = 1.0 + alpha;
        Self {
            b0: alpha / a0, b1: 0.0, b2: -alpha / a0, a1: -2.0 * w0.cos() / a0, a2: (1.0 - alpha) / a0,
            x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0,
        }
    }
    fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1; self.x1 = x; self.y2 = self.y1; self.y1 = y;
        y
    }
}

pub fn get_envelope(audio: &[f64], sr: u32, fps: u32, smoothing: f64, anim: f64, power: f64, gate: f64) -> Vec<f64> {
    let mut bq = Biquad::bandpass(sr as f64, 80.0, 3500.0);
    let mut filtered: Vec<f64> = audio.iter().map(|&x| bq.process(x)).collect();
    filtered.reverse();
    let mut bq_rev = Biquad::bandpass(sr as f64, 80.0, 3500.0);
    filtered = filtered.into_iter().map(|x| bq_rev.process(x)).collect();
    filtered.reverse();

    let spf = sr as f64 / fps as f64;
    let n_frames = (audio.len() as f64 / spf).ceil() as usize;
    let mut env = vec![0.0; n_frames];
    for i in 0..n_frames {
        let start = (i as f64 * spf) as usize;
        let end = ((start as f64 + spf).min(filtered.len() as f64)) as usize;
        if start < end {
            let mut sum_sq = 0.0;
            for j in start..end { sum_sq += filtered[j] * filtered[j]; }
            env[i] = (sum_sq / (end - start) as f64).sqrt();
        }
    }
    let mx = env.iter().cloned().fold(0.0, f64::max);
    if mx > 0.0 { for v in &mut env { *v /= mx; } }
    for v in &mut env {
        if *v < gate { *v = 0.0; } else { *v = (*v - gate) / (1.0 - gate + 1e-6); }
        *v = v.clamp(0.0, 1.0).powf(power) * anim;
    }
    if smoothing > 0.0 { env = gaussian_blur_1d(&env, smoothing * 8.0); }
    env
}

// --- 3. EXPORT COMMAND ---
#[tauri::command]
async fn export_video(
    app: tauri::AppHandle,
    image_path: String, audio_path: String, out_path: String,
    points: Vec<Point>, anim_amount: f64, jaw_drop: f64,
    power: f64, gate: f64, smoothing: f64, fps: u32, crf: u32, inner_color_hex: String,
) -> Result<String, String> {

    // Default to .mkv if no extension provided
    let out_path = if std::path::Path::new(&out_path).extension().is_none() {
        format!("{}.mkv", out_path)
    } else {
        out_path
    };

    // Convert audio to WAV
    let temp_file = tempfile::Builder::new().suffix(".wav").tempfile().map_err(|e| e.to_string())?;
    let temp_path = temp_file.path().to_str().unwrap().to_string();

    let ffmpeg_convert = Command::new("ffmpeg")
        .args(["-y", "-i", &audio_path, "-ar", "44100", "-ac", "1", &temp_path])
        .output()
        .map_err(|e| format!("Failed to launch ffmpeg for audio conversion: {}", e))?;

    if !ffmpeg_convert.status.success() {
        return Err(format!(
            "Audio conversion failed:\n{}",
            String::from_utf8_lossy(&ffmpeg_convert.stderr)
        ));
    }

    // Read audio data
    let mut reader = hound::WavReader::open(&temp_path).map_err(|e| e.to_string())?;
    let spec = reader.spec();
    let audio_data: Vec<f64> = reader.samples::<i16>().map(|s| s.unwrap() as f64 / 32768.0).collect();
    drop(reader);

    let base_img = image::open(&image_path).map_err(|e| e.to_string())?;
    let (width, height) = base_img.dimensions();
    let env = get_envelope(&audio_data, spec.sample_rate, fps, smoothing, anim_amount, power, gate);

    // Spawn FFmpeg with stderr piped so we can capture its real error messages
    let mut child = Command::new("ffmpeg")
        .args([
            "-y", "-f", "rawvideo", "-vcodec", "rawvideo", "-s", &format!("{}x{}", width, height),
            "-pix_fmt", "rgba", "-r", &fps.to_string(), "-i", "-", "-i", &audio_path,
            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
            "-c:v", "libx264", "-crf", &crf.to_string(), "-preset", "fast",
            "-c:a", "aac", "-shortest",
            "-f", "matroska",
            &out_path,
        ])
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch ffmpeg for encoding: {}", e))?;

    // Read stderr on a background thread so it doesn't block if the pipe buffer fills
    let mut stderr_handle = child.stderr.take().unwrap();
    let stderr_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr_handle.read_to_string(&mut buf);
        buf
    });

    let mut stdin = child.stdin.take().unwrap();
    let mouth_color = hex_to_rgba(&inner_color_hex);
    let mut write_error: Option<String> = None;
    let total = env.len();
    let mut last_pct = 0u32;

    for i in 0..total {
        let frame = render_frame_puppet(&base_img, &points, env[i], jaw_drop, mouth_color);
        if let Err(e) = stdin.write_all(frame.as_raw()) {
            write_error = Some(format!("Failed to write frame {}: {}", i, e));
            break;
        }

        // Emit progress every 10 frames to avoid flooding the frontend
        let pct = ((i + 1) as f64 / total as f64 * 100.0).round() as u32;
        if pct != last_pct && (i % 10 == 0 || i + 1 == total) {
            last_pct = pct;
            let _ = app.emit("export-progress", pct);
        }
    }

    // Close stdin so FFmpeg knows we're done (or exits on error)
    drop(stdin);

    // Collect FFmpeg's stderr and wait for it to exit
    let ffmpeg_stderr = stderr_thread.join().unwrap_or_default();
    let status = child.wait().map_err(|e| e.to_string())?;

    if !status.success() {
        let msg = if ffmpeg_stderr.is_empty() {
            write_error.unwrap_or_else(|| "FFmpeg exited with an unknown error".to_string())
        } else {
            let lines: Vec<&str> = ffmpeg_stderr.lines().collect();
            let tail = lines.iter().rev().take(20).cloned().collect::<Vec<_>>();
            let mut tail_str = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
            if let Some(write_err) = write_error {
                tail_str = format!("{}\n\n(write error: {})", tail_str, write_err);
            }
            tail_str
        };
        return Err(msg);
    }

    if let Some(write_err) = write_error {
        return Err(write_err);
    }

    // Ensure frontend sees 100% on success
    let _ = app.emit("export-progress", 100u32);

    Ok(format!("Exported to {}", out_path))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![export_video])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}