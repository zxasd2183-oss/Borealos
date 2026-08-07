import { useState, useCallback } from 'react';

interface ImageItem {
  id: number;
  url: string;
  prompt: string;
}

const SAMPLE_PROMPTS = [
  '极光在雪山上方舞动，超高清摄影',
  '赛博朋克城市夜景，霓虹灯，雨天倒影',
  '水彩风格的山间日出，柔和色调',
  '宇宙星空中的极光鲸鱼，梦幻艺术',
];

export default function ImageView() {
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [size, setSize] = useState('512x512');

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setLoading(true);

    // 使用免费的 Pollinations.ai API 生成图片（无需 API Key）
    const [w, h] = size.split('x');
    const seed = Math.floor(Math.random() * 1000000);
    const encodedPrompt = encodeURIComponent(prompt.trim());
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${w}&height=${h}&seed=${seed}&nologo=true`;

    const img = new Image();
    img.onload = () => {
      setImages((prev) => [{ id: Date.now(), url, prompt: prompt.trim() }, ...prev]);
      setLoading(false);
    };
    img.onerror = () => {
      setLoading(false);
      // 失败时用 placeholder
      setImages((prev) => [
        { id: Date.now(), url: `https://placehold.co/${size}/1a1b1e/6366f1?text=Generation+Failed`, prompt: prompt.trim() },
        ...prev,
      ]);
    };
    img.src = url;
  }, [prompt, size]);

  const handleDownload = useCallback((url: string, prompt: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `aurora-${prompt.slice(0, 20).replace(/\s/g, '_')}.png`;
    a.target = '_blank';
    a.click();
  }, []);

  const useSamplePrompt = useCallback((p: string) => {
    setPrompt(p);
  }, []);

  return (
    <div className="image-view">
      <div className="image-header">
        <h2 className="image-title">AI 图片生成</h2>
        <p className="image-subtitle">输入描述，生成图片</p>
      </div>

      <div className="image-input-area">
        <textarea
          className="image-prompt-input"
          placeholder="描述你想要的图片…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          disabled={loading}
        />
        <div className="image-controls">
          <select className="image-size-select" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="512x512">512 × 512</option>
            <option value="768x768">768 × 768</option>
            <option value="1024x1024">1024 × 1024</option>
            <option value="1024x768">1024 × 768</option>
            <option value="768x1024">768 × 1024</option>
          </select>
          <button
            className={`image-generate-btn ${loading ? 'image-generate-btn--loading' : ''}`}
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
          >
            {loading ? (
              <>
                <span className="image-spinner" />
                生成中…
              </>
            ) : (
              '生成图片'
            )}
          </button>
        </div>
      </div>

      <div className="image-samples">
        <span className="image-samples-label">试试这些:</span>
        {SAMPLE_PROMPTS.map((p) => (
          <button key={p} className="image-sample-btn" onClick={() => useSamplePrompt(p)}>
            {p.slice(0, 15)}…
          </button>
        ))}
      </div>

      <div className="image-gallery">
        {images.length === 0 ? (
          <div className="image-gallery-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <p>生成的图片会显示在这里</p>
          </div>
        ) : (
          <div className="image-grid">
            {images.map((img) => (
              <div key={img.id} className="image-card">
                <img src={img.url} alt={img.prompt} className="image-card-img" />
                <div className="image-card-overlay">
                  <p className="image-card-prompt">{img.prompt}</p>
                  <button className="image-card-download" onClick={() => handleDownload(img.url, img.prompt)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    下载
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
