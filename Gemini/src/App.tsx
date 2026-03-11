import React, { useState, useRef } from 'react';
import { Upload, Image as ImageIcon, Clock, CheckCircle2, AlertCircle, Trash2, Download, RefreshCw, Zap, Scissors } from 'lucide-react';
import { removeBackground } from '@imgly/background-removal';
import { GoogleGenAI } from '@google/genai';
import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';
import { cn } from './lib/utils';

const MODELS = [
  { id: 'rmbg-1.4-local', name: 'RMBG-1.4 (Local In-Browser)', type: 'local', prompt: '' },
  { id: 'mediapipe', name: 'Google MediaPipe (Local)', type: 'mediapipe', prompt: '' },
  { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image (Transparent)', type: 'gemini', prompt: 'Extract the main subject, remove the background (make it transparent), and add a thick white sticker border around the subject. Output as a transparent PNG if possible.' },
];

type HistoryItem = {
  id: string;
  modelId: string;
  modelName: string;
  timeMs: number;
  originalImage: string;
  resultImage: string;
  status: 'success' | 'error';
  errorMessage?: string;
  timestamp: Date;
};

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(MODELS[0].id);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState<string>('');
  const [currentResult, setCurrentResult] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [processingTime, setProcessingTime] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file: File) => {
    if (file.type.startsWith('image/')) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setCurrentResult(null);
      setProcessingTime(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const processImage = async () => {
    if (!selectedFile) return;
    
    setIsProcessing(true);
    setProgressText('Initializing...');
    const startTime = performance.now();
    const model = MODELS.find(m => m.id === selectedModel)!;
    
    let resultUrl = '';
    let status: 'success' | 'error' = 'success';
    let errorMessage = '';

    try {
      if (model.type === 'local') {
        setProgressText('Loading local model & processing...');
        try {
          const blob = await removeBackground(selectedFile, {
            progress: (key, current, total) => {
              const percent = Math.round((current / total) * 100);
              setProgressText(`Downloading model assets: ${percent}%`);
            }
          });
          resultUrl = URL.createObjectURL(blob);
        } catch (err: any) {
          if (err.message?.includes('NetworkError') || err.message?.includes('fetch')) {
            throw new Error('Failed to download local model assets. Your browser or network might be blocking the download. Please try another model.');
          }
          throw err;
        }
      } else if (model.type === 'mediapipe') {
        setProgressText('Loading MediaPipe model...');
        try {
          const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
          );
          const imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
              delegate: "GPU"
            },
            runningMode: "IMAGE",
            outputCategoryMask: true,
            outputConfidenceMasks: false
          });

          setProgressText('Segmenting image...');
          const imageElement = new Image();
          imageElement.src = URL.createObjectURL(selectedFile);
          await new Promise((resolve) => {
            imageElement.onload = resolve;
          });

          const segmentationResult = imageSegmenter.segment(imageElement);
          const mask = segmentationResult.categoryMask?.getAsUint8Array();
          
          if (mask) {
            const canvas = document.createElement('canvas');
            canvas.width = imageElement.width;
            canvas.height = imageElement.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(imageElement, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            
            for (let i = 0; i < mask.length; ++i) {
              if (mask[i] === 0) {
                imageData.data[i * 4 + 3] = 0; // Set alpha to 0 for background
              }
            }
            ctx.putImageData(imageData, 0, 0);
            const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
            if (blob) {
              resultUrl = URL.createObjectURL(blob);
            } else {
              throw new Error('Failed to create image blob from canvas');
            }
          } else {
            throw new Error('Failed to generate segmentation mask');
          }
        } catch (err: any) {
          if (err.message?.includes('NetworkError') || err.message?.includes('fetch')) {
            throw new Error('Failed to download MediaPipe model. Your browser or network might be blocking the download. Please try another model.');
          }
          throw err;
        }
      } else if (model.type === 'gemini') {
        setProgressText('Sending to Gemini API...');
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(selectedFile);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = error => reject(error);
        });
        
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error('GEMINI_API_KEY environment variable is missing.');
        }

        const ai = new GoogleGenAI({ apiKey });
        
        const response = await ai.models.generateContent({
          model: model.id.replace('-solid', ''),
          contents: {
            parts: [
              {
                inlineData: {
                  data: base64Data.split(',')[1],
                  mimeType: selectedFile.type,
                },
              },
              {
                text: model.prompt,
              },
            ],
          },
        });
        
        let foundImage = false;
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            resultUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            foundImage = true;
            break;
          }
        }
        
        if (!foundImage) {
          throw new Error('No image returned from Gemini. It may have returned text instead.');
        }
      }
    } catch (error: any) {
      console.error('Processing error:', error);
      status = 'error';
      errorMessage = error.message || 'An unknown error occurred';
    } finally {
      const endTime = performance.now();
      const timeMs = endTime - startTime;
      
      setIsProcessing(false);
      setProgressText('');
      
      if (status === 'success') {
        setCurrentResult(resultUrl);
        setProcessingTime(timeMs);
      }
      
      setHistory(prev => [{
        id: Math.random().toString(36).substring(7),
        modelId: model.id,
        modelName: model.name,
        timeMs,
        originalImage: previewUrl!,
        resultImage: resultUrl,
        status,
        errorMessage,
        timestamp: new Date()
      }, ...prev]);
    }
  };

  const formatTime = (ms: number) => {
    return (ms / 1000).toFixed(2) + 's';
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-indigo-200">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg text-white">
              <Scissors size={20} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Stickerify Benchmark</h1>
          </div>
          <div className="text-sm text-neutral-500 flex items-center gap-2">
            <Zap size={16} className="text-amber-500" />
            <span>Compare AI Models</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Top Section: Controls & Preview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Left Column: Upload & Settings */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
              <h2 className="text-lg font-medium mb-4">1. Upload Photo</h2>
              
              <div 
                className={cn(
                  "border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer",
                  isDragging ? "border-indigo-500 bg-indigo-50" : "border-neutral-300 hover:border-neutral-400 bg-neutral-50",
                  previewUrl ? "border-solid border-neutral-200 bg-white p-4" : ""
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !previewUrl && fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleFileChange} 
                />
                
                {previewUrl ? (
                  <div className="relative group">
                    <img 
                      src={previewUrl} 
                      alt="Preview" 
                      className="max-h-64 mx-auto rounded-lg object-contain"
                    />
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                        setPreviewUrl(null);
                        setCurrentResult(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-neutral-500">
                    <div className="bg-white p-4 rounded-full shadow-sm border border-neutral-100">
                      <Upload size={24} className="text-indigo-500" />
                    </div>
                    <div>
                      <p className="font-medium text-neutral-700">Click to upload or drag and drop</p>
                      <p className="text-sm">SVG, PNG, JPG or GIF (max. 10MB)</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
              <h2 className="text-lg font-medium mb-4">2. Select Model</h2>
              <div className="space-y-3">
                {MODELS.map(model => (
                  <label 
                    key={model.id}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all",
                      selectedModel === model.id 
                        ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600" 
                        : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <input 
                        type="radio" 
                        name="model" 
                        value={model.id}
                        checked={selectedModel === model.id}
                        onChange={() => setSelectedModel(model.id)}
                        className="w-4 h-4 text-indigo-600 border-neutral-300 focus:ring-indigo-600"
                      />
                      <div>
                        <p className="font-medium text-neutral-900">{model.name}</p>
                        <p className="text-xs text-neutral-500 uppercase tracking-wider mt-0.5">{model.type}</p>
                      </div>
                    </div>
                    {model.type === 'local' && (
                      <span className="bg-emerald-100 text-emerald-700 text-xs font-medium px-2.5 py-1 rounded-full">
                        Free & Fast
                      </span>
                    )}
                  </label>
                ))}
              </div>

              <button
                onClick={processImage}
                disabled={!selectedFile || isProcessing}
                className={cn(
                  "w-full mt-6 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-white transition-all",
                  !selectedFile || isProcessing 
                    ? "bg-neutral-300 cursor-not-allowed" 
                    : "bg-indigo-600 hover:bg-indigo-700 shadow-sm hover:shadow active:scale-[0.98]"
                )}
              >
                {isProcessing ? (
                  <>
                    <RefreshCw size={20} className="animate-spin" />
                    {progressText || 'Processing...'}
                  </>
                ) : (
                  <>
                    <Scissors size={20} />
                    Stickerify Now
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Result */}
          <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm flex flex-col">
            <h2 className="text-lg font-medium mb-4 flex items-center justify-between">
              <span>Result</span>
              {processingTime && (
                <span className="text-sm font-normal text-neutral-500 flex items-center gap-1.5 bg-neutral-100 px-3 py-1 rounded-full">
                  <Clock size={14} />
                  {formatTime(processingTime)}
                </span>
              )}
            </h2>
            
            <div className="flex-1 border-2 border-dashed border-neutral-200 rounded-xl bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+CjxyZWN0IHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgZmlsbD0iI2ZmZiI+PC9yZWN0Pgo8cmVjdCB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNmMmYyZjIiPjwvcmVjdD4KPHJlY3QgeD0iMTAiIHk9IjEwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNmMmYyZjIiPjwvcmVjdD4KPC9zdmc+')] flex items-center justify-center p-8 relative overflow-hidden min-h-[300px]">
              {isProcessing ? (
                <div className="flex flex-col items-center gap-4 text-neutral-500">
                  <div className="relative">
                    <div className="w-16 h-16 border-4 border-neutral-200 rounded-full"></div>
                    <div className="w-16 h-16 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin absolute top-0 left-0"></div>
                  </div>
                  <p className="font-medium animate-pulse">Creating Magic...</p>
                </div>
              ) : currentResult ? (
                <div className="relative group w-full h-full flex items-center justify-center">
                  <img 
                    src={currentResult} 
                    alt="Sticker Result" 
                    className="max-w-full max-h-full object-contain sticker-shadow transition-transform hover:scale-105"
                  />
                  <a 
                    href={currentResult} 
                    download="sticker.png"
                    className="absolute bottom-4 right-4 bg-white text-neutral-900 shadow-lg hover:shadow-xl p-3 rounded-full opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0"
                    title="Download Sticker"
                  >
                    <Download size={20} />
                  </a>
                </div>
              ) : (
                <div className="text-neutral-400 flex flex-col items-center gap-2">
                  <ImageIcon size={48} className="opacity-50" />
                  <p>Your sticker will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Section: History & Comparison */}
        {history.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-neutral-200">
              <h2 className="text-lg font-medium">Benchmark History</h2>
              <p className="text-sm text-neutral-500 mt-1">Compare processing times and quality across models.</p>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider text-xs">
                  <tr>
                    <th className="px-6 py-4 font-medium">Model</th>
                    <th className="px-6 py-4 font-medium">Original</th>
                    <th className="px-6 py-4 font-medium">Result</th>
                    <th className="px-6 py-4 font-medium">Time Taken</th>
                    <th className="px-6 py-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {history.map((item) => (
                    <tr key={item.id} className="hover:bg-neutral-50/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-neutral-900">{item.modelName}</div>
                        <div className="text-xs text-neutral-500 mt-1">
                          {item.timestamp.toLocaleTimeString()}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="w-16 h-16 rounded-lg overflow-hidden border border-neutral-200 bg-neutral-100">
                          <img src={item.originalImage} alt="Original" className="w-full h-full object-cover" />
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="w-16 h-16 rounded-lg overflow-hidden border border-neutral-200 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZmZmIj48L3JlY3Q+CjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNmMmYyZjIiPjwvcmVjdD4KPHJlY3QgeD0iNCIgeT0iNCIgd2lkdGg9IjQiIGhlaWdodD0iNCIgZmlsbD0iI2YyZjJmMiI+PC9yZWN0Pgo8L3N2Zz4=')]">
                          {item.status === 'success' ? (
                            <img 
                              src={item.resultImage} 
                              alt="Result" 
                              className="w-full h-full object-contain sticker-shadow-sm" 
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-red-400 bg-red-50">
                              <AlertCircle size={20} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 font-mono">
                          <Clock size={14} className="text-neutral-400" />
                          {formatTime(item.timeMs)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {item.status === 'success' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                            <CheckCircle2 size={14} />
                            Success
                          </span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 w-fit">
                              <AlertCircle size={14} />
                              Failed
                            </span>
                            <span className="text-xs text-red-600 max-w-xs truncate" title={item.errorMessage}>
                              {item.errorMessage}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
