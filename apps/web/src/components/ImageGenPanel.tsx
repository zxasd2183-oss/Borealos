/**
 * ImageGenPanel — Aurora AI 图像生成面板
 * ------------------------------------------------------------------
 * 参考即梦 / Jimeng AI 图像生成体验，支持三种生成模式：
 *   1. 文生图 (Text-to-Image)
 *   2. 图生图 (Image-to-Image)
 *   3. 风格迁移 (Style Transfer)
 *
 * API：
 *   GET  /api/image/models           获取可用模型列表
 *   POST /api/image/generate         文生图  { prompt, model, size, count, negativePrompt, style }
 *   POST /api/image/edit             图生图  { prompt, imageUrl, model, strength }
 *   POST /api/upload                 文件上传 (multipart) -> imageUrl
 *
 * 视觉：复用全局 Aurora 主题变量（chatgpt-theme.css），蓝紫渐变 + 晶透玻璃。
 * 仅依赖 React，无任何第三方依赖。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  FC,
  ReactNode,
} from 'react';
import './ImageGenPanel.css';

/* ============================================================ *
 * 类型定义
 * ============================================================ */

/** 生成模式 */
export type GenerationMode = 'text2img' | 'img2img' | 'style';

/** 模型信息（来自 GET /api/image/models） */
export interface ImageModel {
  id: string;
  name: string;
  description?: string;
  /** 是否支持图生图 / 风格迁移 */
  capabilities?: string[];
}

/** 单张生成结果 */
export interface GeneratedImage {
  id: string;
  url: string;
  /** 生成时使用的提示词（用于展示与重新生成） */
  prompt: string;
  mode: GenerationMode;
  model: string;
  timestamp: number;
  /** 重新生成所需参数 */
  params: GenParams;
}

/** 一次生成任务所需参数（可复用于「重新生成」） */
export interface GenParams {
  mode: GenerationMode;
  prompt: string;
  model: string;
  size?: string;
  count?: number;
  negativePrompt?: string;
  /** 文生图风格选择 */
  style?: string;
  /** 风格迁移预设 id */
  stylePresetId?: string;
  /** 图生图 / 风格迁移所需的源图地址 */
  imageUrl?: string;
  strength?: number;
}

export interface ImageGenPanelProps {
  /** API 基础地址，默认相对路径 */
  apiBase?: string;
  /** 默认模型 id */
  defaultModel?: string;
  /** 根节点额外 className */
  className?: string;
  /** 每张图片生成成功后回调 */
  onImageGenerated?: (image: GeneratedImage) => void;
}

/** 文生图可选尺寸 */
interface SizeOption {
  id: string;
  label: string;
  w: number;
  h: number;
}

/** 文生图风格选项 */
interface TextStyleOption {
  id: string;
  name: string;
}

/** 风格迁移预设 */
interface StylePreset {
  id: string;
  name: string;
  en: string;
  /** 缩略图渐变背景 */
  gradient: string;
}

/* ============================================================ *
 * 常量
 * ============================================================ */

const SIZES: SizeOption[] = [
  { id: '1024x1024', label: '1:1', w: 1024, h: 1024 },
  { id: '768x1024', label: '3:4', w: 768, h: 1024 },
  { id: '1024x768', label: '4:3', w: 1024, h: 768 },
  { id: '512x512', label: '1:1', w: 512, h: 512 },
];

const TEXT_STYLES: TextStyleOption[] = [
  { id: 'realistic', name: '写实' },
  { id: 'anime', name: '动漫' },
  { id: 'oil', name: '油画' },
  { id: 'watercolor', name: '水彩' },
  { id: '3d', name: '3D' },
  { id: 'cyberpunk', name: '赛博朋克' },
];

