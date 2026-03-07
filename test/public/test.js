
// METHOD C — element refs
const btnC = document.getElementById('btn-c');
const fileC = document.getElementById('file-c');
const statusC = document.getElementById('status-c');
const resultC = document.getElementById('result-c');
const timeC = document.getElementById('time-c');
const logsC = document.getElementById('logs-c');

// METHOD A — element refs
const btnA = document.getElementById('btn-a');
const fileA = document.getElementById('file-a');
const statusA = document.getElementById('status-a');
const resultA = document.getElementById('result-a');
const timeA = document.getElementById('time-a');
const logsA = document.getElementById('logs-a');

// METHOD B — element refs
const btnB = document.getElementById('btn-b');
const fileB = document.getElementById('file-b');
const statusB = document.getElementById('status-b');
const resultB = document.getElementById('result-b');
const timeB = document.getElementById('time-b');
const logsB = document.getElementById('logs-b');



// ---------------------------------------------------------------
// LOGGING HELPERS
// ---------------------------------------------------------------

function log(el, msg) {
    el.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${msg}</div>`;
    el.scrollTop = el.scrollHeight;
}

// Granular timer — call lap(label, el) each time a step finishes.
// Returns a new lap function already bound to the last timestamp.
function makeLap(el) {
    let last = performance.now();
    return function lap(label) {
        const now = performance.now();
        const delta = (now - last).toFixed(0);
        log(el, `${label}: ${delta}ms`);
        last = now;
        return now;
    };
}


// ---------------------------------------------------------------
// SHARED HELPERS
// ---------------------------------------------------------------

// --- Largest Connected Component filter ---
// Runs iterative BFS over all pixels with alpha > 50.
// Identifies every isolated blob, keeps only the largest one,
// and zeroes the alpha of every pixel belonging to smaller blobs.
// Operates directly on a Uint8ClampedArray (imgData.data).
function keepLargestComponent(data, width, height) {
    const total = width * height;
    const visited = new Uint8Array(total); // 0 = unvisited

    let largestId = -1;
    let largestSize = 0;

    // Store each component as { pixels: Int32Array, size }
    const components = [];

    // 4-connected BFS
    const queue = new Int32Array(total); // pre-allocated ring buffer

    for (let start = 0; start < total; start++) {
        const a = data[(start << 2) + 3];
        if (a <= 50 || visited[start]) continue;

        // BFS from `start`
        let head = 0, tail = 0;
        queue[tail++] = start;
        visited[start] = 1;

        const compPixels = [];
        while (head < tail) {
            const idx = queue[head++];
            compPixels.push(idx);

            const x = idx % width;
            const y = (idx / width) | 0;

            // 4 neighbours
            if (x > 0) { const n = idx - 1; if (!visited[n] && data[(n << 2) + 3] > 50) { visited[n] = 1; queue[tail++] = n; } }
            if (x < width - 1) { const n = idx + 1; if (!visited[n] && data[(n << 2) + 3] > 50) { visited[n] = 1; queue[tail++] = n; } }
            if (y > 0) { const n = idx - width; if (!visited[n] && data[(n << 2) + 3] > 50) { visited[n] = 1; queue[tail++] = n; } }
            if (y < height - 1) { const n = idx + width; if (!visited[n] && data[(n << 2) + 3] > 50) { visited[n] = 1; queue[tail++] = n; } }
        }

        const id = components.length;
        components.push(compPixels);
        if (compPixels.length > largestSize) {
            largestSize = compPixels.length;
            largestId = id;
        }
    }

    // Zero alpha for every component that is NOT the largest
    for (let id = 0; id < components.length; id++) {
        if (id === largestId) continue;
        for (const px of components[id]) {
            data[(px << 2) + 3] = 0;
        }
    }

    return components.length; // useful for logging (how many blobs were pruned)
}


// ---------------------------------------------------------------
// SHARED HELPERS — Stroke & Trim (originals used by Method B)
// ---------------------------------------------------------------

async function addWhiteOutline(blob, strokeWidth, outputType = 'image/png') {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = img.width + (strokeWidth * 2);
            canvas.height = img.height + (strokeWidth * 2);

            ctx.fillStyle = 'white';
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
                const dx = Math.cos(angle) * strokeWidth;
                const dy = Math.sin(angle) * strokeWidth;
                ctx.drawImage(img, dx + strokeWidth, dy + strokeWidth);
            }

            ctx.globalCompositeOperation = 'source-in';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(img, strokeWidth, strokeWidth);

            const trimmedCanvas = trimCanvas(canvas);
            trimmedCanvas.toBlob((b) => resolve(b), outputType);
        };
        img.onerror = reject;
        img.src = url;
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


// ---------------------------------------------------------------
// OPTIMIZED HELPERS — Stroke & Trim (used by Method A & C)
// ---------------------------------------------------------------

// PI/8 radial steps (8 draws instead of 16) + early-exit trim
async function addWhiteOutlineOptimized(blob, strokeWidth, outputType = 'image/png') {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = img.width + (strokeWidth * 2);
            canvas.height = img.height + (strokeWidth * 2);

            ctx.fillStyle = 'white';
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
                const dx = Math.cos(angle) * strokeWidth;
                const dy = Math.sin(angle) * strokeWidth;
                ctx.drawImage(img, dx + strokeWidth, dy + strokeWidth);
            }

            ctx.globalCompositeOperation = 'source-in';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(img, strokeWidth, strokeWidth);

            const trimmedCanvas = trimCanvasOptimized(canvas);
            trimmedCanvas.toBlob((b) => resolve(b), outputType);
        };
        img.onerror = reject;
        img.src = url;
    });
}

function trimCanvasOptimized(canvas) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const data = ctx.getImageData(0, 0, width, height).data;

    let top = 0, bottom = height - 1, left = 0, right = width - 1;
    let found = false;

    outer: for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > 50) { top = y; found = true; break outer; }
        }
    }
    if (!found) return canvas;

    outer: for (let y = height - 1; y >= top; y--) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > 50) { bottom = y; break outer; }
        }
    }

    outer: for (let x = 0; x < width; x++) {
        for (let y = top; y <= bottom; y++) {
            if (data[(y * width + x) * 4 + 3] > 50) { left = x; break outer; }
        }
    }

    outer: for (let x = width - 1; x >= left; x--) {
        for (let y = top; y <= bottom; y++) {
            if (data[(y * width + x) * 4 + 3] > 50) { right = x; break outer; }
        }
    }

    const trimW = right - left + 1;
    const trimH = bottom - top + 1;
    const trimmed = document.createElement('canvas');
    trimmed.width = trimW; trimmed.height = trimH;
    trimmed.getContext('2d').drawImage(canvas, left, top, trimW, trimH, 0, 0, trimW, trimH);
    return trimmed;
}


// ---------------------------------------------------------------
// METHOD C: RMBG-1.4 @ 512×512 — Half-Resolution Inference
// ---------------------------------------------------------------

const workerC = new Worker('hf-worker.js', { type: 'module' });
workerC.postMessage({
    type: 'init',
    modelId: 'briaai/RMBG-1.4',
    modelOpts: { config: { model_type: 'custom' } },
    // ✅ Force processor to 512×512 instead of the default 1024×1024
    processorOpts: {
        size: { width: 512, height: 512 },
        crop_size: { width: 512, height: 512 }
    }
});

let startTimeC = 0;
let currentImageC = null;
let lapC = null; // granular timer for Method C

workerC.onmessage = async (e) => {
    const data = e.data;
    if (data.type === 'status') {
        statusC.textContent = data.data;
        log(logsC, data.data);
    } else if (data.type === 'progress') {
        const p = data.data;
        log(logsC, p.name ? `DL ${p.name}: ${Math.round((p.loaded / p.total) * 100)}%` : 'DL Model...');
    } else if (data.type === 'done') {
        const { maskData } = data;

        // ── Step: Inference (time from postMessage → done received)
        lapC('Inference (WebWorker)');

        statusC.textContent = 'Merging Alpha Mask...';

        const cvs = document.createElement('canvas');
        cvs.width = currentImageC.width;
        cvs.height = currentImageC.height;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(currentImageC, 0, 0);

        const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
        // ✅ Bitwise alpha index
        for (let i = 0; i < maskData.length; ++i) {
            imgData.data[(i << 2) + 3] = maskData[i];
        }
        lapC('Alpha Injection');

        // ── Step: Largest Connected Component filter
        statusC.textContent = 'Filtering Components...';
        const blobCount = keepLargestComponent(imgData.data, cvs.width, cvs.height);
        ctx.putImageData(imgData, 0, 0);
        lapC(`Component Filter (${blobCount} blob${blobCount !== 1 ? 's' : ''} found)`);

        // ── Step: Stroke
        statusC.textContent = 'Adding Stroke...';
        log(logsC, 'Adding Stroke...');
        const alphaBlob = await new Promise(res => cvs.toBlob(res, 'image/webp'));
        lapC('Export to Blob (pre-stroke)');

        const finalBlob = await addWhiteOutlineOptimized(alphaBlob, 15, 'image/webp');
        lapC('Stroke Addition');

        // ── Step: Trim is done inside addWhiteOutlineOptimized — logged implicitly above

        const totalMs = (performance.now() - startTimeC).toFixed(0);
        timeC.textContent = `Time: ${totalMs} ms`;
        resultC.innerHTML = `<img src="${URL.createObjectURL(finalBlob)}">`;
        statusC.textContent = '✅ Finished!';
        log(logsC, `Method C done — ${Math.round(finalBlob.size / 1024)} KB WebP — ${totalMs}ms total`);
    } else if (data.type === 'error') {
        log(logsC, 'Worker Error: ' + data.error);
        statusC.textContent = 'Failed';
    }
};

btnC.addEventListener('click', () => fileC.click());
fileC.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    log(logsC, '-----------------------');
    log(logsC, 'Method C (512×512 Inference) Started');
    statusC.textContent = 'Sending to WebWorker...';
    resultC.innerHTML = '<div class="btn-spinner"></div>';

    startTimeC = performance.now();
    lapC = makeLap(logsC);

    currentImageC = await createImageBitmap(file);
    lapC('Pre-processing / Decode');

    log(logsC, `Input: ${currentImageC.width}×${currentImageC.height} — inference at 512×512, mask upscaled`);

    const url = URL.createObjectURL(file);
    workerC.postMessage({ url, width: currentImageC.width, height: currentImageC.height });
    // Note: lapC tick for Inference happens when 'done' is received
});


// ---------------------------------------------------------------
// METHOD A: RMBG-1.4 + 4 Optimizations
// ---------------------------------------------------------------

const workerA = new Worker('hf-worker.js', { type: 'module' });
workerA.postMessage({ type: 'init', modelId: 'briaai/RMBG-1.4', modelOpts: { config: { model_type: 'custom' } } });

let startTimeA = 0;
let currentImageA = null;
let scaledImageA = null;
let lapA = null;

const MAX_DIM = 1500;

async function downscaleIfNeeded(bitmap) {
    const { width, height } = bitmap;
    if (width <= MAX_DIM && height <= MAX_DIM) return bitmap;
    const scale = MAX_DIM / Math.max(width, height);
    const cvs = document.createElement('canvas');
    cvs.width = Math.round(width * scale);
    cvs.height = Math.round(height * scale);
    cvs.getContext('2d').drawImage(bitmap, 0, 0, cvs.width, cvs.height);
    return createImageBitmap(cvs);
}

workerA.onmessage = async (e) => {
    const data = e.data;
    if (data.type === 'status') {
        statusA.textContent = data.data;
        log(logsA, data.data);
    } else if (data.type === 'progress') {
        const p = data.data;
        log(logsA, p.name ? `DL ${p.name}: ${Math.round((p.loaded / p.total) * 100)}%` : 'DL Model...');
    } else if (data.type === 'done') {
        const { maskData } = data;

        lapA('Inference (WebWorker)');

        statusA.textContent = 'Merging Alpha Mask...';

        const cvs = document.createElement('canvas');
        cvs.width = scaledImageA.width;
        cvs.height = scaledImageA.height;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(scaledImageA, 0, 0);

        const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
        for (let i = 0; i < maskData.length; ++i) {
            imgData.data[(i << 2) + 3] = maskData[i];
        }
        lapA('Alpha Injection');

        statusA.textContent = 'Filtering Components...';
        const blobCount = keepLargestComponent(imgData.data, cvs.width, cvs.height);
        ctx.putImageData(imgData, 0, 0);
        lapA(`Component Filter (${blobCount} blob${blobCount !== 1 ? 's' : ''} found)`);

        statusA.textContent = 'Adding Stroke...';
        log(logsA, 'Adding Stroke...');
        const alphaBlob = await new Promise(res => cvs.toBlob(res, 'image/webp'));
        lapA('Export to Blob (pre-stroke)');

        const finalBlob = await addWhiteOutlineOptimized(alphaBlob, 15, 'image/webp');
        lapA('Stroke Addition');

        const totalMs = (performance.now() - startTimeA).toFixed(0);
        timeA.textContent = `Time: ${totalMs} ms`;
        resultA.innerHTML = `<img src="${URL.createObjectURL(finalBlob)}">`;
        statusA.textContent = '✅ Finished!';
        log(logsA, `Method A done — ${Math.round(finalBlob.size / 1024)} KB WebP — ${totalMs}ms total`);
    } else if (data.type === 'error') {
        log(logsA, 'Worker Error: ' + data.error);
        statusA.textContent = 'Failed';
    }
};

btnA.addEventListener('click', () => fileA.click());
fileA.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    log(logsA, '-----------------------');
    log(logsA, 'Method A (Optimized RMBG-1.4) Started');
    statusA.textContent = 'Sending to WebWorker...';
    resultA.innerHTML = '<div class="btn-spinner"></div>';

    startTimeA = performance.now();
    lapA = makeLap(logsA);

    currentImageA = await createImageBitmap(file);

    scaledImageA = await downscaleIfNeeded(currentImageA);
    lapA(`Pre-processing / Downscale (${currentImageA.width}×${currentImageA.height} → ${scaledImageA.width}×${scaledImageA.height})`);

    const url = URL.createObjectURL(file);
    workerA.postMessage({ url, width: scaledImageA.width, height: scaledImageA.height });
});


// ---------------------------------------------------------------
// METHOD B: Transformers WebWorker (RMBG-1.4) — original baseline
// ---------------------------------------------------------------

const workerB = new Worker('hf-worker.js', { type: 'module' });
workerB.postMessage({ type: 'init', modelId: 'briaai/RMBG-1.4', modelOpts: { config: { model_type: 'custom' } } });

let startTimeB = 0;
let currentImageB = null;
let lapB = null;

workerB.onmessage = async (e) => {
    const data = e.data;
    if (data.type === 'status') {
        statusB.textContent = data.data;
        log(logsB, data.data);
    } else if (data.type === 'progress') {
        const p = data.data;
        log(logsB, p.name ? `DL ${p.name}: ${Math.round((p.loaded / p.total) * 100)}%` : 'DL Model...');
    } else if (data.type === 'done') {
        const { maskData } = data;

        lapB('Inference (WebWorker)');

        statusB.textContent = 'Merging Alpha Mask...';

        const cvs = document.createElement('canvas');
        cvs.width = currentImageB.width;
        cvs.height = currentImageB.height;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(currentImageB, 0, 0);

        const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
        for (let i = 0; i < maskData.length; ++i) {
            imgData.data[i * 4 + 3] = maskData[i];
        }
        lapB('Alpha Injection');

        statusB.textContent = 'Filtering Components...';
        const blobCount = keepLargestComponent(imgData.data, cvs.width, cvs.height);
        ctx.putImageData(imgData, 0, 0);
        lapB(`Component Filter (${blobCount} blob${blobCount !== 1 ? 's' : ''} found)`);

        statusB.textContent = 'Adding Stroke...';
        log(logsB, 'Adding Stroke...');
        const alphaBlob = await new Promise(res => cvs.toBlob(res, 'image/webp'));
        lapB('Export to Blob (pre-stroke)');

        const finalBlob = await addWhiteOutline(alphaBlob, 15, 'image/webp');
        lapB('Stroke Addition');

        const totalMs = (performance.now() - startTimeB).toFixed(0);
        timeB.textContent = `Time: ${totalMs} ms`;
        resultB.innerHTML = `<img src="${URL.createObjectURL(finalBlob)}">`;
        statusB.textContent = '✅ Finished!';
        log(logsB, `Method B done — ${Math.round(finalBlob.size / 1024)} KB WebP — ${totalMs}ms total`);
    } else if (data.type === 'error') {
        log(logsB, 'Worker Error: ' + data.error);
        statusB.textContent = 'Failed';
    }
};

btnB.addEventListener('click', () => fileB.click());
fileB.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    log(logsB, '-----------------------');
    log(logsB, 'Method B (WebWorker RMBG-1.4) Started');
    statusB.textContent = 'Sending to WebWorker...';
    resultB.innerHTML = '<div class="btn-spinner"></div>';

    startTimeB = performance.now();
    lapB = makeLap(logsB);

    currentImageB = await createImageBitmap(file);
    lapB('Pre-processing / Decode');

    const url = URL.createObjectURL(file);
    workerB.postMessage({ url, width: currentImageB.width, height: currentImageB.height });
});




async function handleBackendUpload(file, endpoint, statusEl, resultEl, timeEl, logsEl, name) {
    if (!file) return;

    log(logsEl, '-----------------------');
    log(logsEl, `${name} Started`);
    statusEl.textContent = 'Uploading & Processing on Server...';
    resultEl.innerHTML = '<div class="btn-spinner"></div>';

    const startTime = performance.now();

    const formData = new FormData();
    formData.append('photo', file);

    try {
        log(logsEl, 'Sending raw photo to ' + endpoint);
        const res = await fetch(endpoint, { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Server returned ' + res.status);

        log(logsEl, 'Downloading result image blob...');
        const resultBlob = await res.blob();

        const endTime = performance.now();
        timeEl.textContent = `Time: ${(endTime - startTime).toFixed(0)} ms`;

        const url = URL.createObjectURL(resultBlob);
        resultEl.innerHTML = `<img src="${url}">`;
        statusEl.textContent = '✅ Finished!';
        log(logsEl, 'Success!');
    } catch (e) {
        log(logsEl, 'Error: ' + e.message);
        statusEl.textContent = 'Failed';
    }
}

// -------------------------------------------------------------
// GRACEFUL BACKGROUND PRELOAD
// -------------------------------------------------------------
window.addEventListener('load', () => {
    setTimeout(() => {
        log(logsB, 'Silently preloading model in background...');
        workerB.postMessage({ type: 'preload' });

        log(logsA, 'Silently preloading model in background...');
        workerA.postMessage({ type: 'preload' });

        log(logsC, 'Silently preloading model in background...');
        workerC.postMessage({ type: 'preload' });
    }, 500);
});
