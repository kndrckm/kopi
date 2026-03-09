// ============================================================
// benchmark.js — Kopi BG Removal Model Benchmark
// 2 models: RMBG-1.4 Quantized (WASM) / IMG.LY ISNet
// RMBG runs in a Web Worker; IMG.LY runs on the main thread.
// Images downscaled to max 1024px before inference.
// ============================================================

// ── Model Definitions ──────────────────────────────────────
const MODELS = [
    {
        id: 'rmbg14-quantized',
        name: 'RMBG-1.4 — Quantized',
        modelId: 'briaai/RMBG-1.4',
        device: 'wasm',
        dtype: 'uint8',
        quantized: true,
        library: 'transformers',
    },
    {
        id: 'imgly-isnet',
        name: 'IMG.LY — ISNet',
        modelId: 'isnet_fp16',
        device: 'wasm',
        library: 'imgly',
    },
];

const MAX_DIM = 1024; // downscale images to max 1024px on longest side

// ── State ──────────────────────────────────────────────────
let uploadedFile = null;
let results = {};
let stickerMode = 'stroke';
let runningModel = null; // lock: only one model runs at a time

// ── Web Worker (for Transformers.js models only) ───────────
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

worker.onmessage = (e) => {
    const msg = e.data;
    const { id } = msg;

    switch (msg.type) {
        case 'status':
            setStatus(id, msg.text);
            break;

        case 'progress':
            setProgress(id, msg.pct);
            break;

        case 'loadTime':
            if (results[id]) {
                results[id].loadTime = msg.loadTime;
                setTime(id, 'load', msg.loadTime);
            }
            break;

        case 'result':
            handleWorkerResult(id, msg);
            break;

        case 'error':
            handleWorkerError(id, msg.message);
            break;
    }
};

// ── DOM refs ───────────────────────────────────────────────
const fileInput       = document.getElementById('file-input');
const uploadArea      = document.getElementById('upload-area');
const previewRow      = document.getElementById('preview-row');
const previewImg      = document.getElementById('preview-img');
const previewName     = document.getElementById('preview-name');
const previewSize     = document.getElementById('preview-size');
const btnChange       = document.getElementById('btn-change');
const stickerToggle   = document.getElementById('sticker-toggle');
const labelStroke     = document.getElementById('label-stroke');
const labelStickerify = document.getElementById('label-stickerify');
const summarySection  = document.getElementById('summary-section');
const summaryTbody    = document.getElementById('summary-tbody');

// ── Utility: Format time ───────────────────────────────────
function fmt(ms) {
    if (ms == null) return '\u2014';
    return (ms / 1000).toFixed(2) + 's';
}

// ── Utility: Downscale image to max 1024px ─────────────────
// Returns { data: Uint8ClampedArray (RGBA), width, height }
function downscaleImage(bitmap) {
    let w = bitmap.width;
    let h = bitmap.height;

    if (w > MAX_DIM || h > MAX_DIM) {
        const scale = MAX_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
    }

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    return { data: imageData.data, width: w, height: h };
}

// ── Sticker Post-Processing: Current Stroke Method ─────────
function applyCurrentStroke(blob, outlineWidth = 15) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const pad = outlineWidth * 2;
            const canvas = document.createElement('canvas');
            canvas.width = img.width + pad;
            canvas.height = img.height + pad;
            const ctx = canvas.getContext('2d');

            for (let angle = 0; angle < 360; angle += 15) {
                const ox = Math.cos(angle * Math.PI / 180) * outlineWidth;
                const oy = Math.sin(angle * Math.PI / 180) * outlineWidth;
                ctx.drawImage(img, pad / 2 + ox, pad / 2 + oy);
            }

            ctx.globalCompositeOperation = 'source-in';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(img, pad / 2, pad / 2);

            URL.revokeObjectURL(url);
            const trimmed = trimCanvas(canvas);
            trimmed.toBlob((b) => resolve(b), 'image/png');
        };
        img.src = url;
    });
}