const STYLE_PRESETS: StylePreset[] = [
  { id: 'van-gogh', name: '梵高星空', en: 'Van Gogh', gradient: 'linear-gradient(135deg, #1a2a6c 0%, #b21f1f 55%, #fdbb2d 100%)' },
  { id: 'monet', name: '莫奈印象', en: 'Monet', gradient: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)' },
  { id: 'ukiyoe', name: '浮世绘', en: 'Ukiyo-e', gradient: 'linear-gradient(135deg, #f857a6 0%, #ff5858 100%)' },
  { id: 'cyberpunk', name: '赛博朋克', en: 'Cyberpunk', gradient: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
  { id: 'oil-classic', name: '古典油画', en: 'Oil Painting', gradient: 'linear-gradient(135deg, #5f2c82 0%, #49a09d 100%)' },
  { id: 'watercolor', name: '清新水彩', en: 'Watercolor', gradient: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)' },
  { id: 'pixel', name: '像素艺术', en: 'Pixel Art', gradient: 'linear-gradient(135deg, #00b09b 0%, #96c93d 100%)' },
  { id: 'concept', name: '概念艺术', en: 'Concept Art', gradient: 'linear-gradient(135deg, #2c3e50 0%, #fd746c 100%)' },
];

const COUNT_OPTIONS = [1, 2, 3, 4];

/** 上传文件大小上限：10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

const TABS: { key: GenerationMode; label: string; icon: FC<IconProps> }[] = [
  { key: 'text2img', label: '文生图', icon: TextTabIcon },
  { key: 'img2img', label: '图生图', icon: ImgEditTabIcon },
  { key: 'style', label: '风格迁移', icon: WandTabIcon },
];

/* ============================================================ *
 * 内联 SVG 图标
 * ============================================================ */

interface IconProps {
  size?: number;
  className?: string;
}

const Svg: FC<IconProps & { children: ReactNode }> = ({ size = 16, className, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ flexShrink: 0 }}
    aria-hidden="true"
  >
    {children}
  </svg>
);

function TextTabIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 3v18M5 8l7-5 7 5" />
      <path d="M5 14h14" opacity="0.5" />
    </Svg>
  );
}

function ImgEditTabIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.6" />
      <path d="m21 15-4.5-4.5L5 21" />
      <path d="M16 5l3 3" />
    </Svg>
  );
}

function WandTabIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M15 4V2M15 10V8M19 6h2M11 6H9" opacity="0.6" />
      <path d="m14.5 6.5 4 4L9 20l-4 1 1-4L14.5 6.5z" />
      <path d="m13 8 3 3" />
    </Svg>
  );
}

function SparklesIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" fill="currentColor" fillOpacity="0.18" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" fill="currentColor" fillOpacity="0.3" />
    </Svg>
  );
}

function UploadIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </Svg>
  );
}

function DownloadIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </Svg>
  );
}

function CopyIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  );
}

function CheckIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

function ZoomInIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
    </Svg>
  );
}

function CloseIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  );
}

function ChevronDownIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

function ChevronLeftIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

function ChevronRightIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  );
}

function AlertIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" />
    </Svg>
  );
}

function TrashIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" opacity="0.6" />
    </Svg>
  );
}

function RefreshIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </Svg>
  );
}

function ImageIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.6" />
      <path d="m21 15-4.5-4.5L5 21" />
    </Svg>
  );
}

