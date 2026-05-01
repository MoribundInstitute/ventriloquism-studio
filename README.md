# 🎭 Ventriloquism Studio
### A Moribund Institute Project

**Ventriloquism Studio** is a simple but powerful tool that turns a still photo into a talking puppet. By using sound recordings, the app automatically makes the puppet's mouth move in sync with the voice. It was built for the **Moribund Institute** to help creators make educational videos with a touch of Monty Python-esque absurdity.

![Ventriloquism Studio Interface](src/assets/screenshot-main.png)

---

## ✨ The Big Idea
Imagine you have a photo of a historical figure or a character. Usually, making that photo "talk" would take hours of manual work. This app does the heavy lifting for you:
* **Automatic Lip-Sync:** It listens to the audio and moves the puppet's mouth for you.
* **Puppet Physics:** The movements are smooth and feel like a real puppet.
* **Privacy by Design:** This is a **100% offline** app. Your photos and voice recordings never leave your machine (making it ideal for secure research environments).

---

## 🛠️ How It Works (The "Engine")
We used two special technologies to make this app work on any computer:

1. **Tauri (The Bridge):** This acts as a bridge, allowing us to build the "face" of the app using web tools (HTML/JS) while the "brain" of the app uses **Rust** to handle the heavy math of audio and movement.
2. **Multi-Distro Support:** Instead of a single "lunchbox" format, we provide native packages for Ubuntu (.deb), Fedora (.rpm), and a universal AppImage for Arch and other Linux users.

---

## 🚀 Installation & Downloads
The easiest way to use the Studio is to download a pre-built version from our **Releases** page.

### 📥 Available Formats
* **Ubuntu / Debian (.deb):** The leanest version (about 5MB) for Debian-based systems.
* **Arch / Universal (.AppImage):** A "download and run" portable version that works on almost any Linux distro.
* **Fedora / Red Hat (.rpm):** For enterprise and Red Hat-based workstations.

### 🔒 Security Check
Every release includes **SHA-256 checksums**. We recommend verifying your download in the terminal to ensure you have the authentic Moribund Institute build.

---

## 🖥️ Getting Started (For Developers)
If you want to build the project from source or help us improve the puppet physics, follow these steps.

### 1. Grab the Code
```bash
git clone https://github.com/MoribundInstitute/ventriloquism-studio.git
cd ventriloquism-studio
```

### 2. Install Dependencies
You will need Node.js and Rust installed on your system.
```bash
npm install
```

### 3. Run the App
To start the app in "Live Mode" for development:
```bash
npm run tauri dev
```

## 📜 The Institute's Rules
To keep our documentation looking professional and scholarly, please follow these guidelines.

- **No Em Dashes:** We do not use the long dash. Please use colons, commas, or parentheses for asides.
- **Branding:** Keep all colors strictly to our high-contrast monochrome and Purple Ink palette.

## ⚖️ License
This project is open-source and free to use under the MIT License.