// ── Sticker Post-Processing: Stickerify + Drop Shadow ──────
function applyStickerify(blob, outlineWidth = 12) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const shadowBlur = 16;
            const shadowOffY = 6;
            const pad = outlineWidth * 2 + shadowBlur * 2 + shadowOffY;
            const canvas = document.createElement('canvas');
            canvas.width = img.width + pad;
            canvas.height = img.height + pad;
            const ctx = canvas.getContext('2d');
            const cx = pad / 2;
            const cy = pad / 2 - shadowOffY / 2;

            ctx.save();
            const steps = 64;
            for (let i = 0; i < steps; i++) {
                const angle = (i / steps) * Math.PI * 2;
                const ox = Math.cos(angle) * outlineWidth;
                const oy = Math.sin(angle) * outlineWidth;
                ctx.drawImage(img, cx + ox, cy + oy);
            }
            ctx.globalCompositeOperation = 'source-in';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();

            const outlineCanvas = document.createElement('canvas');
            outlineCanvas.width = canvas.width;
            outlineCanvas.height = canvas.height;
            const octx = outlineCanvas.getContext('2d');
            octx.shadowColor = 'rgba(0, 0, 0, 0.25)';
            octx.shadowBlur = shadowBlur;
            octx.shadowOffsetX = 0;
            octx.shadowOffsetY = shadowOffY;
            octx.drawImage(canvas, 0, 0);

            octx.shadowColor = 'transparent';
            octx.shadowBlur = 0;
            octx.shadowOffsetX = 0;
            octx.shadowOffsetY = 0;
            octx.drawImage(img, cx, cy);

            URL.revokeObjectURL(url);
            const trimmed = trimCanvas(outlineCanvas);
            trimmed.toBlob((b) => resolve(b), 'image/png');
        };
        img.src = url;
    });
}

// ── Trim transparent pixels ────────────────────────────────
function trimCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    let top = h, left = w, right = 0, bottom = 0;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const a = data[(y * w + x) * 4 + 3];
            if (a > 10) {
                if (y < top) top = y;
                if (y > bottom) bottom = y;
                if (x < left) left = x;
                if (x > right) right = x;
            }
        }
    }

    if (top >= bottom || left >= right) return canvas;

    const tw = right - left + 1;
    const th = bottom - top + 1;
    const trimmed = document.createElement('canvas');
    trimmed.width = tw;
    trimmed.height = th;
    trimmed.getContext('2d').drawImage(canvas, left, top, tw, th, 0, 0, tw, th);
    return trimmed;
}

// ── Update DOM helpers ─────────────────────────────────────
function setStatus(modelId, text) {
    const el = document.getElementById(`status-${modelId}`);
    if (el) el.textContent = text;
}
function setProgress(modelId, pct) {
    const el = document.getElementById(`prog-${modelId}`);
    if (el) el.style.width = pct + '%';
}
function setTime(modelId, phase, ms) {
    const el = document.getElementById(`time-${phase}-${modelId}`);
    if (el) el.textContent = fmt(ms);
}
function setCardState(modelId, state) {
    const card = document.querySelector(`.model-card[data-model="${modelId}"]`);
    if (!card) return;
    card.classList.remove('running', 'done', 'error', 'fastest');
    if (state) card.classList.add(state);
}

// ── Display result on canvas ───────────────────────────────
async function displayResult(modelId, blob) {
    const canvas = document.getElementById(`canvas-${modelId}`);
    const ph = document.getElementById(`ph-${modelId}`);
    const img = new Image();
    const url = URL.createObjectURL(blob);

    return new Promise((resolve) => {
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            canvas.classList.add('visible');
            ph.classList.add('hidden');
            URL.revokeObjectURL(url);
            resolve();
        };
        img.src = url;
    });
}

