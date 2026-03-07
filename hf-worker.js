import { env, AutoModel, AutoProcessor, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0-alpha.15';

env.allowLocalModels = false;

let hfPromise = null;
let currentModelId = null;

self.onmessage = async (e) => {
    try {
        if (e.data.type === 'init') {
            currentModelId = e.data.modelId;
            const userModelOpts = e.data.modelOpts || {};

            // Try to use WebGPU for massive speedup, but gracefully fallback to CPU (WASM)
            // if WebGPU isn't supported on the device.
            const preferredDevice = navigator.gpu ? 'webgpu' : 'wasm';

            const modelOpts = {
                ...userModelOpts,
                device: preferredDevice,
                progress_callback: (p) => {
                    self.postMessage({ type: 'progress', data: p });
                }
            };
            const processorOpts = { ...(e.data.processorOpts || {}), device: preferredDevice };

            self.postMessage({ type: 'status', data: `Downloading ${currentModelId}...` });

            hfPromise = Promise.all([
                AutoModel.from_pretrained(currentModelId, modelOpts),
                AutoProcessor.from_pretrained(currentModelId, processorOpts)
            ]).then((res) => {
                self.postMessage({ type: 'status', data: "Ready" });
                return res;
            });
            return;
        }

        if (e.data.type === 'predict') {
            const { url, width, height } = e.data;

            self.postMessage({ type: 'status', data: "Processing image tensors..." });

            const image = await RawImage.fromURL(url);

            if (!hfPromise) throw new Error("Worker not initialized. Call init first.");
            const [model, processor] = await hfPromise;

            const { pixel_values } = await processor(image);

            self.postMessage({ type: 'status', data: "Predicting Alpha Mask..." });
            const { output } = await model({ input: pixel_values });

            self.postMessage({ type: 'status', data: "Generating Final Image..." });

            // Some models output { output: tensor }, others return tensor directly. Handle various formats.
            const outputTensor = output[0] ? output[0] : output;
            const mask = await RawImage.fromTensor(outputTensor.mul(255).to('uint8')).resize(width, height);

            self.postMessage({ type: 'done', maskData: mask.data });
        }
    } catch (err) {
        self.postMessage({ type: 'error', error: err.message });
    }
};
