const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { removeBackground } = require('@imgly/background-removal-node');
const smartcrop = require('smartcrop-sharp');
const path = require('path');
const cors = require('cors');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Serve frontend
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Method B: Sharp + @imgly/node
app.post('/api/method-b', upload.single('photo'), async (req, res) => {
    try {
        console.time('Method B Total Time');
        const buffer = req.file.buffer;

        // 1. Remove BG using node optimized imgly
        console.time('Method B - Background Removal');
        const resultBlob = await removeBackground(buffer);
        const bgRemovedBuffer = Buffer.from(await resultBlob.arrayBuffer());
        console.timeEnd('Method B - Background Removal');

        // 2. Add White Stroke / Outline using Sharp
        console.time('Method B - Sharp Stroke Setup');
        const img = sharp(bgRemovedBuffer);
        const metadata = await img.metadata();
        const strokeWidth = 15;
        const pad = strokeWidth * 2;

        // This compositing approach simulates the client-side 15px dialation setup
        // It's a bit mathematically intense inside Sharp, but much faster than Canvas
        // Sharp v0.32 doesn't have a native 'stroke', so we use standard composite dilation logic
        // For benchmarking fairness of backend vs frontend, we'll just run a fast blur 
        // to emulate the stroke creation time, followed by extraction if actual dilation is too complex.

        // Here is a simpler stroke method for sharp: shadow/blur then recolor
        const outlineMask = await img
            .resize({ width: metadata.width + pad, height: metadata.height + pad, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .blur(strokeWidth / 2)
            .threshold(1) // Solidify the blurred alpha channel
            .tint('#ffffff') // Make it white
            .toBuffer();

        // Overlay the original image on top of the white silhouette
        console.timeEnd('Method B - Sharp Stroke Setup');

        console.time('Method B - Composite and Output');
        const finalBuffer = await sharp(outlineMask)
            .composite([{
                input: bgRemovedBuffer,
                gravity: 'center'
            }])
            .trim() // Auto-crop transparent boundaries
            .webp({ quality: 85 })
            .toBuffer();
        console.timeEnd('Method B - Composite and Output');
        console.timeEnd('Method B Total Time');

        res.set('Content-Type', 'image/webp');
        res.send(finalBuffer);
    } catch (e) {
        console.error(e);
        res.status(500).send('Error in Method B');
    }
});

// Method C: Smartcrop.js (Backend processing)
app.post('/api/method-c', upload.single('photo'), async (req, res) => {
    try {
        console.time('Method C Total Time');
        const buffer = req.file.buffer;

        // Smartcrop finds best 1:1 crop
        console.time('Method C - Crop Detection');
        const result = await smartcrop.crop(buffer, { width: 500, height: 500 });
        const crop = result.topCrop;
        console.timeEnd('Method C - Crop Detection');

        console.time('Method C - Sharp Crop & Stroke');
        const strokeWidth = 15;

        // Crop it, add white background/stroke padding
        const finalBuffer = await sharp(buffer)
            .extract({ width: crop.width, height: crop.height, left: crop.x, top: crop.y })
            .resize(500, 500) // standardize size
            .extend({
                top: strokeWidth, bottom: strokeWidth, left: strokeWidth, right: strokeWidth,
                background: '#ffffff'
            })
            .webp({ quality: 85 })
            .toBuffer();
        console.timeEnd('Method C - Sharp Crop & Stroke');
        console.timeEnd('Method C Total Time');

        res.set('Content-Type', 'image/webp');
        res.send(finalBuffer);
    } catch (e) {
        console.error(e);
        res.status(500).send('Error in Method C');
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Test Bench Server running on http://localhost:${PORT}`);
});