// ── Per-card button state helpers ──────────────────────────
function setRunBtnState(modelId, disabled, text) {
    const btn = document.getElementById(`btn-run-${modelId}`);
    if (btn) {
        btn.disabled = disabled;
        btn.textContent = text;
    }
}

function setAllRunBtns(disabled) {
    MODELS.forEach(m => {
        const btn = document.getElementById(`btn-run-${m.id}`);
        if (btn && m.id !== runningModel) {
            btn.disabled = disabled;
        }
    });
}

// ── Convert RGBA ArrayBuffer from worker into a PNG Blob ───
function rgbaToBlob(buffer, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
    ctx.putImageData(imageData, 0, 0);
    return new Promise(res => canvas.toBlob(res, 'image/png'));
}

// ════════════════════════════════════════════════════════════
// WORKER RESULT / ERROR HANDLERS (Transformers.js models)
// ════════════════════════════════════════════════════════════

const pendingRuns = {}; // id -> { resolve }

async function handleWorkerResult(id, msg) {
    try {
        const rawBlob = await rgbaToBlob(msg.resultData, msg.width, msg.height);

        setProgress(id, 85);
        setStatus(id, 'Applying sticker effect...');

        let finalBlob;
        if (stickerMode === 'stickerify') {
            finalBlob = await applyStickerify(rawBlob);
        } else {
            finalBlob = await applyCurrentStroke(rawBlob);
        }

        const totalTime = performance.now() - results[id]._startTime;
        const processTime = msg.processTime;

        if (results[id].loadTime == null) {
            results[id].loadTime = totalTime - processTime;
            setTime(id, 'load', results[id].loadTime);
        }

        results[id].processTime = processTime;
        results[id].totalTime = totalTime;
        results[id].blob = finalBlob;
        results[id].status = 'done';

        setTime(id, 'process', processTime);
        setTime(id, 'total', totalTime);
        setProgress(id, 100);
        setCardState(id, 'done');
        setStatus(id, `Done \u2014 ${fmt(totalTime)}`);

        await displayResult(id, finalBlob);
    } catch (err) {
        console.error(`[${id}] Post-processing error:`, err);
        results[id].status = 'error';
        setCardState(id, 'error');
        setStatus(id, `Error: ${String(err.message || err).slice(0, 60)}`);
        setProgress(id, 100);
    }

    if (pendingRuns[id]) {
        pendingRuns[id].resolve();
        delete pendingRuns[id];
    }
}

function handleWorkerError(id, message) {
    const totalTime = performance.now() - (results[id]?._startTime || 0);
    if (results[id]) {
        results[id].status = 'error';
        results[id].totalTime = totalTime;
    }
    setCardState(id, 'error');
    setStatus(id, `Error: ${message}`);
    setProgress(id, 100);
    console.error(`[${id}] Worker error:`, message);

    if (pendingRuns[id]) {
        pendingRuns[id].resolve();
        delete pendingRuns[id];
    }
}

// ════════════════════════════════════════════════════════════
// IMG.LY RUNNER (runs on main thread, no worker needed)
// ════════════════════════════════════════════════════════════

let imglyModule = null; // lazy-loaded

