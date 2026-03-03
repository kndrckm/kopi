// ============================================================
// bg-removal.js — Background Removal (imgly only)
// ============================================================

// Add white sticker outline around a transparent-bg image
async function addWhiteOutline(blob, outlineWidth = 8) {
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

            URL.revokeObjectURL(bmpUrl);
            resolve(canvas.toDataURL('image/png'));
        };
        img.src = bmpUrl;
    });
}

// Background removal via @imgly + white outline
export async function removeBackground(imageBlob) {
    const module = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm');
    const removeBg = module.removeBackground || module.default;

    const resultBlob = await removeBg(imageBlob, {
        progress: (key, current, total) => {
            console.log(`imgly: ${key} ${Math.round((current / total) * 100)}%`);
        }
    });

    return await addWhiteOutline(resultBlob);
}
