// ============================================================
// worker.js — Dedicated Web Worker for RMBG-1.4 inference
// Handles model loading, caching, inference, and tensor disposal
// off the main thread to prevent UI freezes and OOM crashes.
// ============================================================

import {
    AutoModel,
    AutoProcessor,
    RawImage,
    env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1';

env.allowLocalModels = false;

// ── Model + Processor cache (reuse across runs) ────────────
const modelCache = {};    // keyed by cacheKey = `${modelId}|${device}|${dtype}|${quantized}`
const processorCache = {}; // keyed by modelId

function cacheKey(cfg) {
    return `${cfg.modelId}|${cfg.device}|${cfg.dtype}|${cfg.quantized}`;
}

// ── Message handler ────────────────────────────────────────
self.onmessage = async (e) => {
    const { type, id, config, imageData, imageWidth, imageHeight } = e.data;

    if (type !== 'run') return;

    try {
        // ── Step 1: Load or retrieve cached model + processor ──
        const key = cacheKey(config);
        let model, processor;

        if (modelCache[key]) {
            model = modelCache[key];
            processor = processorCache[config.modelId];
            self.postMessage({ type: 'status', id, text: 'Using cached model...' });
            self.postMessage({ type: 'progress', id, pct: 50 });
        } else {
            self.postMessage({ type: 'status', id, text: 'Loading model...' });
            self.postMessage({ type: 'progress', id, pct: 5 });

            const progressCb = (p) => {
                if (p.status === 'progress' && p.total) {
                    const pct = Math.round((p.loaded / p.total) * 45);
                    self.postMessage({ type: 'progress', id, pct: 5 + pct });
                    const mb = (p.loaded / 1024 / 1024).toFixed(1);
                    self.postMessage({ type: 'status', id, text: `Downloading... ${mb} MB` });
                }
            };

            // Build from_pretrained options
            const modelOpts = {
                revision: 'main',
                config: { model_type: 'bria-rmbg' },
                device: config.device,
                progress_callback: progressCb,
            };

            // Always set dtype explicitly to avoid Transformers.js defaults
            // uint8 + quantized:true  → model_quantized.onnx (44 MB)
            // fp16                    → model_fp16.onnx      (88 MB)
            // fp32 + quantized:false  → model.onnx           (176 MB)
            if (config.dtype) {
                modelOpts.dtype = config.dtype;
            }
            if (config.quantized) {
                modelOpts.quantized = true;
            } else {
                modelOpts.quantized = false;
            }

            const tLoad0 = performance.now();

            [model, processor] = await Promise.all([
                AutoModel.from_pretrained(config.modelId, modelOpts),
                processorCache[config.modelId]
                    ? Promise.resolve(processorCache[config.modelId])
                    : AutoProcessor.from_pretrained(config.modelId, {}),
            ]);

            const loadTime = performance.now() - tLoad0;

            // Cache for reuse
            modelCache[key] = model;
            processorCache[config.modelId] = processor;

            self.postMessage({ type: 'loadTime', id, loadTime });
        }

        self.postMessage({ type: 'progress', id, pct: 55 });
        self.postMessage({ type: 'status', id, text: 'Processing image...' });

        // ── Step 2: Reconstruct image from raw pixel data ──
        // We receive pre-downscaled RGBA pixel data from the main thread
        const rawImage = new RawImage(
            new Uint8ClampedArray(imageData),
            imageWidth,
            imageHeight,
            4 // RGBA channels
        );

        // ── Step 3: Run inference ──
        const tProc0 = performance.now();

        const { pixel_values } = await processor(rawImage);
        self.postMessage({ type: 'progress', id, pct: 65 });

        const { output } = await model({ input: pixel_values });

        const outputTensor = output[0] ? output[0] : output;
        const maskTensor = outputTensor.mul(255).to('uint8');
        const mask = await RawImage.fromTensor(maskTensor).resize(imageWidth, imageHeight);

        // ── Step 4: Dispose tensors to free WASM/GPU memory ──
        try { pixel_values.dispose(); } catch (_) {}
        try { outputTensor.dispose(); } catch (_) {}
        try { maskTensor.dispose(); } catch (_) {}
        try { if (output[0]) output[0].dispose(); } catch (_) {}

        const processTime = performance.now() - tProc0;

        self.postMessage({ type: 'progress', id, pct: 80 });
        self.postMessage({ type: 'status', id, text: 'Generating result...' });

        // ── Step 5: Compose masked image (apply alpha) ──
        // Build RGBA output with mask as alpha channel
        const pixelCount = imageWidth * imageHeight;
        const resultData = new Uint8ClampedArray(pixelCount * 4);
        const srcPixels = new Uint8ClampedArray(imageData);

        for (let i = 0; i < pixelCount; i++) {
            resultData[i * 4]     = srcPixels[i * 4];     // R
            resultData[i * 4 + 1] = srcPixels[i * 4 + 1]; // G
            resultData[i * 4 + 2] = srcPixels[i * 4 + 2]; // B
            resultData[i * 4 + 3] = mask.data[i];          // A from mask
        }

        self.postMessage({ type: 'progress', id, pct: 90 });

        // Send result back (transferable for zero-copy)
        self.postMessage(
            {
                type: 'result',
                id,
                processTime,
                resultData: resultData.buffer,
                width: imageWidth,
                height: imageHeight,
            },
            [resultData.buffer]
        );

    } catch (err) {
        self.postMessage({
            type: 'error',
            id,
            message: String(err.message || err).slice(0, 120),
        });
    }
};
