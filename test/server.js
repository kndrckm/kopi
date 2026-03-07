const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { removeBackground } = require('@imgly/background-removal-node');
const smartcrop = require('smartcrop-sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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
        const blob = new Blob([buffer], { type: req.file.mimetype });
        const resultBlob = await removeBackground(blob);
        const bgRemovedBuffer = Buffer.from(await resultBlob.arrayBuffer());
        console.timeEnd('Method B - Background Removal');
        console.timeEnd('Method B Total Time');

        res.set('Content-Type', 'image/png');
        res.send(bgRemovedBuffer);
    } catch (e) {
        console.error(e);
        res.status(500).send('Error in Method B');
    }
});

// --------------------------------------------------------------------------------------
// METHOD D: @harshit_01/ai-bg-remover
// (This is a Node wrapper around Python rembg. It creates temp files and execs rembg)
// --------------------------------------------------------------------------------------
const aiBgRemover = require('@harshit_01/ai-bg-remover');

app.post('/api/method-d', upload.single('photo'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    try {
        console.time('Method D Total Time');

        // ai-bg-remover requires actual files on disk
        const tempId = crypto.randomBytes(8).toString('hex');
        const inPath = path.join(__dirname, `temp_in_${tempId}.png`);
        const outPath = path.join(__dirname, `temp_out_${tempId}.png`);

        fs.writeFileSync(inPath, req.file.buffer);

        console.time('Method D - rembg Python Process');
        // This will throw if python `rembg` is not installed globally!
        await aiBgRemover.removeBg(inPath, outPath);
        console.timeEnd('Method D - rembg Python Process');

        const finalBuffer = fs.readFileSync(outPath);

        // cleanup temp files
        fs.unlinkSync(inPath);
        fs.unlinkSync(outPath);

        console.timeEnd('Method D Total Time');

        res.set('Content-Type', 'image/png');
        res.send(finalBuffer);
    } catch (e) {
        console.error('Method D Error (Is Python rembg installed?):', e);
        res.status(500).send('Error in Method D: ' + e.message);
    }
});

// --------------------------------------------------------------------------------------

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

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Test Bench Server running on http://localhost:${PORT}`);
});
