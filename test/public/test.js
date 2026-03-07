import { removeBackground } from 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';

// UI Elements
const btnA = document.getElementById('btn-a');
const fileA = document.getElementById('file-a');
const statusA = document.getElementById('status-a');
const resultA = document.getElementById('result-a');
const timeA = document.getElementById('time-a');
const logsA = document.getElementById('logs-a');

const btnB = document.getElementById('btn-b');
const fileB = document.getElementById('file-b');
const statusB = document.getElementById('status-b');
const resultB = document.getElementById('result-b');
const timeB = document.getElementById('time-b');
const logsB = document.getElementById('logs-b');

const btnC = document.getElementById('btn-c');
const fileC = document.getElementById('file-c');
const statusC = document.getElementById('status-c');
const resultC = document.getElementById('result-c');
const timeC = document.getElementById('time-c');
const logsC = document.getElementById('logs-c');

function log(el, msg) {
    el.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${msg}</div>`;
    el.scrollTop = el.scrollHeight;
}

// -------------------------------------------------------------
// METHOD A: PRELOADED IMGLY CLIENT SIDE
// -------------------------------------------------------------
let imglyConfig = {
    progress: (key, current, total) => { /* quiet preload */ }
};

// 1. Preload Model immediately on page load
statusA.textContent = "Preloading IMGLY model (WASM/ONNX)...";
let dummyCanvas = document.createElement('canvas');
dummyCanvas.width = 10; dummyCanvas.height = 10;
dummyCanvas.getContext('2d').fillRect(0, 0, 10, 10);
dummyCanvas.toBlob(async (blob) => {
    try {
        log(logsA, "Starting background preload...");
        await removeBackground(blob, imglyConfig);
        statusA.textContent = "✅ Model Preloaded & Ready!";
        btnA.disabled = false;
        log(logsA, "Preload complete! Warmed up.");
    } catch (e) {
        log(logsA, "Preload error: " + e.message);
        statusA.textContent = "Error preloading";
    }
});

btnA.addEventListener('click', () => fileA.click());

fileA.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    log(logsA, "-----------------------");
    log(logsA, "Method A Started");
    statusA.textContent = "Processing locally...";
    resultA.innerHTML = '<div class="btn-spinner"></div>';

    const startTime = performance.now();

    try {
        // Step 1: Resize source image for performance (prevent phone crashing)
        log(logsA, "1. Resizing raw photo down to 800px max...");
        const resizedBlob = await resizeImage(file, 800);

        // Step 2: Remove BG
        log(logsA, "2. Running AI Background Removal...");
        const noBgBlob = await removeBackground(resizedBlob, {
            progress: (k, c, t) => log(logsA, `imgly: ${k} ${Math.round((c / t) * 100)}%`)
        });

        // Step 3: Add Stroke
        log(logsA, "3. Adding 15px stroke + trimming...");
        const finalBlob = await addWhiteOutline(noBgBlob, 15);

        const endTime = performance.now();
        timeA.textContent = `Time: ${(endTime - startTime).toFixed(0)} ms`;

        const url = URL.createObjectURL(finalBlob);
        resultA.innerHTML = `<img src="${url}">`;
        statusA.textContent = "✅ Finished!";
        log(logsA, "Method A Success!");
    } catch (err) {
        log(logsA, "Error: " + err.message);
        statusA.textContent = "Failed";
    }
});

// Helper: Resize Image
function resizeImage(file, maxDist) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let w = img.width;
            let h = img.height;
            if (w > maxDist || h > maxDist) {
                if (w > h) { h *= maxDist / w; w = maxDist; }
                else { w *= maxDist / h; h = maxDist; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            canvas.toBlob(resolve, 'image/jpeg', 0.9);
        };
        img.src = URL.createObjectURL(file);
    });
}

// Helper: Stroke (Copied from original kopi app)
async function addWhiteOutline(blob, outlineWidth = 15) {
    const bmpUrl = URL.createObjectURL(blob);
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const pad = outlineWidth * 2;
            const canvas = document.createElement('canvas');
            canvas.width = img.width + pad; canvas.height = img.height + pad;
            const ctx = canvas.getContext('2d');

            const offsets = [];
            for (let angle = 0; angle < 360; angle += 15) {
                offsets.push({ x: Math.cos(angle * Math.PI / 180) * outlineWidth, y: Math.sin(angle * Math.PI / 180) * outlineWidth });
            }
            offsets.forEach(o => ctx.drawImage(img, pad / 2 + o.x, pad / 2 + o.y));

            ctx.globalCompositeOperation = 'source-in';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(img, pad / 2, pad / 2);

            // Trim
            const trimmedCanvas = trimCanvas(canvas);
            URL.revokeObjectURL(bmpUrl);
            trimmedCanvas.toBlob((b) => resolve(b), 'image/webp', 0.85);
        };
        img.src = bmpUrl;
    });
}

function trimCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width; const height = canvas.height;
    const pixels = ctx.getImageData(0, 0, width, height);
    let bound = { top: null, left: null, right: null, bottom: null };

    for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i + 3] > 50) {
            const x = (i / 4) % width;
            const y = Math.floor((i / 4) / width);
            if (bound.top === null || y < bound.top) bound.top = y;
            if (bound.left === null || x < bound.left) bound.left = x;
            if (bound.right === null || x > bound.right) bound.right = x;
            if (bound.bottom === null || y > bound.bottom) bound.bottom = y;
        }
    }
    if (bound.top === null) return canvas;

    const trimW = bound.right - bound.left + 1;
    const trimH = bound.bottom - bound.top + 1;
    const trimmed = document.createElement('canvas');
    trimmed.width = trimW; trimmed.height = trimH;
    trimmed.getContext('2d').drawImage(canvas, bound.left, bound.top, trimW, trimH, 0, 0, trimW, trimH);
    return trimmed;
}

// -------------------------------------------------------------
// Backend Helpers
// -------------------------------------------------------------
btnB.addEventListener('click', () => fileB.click());
btnC.addEventListener('click', () => fileC.click());

fileB.addEventListener('change', (e) => handleBackendUpload(e.target.files[0], 'http://localhost:3000/api/method-b', statusB, resultB, timeB, logsB, "Method B (Sharp + Imgly Node)"));
fileC.addEventListener('change', (e) => handleBackendUpload(e.target.files[0], 'http://localhost:3000/api/method-c', statusC, resultC, timeC, logsC, "Method C (Smartcrop.js)"));

async function handleBackendUpload(file, endpoint, statusEl, resultEl, timeEl, logsEl, name) {
    if (!file) return;

    log(logsEl, "-----------------------");
    log(logsEl, `${name} Started`);
    statusEl.textContent = "Uploading & Processing on Server...";
    resultEl.innerHTML = '<div class="btn-spinner"></div>';

    const startTime = performance.now();

    const formData = new FormData();
    formData.append('photo', file);

    try {
        log(logsEl, "Sending raw photo to " + endpoint);
        const res = await fetch(endpoint, { method: 'POST', body: formData });
        if (!res.ok) throw new Error("Server returned " + res.status);

        log(logsEl, "Downloading result image blob...");
        const resultBlob = await res.blob();

        const endTime = performance.now();
        timeEl.textContent = `Time: ${(endTime - startTime).toFixed(0)} ms`;

        const url = URL.createObjectURL(resultBlob);
        resultEl.innerHTML = `<img src="${url}">`;
        statusEl.textContent = "✅ Finished!";
        log(logsEl, "Success!");
    } catch (e) {
        log(logsEl, "Error: " + e.message);
        statusEl.textContent = "Failed";
    }
}
