// ============================================================
// bg-removal.js — Background Removal (briaai/RMBG-1.4 via WebWorker)
// ============================================================

// ---------------------------------------------------------------
// LARGEST CONNECTED COMPONENT FILTER
// BFS over opaque pixels, keeps only the biggest blob, zeroes others.
// ---------------------------------------------------------------
function keepLargestComponent(data, width, height) {
    const total = width * height;
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    const components = [];
    let largestId = -1, largestSize = 0;

    for (let start = 0; start < total; start++) {
        if (data[(start << 2) + 3] <= 50 || visited[start]) continue;

        let head = 0, tail = 0;
        queue[tail++] = start;
        visited[start] = 1;
        const pixels = [];

        while (head < tail) {
            const idx = queue[head++];
            pixels.push(idx);
            const x = idx % width;
            const y = (idx / width) | 0;

            if (x > 0) { const n = idx - 1; if (!visited[n] && data[(n << 2) + 3] > 50) { visited[n] = 1; queue[tail++] = n; } }
            if (x < width - 1) { const n = idx + 1; if (!visited[n] && data[(n << 2) + 3] > 50) { visited[n] = 1; queue[tail++] = n; } }
            if (y > 0) { const n = idx - width; if (!visited[n] && data[(n << 2) + 3] > 50) { visited[n] = 1; queue[tail++] = n; } }
            if (y < height - 1) { const n = idx + width; if (!visited[n] && data[(n << 2) + 3] > 50) { visited[n] = 1; queue[tail++] = n; } }
        }

        const id = components.length;
        components.push(pixels);
        if (pixels.length > largestSize) { largestSize = pixels.length; largestId = id; }
    }

    for (let id = 0; id < components.length; id++) {
        if (id === largestId) continue;
        for (const px of components[id]) data[(px << 2) + 3] = 0;
    }
}

// ---------------------------------------------------------------
// WHITE OUTLINE (Sticker edge effect)
// ---------------------------------------------------------------
function addWhiteOutline(blob, outlineWidth = 15) {
    const bmpUrl = URL.createObjectURL(blob);
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const pad = outlineWidth * 2;
            const canvas = document.createElement('canvas');
            canvas.width = img.width + pad;
            canvas.height = img.height + pad;
            const ctx = canvas.getContext('2d');

            // Radial silhouette draws
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
                const dx = Math.cos(angle) * outlineWidth;
                const dy = Math.sin(angle) * outlineWidth;
                ctx.drawImage(img, pad / 2 + dx, pad / 2 + dy);
            }

            // Fill silhouette white
            ctx.globalCompositeOperation = 'source-in';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw original on top
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(img, pad / 2, pad / 2);

            URL.revokeObjectURL(bmpUrl);
            trimCanvas(canvas).toBlob((b) => resolve(b), 'image/webp', 0.85);
        };
        img.src = bmpUrl;
    });
}

// ---------------------------------------------------------------
// TRIM CANVAS — removes empty transparent margins
// ---------------------------------------------------------------
export function trimCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const pixels = ctx.getImageData(0, 0, width, height);
    const l = pixels.data.length;
    let bound = { top: null, left: null, right: null, bottom: null };

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
    trimmed.getContext('2d').drawImage(canvas, bound.left, bound.top, trimWidth, trimHeight, 0, 0, trimWidth, trimHeight);
    return trimmed;
}

// ---------------------------------------------------------------
// RMBG-1.4 WebWorker — singleton setup
// ---------------------------------------------------------------
const _worker = new Worker('./hf-worker.js', { type: 'module' });
_worker.postMessage({
    type: 'init',
    modelId: 'briaai/RMBG-1.4',
    modelOpts: { config: { model_type: 'custom' } }
});

// Preload model 500ms after page fully renders (zero UI freeze)
window.addEventListener('load', () => {
    setTimeout(() => {
        console.log('[bg-removal] Preloading RMBG-1.4 model...');
        _worker.postMessage({ type: 'preload' });
    }, 500);
});

// ---------------------------------------------------------------
// removeBackground — Promise-based wrapper around the WebWorker.
// Drop-in replacement for the old imgly removeBackground().
// Returns a WebP Blob with white stroke, alpha-cleaned.
// ---------------------------------------------------------------
export async function removeBackground(imageBlob) {
    // Decode blob → ImageBitmap so we can drawImage it directly
    const bitmap = await createImageBitmap(imageBlob);

    // Send a URL the worker can fetch
    const url = URL.createObjectURL(imageBlob);

    return new Promise((resolve, reject) => {
        function onMessage(e) {
            const data = e.data;

            if (data.type === 'done') {
                _worker.removeEventListener('message', onMessage);
                URL.revokeObjectURL(url);

                const { maskData } = data;

                // Draw original image, apply mask alpha
                const cvs = document.createElement('canvas');
                cvs.width = bitmap.width;
                cvs.height = bitmap.height;
                const ctx = cvs.getContext('2d');
                ctx.drawImage(bitmap, 0, 0);

                const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
                for (let i = 0; i < maskData.length; ++i) {
                    imgData.data[i * 4 + 3] = maskData[i];
                }

                // Largest Connected Component filter — remove stray background blobs
                keepLargestComponent(imgData.data, cvs.width, cvs.height);

                ctx.putImageData(imgData, 0, 0);

                // Add white stroke, trim, export
                cvs.toBlob(async (alphaBlob) => {
                    try {
                        const finalBlob = await addWhiteOutline(alphaBlob);
                        resolve(finalBlob);
                    } catch (err) {
                        reject(err);
                    }
                }, 'image/webp', 0.85);

            } else if (data.type === 'error') {
                _worker.removeEventListener('message', onMessage);
                URL.revokeObjectURL(url);
                reject(new Error(data.error));
            }
            // 'status' and 'progress' messages are intentionally ignored here;
            // the caller (app.js) doesn't use them for UI today.
        }

        _worker.addEventListener('message', onMessage);
        _worker.postMessage({ url, width: bitmap.width, height: bitmap.height });
    });
}
