// ============================================================
// bg-removal.js — Background Removal (Supabase Edge Function)
// ============================================================

export function preloadModel() {
    // No-op. Cloud API doesn't need client-side preloading.
    console.log("Gemini 2.5: Cloud model, no preloading required.");
}

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

            const base64Img = await new Promise((res) => {
                const reader = new FileReader();
                reader.onloadend = () => res(reader.result.split(',')[1]);
                reader.readAsDataURL(imageBlob);
            });

            // Project ID extracted from config.js: ifwwlxasqzfiqpnphasr
            const endpoint = 'https://ifwwlxasqzfiqpnphasr.supabase.co/functions/v1/gemini-bg-removal';
            
            if (progressCallback) progressCallback({ type: 'status', message: 'Processing with AI...' });

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64: base64Img })
            });

            if (!response.ok) {
                const errResult = await response.json();
                console.error("Edge Function Error:", errResult);
                throw new Error(errResult.error || `Edge Function error ${response.status}`);
            }

            const data = await response.json();
            
            let resultBlob = null;
            for (const part of data.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                    resultBlob = base64ToBlob(part.inlineData.data, part.inlineData.mimeType);
                    break;
                } else if (part.text) {
                    // Check if it's returning base64 in markdown
                    const match = part.text.match(/```(png|jpeg|jpg|webp)\n([\s\S]+?)\n```/);
                    if (match) {
                        const mime = `image/${match[1]}`;
                        const base64Str = match[2].replace(/\s/g, '');
                        resultBlob = base64ToBlob(base64Str, mime);
                        break;
                    }
                }
            }

            if (!resultBlob) {
                console.error("Failed to parse Gemini response parts:", data.candidates?.[0]?.content?.parts);
                throw new Error('No image data returned from Edge Function.');
            }

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
                
                const trimmedCanvas = trimCanvas(canvas);
                URL.revokeObjectURL(bmpUrl);
                
                trimmedCanvas.toBlob((finalBlob) => resolve(finalBlob), 'image/webp', 0.85);
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
