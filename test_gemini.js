const fs = require('fs');
const path = require('path');

async function testGemini() {
    const apiKey = 'AIzaSyDRo1kluvDWv84Q1zgbbkveTLA1YebpruQ';
    
    // Read an image to base64
    const imgPath = path.join(__dirname, 'test', 'public', 'photo.jpg'); // Try to find a photo
    let base64Data;
    let mimeType = 'image/jpeg';
    
    try {
        const fileData = fs.readFileSync(imgPath);
        base64Data = fileData.toString('base64');
    } catch (e) {
        // Fallback to something else if photo.jpg doesn't exist
        console.log("Could not read photo.jpg, using a tiny 1x1 image.");
        base64Data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        mimeType = 'image/png';
    }

    const prompt = 'Extract the main subject, remove the background (make it transparent). Output ONLY as a transparent PNG if possible without any other context.';
    const payload = {
        contents: [{ parts: [ { inlineData: { mimeType: mimeType, data: base64Data } }, { text: prompt } ] }]
    };

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1alpha/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log("STATUS:", response.status);
        console.log("RESPONSE JSON:", JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("ERROR:", err);
    }
}

testGemini();