function Spinner({ size = 16, className }: IconProps) {
  return (
    <svg
      className={`imggen-spinner${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ============================================================ *
 * 工具函数
 * ============================================================ */

/** 生成唯一 id */
function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 把未知错误格式化为可读文案 */
function formatError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return '生成已取消';
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '发生未知错误，请稍后重试';
}

/** 兼容多种 API 返回结构，统一提取图片列表 */
function normalizeImages(data: unknown): string[] {
  const pickUrl = (item: unknown): string | null => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (typeof obj.url === 'string') return obj.url;
      if (typeof obj.imageUrl === 'string') return obj.imageUrl;
      if (typeof obj.image === 'string') return obj.image;
      if (typeof obj.b64 === 'string') return `data:image/png;base64,${obj.b64}`;
      if (typeof obj.base64 === 'string') return `data:image/png;base64,${obj.base64}`;
    }
    return null;
  };

  if (Array.isArray(data)) {
    return data.map(pickUrl).filter((u): u is string => !!u);
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.images)) return normalizeImages(obj.images);
    if (Array.isArray(obj.urls)) return normalizeImages(obj.urls);
    if (Array.isArray(obj.results)) return normalizeImages(obj.results);
    if (Array.isArray(obj.data)) return normalizeImages(obj.data);
    // 处理嵌套 data 对象：{ success, data: { urls: [...] } }
    if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
      const inner = obj.data as Record<string, unknown>;
      if (Array.isArray(inner.urls)) return normalizeImages(inner.urls);
      if (Array.isArray(inner.images)) return normalizeImages(inner.images);
      if (Array.isArray(inner.results)) return normalizeImages(inner.results);
    }
    const single = pickUrl(obj);
    if (single) return [single];
  }
  return [];
}

/** 风格迁移：根据预设 id 生成提示词 */
function stylePresetToPrompt(preset: StylePreset | undefined): string {
  if (!preset) return '风格迁移';
  return `将图片转换为「${preset.name}」(${preset.en})风格，保留主体结构，应用该艺术风格的色彩与笔触`;
}

/** 复制文本到剪贴板（带降级方案） */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 下载图片（优先 blob，降级为直接打开） */
async function downloadImage(url: string, filename: string): Promise<void> {
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error('下载失败');
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    // 降级：直接在新标签打开
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/* ============================================================ *
 * 子组件
 * ============================================================ */

/** 模型下拉选择器 */
const ModelSelector: FC<{
  models: ImageModel[];
  value: string;
  loading: boolean;
  onChange: (id: string) => void;
}> = ({ models, value, loading, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = models.find((m) => m.id === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="imggen-model" ref={ref}>
      <button
        type="button"
        className="imggen-model__trigger"
        onClick={() => setOpen((v) => !v)}
        disabled={loading || models.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {loading ? (
          <>
            <Spinner size={14} />
            <span className="imggen-model__label">加载模型…</span>
          </>
        ) : selected ? (
          <>
            <SparklesIcon size={14} />
            <span className="imggen-model__label">{selected.name}</span>
          </>
        ) : (
          <span className="imggen-model__label imggen-model__label--muted">
            {models.length === 0 ? '暂无可用模型' : '选择模型'}
          </span>
        )}
        <ChevronDownIcon size={14} className={open ? 'imggen-model__chev--open' : ''} />
      </button>
      {open && models.length > 0 && (
        <ul className="imggen-model__menu" role="listbox">
          {models.map((m) => (
            <li key={m.id} role="option" aria-selected={m.id === value}>
              <button
                type="button"
                className={`imggen-model__option${m.id === value ? ' imggen-model__option--active' : ''}`}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
              >
                <span className="imggen-model__option-name">{m.name}</span>
                {m.description && <span className="imggen-model__option-desc">{m.description}</span>}
                {m.id === value && <CheckIcon size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** 尺寸选择器 */
const SizeSelector: FC<{ value: string; onChange: (id: string) => void }> = ({ value, onChange }) => (
  <div className="imggen-sizes">
    {SIZES.map((s) => (
      <button
        key={s.id}
        type="button"
        className={`imggen-size${s.id === value ? ' imggen-size--active' : ''}`}
        onClick={() => onChange(s.id)}
        title={`${s.w} × ${s.h}`}
      >
        <span
          className="imggen-size__ratio"
          style={{ aspectRatio: `${s.w} / ${s.h}` }}
        />
        <span className="imggen-size__dim">{s.id}</span>
      </button>
    ))}
  </div>
);

/** 数量选择器 */
const CountSelector: FC<{ value: number; onChange: (n: number) => void; disabled?: boolean }> = ({
  value,
  onChange,
  disabled,
}) => (
  <div className="imggen-count">
    {COUNT_OPTIONS.map((n) => (
      <button
        key={n}
        type="button"
        className={`imggen-count__btn${n === value ? ' imggen-count__btn--active' : ''}`}
        onClick={() => onChange(n)}
        disabled={disabled}
      >
        {n}
      </button>
    ))}
  </div>
);

/** 文生图风格选择器 */
const TextStyleSelector: FC<{ value: string; onChange: (id: string) => void }> = ({ value, onChange }) => (
  <div className="imggen-styles">
    <button
      type="button"
      className={`imggen-style-chip${value === '' ? ' imggen-style-chip--active' : ''}`}
      onClick={() => onChange('')}
    >
      默认
    </button>
    {TEXT_STYLES.map((s) => (
      <button
        key={s.id}
        type="button"
        className={`imggen-style-chip${s.id === value ? ' imggen-style-chip--active' : ''}`}
        onClick={() => onChange(s.id)}
      >
        {s.name}
      </button>
    ))}
  </div>
);

/** 风格迁移预设画廊 */
const StylePresetGallery: FC<{ value: string; onChange: (id: string) => void }> = ({ value, onChange }) => (
  <div className="imggen-presets">
    {STYLE_PRESETS.map((p) => (
      <button
        key={p.id}
        type="button"
        className={`imggen-preset${p.id === value ? ' imggen-preset--active' : ''}`}
        onClick={() => onChange(p.id)}
      >
        <span className="imggen-preset__thumb" style={{ background: p.gradient }}>
          {p.id === value && <CheckIcon size={18} className="imggen-preset__check" />}
        </span>
        <span className="imggen-preset__name">{p.name}</span>
      </button>
    ))}
  </div>
);

/** 图片上传区（拖拽 + 点击 + 粘贴） */
const ImageUploader: FC<{
  imageUrl: string | null;
  uploading: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
}> = ({ imageUrl, uploading, onFile, onClear }) => {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!ACCEPTED_TYPES.includes(file.type)) {
      onFile(new File([], 'invalid-type')); // 触发上层校验提示
      return;
    }
    onFile(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (imageUrl) return;
    handleFiles(e.dataTransfer.files);
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (imageUrl) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          handleFiles(null);
          onFile(file);
          break;
        }
      }
    }
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = '';
  };

  return (
    <div
      className={`imggen-uploader${dragging ? ' imggen-uploader--drag' : ''}${imageUrl ? ' imggen-uploader--filled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!imageUrl) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onPaste={onPaste}
      tabIndex={0}
      role="button"
      aria-label="上传图片：拖拽、点击或粘贴"
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="imggen-uploader__input"
        onChange={onInputChange}
      />
      {uploading ? (
        <div className="imggen-uploader__state">
          <Spinner size={26} />
          <span>上传中…</span>
        </div>
      ) : imageUrl ? (
        <div className="imggen-uploader__preview">
          <img src={imageUrl} alt="源图片" />
          <div className="imggen-uploader__overlay">
            <button type="button" className="imggen-uploader__replace" onClick={() => inputRef.current?.click()}>
              <RefreshIcon size={14} /> 更换
            </button>
            <button type="button" className="imggen-uploader__clear" onClick={onClear}>
              <TrashIcon size={14} /> 移除
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="imggen-uploader__empty"
          onClick={() => inputRef.current?.click()}
        >
          <UploadIcon size={28} />
          <span className="imggen-uploader__title">拖拽、点击或粘贴上传图片</span>
          <span className="imggen-uploader__hint">支持 PNG / JPG / WEBP / GIF，最大 10MB</span>
        </button>
      )}
    </div>
  );
};

/** 错误横幅 */
const ErrorBanner: FC<{ message: string; onDismiss: () => void }> = ({ message, onDismiss }) => (
  <div className="imggen-error" role="alert">
    <AlertIcon size={18} className="imggen-error__icon" />
    <div className="imggen-error__body">
      <span className="imggen-error__title">生成失败</span>
      <span className="imggen-error__msg">{message}</span>
    </div>
    <button type="button" className="imggen-error__close" onClick={onDismiss} aria-label="关闭">
      <CloseIcon size={16} />
    </button>
  </div>
);

/** 加载骨架网格 */
const SkeletonGrid: FC<{ count: number }> = ({ count }) => (
  <div className="imggen-gallery imggen-gallery--loading">
    {Array.from({ length: count }).map((_, i) => (
      <div className="imggen-skeleton" key={i}>
        <div className="imggen-skeleton__shimmer" />
        <div className="imggen-skeleton__icon">
          <Spinner size={22} />
        </div>
      </div>
    ))}
  </div>
);

/** 单张结果卡片 */
const ResultCard: FC<{
  image: GeneratedImage;
  onZoom: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onRegenerate: () => void;
  copied: boolean;
  regenerating: boolean;
}> = ({ image, onZoom, onDownload, onCopy, onRegenerate, copied, regenerating }) => (
  <div className="imggen-card">
    <div className="imggen-card__media" onClick={onZoom} role="button" tabIndex={0}>
      <img src={image.url} alt={image.prompt} loading="lazy" />
      <div className="imggen-card__overlay">
        <span className="imggen-card__zoom">
          <ZoomInIcon size={16} /> 预览
        </span>
      </div>
    </div>
    <div className="imggen-card__bar">
      <button
        type="button"
        className="imggen-card__btn"
        onClick={onDownload}
        title="下载"
      >
        <DownloadIcon size={15} />
      </button>
      <button
        type="button"
        className="imggen-card__btn"
        onClick={onCopy}
        title={copied ? '已复制' : '复制链接'}
      >
        {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      </button>
      <button
        type="button"
        className="imggen-card__btn imggen-card__btn--accent"
        onClick={onRegenerate}
        title="重新生成"
        disabled={regenerating}
      >
        {regenerating ? <Spinner size={15} /> : <RefreshIcon size={15} />}
      </button>
    </div>
  </div>
);

/** 灯箱（大图预览） */
const Lightbox: FC<{
  images: GeneratedImage[];
  index: number;
  onClose: () => void;
  onNav: (i: number) => void;
  onDownload: (img: GeneratedImage) => void;
}> = ({ images, index, onClose, onNav, onDownload }) => {
  const img = images[index];
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onNav((index - 1 + images.length) % images.length);
      else if (e.key === 'ArrowRight') onNav((index + 1) % images.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onClose, onNav]);

  if (!img) return null;

  return (
    <div className="imggen-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <button type="button" className="imggen-lightbox__close" onClick={onClose} aria-label="关闭">
        <CloseIcon size={22} />
      </button>
      {images.length > 1 && (
        <>
          <button
            type="button"
            className="imggen-lightbox__nav imggen-lightbox__nav--prev"
            onClick={(e) => {
              e.stopPropagation();
              onNav((index - 1 + images.length) % images.length);
            }}
            aria-label="上一张"
          >
            <ChevronLeftIcon size={24} />
          </button>
          <button
            type="button"
            className="imggen-lightbox__nav imggen-lightbox__nav--next"
            onClick={(e) => {
              e.stopPropagation();
              onNav((index + 1) % images.length);
            }}
            aria-label="下一张"
          >
            <ChevronRightIcon size={24} />
          </button>
        </>
      )}
      <div className="imggen-lightbox__inner" onClick={(e) => e.stopPropagation()}>
        <img src={img.url} alt={img.prompt} className="imggen-lightbox__img" />
        <div className="imggen-lightbox__meta">
          <span className="imggen-lightbox__prompt" title={img.prompt}>{img.prompt}</span>
          <div className="imggen-lightbox__actions">
            <button
              type="button"
              className="imggen-lightbox__btn"
              onClick={() => onDownload(img)}
            >
              <DownloadIcon size={15} /> 下载
            </button>
          </div>
        </div>
        {images.length > 1 && (
          <span className="imggen-lightbox__count">{index + 1} / {images.length}</span>
        )}
      </div>
    </div>
  );
};

/* ============================================================ *
 * 主组件
 * ============================================================ */

const ImageGenPanel: FC<ImageGenPanelProps> = ({
  apiBase = '',
  defaultModel,
  className,
  onImageGenerated,
}) => {
  /* ---- tab ---- */
  const [activeTab, setActiveTab] = useState<GenerationMode>('text2img');

  /* ---- 文生图参数 ---- */
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [count, setCount] = useState(2);
  const [textStyle, setTextStyle] = useState('');

  /* ---- 图生图参数 ---- */
  const [editPrompt, setEditPrompt] = useState('');
  const [strength, setStrength] = useState(0.6);
  const [sourceImage, setSourceImage] = useState<string | null>(null);

  /* ---- 风格迁移参数 ---- */
  const [stylePresetId, setStylePresetId] = useState(STYLE_PRESETS[0].id);

  /* ---- 模型 ---- */
  const [models, setModels] = useState<ImageModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [model, setModel] = useState(defaultModel ?? '');

  /* ---- 结果与状态 ---- */
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [skeletonCount, setSkeletonCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  /* ---- 获取模型列表 ---- */
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      setModelsLoading(true);
      try {
        const resp = await fetch(`${apiBase}/api/image/models`, {
          signal: ac.signal,
          headers: { Accept: 'application/json' },
        });
        if (!resp.ok) throw new Error(`获取模型列表失败 (${resp.status})`);
        const data = await resp.json();
        const list: ImageModel[] = Array.isArray(data)
          ? data
          : data?.models ?? data?.data ?? [];
        if (cancelled) return;
        const normalized = list.map((m) =>
          typeof m === 'string' ? { id: m, name: m } : m
        );
        if (normalized.length > 0) {
          setModels(normalized);
          setModel((prev) => prev || (defaultModel && normalized.some((m) => m.id === defaultModel) ? defaultModel : normalized[0].id));
        } else {
          // API 返回空列表时使用内置默认模型
          const fallback: ImageModel[] = [
            { id: 'wanx2.1-t2i-turbo', name: '万相 2.1 Turbo', description: '快速生成，质量均衡' },
            { id: 'wanx2.1-t2i-plus', name: '万相 2.1 Plus', description: '高质量生成，细节丰富' },
            { id: 'wanx-v1', name: '通义万相 v1', description: '中文理解强，适合写实/艺术风格' },
          ];
          setModels(fallback);
          setModel((prev) => prev || fallback[0].id);
        }
      } catch (e) {
        if (!cancelled && e instanceof DOMException && e.name === 'AbortError') return;
        if (!cancelled) {
          // 模型获取失败时使用内置默认
          const fallback: ImageModel[] = [
            { id: 'aurora-flux', name: 'Aurora Flux', description: '通用高质量图像模型' },
            { id: 'aurora-pro', name: 'Aurora Pro', description: '高保真写实模型' },
            { id: 'aurora-anime', name: 'Aurora Anime', description: '动漫风格专用' },
          ];
          setModels(fallback);
          setModel((prev) => prev || fallback[0].id);
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  /* ---- 卸载时取消进行中的请求 ---- */
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /* ---- 文件上传 ---- */
  const uploadFile = useCallback(
    async (file: File): Promise<string> => {
      if (file.size === 0 && file.name === 'invalid-type') {
        throw new Error('不支持的文件类型，请上传 PNG / JPG / WEBP / GIF 图片');
      }
      if (file.size > MAX_FILE_SIZE) {
        throw new Error('文件过大，最大支持 10MB');
      }
      setUploading(true);
      try {
        const form = new FormData();
        form.append('file', file);
        const resp = await fetch(`${apiBase}/api/upload`, { method: 'POST', body: form });
        if (!resp.ok) throw new Error(`上传失败 (${resp.status})`);
        const data = await resp.json();
        const url =
          data?.url ?? data?.imageUrl ?? data?.file?.url ?? data?.path ?? data?.data?.url;
        if (typeof url !== 'string') throw new Error('上传返回格式异常');
        return url;
      } finally {
        setUploading(false);
      }
    },
    [apiBase]
  );

  const handleUploadFile = useCallback(
    async (file: File) => {
      try {
        if (file.size === 0 && file.name === 'invalid-type') {
          await uploadFile(file); // 抛出友好错误
          return;
        }
        // 先本地预览，再异步上传
        const localUrl = URL.createObjectURL(file);
        setSourceImage(localUrl);
        const remoteUrl = await uploadFile(file);
        // 上传成功后替换为远端地址
        setSourceImage((prev) => (prev === localUrl ? remoteUrl : prev));
        URL.revokeObjectURL(localUrl);
      } catch (e) {
        setError(formatError(e));
        setSourceImage(null);
      }
    },
    [uploadFile]
  );

  /* ---- 统一生成入口 ---- */
  const runGeneration = useCallback(
    async (params: GenParams) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setLoading(true);
      setError(null);
      setSkeletonCount(params.count ?? 1);

      try {
        let resp: Response;
        if (params.mode === 'text2img') {
          resp = await fetch(`${apiBase}/api/image/generate`, {
            method: 'POST',
            signal: ac.signal,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              prompt: params.prompt,
              model: params.model,
              size: params.size,
              count: params.count,
              negativePrompt: params.negativePrompt || undefined,
              style: params.style || undefined,
            }),
          });
        } else {
          // img2img / style
          if (!params.imageUrl) throw new Error('请先上传源图片');
          resp = await fetch(`${apiBase}/api/image/edit`, {
            method: 'POST',
            signal: ac.signal,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              prompt: params.prompt,
              imageUrl: params.imageUrl,
              model: params.model,
              strength: params.strength ?? 0.6,
            }),
          });
        }

        if (!resp.ok) {
          let msg = `请求失败 (${resp.status})`;
          try {
            const errData = await resp.json();
            msg = errData?.message || errData?.error || errData?.detail || msg;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }

        const data = await resp.json();
        const urls = normalizeImages(data);
        if (urls.length === 0) throw new Error('未返回任何图片，请稍后重试');

        const now = Date.now();
        const newImages: GeneratedImage[] = urls.map((url, i) => ({
          id: `${uid()}-${i}`,
          url,
          prompt: params.prompt,
          mode: params.mode,
          model: params.model,
          timestamp: now,
          params,
        }));

        setResults((prev) => [...newImages, ...prev]);
        newImages.forEach((img) => onImageGenerated?.(img));
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(formatError(e));
      } finally {
        setLoading(false);
        setSkeletonCount(0);
        setRegeneratingId(null);
      }
    },
    [apiBase, onImageGenerated]
  );

  /* ---- 各 tab 生成按钮 ---- */
  const handleGenerateText = useCallback(() => {
    if (!prompt.trim()) {
      setError('请输入提示词');
      return;
    }
    if (!model) {
      setError('请选择模型');
      return;
    }
    runGeneration({
      mode: 'text2img',
      prompt: prompt.trim(),
      model,
      size,
      count,
      negativePrompt: negativePrompt.trim(),
      style: textStyle,
    });
  }, [prompt, model, size, count, negativePrompt, textStyle, runGeneration]);

  const handleGenerateEdit = useCallback(() => {
    if (!sourceImage) {
      setError('请先上传源图片');
      return;
    }
    if (!editPrompt.trim()) {
      setError('请输入修改指令');
      return;
    }
    if (!model) {
      setError('请选择模型');
      return;
    }
    runGeneration({
      mode: 'img2img',
      prompt: editPrompt.trim(),
      model,
      imageUrl: sourceImage,
      strength,
      count: 1,
    });
  }, [sourceImage, editPrompt, model, strength, runGeneration]);

  const handleGenerateStyle = useCallback(() => {
    if (!sourceImage) {
      setError('请先上传源图片');
      return;
    }
    if (!model) {
      setError('请选择模型');
      return;
    }
    const preset = STYLE_PRESETS.find((p) => p.id === stylePresetId);
    runGeneration({
      mode: 'style',
      prompt: stylePresetToPrompt(preset),
      model,
      imageUrl: sourceImage,
      strength: 0.75,
      stylePresetId,
      count: 1,
    });
  }, [sourceImage, model, stylePresetId, runGeneration]);

  /* ---- 结果操作 ---- */
  const handleDownload = useCallback((img: GeneratedImage) => {
    const ext = img.url.match(/\.(png|jpe?g|webp|gif)/i)?.[1]?.toLowerCase() || 'png';
    downloadImage(img.url, `aurora-${img.id}.${ext}`);
  }, []);

  const handleCopy = useCallback(
    async (img: GeneratedImage) => {
      const ok = await copyToClipboard(img.url);
      if (ok) {
        setCopiedId(img.id);
        setTimeout(() => setCopiedId((prev) => (prev === img.id ? null : prev)), 1600);
      } else {
        setError('复制失败，请手动复制链接');
      }
    },
    []
  );

  const handleRegenerate = useCallback(
    (img: GeneratedImage) => {
      setRegeneratingId(img.id);
      // 重新生成不阻塞 UI，复用同参数
      runGeneration(img.params);
    },
    [runGeneration]
  );

  const handleClearResults = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  /* ---- 可生成判断 ---- */
  const canGenerate = useMemo(() => {
    if (loading) return false;
    if (activeTab === 'text2img') return prompt.trim().length > 0 && !!model;
    if (activeTab === 'img2img') return !!sourceImage && editPrompt.trim().length > 0 && !!model;
    if (activeTab === 'style') return !!sourceImage && !!model;
    return false;
  }, [activeTab, loading, prompt, model, sourceImage, editPrompt]);

  const isCurrentTab = (key: GenerationMode) => activeTab === key;

  /* ============================================================ *
   * 渲染
   * ============================================================ */
  return (
    <div className={`imggen-panel${className ? ` ${className}` : ''}`}>
      {/* 头部 */}
      <header className="imggen-header">
        <div className="imggen-header__title">
          <span className="imggen-header__logo">
            <SparklesIcon size={18} />
          </span>
          <div>
            <h2>AI 图像生成</h2>
            <p>文生图 · 图生图 · 风格迁移</p>
          </div>
        </div>
        <div className="imggen-header__meta">
          <ModelSelector
            models={models}
            value={model}
            loading={modelsLoading}
            onChange={setModel}
          />
        </div>
      </header>

      {/* 标签栏 */}
      <nav className="imggen-tabs" role="tablist">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isCurrentTab(t.key)}
              className={`imggen-tab${isCurrentTab(t.key) ? ' imggen-tab--active' : ''}`}
              onClick={() => {
                setActiveTab(t.key);
                setError(null);
              }}
            >
              <Icon size={16} />
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* 表单区 */}
      <section className="imggen-form">
        {/* ===== 文生图 ===== */}
        {isCurrentTab('text2img') && (
          <div className="imggen-form__group">
            <label className="imggen-field">
              <span className="imggen-field__label">提示词</span>
              <textarea
                className="imggen-textarea"
                placeholder="描述你想要生成的画面，越具体效果越好…&#10;例：一只穿着宇航服的柴犬站在月球表面，地球在背景中，电影级光影"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
              />
            </label>

            <label className="imggen-field">
              <span className="imggen-field__label">
                负面提示词 <span className="imggen-field__optional">（可选）</span>
              </span>
              <input
                className="imggen-input"
                type="text"
                placeholder="不想出现的内容，如：模糊、低质量、变形"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
              />
            </label>

            <div className="imggen-row">
              <div className="imggen-field">
                <span className="imggen-field__label">尺寸</span>
                <SizeSelector value={size} onChange={setSize} />
              </div>
              <div className="imggen-field">
                <span className="imggen-field__label">数量</span>
                <CountSelector value={count} onChange={setCount} />
              </div>
            </div>

            <div className="imggen-field">
              <span className="imggen-field__label">
                风格 <span className="imggen-field__optional">（可选）</span>
              </span>
              <TextStyleSelector value={textStyle} onChange={setTextStyle} />
            </div>

            <button
              type="button"
              className="imggen-submit"
              onClick={handleGenerateText}
              disabled={!canGenerate}
            >
              {loading ? <Spinner size={16} /> : <SparklesIcon size={16} />}
              {loading ? '生成中…' : '生成图片'}
            </button>
          </div>
        )}

        {/* ===== 图生图 ===== */}
        {isCurrentTab('img2img') && (
          <div className="imggen-form__group">
            <div className="imggen-field">
              <span className="imggen-field__label">源图片</span>
              <ImageUploader
                imageUrl={sourceImage}
                uploading={uploading}
                onFile={handleUploadFile}
                onClear={() => setSourceImage(null)}
              />
            </div>

            <label className="imggen-field">
              <span className="imggen-field__label">修改指令</span>
              <textarea
                className="imggen-textarea"
                placeholder="描述你想要的修改，如：把背景换成星空、添加一副墨镜、改为赛博朋克风格…"
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                rows={4}
              />
            </label>

            <div className="imggen-field">
              <div className="imggen-slider-head">
                <span className="imggen-field__label">重绘强度</span>
                <span className="imggen-slider-value">{strength.toFixed(1)}</span>
              </div>
              <input
                className="imggen-slider"
                type="range"
                min={0.1}
                max={1.0}
                step={0.1}
                value={strength}
                onChange={(e) => setStrength(parseFloat(e.target.value))}
                style={{
                  ['--imggen-progress' as string]: `${((strength - 0.1) / 0.9) * 100}%`,
                }}
              />
              <div className="imggen-slider-track">
                <span>保留原图</span>
                <span>完全重绘</span>
              </div>
            </div>

            <button
              type="button"
              className="imggen-submit"
              onClick={handleGenerateEdit}
              disabled={!canGenerate}
            >
              {loading ? <Spinner size={16} /> : <SparklesIcon size={16} />}
              {loading ? '生成中…' : '编辑图片'}
            </button>
          </div>
        )}

        {/* ===== 风格迁移 ===== */}
        {isCurrentTab('style') && (
          <div className="imggen-form__group">
            <div className="imggen-field">
              <span className="imggen-field__label">源图片</span>
              <ImageUploader
                imageUrl={sourceImage}
                uploading={uploading}
                onFile={handleUploadFile}
                onClear={() => setSourceImage(null)}
              />
            </div>

            <div className="imggen-field">
              <span className="imggen-field__label">选择风格</span>
              <StylePresetGallery value={stylePresetId} onChange={setStylePresetId} />
            </div>

            <button
              type="button"
              className="imggen-submit"
              onClick={handleGenerateStyle}
              disabled={!canGenerate}
            >
              {loading ? <Spinner size={16} /> : <WandTabIcon size={16} />}
              {loading ? '生成中…' : '开始迁移'}
            </button>
          </div>
        )}
      </section>

      {/* 错误提示 */}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* 结果区 */}
      <section className="imggen-results">
        <div className="imggen-results__head">
          <h3>
            <ImageIcon size={16} />
            生成结果
            {results.length > 0 && <span className="imggen-results__count">{results.length}</span>}
          </h3>
          {results.length > 0 && (
            <button type="button" className="imggen-results__clear" onClick={handleClearResults}>
              <TrashIcon size={14} /> 清空
            </button>
          )}
        </div>

        {loading && skeletonCount > 0 ? (
          <SkeletonGrid count={skeletonCount} />
        ) : results.length === 0 ? (
          <div className="imggen-empty">
            <div className="imggen-empty__icon">
              <ImageIcon size={32} />
            </div>
            <p className="imggen-empty__title">还没有生成结果</p>
            <p className="imggen-empty__hint">在上方输入提示词或上传图片，开始你的创作</p>
          </div>
        ) : (
          <div className="imggen-gallery">
            {results.map((img) => (
              <ResultCard
                key={img.id}
                image={img}
                onZoom={() => setLightboxIndex(results.indexOf(img))}
                onDownload={() => handleDownload(img)}
                onCopy={() => handleCopy(img)}
                onRegenerate={() => handleRegenerate(img)}
                copied={copiedId === img.id}
                regenerating={regeneratingId === img.id}
              />
            ))}
          </div>
        )}
      </section>

      {/* 灯箱 */}
      {lightboxIndex !== null && results[lightboxIndex] && (
        <Lightbox
          images={results}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNav={setLightboxIndex}
          onDownload={handleDownload}
        />
      )}
    </div>
  );
};

export default ImageGenPanel;
