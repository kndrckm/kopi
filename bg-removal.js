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

import { removeBackground as imglyRemoveBackground, preload } from "https://esm.sh/@imgly/background-removal";

// Start background cache early so the model is ready instantly
const preloadConfig = {
    model: "medium"
};
preload(preloadConfig).catch(e => console.error("Warning: Could not pre-fetch AI model", e));

// Background removal via @imgly/background-removal (Local RMBG-1.4 Quantized)
export async function removeBackground(imageBlob, progressCallback = null) {
    return new Promise(async (resolve, reject) => {
        try {
            if (progressCallback) progressCallback({ type: 'status', message: 'Initializing local AI model...' });

            const config = {
                model: "medium",
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

            // Add stickerify stroke and drop shadow natively
            const imgUrl = URL.createObjectURL(resultBlob);
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                // Add white outline (dynamic thickness: ~2% of image size)
                const thickness = Math.floor(Math.max(canvas.width, canvas.height) * 0.02) || 15;
                let processedCanvas = stickerify(canvas, thickness, 'white');

                // Apply Drop Shadow AFTER stickerify
                const shadowPadded = document.createElement('canvas');
                // Allow enough room for a 15px blur shadow evenly around
                const shadowPad = 30;
                shadowPadded.width = processedCanvas.width + shadowPad * 2;
                shadowPadded.height = processedCanvas.height + shadowPad * 2;
                const shadowCtx = shadowPadded.getContext('2d');

                shadowCtx.shadowColor = 'rgba(0, 0, 0, 0.15)';
                shadowCtx.shadowBlur = 15;
                shadowCtx.shadowOffsetX = 0;
                shadowCtx.shadowOffsetY = 4;

                // Draw the stickerified image into the center, dropping the shadow
                shadowCtx.drawImage(processedCanvas, shadowPad, shadowPad);

                // Trim excess transparent margins off the final shadowed image
                processedCanvas = trimCanvas(shadowPadded);

                URL.revokeObjectURL(imgUrl);
                processedCanvas.toBlob((finalBlob) => resolve(finalBlob), 'image/webp', 0.85);
            };
            img.onerror = () => {
                URL.revokeObjectURL(imgUrl);
                resolve(resultBlob);
            }
            img.src = imgUrl;

        } catch (error) {
            console.error("Local BG Removal Error:", error);
            reject(error);
        }
    });
}
