// ============================================================
// benchmark.js — Kopi BG Removal Model Benchmark
// Each model loads + runs inference individually when "Run All" is clicked
// ============================================================

import { pipeline, AutoModel, AutoProcessor, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1';

env.allowLocalModels = false;

// ── Model Definitions (4 models — u2netp and BEN2 removed) ─
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
        id: 'birefnet-lite',
        name: 'BiRefNet-lite',
        modelId: 'onnx-community/BiRefNet_lite-ONNX',
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

// ════════════════════════════════════════════════════════════
// LOAD + INFERENCE PER MODEL (sequential)
// ════════════════════════════════════════════════════════════

async function runModel(modelDef, imageBlob) {
    const { id, modelId, device, dtype } = modelDef;

    results[id] = { status: 'running', loadTime: null, processTime: null, totalTime: null, blob: null };

    setCardState(id, 'running');
    setStatus(id, 'Loading model...');
    setProgress(id, 5);

    const tStart = performance.now();

    try {
        // ── Step 1: Determine device ──
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
                const pct = Math.round((p.loaded / p.total) * 45);
                setProgress(id, 5 + pct);
                const mb = (p.loaded / 1024 / 1024).toFixed(1);
                setStatus(id, `Downloading... ${mb} MB`);
            }
        };

        // ── Step 2: Load model ──
        let model, processor, segmenter;
        const tLoad0 = performance.now();

        if (modelDef.useAutoModel) {
            [model, processor] = await Promise.all([
                AutoModel.from_pretrained(modelId, {
                    dtype: dtype,
                    revision: 'main',
                    config: modelDef.modelConfig || {},
                    device: actualDevice,
                    progress_callback: progressCb,
                }),
                AutoProcessor.from_pretrained(modelId, {}),
            ]);
        } else {
            segmenter = await pipeline('background-removal', modelId, {
                device: actualDevice,
                dtype: dtype,
                progress_callback: progressCb,
            });
        }

        const loadTime = performance.now() - tLoad0;
        results[id].loadTime = loadTime;
        setTime(id, 'load', loadTime);
        setProgress(id, 55);
        setStatus(id, 'Processing image...');

        // ── Step 3: Run inference ──
        const tProc0 = performance.now();
        let rawBlob;

        if (modelDef.useAutoModel) {
            const bmp = await createImageBitmap(imageBlob);
            const imgUrl = URL.createObjectURL(imageBlob);
            const image = await RawImage.fromURL(imgUrl);
            URL.revokeObjectURL(imgUrl);

            setProgress(id, 65);

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
            const imageUrl = URL.createObjectURL(imageBlob);
            setProgress(id, 65);
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

        setProgress(id, 85);
        setStatus(id, 'Applying sticker effect...');

        // ── Step 4: Apply sticker post-processing ──
        let finalBlob;
        if (stickerMode === 'stickerify') {
            finalBlob = await applyStickerify(rawBlob);
        } else {
            finalBlob = await applyCurrentStroke(rawBlob);
        }

        const processTime = performance.now() - tProc0;
        const totalTime = performance.now() - tStart;

        results[id].processTime = processTime;
        results[id].totalTime = totalTime;
        results[id].blob = finalBlob;
        results[id].status = 'done';

        setTime(id, 'process', processTime);
        setTime(id, 'total', totalTime);
        setProgress(id, 100);
        setCardState(id, 'done');
        setStatus(id, `Done — ${fmt(totalTime)}`);

        await displayResult(id, finalBlob);

    } catch (err) {
        console.error(`[${id}] Error:`, err);
        const totalTime = performance.now() - tStart;
        results[id].status = 'error';
        results[id].totalTime = totalTime;
        setCardState(id, 'error');
        setStatus(id, `Error: ${err.message.slice(0, 60)}`);
        setProgress(id, 100);
    }

    return results[id];
}

// ── Run all models sequentially ────────────────────────────
async function runAll() {
    if (!uploadedFile) return;

    btnRun.disabled = true;
    btnRun.textContent = 'Running...';
    summarySection.style.display = 'none';
    results = {};

    // Reset all cards
    MODELS.forEach(m => {
        setCardState(m.id, null);
        setStatus(m.id, 'Queued...');
        setProgress(m.id, 0);
        setTime(m.id, 'load', null);
        setTime(m.id, 'process', null);
        setTime(m.id, 'total', null);
        const canvas = document.getElementById(`canvas-${m.id}`);
        canvas.classList.remove('visible');
        document.getElementById(`ph-${m.id}`).classList.remove('hidden');
        document.getElementById(`ph-${m.id}`).textContent = 'Queued...';
    });

    // Run each model one at a time
    for (const model of MODELS) {
        await runModel(model, uploadedFile);
    }

    // Highlight fastest by total time
    let fastestId = null;
    let fastestTime = Infinity;
    for (const [id, r] of Object.entries(results)) {
        if (r.status === 'done' && r.totalTime < fastestTime) {
            fastestTime = r.totalTime;
            fastestId = id;
        }
    }
    if (fastestId) {
        setCardState(fastestId, 'done');
        document.querySelector(`.model-card[data-model="${fastestId}"]`).classList.add('fastest');
    }

    buildSummary(fastestId);

    btnRun.disabled = false;
    btnRun.textContent = 'Run All Models';
}

// ── Build summary table ────────────────────────────────────
function buildSummary(fastestId) {
    summaryTbody.innerHTML = '';
    const sorted = MODELS.map(m => ({ ...m, ...results[m.id] }))
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
            <td class="${isFailed ? 'failed' : ''}">${r.status === 'done' ? 'OK' : r.status === 'error' ? 'FAIL' : '—'}</td>
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
        note.textContent = 'Toggle changed! Click "Run All Models" to see results with the new sticker style.';
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

    btnRun.disabled = false;
    btnRun.textContent = 'Run All Models';
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

// Run button
btnRun.addEventListener('click', () => runAll());

// ── Init ───────────────────────────────────────────────────
(async () => {
    const gpuAvailable = await hasWebGPU();
    const gpuCards = document.querySelectorAll('.badge-gpu');
    if (!gpuAvailable) {
        gpuCards.forEach(b => {
            b.textContent = 'WebGPU (N/A)';
            b.style.opacity = '0.5';
        });
    }
    console.log('Kopi Benchmark: Ready. WebGPU:', gpuAvailable ? 'Available' : 'Not available');
})();
