// ============================================================
// bg-removal.js — Background Removal (RMBG-1.4 WebWorker)
// ============================================================

let worker = null;
let isModelPreloaded = false;

// Initialize the worker and start caching the model quietly
export function preloadModel() {
    if (worker || isModelPreloaded) return;

    worker = new Worker('hf-worker.js', { type: 'module' });
    worker.postMessage({
        type: 'init',
        modelId: 'briaai/RMBG-1.4',
        modelOpts: { config: { model_type: 'custom' } }
    });

    // Listen for the initial load progress
    worker.addEventListener('message', function preloadHandler(e) {
        if (e.data.type === 'status' && e.data.data === 'Ready') {
            isModelPreloaded = true;
            worker.removeEventListener('message', preloadHandler);
            console.log('RMBG-1.4 model preloaded successfully.');
        }
    });
}

// Ensure worker exists
function getWorker() {
    if (!worker) preloadModel();
    return worker;
}

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

    return components.length;
}

// Add white sticker outline around a transparent-bg image
async function addWhiteOutline(blob, outlineWidth = 15) {
    const bmpUrl = URL.createObjectURL(blob);
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const pad = outlineWidth * 2;
            const canvas = document.createElement('canvas');
            canvas.width = img.width + pad;
            canvas.height = img.height + pad;
            const ctx = canvas.getContext('2d');

            // Step 1: draw offset in all directions → dilated silhouette
            const offsets = [];
            for (let angle = 0; angle < 360; angle += 15) {
                offsets.push({
                    x: Math.cos(angle * Math.PI / 180) * outlineWidth,
                    y: Math.sin(angle * Math.PI / 180) * outlineWidth
                });
            }
            offsets.forEach(o => {
                ctx.drawImage(img, pad / 2 + o.x, pad / 2 + o.y);
            });

            // Step 2: fill silhouette with white
            ctx.globalCompositeOperation = 'source-in';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Step 3: draw original on top
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(img, pad / 2, pad / 2);

            // Step 4: Trim transparent margins (Autocrop)
            const trimmedCanvas = trimCanvas(canvas);

            URL.revokeObjectURL(bmpUrl);
            trimmedCanvas.toBlob((blob) => resolve(blob), 'image/webp', 0.85);
        };
        img.src = bmpUrl;
    });
}

// Helper to remove empty transparent pixels around the content
export function trimCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const pixels = ctx.getImageData(0, 0, width, height);
    const l = pixels.data.length;
    let bound = { top: null, left: null, right: null, bottom: null };

    // Use a higher alpha threshold (50) to ignore ghost shadows left by AI bg removal
    for (let i = 0; i < l; i += 4) {
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

    const trimWidth = bound.right - bound.left + 1;
    const trimHeight = bound.bottom - bound.top + 1;
    const trimmed = document.createElement('canvas');
    trimmed.width = trimWidth;
    trimmed.height = trimHeight;

    trimmed.getContext('2d').drawImage(canvas,
        bound.left, bound.top, trimWidth, trimHeight,
        0, 0, trimWidth, trimHeight
    );
    return trimmed;
}

// Background removal via briaai/RMBG-1.4 (Method B) + white outline
export async function removeBackground(imageBlob) {
    return new Promise(async (resolve, reject) => {
        const imgWorker = getWorker();
        const bmp = await createImageBitmap(imageBlob);

        const messageHandler = async (e) => {
            const data = e.data;
            if (data.type === 'progress') {
                console.log(`RMBG: DL ${data.data.name || 'Model'}: ${Math.round((data.data.loaded / data.data.total) * 100)}%`);
            } else if (data.type === 'status') {
                console.log('RMBG Status:', data.data);
            } else if (data.type === 'done') {
                imgWorker.removeEventListener('message', messageHandler);
                URL.revokeObjectURL(imageUrl);

                const { maskData } = data;

                // 1. Draw original onto canvas
                const cvs = document.createElement('canvas');
                cvs.width = bmp.width;
                cvs.height = bmp.height;
                const ctx = cvs.getContext('2d');
                ctx.drawImage(bmp, 0, 0);

                // 2. Inject Alpha Mask
                const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
                for (let i = 0; i < maskData.length; ++i) {
                    imgData.data[i * 4 + 3] = maskData[i];
                }

                // 3. Filter out disconnected artifacts (Largest Connected Component)
                keepLargestComponent(imgData.data, cvs.width, cvs.height);
                ctx.putImageData(imgData, 0, 0);

                // 4. Export to blob and add stroke
                const alphaBlob = await new Promise(res => cvs.toBlob(res, 'image/webp'));
                const finalBlob = await addWhiteOutline(alphaBlob, 15);

                resolve(finalBlob);
            } else if (data.type === 'error') {
                imgWorker.removeEventListener('message', messageHandler);
                URL.revokeObjectURL(imageUrl);
                reject(new Error(data.error));
            }
        };

        imgWorker.addEventListener('message', messageHandler);

        // Send to worker for inference
        const imageUrl = URL.createObjectURL(imageBlob);
        imgWorker.postMessage({
            type: 'predict',
            url: imageUrl,
            width: bmp.width,
            height: bmp.height
        });
    });
}
