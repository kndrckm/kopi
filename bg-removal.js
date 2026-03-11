// ============================================================
// bg-removal.js — Background Removal (Supabase Edge Function)
// ============================================================

// Helper to remove empty transparent pixels around the content
export function trimCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const pixels = ctx.getImageData(0, 0, width, height);
    const l = pixels.data.length;
    let bound = { top: null, left: null, right: null, bottom: null };

    // Use a higher alpha threshold (50) to ignore ghost shadows
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

// Native Stickerify Implementation to add outline locally
function stickerify(canvas, thickness = 20, fillStyle = 'white', samples = 36) {
    const x = thickness + 1;
    const y = thickness + 1;
    const padded = document.createElement('canvas');
    padded.width = canvas.width + x * 2;
    padded.height = canvas.height + y * 2;
    const ctx = padded.getContext('2d');

    // Draw original image in a circle to create the shadow structure
    for (let angle = 0; angle < 360; angle += 360 / samples) {
        ctx.drawImage(canvas, thickness * Math.sin((Math.PI * 2 * angle) / 360) + x, thickness * Math.cos((Math.PI * 2 * angle) / 360) + y);
    }

    // Fill the accumulated shadow region with the solid border color
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = fillStyle;
    ctx.fillRect(0, 0, padded.width, padded.height);

    // Draw original image securely on top
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(canvas, x, y);

    return padded;
}

import { removeBackground as imglyRemoveBackground } from "https://esm.sh/@imgly/background-removal";

// Background removal via @imgly/background-removal (Local RMBG-1.4 Quantized)
export async function removeBackground(imageBlob, progressCallback = null) {
    return new Promise(async (resolve, reject) => {
        try {
            if (progressCallback) progressCallback({ type: 'status', message: 'Initializing local AI model...' });

            const config = {
                publicPath: "https://unpkg.com/@imgly/background-removal@1.4.3/dist/",
                model: "isnet_quint8",
                progress: (key, current, total) => {
                    if (progressCallback) {
                        const message = total > 0 
                            ? `Downloading AI (${Math.round((current / total) * 100)}%)`
                            : `Processing image...`;
                        progressCallback({ type: 'progress', message: message, progress: total > 0 ? Math.round((current / total) * 100) : 0 });
                    }
                }
            };

            const resultBlob = await imglyRemoveBackground(imageBlob, config);

            if (progressCallback) progressCallback({ type: 'status', message: 'Trimming image...' });

            // Trim transparent margins (Autocrop)
            const bmpUrl = URL.createObjectURL(resultBlob);
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                let processedCanvas = trimCanvas(canvas);

                // Add stickerify stroke (dynamic thickness based on image size)
                const thickness = Math.floor(Math.max(processedCanvas.width, processedCanvas.height) * 0.04) || 20;
                processedCanvas = stickerify(processedCanvas, thickness, 'white');

                URL.revokeObjectURL(bmpUrl);

                processedCanvas.toBlob((finalBlob) => resolve(finalBlob), 'image/webp', 0.85);
            };
            img.onerror = () => {
                URL.revokeObjectURL(bmpUrl);
                resolve(resultBlob); // Fallback to untrimmed if error
            }
            img.src = bmpUrl;

        } catch (error) {
            console.error("Local BG Removal Error:", error);
            reject(error);
        }
    });
}