async function runImgly(modelId) {
    // Lazy-load the imgly library on first use
    if (!imglyModule) {
        setStatus(modelId, 'Loading IMG.LY library...');
        setProgress(modelId, 5);
        imglyModule = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.11/dist/index.js');
    }

    const removeBackground = imglyModule.removeBackground || imglyModule.default;

    const tLoad0 = performance.now();
    setStatus(modelId, 'Downloading model...');
    setProgress(modelId, 10);

    const config = {
        model: 'isnet_fp16',
        output: {
            format: 'image/png',
            quality: 1.0,
            type: 'foreground',
        },
        progress: (key, current, total) => {
            if (total > 0) {
                const pct = Math.round((current / total) * 40);
                setProgress(modelId, 10 + pct);
                const mb = (current / 1024 / 1024).toFixed(1);
                setStatus(modelId, `Downloading... ${mb} MB`);
            }
        },
    };

    // removeBackground accepts File/Blob/URL directly
    const resultBlob = await removeBackground(uploadedFile, config);

    const loadAndProcessTime = performance.now() - tLoad0;

    // IMG.LY doesn't separate load vs process, so we report combined as process
    results[modelId].loadTime = 0;
    results[modelId].processTime = loadAndProcessTime;

    setTime(modelId, 'load', 0);
    setTime(modelId, 'process', loadAndProcessTime);
    setProgress(modelId, 80);
    setStatus(modelId, 'Applying sticker effect...');

    // Apply sticker post-processing
    let finalBlob;
    if (stickerMode === 'stickerify') {
        finalBlob = await applyStickerify(resultBlob);
    } else {
        finalBlob = await applyCurrentStroke(resultBlob);
    }

    const totalTime = performance.now() - results[modelId]._startTime;

    results[modelId].totalTime = totalTime;
    results[modelId].blob = finalBlob;
    results[modelId].status = 'done';

    setTime(modelId, 'total', totalTime);
    setProgress(modelId, 100);
    setCardState(modelId, 'done');
    setStatus(modelId, `Done \u2014 ${fmt(totalTime)}`);

    await displayResult(modelId, finalBlob);
}

// ════════════════════════════════════════════════════════════
// RUN A SINGLE MODEL
// ════════════════════════════════════════════════════════════

async function runSingle(modelId) {
    if (!uploadedFile) return;
    if (runningModel) return;

    const modelDef = MODELS.find(m => m.id === modelId);
    if (!modelDef) return;

    runningModel = modelId;
    setRunBtnState(modelId, true, 'Running...');
    setAllRunBtns(true);

    // Reset card
    setCardState(modelId, 'running');
    setStatus(modelId, 'Preparing image...');
    setProgress(modelId, 0);
    setTime(modelId, 'load', null);
    setTime(modelId, 'process', null);
    setTime(modelId, 'total', null);
    const canvas = document.getElementById(`canvas-${modelId}`);
    canvas.classList.remove('visible');
    const ph = document.getElementById(`ph-${modelId}`);
    ph.classList.remove('hidden');
    ph.textContent = 'Processing...';

    results[modelId] = {
        status: 'running',
        loadTime: null,
        processTime: null,
        totalTime: null,
        blob: null,
        _startTime: performance.now(),
    };

    try {
        if (modelDef.library === 'imgly') {
            // ── IMG.LY path: runs on main thread ──
            await runImgly(modelId);
        } else {
            // ── Transformers.js path: runs in Web Worker ──
            const bitmap = await createImageBitmap(uploadedFile);
            const scaled = downscaleImage(bitmap);
            bitmap.close();

            setProgress(modelId, 2);

            const runPromise = new Promise(resolve => {
                pendingRuns[modelId] = { resolve };
            });

            worker.postMessage(
                {
                    type: 'run',
                    id: modelId,
                    config: {
                        modelId: modelDef.modelId,
                        device: modelDef.device,
                        dtype: modelDef.dtype,
                        quantized: modelDef.quantized,
                    },
                    imageData: scaled.data.buffer,
                    imageWidth: scaled.width,
                    imageHeight: scaled.height,
                },
                [scaled.data.buffer]
            );

            await runPromise;
        }
    } catch (err) {
        console.error(`[${modelId}] Error:`, err);
        results[modelId].status = 'error';
        results[modelId].totalTime = performance.now() - results[modelId]._startTime;
        setCardState(modelId, 'error');
        setStatus(modelId, `Error: ${String(err.message || err).slice(0, 60)}`);
        setProgress(modelId, 100);
    }

    // Update summary
    highlightFastest();
    buildSummary();

    runningModel = null;
    setRunBtnState(modelId, false, 'Run');
    setAllRunBtns(false);
}

