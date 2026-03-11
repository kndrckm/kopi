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

// Convert Base64 into a Blob
function base64ToBlob(base64Str, mime) {
    const byteString = atob(base64Str);
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const int8Array = new Uint8Array(arrayBuffer);
    for (let i = 0; i < byteString.length; i++) {
        int8Array[i] = byteString.charCodeAt(i);
    }
    return new Blob([int8Array], { type: mime });
}

// Background removal via Secure Supabase Edge Function (Gemini handles the white outline)
export async function removeBackground(imageBlob, progressCallback = null) {
    return new Promise(async (resolve, reject) => {
        try {
            if (progressCallback) progressCallback({ type: 'status', message: 'Uploading to Edge Function...' });

            // We compress the image first. Supabase Edge Functions have a 2MB payload size limit.
            // If the image is loaded from an old high-res DB entry it will crash the function.
            const { base64Img, mimeType } = await new Promise((res) => {
                const img = new Image();
                const objUrl = URL.createObjectURL(imageBlob);
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Downscale if larger than 1024px to save payload size
                    const MAX_SIZE = 1024;
                    if (width > MAX_SIZE || height > MAX_SIZE) {
                        const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
                        width = width * ratio;
                        height = height * ratio;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Use JPEG for the API payload to ensure maximum compatibility (WebP is sometimes rejected by REST API versions)
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    URL.revokeObjectURL(objUrl);

                    const match = dataUrl.match(/^data:(image\/[a-zA-Z+-]+);base64,(.+)$/);
                    if (match) {
                        res({ mimeType: match[1], base64Img: match[2] });
                    } else {
                        res({ mimeType: 'image/jpeg', base64Img: dataUrl.split(',')[1] });
                    }
                };
                img.onerror = () => {
                    // Fallback to FileReader if image parsing completely fails
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const match = reader.result.match(/^data:(image\/[a-zA-Z+-]+);base64,(.+)$/);
                        if (match) {
                            res({ mimeType: match[1], base64Img: match[2] });
                        } else {
                            res({ mimeType: 'image/jpeg', base64Img: reader.result.split(',')[1] || reader.result });
                        }
                    };
                    reader.readAsDataURL(imageBlob);
                };
                img.src = objUrl;
            });

            // New AI Studio Proxy Endpoint (handles API key securely on the server side)
            const endpoint = 'https://ais-dev-qgle3en2mrpmqhuege3w5c-326537839013.asia-east1.run.app/api/remove-bg';

            if (progressCallback) progressCallback({ type: 'status', message: 'Processing with AI Studio...' });

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64: `data:${mimeType};base64,${base64Img}`, mimeType: mimeType })
            });

            if (!response.ok) {
                const errResult = await response.json().catch(() => ({}));
                console.error("AI Studio Error:", errResult);
                throw new Error(errResult.error || `AI Studio error ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.success || !data.resultImage) {
                console.error("AI Studio Failure:", data);
                throw new Error(data.error || 'AI Studio failed to return image data.');
            }

            // The resultImage is a full data URL (e.g. data:image/png;base64,...)
            const resultBase64 = data.resultImage.split(',')[1];
            const resultBlob = base64ToBlob(resultBase64, 'image/png');

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
            console.error(error);
            reject(error);
        }
    });
}
