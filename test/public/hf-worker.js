import { env, AutoModel, AutoProcessor, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;

let hfPromise = null;
let currentModelId = null;
let _modelOpts = {};
let _processorOpts = {};

self.onmessage = async (e) => {
    try {
        if (e.data.type === 'init') {
            currentModelId = e.data.modelId;
            _modelOpts = e.data.modelOpts || {};
            _processorOpts = e.data.processorOpts || {};
            return;
        }

        if (e.data.type === 'preload' || (e.data.url && !hfPromise)) {
            if (!hfPromise) {
                self.postMessage({ type: 'status', data: `Downloading ${currentModelId}...` });

                let finalModelOpts = {
                    ..._modelOpts,
                    progress_callback: (p) => {
                        self.postMessage({ type: 'progress', data: p });
                    }
                };

                hfPromise = Promise.all([
                    AutoModel.from_pretrained(currentModelId, finalModelOpts),
                    AutoProcessor.from_pretrained(currentModelId, _processorOpts)
                ]).then((res) => {
                    self.postMessage({ type: 'status', data: "Ready (Preloaded)" });
                    return res;
                });
            }
            if (e.data.type === 'preload') return;
        }

        const { url, width, height } = e.data;

        self.postMessage({ type: 'status', data: "Processing image tensors..." });
        const [model, processor] = await hfPromise;
        const image = await RawImage.fromURL(url);
        const { pixel_values } = await processor(image);

        self.postMessage({ type: 'status', data: "Predicting Alpha Mask..." });
        const { output } = await model({ input: pixel_values });

        self.postMessage({ type: 'status', data: "Generating Final Image..." });

        // Some models output { output: tensor }, others return tensor directly. Handle various formats.
        const outputTensor = output[0] ? output[0] : output;
        const mask = await RawImage.fromTensor(outputTensor.mul(255).to('uint8')).resize(width, height);

        self.postMessage({ type: 'done', maskData: mask.data });

    } catch (err) {
        self.postMessage({ type: 'error', error: err.message });
    }
};