// ── Highlight fastest completed model ──────────────────────
function highlightFastest() {
    MODELS.forEach(m => {
        const card = document.querySelector(`.model-card[data-model="${m.id}"]`);
        if (card) card.classList.remove('fastest');
    });

    let fastestId = null;
    let fastestTime = Infinity;
    for (const [id, r] of Object.entries(results)) {
        if (r.status === 'done' && r.totalTime < fastestTime) {
            fastestTime = r.totalTime;
            fastestId = id;
        }
    }
    if (fastestId) {
        const card = document.querySelector(`.model-card[data-model="${fastestId}"]`);
        if (card) card.classList.add('fastest');
    }
    return fastestId;
}

// ── Build summary table ────────────────────────────────────
function buildSummary() {
    const completedModels = MODELS.filter(m => results[m.id]);
    if (completedModels.length === 0) {
        summarySection.style.display = 'none';
        return;
    }

    const fastestId = highlightFastest();

    summaryTbody.innerHTML = '';
    const sorted = completedModels.map(m => ({ ...m, ...results[m.id] }))
        .sort((a, b) => {
            if (a.status === 'done' && b.status !== 'done') return -1;
            if (a.status !== 'done' && b.status === 'done') return 1;
            return (a.totalTime || Infinity) - (b.totalTime || Infinity);
        });

    sorted.forEach(r => {
        const tr = document.createElement('tr');
        const isWinner = r.id === fastestId;
        const isFailed = r.status === 'error';
        tr.innerHTML = `
            <td>${r.name}${isWinner ? ' *' : ''}</td>
            <td>${fmt(r.loadTime)}</td>
            <td>${fmt(r.processTime)}</td>
            <td class="${isWinner ? 'winner' : ''}">${fmt(r.totalTime)}</td>
            <td class="${isFailed ? 'failed' : ''}">${r.status === 'done' ? 'OK' : r.status === 'error' ? 'FAIL' : '\u2014'}</td>
        `;
        summaryTbody.appendChild(tr);
    });

    summarySection.style.display = 'block';
}

// ── Re-apply sticker effect note ───────────────────────────
async function reapplySticker() {
    if (Object.keys(results).length > 0) {
        const note = document.createElement('p');
        note.style.cssText = 'text-align:center;color:var(--primary);font-size:13px;font-weight:600;margin-bottom:16px;';
        note.textContent = 'Toggle changed! Re-run individual models to see results with the new sticker style.';
        const existing = document.querySelector('.toggle-note');
        if (existing) existing.remove();
        note.classList.add('toggle-note');
        const grid = document.getElementById('results-grid');
        grid.parentNode.insertBefore(note, grid);
    }
}

// ── File handling ──────────────────────────────────────────
function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    uploadedFile = file;

    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewName.textContent = file.name;
    previewSize.textContent = (file.size / 1024).toFixed(0) + ' KB';

    uploadArea.style.display = 'none';
    previewRow.style.display = 'flex';

    // Enable all per-card run buttons
    MODELS.forEach(m => {
        setRunBtnState(m.id, false, 'Run');
    });
}

// ── Event listeners ────────────────────────────────────────
uploadArea.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
});
btnChange.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
});

// Drag & drop
uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

// Toggle sticker mode
stickerToggle.addEventListener('change', () => {
    if (stickerToggle.checked) {
        stickerMode = 'stickerify';
        labelStroke.classList.remove('active');
        labelStickerify.classList.add('active');
    } else {
        stickerMode = 'stroke';
        labelStroke.classList.add('active');
        labelStickerify.classList.remove('active');
    }
    reapplySticker();
});

// Per-card run buttons
MODELS.forEach(m => {
    const btn = document.getElementById(`btn-run-${m.id}`);
    if (btn) {
        btn.addEventListener('click', () => runSingle(m.id));
    }
});

// ── Init ───────────────────────────────────────────────────
console.log('Kopi Benchmark: Ready. Models:', MODELS.map(m => m.name).join(', '));
