// ============================================================
// bg-removal.js — Background Removal (ML Kit Subject Segmentation)
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

// ML Kit Subject Segmentation for background removal
// This uses the Capacitor ML Kit plugin for native subject segmentation
async function removeBackgroundWithMLKit(imageBlob) {
    return new Promise((resolve, reject) => {
        // Convert blob to base64 for ML Kit processing
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const base64Image = reader.result;
                
                // Call Capacitor ML Kit Subject Segmentation plugin
                const { SubjectSegmentation } = await import('@capacitor-mlkit/subject-segmentation');
                
                const result = await SubjectSegmentation.segmentSubject({
                    image: base64Image,
                    enableForegroundMask: true
                });
                
                // Process the segmentation result
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    
                    // Draw original image
                    ctx.drawImage(img, 0, 0);
                    
                    // Apply the foreground mask from ML Kit
                    if (result.foregroundMask) {
                        const maskCanvas = document.createElement('canvas');
                        maskCanvas.width = img.width;
                        maskCanvas.height = img.height;
                        const maskCtx = maskCanvas.getContext('2d');
                        
                        // Draw the mask
                        const maskImg = new Image();
                        maskImg.onload = () => {
                            maskCtx.drawImage(maskImg, 0, 0);
                            
                            // Apply mask to remove background
                            ctx.globalCompositeOperation = 'destination-in';
                            ctx.drawImage(maskCanvas, 0, 0);
                            
                            canvas.toBlob(resolve, 'image/png');
                        };
                        maskImg.src = result.foregroundMask;
                    } else {
                        resolve(imageBlob);
                    }
                };
                img.src = base64Image;
            } catch (error) {
                console.error("ML Kit Subject Segmentation Error:", error);
                reject(error);
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(imageBlob);
    });
}

// Fallback to server-side or alternative method if ML Kit fails
async function removeBackgroundFallback(imageBlob, progressCallback = null) {
    if (progressCallback) progressCallback({ type: 'status', message: 'Using fallback method...' });
    
    // You can implement a server-side fallback here
    // For now, return the original blob
    return imageBlob;
}

// Main background removal function using ML Kit
export async function removeBackground(imageBlob, progressCallback = null) {
    return new Promise(async (resolve, reject) => {
        try {
            if (progressCallback) progressCallback({ type: 'status', message: 'Initializing ML Kit...' });

            // Try ML Kit first
            let resultBlob;
            try {
                if (progressCallback) progressCallback({ type: 'status', message: 'Processing with ML Kit...' });
                resultBlob = await removeBackgroundWithMLKit(imageBlob);
            } catch (mlKitError) {
                console.warn("ML Kit failed, using fallback:", mlKitError);
                resultBlob = await removeBackgroundFallback(imageBlob, progressCallback);
            }

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
            console.error("BG Removal Error:", error);
            reject(error);
        }
    });
}
