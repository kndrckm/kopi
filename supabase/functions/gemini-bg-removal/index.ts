import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { imageBase64, mimeType } = await req.json()
    // Using the secret the user created: GEMINI_KOPI
    const apiKey = Deno.env.get('GEMINI_KOPI')
    
    if (!apiKey) {
      throw new Error("API Key GEMINI_KOPI not found in edge function environment environment");
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1alpha/models/gemini-2.5-flash:generateContent?key=${apiKey}`
    const payload = {
        contents: [{
            role: "user",
            parts: [
                { inlineData: { mimeType: mimeType || "image/jpeg", data: imageBase64 } },
                { text: "Extract the main subject, remove the background (make it transparent), and add a thick white sticker border around the subject. Output as a transparent PNG if possible." }
            ]
        }],
        generationConfig: { 
            temperature: 0.1,
            topK: 32,
            topP: 1,
            maxOutputTokens: 8192
        }
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    
    const data = await response.json()
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
  }
})
