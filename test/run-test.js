const fs = require('fs');
const path = require('path');

async function benchmark(methodName, url, filePath) {
    try {
        console.log(`\n--- Starting ${methodName} ---`);
        const fileBuffer = fs.readFileSync(filePath);
        const blob = new Blob([fileBuffer], { type: 'image/png' });

        const formData = new FormData();
        formData.append('photo', blob, 'test.png');

        const start = performance.now();
        const res = await fetch(url, { method: 'POST', body: formData });

        if (!res.ok) {
            console.error(`${methodName} failed with status: ${res.status}`);
            return;
        }

        const resultBlob = await res.blob();
        const end = performance.now();
        const buffer = Buffer.from(await resultBlob.arrayBuffer());
        const outPath = path.join(__dirname, `result-${methodName.toLowerCase().replace(' ', '-')}.webp`);
        fs.writeFileSync(outPath, buffer);
        console.log(`✅ ${methodName} finished in ${Math.round(end - start)} ms`);
        console.log(`Saved result to ${outPath}\n`);
    } catch (e) {
        console.error(`${methodName} Error:`, e);
    }
}

async function runAll() {
    const imgPath = path.join(__dirname, 'public', 'Gemini_Generated_Image_ap9ah4ap9ah4ap9a.png');
    console.log(`File size: ${Math.round(fs.statSync(imgPath).size / 1024)} KB`);

    // Warmup request to download model if applicable
    console.log('--- WARMING UP THE SERVER... ---');
    await benchmark('Warmup', 'http://localhost:3001/api/method-c', imgPath);

    await benchmark('Method B', 'http://localhost:3001/api/method-b', imgPath);
    await benchmark('Method C', 'http://localhost:3001/api/method-c', imgPath);
}

runAll();
