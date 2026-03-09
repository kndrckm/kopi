// ============================================================
// benchmark.js — Kopi BG Removal Model Benchmark
// Phase 1: Preload all models on page load
// Phase 2: Run inference only when user uploads image
// ============================================================

import { pipeline, AutoModel, AutoProcessor, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1';

env.allowLocalModels = false;

// ── Model Definitions ──────────────────────────────────────
const MODELS = [
    {
        id: 'original',
        name: 'RMBG-1.4 (Current)',
        modelId: 'briaai/RMBG-1.4',
        device: 'wasm',
        dtype: 'q8',
        useAutoModel: true,
        modelConfig: { model_type: 'bria-rmbg' },
    },
    {
        id: 'u2netp',
        name: 'u2netp',
        modelId: 'BritishWerewolf/U-2-Netp',
        device: 'wasm',
        dtype: 'fp32',
    },
    {
        id: 'birefnet-lite',
        name: 'BiRefNet-lite',
        modelId: 'onnx-community/BiRefNet_lite-ONNX',
        device: 'wasm',
        dtype: 'fp32',
    },
    {
        id: 'ben2',
        name: 'BEN2',
        modelId: 'onnx-community/BEN2-ONNX',
        device: 'wasm',
        dtype: 'fp32',
    },
    {
        id: 'rmbg14-webgpu',
        name: 'RMBG-1.4 (WebGPU)',
        modelId: 'briaai/RMBG-1.4',
        device: 'webgpu',
        dtype: 'fp32',
    },
    {
        id: 'birefnet-lite-webgpu',
        name: 'BiRefNet-lite (WebGPU)',
        modelId: 'onnx-community/BiRefNet_lite-ONNX',
        device: 'webgpu',
        dtype: 'fp32',
    },
];

// ── State ──────────────────────────────────────────────────
let uploadedFile = null;
let results = {};
let stickerMode = 'stroke';

// Preloaded model instances: modelId -> { model, processor } or { segmenter }
const loadedModels = {};
let preloadDone = false;
let modelsLoadedCount = 0;

// ── DOM refs ───────────────────────────────────────────────
const fileInput       = document.getElementById('file-input');
const uploadArea      = document.getElementById('upload-area');
const previewRow      = document.getElementById('preview-row');
const previewImg      = document.getElementById('preview-img');
const previewName     = document.getElementById('preview-name');
const previewSize     = document.getElementById('preview-size');
const btnChange       = document.getElementById('btn-change');
const btnRun          = document.getElementById('btn-run');
const stickerToggle   = document.getElementById('sticker-toggle');
const labelStroke     = document.getElementById('label-stroke');
const labelStickerify = document.getElementById('label-stickerify');
const summarySection  = document.getElementById('summary-section');
const summaryTbody    = document.getElementById('summary-tbody');
const preloadBanner   = document.getElementById('preload-banner');
const preloadStatus   = document.getElementById('preload-status');
const preloadProgress = document.getElementById('preload-progress');

// ── Utility: Check WebGPU availability ─────────────────────
async function hasWebGPU() {
    if (!navigator.gpu) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return !!adapter;
    } catch { return false; }
}

// ── Utility: Format time ───────────────────────────────────
function fmt(ms) {
    if (ms == null) return '—';
    return (ms / 1000).toFixed(2) + 's';
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
    document.getElementById(`status-${modelId}`).textContent = text;
}
function setProgress(modelId, pct) {
    document.getElementById(`prog-${modelId}`).style.width = pct + '%';
}
function setTime(modelId, phase, ms) {
    document.getElementById(`time-${phase}-${modelId}`).textContent = fmt(ms);
}
function setCardState(modelId, state) {
    const card = document.querySelector(`.model-card[data-model="${modelId}"]`);
    card.classList.remove('running', 'done', 'error', 'fastest', 'preloaded');
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

// ════════════════════════════════════════════════════════════
// PHASE 1: PRELOAD ALL MODELS ON PAGE LOAD
// ════════════════════════════════════════════════════════════

async function preloadModel(modelDef) {
    const { id, modelId, device, dtype } = modelDef;

    setCardState(id, 'running');
    setStatus(id, 'Preloading model...');
    setProgress(id, 5);

    const t0 = performance.now();

    try {
        let actualDevice = device;
        if (device === 'webgpu') {
            const gpuOk = await hasWebGPU();
            if (!gpuOk) {
                actualDevice = 'wasm';
                setStatus(id, 'WebGPU N/A, falling back to WASM...');
            }
        }

        const progressCb = (p) => {
            if (p.status === 'progress' && p.total) {
                const pct = Math.round((p.loaded / p.total) * 90);
                setProgress(id, 5 + pct);
                const mb = (p.loaded / 1024 / 1024).toFixed(1);
                setStatus(id, `Downloading... ${mb} MB`);
            }
        };

        if (modelDef.useAutoModel) {
            // Production path: AutoModel + AutoProcessor
            const [model, processor] = await Promise.all([
                AutoModel.from_pretrained(modelId, {
                    dtype: dtype,
                    revision: 'main',
                    config: modelDef.modelConfig || {},
                    device: actualDevice,
                    progress_callback: progressCb,
                }),
                AutoProcessor.from_pretrained(modelId, {}),
            ]);
            loadedModels[id] = { model, processor, useAutoModel: true };
        } else {
            // Challenger path: pipeline
            const segmenter = await pipeline('background-removal', modelId, {
                device: actualDevice,
                dtype: dtype,
                progress_callback: progressCb,
            });
            loadedModels[id] = { segmenter, useAutoModel: false };
        }

        const loadTime = performance.now() - t0;
        setTime(id, 'load', loadTime);
        setProgress(id, 100);
        setCardState(id, 'preloaded');
        setStatus(id, `Preloaded in ${fmt(loadTime)}`);

        // Store load time for later summary
        results[id] = results[id] || {};
        results[id].loadTime = loadTime;

        modelsLoadedCount++;
        updatePreloadBanner();

    } catch (err) {
        console.error(`[${id}] Preload error:`, err);
        setCardState(id, 'error');
        setStatus(id, `Preload failed: ${err.message.slice(0, 60)}`);
        setProgress(id, 100);
        loadedModels[id] = null;
        modelsLoadedCount++;
        updatePreloadBanner();
    }
}

function updatePreloadBanner() {
    const total = MODELS.length;
    const pct = Math.round((modelsLoadedCount / total) * 100);
    preloadStatus.textContent = `Preloading models... ${modelsLoadedCount}/${total}`;
    preloadProgress.style.width = pct + '%';

    if (modelsLoadedCount >= total) {
        preloadDone = true;
        preloadStatus.textContent = `All ${total} models preloaded and ready`;
        preloadBanner.classList.add('done');
        // Enable run button if image is already uploaded
        if (uploadedFile) {
            btnRun.disabled = false;
        }
    }
}

async function preloadAllModels() {
    preloadBanner.style.display = 'block';
    preloadStatus.textContent = `Preloading models... 0/${MODELS.length}`;
    preloadProgress.style.width = '0%';

    // Reset all cards
    MODELS.forEach(m => {
        setCardState(m.id, null);
        setStatus(m.id, 'Waiting to preload...');
        setProgress(m.id, 0);
        setTime(m.id, 'load', null);
        setTime(m.id, 'process', null);
        setTime(m.id, 'total', null);
    });

    // Preload all models in parallel
    await Promise.all(MODELS.map(m => preloadModel(m)));
}

// ════════════════════════════════════════════════════════════
// PHASE 2: INFERENCE ONLY (after user uploads image)
// ════════════════════════════════════════════════════════════

async function runInference(modelDef, imageBlob) {
    const { id, modelId } = modelDef;
    const loaded = loadedModels[id];

    if (!loaded) {
        // Model failed to preload
        results[id] = results[id] || {};
        results[id].status = 'error';
        results[id].processTime = null;
        results[id].totalTime = null;
        setCardState(id, 'error');
        setStatus(id, 'Skipped — preload failed');
        return results[id];
    }

    results[id] = results[id] || {};
    results[id].status = 'running';
    results[id].blob = null;

    setCardState(id, 'running');
    setStatus(id, 'Processing image...');
    setProgress(id, 30);

    const t0 = performance.now();

    try {
        let rawBlob;

        if (loaded.useAutoModel) {
            // Production path inference
            const { model, processor } = loaded;
            const bmp = await createImageBitmap(imageBlob);
            const imgUrl = URL.createObjectURL(imageBlob);
            const image = await RawImage.fromURL(imgUrl);
            URL.revokeObjectURL(imgUrl);

            setProgress(id, 50);

            const { pixel_values } = await processor(image);
            const { output } = await model({ input: pixel_values });

            const outputTensor = output[0] ? output[0] : output;
            const mask = await RawImage.fromTensor(
                outputTensor.mul(255).to('uint8')
            ).resize(bmp.width, bmp.height);

            const cvs = document.createElement('canvas');
            cvs.width = bmp.width;
            cvs.height = bmp.height;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(bmp, 0, 0);

            const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
            for (let i = 0; i < mask.data.length; ++i) {
                imgData.data[i * 4 + 3] = mask.data[i];
            }
            ctx.putImageData(imgData, 0, 0);

            rawBlob = await new Promise(res => cvs.toBlob(res, 'image/png'));

        } else {
            // Pipeline inference
            const { segmenter } = loaded;
            const imageUrl = URL.createObjectURL(imageBlob);
            setProgress(id, 50);
            const output = await segmenter(imageUrl);
            URL.revokeObjectURL(imageUrl);

            if (output[0] && typeof output[0].toBlob === 'function') {
                rawBlob = await output[0].toBlob();
            } else if (output[0] && typeof output[0].toCanvas === 'function') {
                const cvs = output[0].toCanvas();
                rawBlob = await new Promise(res => cvs.toBlob(res, 'image/png'));
            } else {
                rawBlob = await output[0].toBlob();
            }
        }

        setProgress(id, 80);
        setStatus(id, 'Applying sticker effect...');

        // Apply sticker post-processing
        let finalBlob;
        if (stickerMode === 'stickerify') {
            finalBlob = await applyStickerify(rawBlob);
        } else {
            finalBlob = await applyCurrentStroke(rawBlob);
        }

        const processTime = performance.now() - t0;
        results[id].processTime = processTime;
        results[id].totalTime = (results[id].loadTime || 0) + processTime;
        results[id].blob = finalBlob;
        results[id].status = 'done';

        setTime(id, 'process', processTime);
        setTime(id, 'total', results[id].totalTime);
        setProgress(id, 100);
        setCardState(id, 'done');
        setStatus(id, `Inference: ${fmt(processTime)}`);

        await displayResult(id, finalBlob);

    } catch (err) {
        console.error(`[${id}] Inference error:`, err);
        results[id].status = 'error';
        results[id].processTime = performance.now() - t0;
        results[id].totalTime = (results[id].loadTime || 0) + results[id].processTime;
        setCardState(id, 'error');
        setStatus(id, `Error: ${err.message.slice(0, 60)}`);
        setProgress(id, 100);
    }

    return results[id];
}

// ── Run inference on all preloaded models ───────────────────
async function runAllInference() {
    if (!uploadedFile || !preloadDone) return;

    btnRun.disabled = true;
    btnRun.textContent = 'Running Inference...';
    summarySection.style.display = 'none';

    // Reset inference-related state on cards
    MODELS.forEach(m => {
        if (loadedModels[m.id]) {
            setCardState(m.id, null);
            setStatus(m.id, 'Queued...');
            setProgress(m.id, 0);
            setTime(m.id, 'process', null);
            setTime(m.id, 'total', null);
            // Keep load time visible
            setTime(m.id, 'load', results[m.id]?.loadTime ?? null);
            const canvas = document.getElementById(`canvas-${m.id}`);
            canvas.classList.remove('visible');
            document.getElementById(`ph-${m.id}`).classList.remove('hidden');
            document.getElementById(`ph-${m.id}`).textContent = 'Queued...';
        }
    });

    // Run each model sequentially to avoid GPU/memory contention
    for (const model of MODELS) {
        await runInference(model, uploadedFile);
    }

    // Highlight fastest by process time (inference only)
    let fastestId = null;
    let fastestTime = Infinity;
    for (const [id, r] of Object.entries(results)) {
        if (r.status === 'done' && r.processTime < fastestTime) {
            fastestTime = r.processTime;
            fastestId = id;
        }
    }
    if (fastestId) {
        setCardState(fastestId, 'done');
        document.querySelector(`.model-card[data-model="${fastestId}"]`).classList.add('fastest');
    }

    buildSummary(fastestId);

    btnRun.disabled = false;
    btnRun.textContent = 'Run Inference Again';
}

// ── Build summary table ────────────────────────────────────
function buildSummary(fastestId) {
    summaryTbody.innerHTML = '';
    const sorted = MODELS.map(m => ({ ...m, ...results[m.id] }))
        .sort((a, b) => {
            if (a.status === 'done' && b.status !== 'done') return -1;
            if (a.status !== 'done' && b.status === 'done') return 1;
            return (a.processTime || Infinity) - (b.processTime || Infinity);
        });

    sorted.forEach(r => {
        const tr = document.createElement('tr');
        const isWinner = r.id === fastestId;
        const isFailed = r.status === 'error';
        tr.innerHTML = `
            <td>${r.name}${isWinner ? ' *' : ''}</td>
            <td>${fmt(r.loadTime)}</td>
            <td class="${isWinner ? 'winner' : ''}">${fmt(r.processTime)}</td>
            <td>${fmt(r.totalTime)}</td>
            <td class="${isFailed ? 'failed' : ''}">${r.status === 'done' ? 'OK' : r.status === 'error' ? 'FAIL' : '—'}</td>
        `;
        summaryTbody.appendChild(tr);
    });

    summarySection.style.display = 'block';
}

// ── Re-apply sticker effect ────────────────────────────────
async function reapplySticker() {
    if (Object.keys(results).length > 0) {
        const note = document.createElement('p');
        note.style.cssText = 'text-align:center;color:var(--primary);font-size:13px;font-weight:600;margin-bottom:16px;';
        note.textContent = 'Toggle changed! Click "Run Inference" to see results with the new sticker style.';
        const existing = document.querySelector('.toggle-note');
        if (existing) existing.remove();
        note.classList.add('toggle-note');
        btnRun.parentNode.insertBefore(note, btnRun);
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

    // Enable run button only if models are preloaded
    btnRun.disabled = !preloadDone;
    if (!preloadDone) {
        btnRun.textContent = 'Waiting for models...';
    } else {
        btnRun.textContent = 'Run Inference';
    }
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

// Run inference (not loading — models are already preloaded)
btnRun.addEventListener('click', () => runAllInference());

// ── Init: Start preloading immediately ─────────────────────
(async () => {
    const gpuAvailable = await hasWebGPU();
    const gpuCards = document.querySelectorAll('.badge-gpu');
    if (!gpuAvailable) {
        gpuCards.forEach(b => {
            b.textContent = 'WebGPU (N/A)';
            b.style.opacity = '0.5';
        });
    }
    console.log('Kopi Benchmark: Preloading all models. WebGPU:', gpuAvailable ? 'Available' : 'Not available');

    // Start preloading all models immediately
    btnRun.textContent = 'Preloading models...';
    btnRun.disabled = true;
    await preloadAllModels();
})();
