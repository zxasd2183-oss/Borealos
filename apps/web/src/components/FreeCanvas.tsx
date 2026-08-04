/**
 * FreeCanvas — Aurora 自由画布组件
 * ------------------------------------------------------------------
 * 参考 liblib「自由画布」的 AI 创意画布体验：用户可在无限画布上生成、
 * 编辑、合成图像。支持图层系统、局部重绘（Inpainting）、扩图（Outpainting）。
 *
 * API：
 *   GET  /api/image/models           获取可用模型列表
 *   POST /api/image/generate         文生图  { prompt, model, size, count }
 *   POST /api/image/edit             图生图 / 局部重绘 / 扩图
 *                                     { prompt, imageUrl, maskUrl?, model }
 *
 * 视觉：复用全局 Aurora 主题变量（chatgpt-theme.css），蓝紫渐变 + 晶透玻璃。
 * 仅依赖 React，无任何第三方依赖。类名统一 canvas- 前缀。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CSSProperties,
  DragEvent,
  FC,
  KeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  WheelEvent as ReactWheelEvent,
} from 'react';
import './FreeCanvas.css';

/* ============================================================ *
 * 类型定义
 * ============================================================ */

/** 画布图层 */
export interface CanvasLayer {
  id: string;
  type: 'image' | 'text';
  url?: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  opacity: number;
  zIndex: number;
}

/** 画布状态 */
export interface CanvasState {
  layers: CanvasLayer[];
  selectedLayerId: string | null;
  zoom: number;
  panX: number;
  panY: number;
  tool: 'select' | 'pan' | 'brush' | 'eraser' | 'text';
}

/** 模型信息（来自 GET /api/image/models） */
export interface ImageModel {
  id: string;
  name: string;
  description?: string;
}

/** 工具类型 */
type Tool = CanvasState['tool'];

/** 编辑模式 */
type EditMode = 'none' | 'inpaint' | 'outpaint';

/** 扩图方向 */
type OutpaintDirection = 'up' | 'down' | 'left' | 'right' | 'all';

/** 缩放手柄方位 */
type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** 视口（pan / zoom） */
interface View {
  panX: number;
  panY: number;
  zoom: number;
}

/** 交互状态 */
interface Interaction {
  type: 'pan' | 'move' | 'resize' | 'brush' | null;
  startScreenX: number;
  startScreenY: number;
  startPanX: number;
  startPanY: number;
  layerId?: string;
  handle?: HandleDir;
  startLayer?: CanvasLayer;
}

/** 右键菜单 */
interface ContextMenuState {
  x: number;
  y: number;
  layerId: string;
}

export interface FreeCanvasProps {
  /** API 基础地址，默认相对路径 */
  apiBase?: string;
  /** 默认模型 id */
  defaultModel?: string;
  /** 局部重绘 / 扩图使用的编辑模型 id */
  editModel?: string;
  /** 根节点额外 className */
  className?: string;
  /** 初始图层 */
  initialLayers?: CanvasLayer[];
}

/* ============================================================ *
 * 常量
 * ============================================================ */

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const GRID_SIZE = 50; // 世界单位
const MIN_LAYER_SIZE = 24; // 世界单位
const BASE_LONG_SIDE = 360; // 新建图层的基准长边（世界单位）

const SIZES = [
  { id: '1024x1024', label: '1:1' },
  { id: '768x1024', label: '3:4' },
  { id: '1024x768', label: '4:3' },
  { id: '512x512', label: '1:1' },
];

const TOOLS: { key: Tool; label: string; icon: FC<IconProps> }[] = [
  { key: 'select', label: '选择', icon: CursorIcon },
  { key: 'pan', label: '平移', icon: HandIcon },
  { key: 'brush', label: '画笔', icon: BrushIcon },
  { key: 'eraser', label: '橡皮', icon: EraserIcon },
  { key: 'text', label: '文字', icon: TextIcon },
];

const OUTPAINT_DIRECTIONS: { key: OutpaintDirection; label: string }[] = [
  { key: 'up', label: '上' },
  { key: 'down', label: '下' },
  { key: 'left', label: '左' },
  { key: 'right', label: '右' },
  { key: 'all', label: '四周' },
];

const FALLBACK_MODELS: ImageModel[] = [
  { id: 'aurora-flux', name: 'Aurora Flux', description: '通用高质量图像模型' },
  { id: 'aurora-pro', name: 'Aurora Pro', description: '高保真写实模型' },
  { id: 'aurora-anime', name: 'Aurora Anime', description: '动漫风格专用' },
];

const HANDLES: HandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/* ============================================================ *
 * 内联 SVG 图标
 * ============================================================ */

interface IconProps {
  size?: number;
  className?: string;
}

const Svg: FC<IconProps & { children: ReactNode }> = ({
  size = 16,
  className,
  children,
}) => (
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

function CursorIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M5 3l5 15 2.2-6.3L18.5 9.5 5 3z" fill="currentColor" fillOpacity="0.12" />
      <path d="M5 3l5 15 2.2-6.3L18.5 9.5 5 3z" />
    </Svg>
  );
}

function HandIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 11.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-3.6-1.5L4 15s-1-1.2 0-2.2 2.4-.2 3 .4l1 1" />
    </Svg>
  );
}

function BrushIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M9.5 14.5 18 6a1.8 1.8 0 0 0-2.5-2.5L7 12" />
      <path d="M9.5 14.5C8 15 6.5 16 6 18c2 .2 3.4-1 4-2.5" />
      <path d="M5 20c1-1 1.5-1.5 2.5-1.5" opacity="0.5" />
    </Svg>
  );
}

function EraserIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 15.5 12.5 7a2 2 0 0 1 2.8 0l2.7 2.7a2 2 0 0 1 0 2.8L13 17.5" />
      <path d="M9 12.5 14.5 18H7l-3-3a2 2 0 0 1 0-2.8L9 8" opacity="0.5" />
      <path d="M8 21h13" />
    </Svg>
  );
}

function TextIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M5 6V4h14v2" />
      <path d="M12 4v16" />
      <path d="M9 20h6" />
    </Svg>
  );
}

function SparklesIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path
        d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path
        d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"
        fill="currentColor"
        fillOpacity="0.3"
      />
    </Svg>
  );
}

function LayersIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 3 3 8l9 5 9-5-9-5z" />
      <path d="m3 13 9 5 9-5" opacity="0.6" />
      <path d="m3 18 9 5 9-5" opacity="0.35" />
    </Svg>
  );
}

function EyeIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

function EyeOffIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M10.7 6.2A9.6 9.6 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-2.2 2.8" />
      <path d="M6.6 6.6A16 16 0 0 0 2 12s3.5 6 10 6a9.4 9.4 0 0 0 4.2-1" />
      <path d="m3 3 18 18" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" opacity="0.6" />
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

function CopyIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  );
}

function PlusIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 5v14M5 12h14" />
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

function CheckIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M20 6 9 17l-5-5" />
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

function ImageIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.6" />
      <path d="m21 15-4.5-4.5L5 21" />
    </Svg>
  );
}

function WandIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M15 4V2M15 10V8M19 6h2M11 6H9" opacity="0.6" />
      <path d="m14.5 6.5 4 4L9 20l-4 1 1-4L14.5 6.5z" />
      <path d="m13 8 3 3" />
    </Svg>
  );
}

function ExpandIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
      <path d="M3 3l7 7M21 3l-7 7M21 21l-7-7M3 21l7-7" opacity="0.4" />
    </Svg>
  );
}

function FrontIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="8" y="3" width="13" height="13" rx="2" opacity="0.45" />
      <rect x="3" y="8" width="13" height="13" rx="2" fill="currentColor" fillOpacity="0.14" />
    </Svg>
  );
}

function BackIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3" y="8" width="13" height="13" rx="2" opacity="0.45" />
      <rect x="8" y="3" width="13" height="13" rx="2" fill="currentColor" fillOpacity="0.14" />
    </Svg>
  );
}

function ZoomFitIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
      <circle cx="12" cy="12" r="2.4" opacity="0.5" />
    </Svg>
  );
}

function ZoomActualIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M7 12h10" opacity="0.5" />
    </Svg>
  );
}

function Spinner({ size = 16, className }: IconProps) {
  return (
    <svg
      className={`canvas-spinner${className ? ` ${className}` : ''}`}
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

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clampZoom(z: number): number {
  return clamp(z, MIN_ZOOM, MAX_ZOOM);
}

function formatError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return '操作已取消';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '发生未知错误，请稍后重试';
}

/** 兼容多种 API 返回结构，统一提取图片 url 列表 */
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
  if (Array.isArray(data)) return data.map(pickUrl).filter((u): u is string => !!u);
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.images)) return normalizeImages(obj.images);
    if (Array.isArray(obj.data)) return normalizeImages(obj.data);
    if (Array.isArray(obj.results)) return normalizeImages(obj.results);
    const single = pickUrl(obj);
    if (single) return [single];
  }
  return [];
}

/** 加载图片为 HTMLImageElement（跨域时设 crossOrigin） */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

/** 根据尺寸 id 计算图层展示尺寸（世界单位） */
function sizeToDisplay(sizeId: string): { width: number; height: number } {
  const [w, h] = sizeId.split('x').map(Number);
  const long = Math.max(w, h) || 1;
  const scale = BASE_LONG_SIDE / long;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** 计算缩放后的图层边界 */
function computeResize(
  dir: HandleDir,
  b: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
  ratio: number | null,
): { x: number; y: number; width: number; height: number } {
  let x = b.x;
  let y = b.y;
  let w = b.width;
  let h = b.height;

  if (dir.includes('e')) w = Math.max(MIN_LAYER_SIZE, b.width + dx);
  if (dir.includes('w')) {
    w = Math.max(MIN_LAYER_SIZE, b.width - dx);
    x = b.x + (b.width - w);
  }
  if (dir.includes('s')) h = Math.max(MIN_LAYER_SIZE, b.height + dy);
  if (dir.includes('n')) {
    h = Math.max(MIN_LAYER_SIZE, b.height - dy);
    y = b.y + (b.height - h);
  }

  // 角落手柄锁定宽高比
  if (ratio && (dir === 'se' || dir === 'sw' || dir === 'ne' || dir === 'nw')) {
    h = w * ratio;
    if (dir === 'ne' || dir === 'nw') y = b.y + (b.height - h);
  }
  return { x, y, width: w, height: h };
}

/* ============================================================ *
 * 子组件：模型下拉选择器
 * ============================================================ */

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
    const handler = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="canvas-model" ref={ref}>
      <button
        type="button"
        className="canvas-model__trigger"
        onClick={() => setOpen((v) => !v)}
        disabled={loading || models.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {loading ? (
          <>
            <Spinner size={14} />
            <span>加载模型…</span>
          </>
        ) : selected ? (
          <>
            <SparklesIcon size={14} />
            <span className="canvas-model__label">{selected.name}</span>
          </>
        ) : (
          <span className="canvas-model__label canvas-model__label--muted">
            {models.length === 0 ? '暂无可用模型' : '选择模型'}
          </span>
        )}
        <ChevronDownIcon size={14} className={open ? 'canvas-model__chev--open' : ''} />
      </button>
      {open && models.length > 0 && (
        <ul className="canvas-model__menu" role="listbox">
          {models.map((m) => (
            <li key={m.id} role="option" aria-selected={m.id === value}>
              <button
                type="button"
                className={`canvas-model__option${m.id === value ? ' canvas-model__option--active' : ''}`}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
              >
                <span className="canvas-model__option-name">{m.name}</span>
                {m.description && (
                  <span className="canvas-model__option-desc">{m.description}</span>
                )}
                {m.id === value && <CheckIcon size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/* ============================================================ *
 * 子组件：尺寸选择器
 * ============================================================ */

const SizeSelector: FC<{ value: string; onChange: (id: string) => void }> = ({
  value,
  onChange,
}) => (
  <div className="canvas-sizes">
    {SIZES.map((s) => (
      <button
        key={s.id}
        type="button"
        className={`canvas-size${s.id === value ? ' canvas-size--active' : ''}`}
        onClick={() => onChange(s.id)}
        title={s.id}
      >
        <span className="canvas-size__ratio" style={{ aspectRatio: s.id.replace('x', ' / ') }} />
        <span className="canvas-size__dim">{s.label}</span>
      </button>
    ))}
  </div>
);

/* ============================================================ *
 * 子组件：顶部工具栏
 * ============================================================ */

const Toolbar: FC<{
  tool: Tool;
  onTool: (t: Tool) => void;
  onZoomFit: () => void;
  onZoomActual: () => void;
  onExport: () => void;
  exporting: boolean;
}> = ({ tool, onTool, onZoomFit, onZoomActual, onExport, exporting }) => (
  <header className="canvas-toolbar">
    <div className="canvas-toolbar__brand">
      <span className="canvas-toolbar__logo">
        <SparklesIcon size={16} />
      </span>
      <div className="canvas-toolbar__title">
        <h2>自由画布</h2>
        <p>Aurora · 无限创意画布</p>
      </div>
    </div>

    <div className="canvas-toolbar__tools" role="toolbar" aria-label="工具">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            className={`canvas-tool${tool === t.key ? ' canvas-tool--active' : ''}`}
            onClick={() => onTool(t.key)}
            title={t.label}
            aria-pressed={tool === t.key}
          >
            <Icon size={17} />
            <span className="canvas-tool__label">{t.label}</span>
          </button>
        );
      })}
    </div>

    <div className="canvas-toolbar__actions">
      <button type="button" className="canvas-iconbtn" onClick={onZoomFit} title="缩放以适应">
        <ZoomFitIcon size={17} />
      </button>
      <button type="button" className="canvas-iconbtn" onClick={onZoomActual} title="实际大小 (100%)">
        <ZoomActualIcon size={17} />
      </button>
      <button
        type="button"
        className="canvas-iconbtn canvas-iconbtn--accent"
        onClick={onExport}
        disabled={exporting}
        title="导出为 PNG"
      >
        {exporting ? <Spinner size={16} /> : <DownloadIcon size={17} />}
      </button>
    </div>
  </header>
);

/* ============================================================ *
 * 子组件：左侧 AI 生成面板
 * ============================================================ */

const AIGenSidebar: FC<{
  prompt: string;
  onPrompt: (v: string) => void;
  models: ImageModel[];
  model: string;
  modelsLoading: boolean;
  onModel: (id: string) => void;
  size: string;
  onSize: (id: string) => void;
  loading: boolean;
  onGenerate: () => void;
}> = ({ prompt, onPrompt, models, model, modelsLoading, onModel, size, onSize, loading, onGenerate }) => (
  <aside className="canvas-sidebar canvas-sidebar--left">
    <div className="canvas-sidebar__head">
      <SparklesIcon size={16} />
      <span>AI 生成</span>
    </div>

    <div className="canvas-sidebar__body">
      <label className="canvas-field">
        <span className="canvas-field__label">提示词</span>
        <textarea
          className="canvas-textarea"
          placeholder="描述你想要生成的画面，越具体效果越好…"
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          rows={5}
        />
      </label>

      <div className="canvas-field">
        <span className="canvas-field__label">模型</span>
        <ModelSelector models={models} value={model} loading={modelsLoading} onChange={onModel} />
      </div>

      <div className="canvas-field">
        <span className="canvas-field__label">尺寸</span>
        <SizeSelector value={size} onChange={onSize} />
      </div>

      <button
        type="button"
        className="canvas-submit"
        onClick={onGenerate}
        disabled={loading || !prompt.trim() || !model}
      >
        {loading ? <Spinner size={16} /> : <SparklesIcon size={16} />}
        {loading ? '生成中…' : '生成到画布'}
      </button>

      <p className="canvas-sidebar__hint">
        生成的图片将作为新图层添加到画布中心，可自由拖动、缩放与编辑。
      </p>
    </div>
  </aside>
);

/* ============================================================ *
 * 子组件：右侧图层面板
 * ============================================================ */

const LayersSidebar: FC<{
  layers: CanvasLayer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (from: number, to: number) => void;
}> = ({ layers, selectedId, onSelect, onToggleVisible, onDelete, onDuplicate, onReorder }) => {
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const sorted = useMemo(
    () => [...layers].sort((a, b) => b.zIndex - a.zIndex),
    [layers],
  );

  const onDragStart = (e: DragEvent<HTMLDivElement>, index: number) => {
    dragIndex.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverIndex(index);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    const from = dragIndex.current;
    dragIndex.current = null;
    setOverIndex(null);
    if (from === null || from === index) return;
    onReorder(from, index);
  };

  return (
    <aside className="canvas-sidebar canvas-sidebar--right">
      <div className="canvas-sidebar__head">
        <LayersIcon size={16} />
        <span>图层</span>
        <span className="canvas-sidebar__count">{layers.length}</span>
      </div>

      <div className="canvas-sidebar__body canvas-layers">
        {sorted.length === 0 ? (
          <div className="canvas-layers__empty">
            <ImageIcon size={28} />
            <p>暂无图层</p>
            <span>在左侧生成图片或添加文字</span>
          </div>
        ) : (
          sorted.map((layer, idx) => (
            <div
              key={layer.id}
              className={`canvas-layer-item${layer.id === selectedId ? ' canvas-layer-item--active' : ''}${
                overIndex === idx ? ' canvas-layer-item--over' : ''
              }${!layer.visible ? ' canvas-layer-item--hidden' : ''}`}
              draggable
              onDragStart={(e) => onDragStart(e, idx)}
              onDragOver={(e) => onDragOver(e, idx)}
              onDrop={(e) => onDrop(e, idx)}
              onDragEnd={() => {
                dragIndex.current = null;
                setOverIndex(null);
              }}
              onClick={() => onSelect(layer.id)}
            >
              <div className="canvas-layer-item__thumb">
                {layer.type === 'image' && layer.url ? (
                  <img src={layer.url} alt="" loading="lazy" />
                ) : (
                  <span className="canvas-layer-item__thumb-text">
                    <TextIcon size={16} />
                  </span>
                )}
              </div>
              <div className="canvas-layer-item__info">
                <span className="canvas-layer-item__name">
                  {layer.type === 'image' ? '图像图层' : layer.text || '文字图层'}
                </span>
                <span className="canvas-layer-item__meta">
                  {Math.round(layer.width)} × {Math.round(layer.height)}
                </span>
              </div>
              <div className="canvas-layer-item__actions">
                <button
                  type="button"
                  className="canvas-layer-item__btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisible(layer.id);
                  }}
                  title={layer.visible ? '隐藏' : '显示'}
                >
                  {layer.visible ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
                </button>
                <button
                  type="button"
                  className="canvas-layer-item__btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(layer.id);
                  }}
                  title="复制图层"
                >
                  <CopyIcon size={14} />
                </button>
                <button
                  type="button"
                  className="canvas-layer-item__btn canvas-layer-item__btn--danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(layer.id);
                  }}
                  title="删除图层"
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
};

/* ============================================================ *
 * 子组件：编辑面板（局部重绘 / 扩图）
 * ============================================================ */

const EditPanel: FC<{
  mode: EditMode;
  layer: CanvasLayer | null;
  inpaintPrompt: string;
  onInpaintPrompt: (v: string) => void;
  brushSize: number;
  onBrushSize: (n: number) => void;
  onClearMask: () => void;
  outpaintPrompt: string;
  onOutpaintPrompt: (v: string) => void;
  outpaintDirection: OutpaintDirection;
  onOutpaintDirection: (d: OutpaintDirection) => void;
  loading: boolean;
  onApply: () => void;
  onClose: () => void;
}> = ({
  mode,
  layer,
  inpaintPrompt,
  onInpaintPrompt,
  brushSize,
  onBrushSize,
  onClearMask,
  outpaintPrompt,
  onOutpaintPrompt,
  outpaintDirection,
  onOutpaintDirection,
  loading,
  onApply,
  onClose,
}) => {
  if (mode === 'none' || !layer) return null;
  const isInpaint = mode === 'inpaint';

  return (
    <div className="canvas-editpanel">
      <div className="canvas-editpanel__head">
        <span className="canvas-editpanel__title">
          {isInpaint ? <WandIcon size={15} /> : <ExpandIcon size={15} />}
          {isInpaint ? '局部重绘' : '扩图'}
        </span>
        <button type="button" className="canvas-editpanel__close" onClick={onClose} aria-label="关闭">
          <CloseIcon size={15} />
        </button>
      </div>

      <div className="canvas-editpanel__body">
        {isInpaint ? (
          <>
            <p className="canvas-editpanel__tip">
              使用画笔在图层上涂抹需要重绘的区域，然后输入提示词应用。
            </p>
            <label className="canvas-field">
              <span className="canvas-field__label">重绘提示词</span>
              <textarea
                className="canvas-textarea"
                placeholder="描述要替换的内容，如：把天空改成极光"
                value={inpaintPrompt}
                onChange={(e) => onInpaintPrompt(e.target.value)}
                rows={3}
              />
            </label>
            <div className="canvas-field">
              <div className="canvas-slider-head">
                <span className="canvas-field__label">画笔大小</span>
                <span className="canvas-slider-value">{brushSize}px</span>
              </div>
              <input
                className="canvas-slider"
                type="range"
                min={4}
                max={120}
                step={1}
                value={brushSize}
                onChange={(e) => onBrushSize(parseInt(e.target.value, 10))}
                style={
                  { ['--canvas-progress' as string]: `${((brushSize - 4) / 116) * 100}%` } as CSSProperties
                }
              />
            </div>
            <div className="canvas-editpanel__row">
              <button type="button" className="canvas-ghostbtn" onClick={onClearMask}>
                <TrashIcon size={14} /> 清除遮罩
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="canvas-editpanel__tip">
              选择扩展方向并输入提示词，AI 将沿该方向扩展图像内容。
            </p>
            <div className="canvas-field">
              <span className="canvas-field__label">扩展方向</span>
              <div className="canvas-directions">
                {OUTPAINT_DIRECTIONS.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    className={`canvas-direction${outpaintDirection === d.key ? ' canvas-direction--active' : ''}`}
                    onClick={() => onOutpaintDirection(d.key)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="canvas-field">
              <span className="canvas-field__label">扩展提示词</span>
              <textarea
                className="canvas-textarea"
                placeholder="描述扩展区域的内容，留空则自动延展"
                value={outpaintPrompt}
                onChange={(e) => onOutpaintPrompt(e.target.value)}
                rows={3}
              />
            </label>
          </>
        )}

        <button
          type="button"
          className="canvas-submit"
          onClick={onApply}
          disabled={loading || (isInpaint ? !inpaintPrompt.trim() : false)}
        >
          {loading ? <Spinner size={16} /> : isInpaint ? <WandIcon size={16} /> : <ExpandIcon size={16} />}
          {loading ? '处理中…' : isInpaint ? '应用重绘' : '应用扩图'}
        </button>
      </div>
    </div>
  );
};

/* ============================================================ *
 * 子组件：右键上下文菜单
 * ============================================================ */

const ContextMenu: FC<{
  state: ContextMenuState;
  onClose: () => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onFront: (id: string) => void;
  onBack: (id: string) => void;
}> = ({ state, onClose, onDelete, onDuplicate, onFront, onBack }) => {
  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('click', handler);
    document.addEventListener('contextmenu', handler);
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('contextmenu', handler);
    };
  }, [onClose]);

  const items: { label: string; icon: FC<IconProps>; action: () => void; danger?: boolean }[] = [
    { label: '复制图层', icon: CopyIcon, action: () => onDuplicate(state.layerId) },
    { label: '置于顶层', icon: FrontIcon, action: () => onFront(state.layerId) },
    { label: '置于底层', icon: BackIcon, action: () => onBack(state.layerId) },
    { label: '删除图层', icon: TrashIcon, action: () => onDelete(state.layerId), danger: true },
  ];

  return (
    <div
      className="canvas-contextmenu"
      style={{ left: state.x, top: state.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <button
            key={it.label}
            type="button"
            className={`canvas-contextmenu__item${it.danger ? ' canvas-contextmenu__item--danger' : ''}`}
            onClick={() => {
              it.action();
              onClose();
            }}
          >
            <Icon size={15} />
            {it.label}
          </button>
        );
      })}
    </div>
  );
};

/* ============================================================ *
 * 主组件
 * ============================================================ */

const FreeCanvas: FC<FreeCanvasProps> = ({
  apiBase = '',
  defaultModel,
  editModel = 'wanx2.1-imageedit',
  className,
  initialLayers = [],
}) => {
  /* ---- 图层与选择 ---- */
  const [layers, setLayers] = useState<CanvasLayer[]>(initialLayers);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  /* ---- 视口（pan / zoom） ---- */
  const [pan, setPan] = useState<View>({ panX: 0, panY: 0, zoom: 1 });
  const [zoom, setZoom] = useState(1);

  /* ---- 工具与编辑模式 ---- */
  const [tool, setTool] = useState<Tool>('select');
  const [editMode, setEditMode] = useState<EditMode>('none');

  /* ---- 模型 ---- */
  const [models, setModels] = useState<ImageModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [model, setModel] = useState(defaultModel ?? '');

  /* ---- 生成参数 ---- */
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');

  /* ---- 局部重绘 / 扩图参数 ---- */
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [brushSize, setBrushSize] = useState(28);
  const [outpaintPrompt, setOutpaintPrompt] = useState('');
  const [outpaintDirection, setOutpaintDirection] = useState<OutpaintDirection>('right');

  /* ---- 状态 ---- */
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  /* ---- refs ---- */
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction>({ type: null, startScreenX: 0, startScreenY: 0, startPanX: 0, startPanY: 0 });
  const viewRef = useRef<View>({ panX: 0, panY: 0, zoom: 1 });
  const layersRef = useRef<CanvasLayer[]>(layers);

  // 局部重绘遮罩画布（显示层 + 数据层）
  const maskDisplayRef = useRef<HTMLCanvasElement | null>(null);
  const maskDataRef = useRef<HTMLCanvasElement | null>(null);
  const maskLastPoint = useRef<{ x: number; y: number } | null>(null);
  const maskLayerIdRef = useRef<string | null>(null);

  // rAF 合并更新 pan/zoom
  const pendingView = useRef<Partial<View>>({});
  const rafIdRef = useRef<number | null>(null);

  // 窗口事件处理器引用（便于卸载）
  const windowMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const windowUpRef = useRef<((e: PointerEvent) => void) | null>(null);

  /* ---- 同步 ref ---- */
  useEffect(() => {
    viewRef.current = { panX: pan.panX, panY: pan.panY, zoom };
  }, [pan, zoom]);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  const selectedLayer = useMemo(
    () => layers.find((l) => l.id === selectedLayerId) ?? null,
    [layers, selectedLayerId],
  );

  /* ---- rAF 刷新视口 ---- */
  const flushView = useCallback(() => {
    rafIdRef.current = null;
    const p = pendingView.current;
    if (p.panX !== undefined || p.panY !== undefined || p.zoom !== undefined) {
      setPan((prev) => ({
        panX: p.panX ?? prev.panX,
        panY: p.panY ?? prev.panY,
        zoom: p.zoom ?? prev.zoom,
      }));
      if (p.zoom !== undefined) setZoom(p.zoom);
    }
    pendingView.current = {};
  }, []);

  const scheduleView = useCallback(() => {
    if (rafIdRef.current == null) {
      rafIdRef.current = requestAnimationFrame(flushView);
    }
  }, [flushView]);

  useEffect(() => () => {
    if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
  }, []);

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
          typeof m === 'string' ? { id: m, name: m } : m,
        );
        if (normalized.length > 0) {
          setModels(normalized);
          setModel((prev) => prev || (defaultModel && normalized.some((m) => m.id === defaultModel) ? defaultModel : normalized[0].id));
        } else {
          setModels(FALLBACK_MODELS);
          setModel((prev) => prev || FALLBACK_MODELS[0].id);
        }
      } catch {
        if (cancelled) return;
        setModels(FALLBACK_MODELS);
        setModel((prev) => prev || FALLBACK_MODELS[0].id);
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

  /* ============================================================ *
   * 坐标转换
   * ============================================================ */
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const v = viewRef.current;
    return {
      x: (clientX - rect.left - v.panX) / v.zoom,
      y: (clientY - rect.top - v.panY) / v.zoom,
    };
  }, []);

  /* ============================================================ *
   * 图层操作
   * ============================================================ */
  const nextZIndex = useCallback(() => {
    const zs = layersRef.current.map((l) => l.zIndex);
    return zs.length ? Math.max(...zs) + 1 : 1;
  }, []);

  const addImageLayer = useCallback(
    (url: string, displayWidth: number, displayHeight: number, atCenter = true) => {
      let x = 0;
      let y = 0;
      if (atCenter) {
        const rect = viewportRef.current?.getBoundingClientRect();
        const v = viewRef.current;
        const cx = rect ? (rect.width / 2 - v.panX) / v.zoom : 0;
        const cy = rect ? (rect.height / 2 - v.panY) / v.zoom : 0;
        x = cx - displayWidth / 2;
        y = cy - displayHeight / 2;
      }
      const id = uid();
      const layer: CanvasLayer = {
        id,
        type: 'image',
        url,
        x,
        y,
        width: displayWidth,
        height: displayHeight,
        rotation: 0,
        visible: true,
        opacity: 1,
        zIndex: nextZIndex(),
      };
      setLayers((prev) => [...prev, layer]);
      setSelectedLayerId(id);
      return id;
    },
    [nextZIndex],
  );

  const addTextLayer = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    const cx = rect ? (rect.width / 2 - v.panX) / v.zoom : 0;
    const cy = rect ? (rect.height / 2 - v.panY) / v.zoom : 0;
    const id = uid();
    const layer: CanvasLayer = {
      id,
      type: 'text',
      text: '双击编辑文字',
      x: cx - 100,
      y: cy - 18,
      width: 200,
      height: 36,
      rotation: 0,
      visible: true,
      opacity: 1,
      zIndex: nextZIndex(),
    };
    setLayers((prev) => [...prev, layer]);
    setSelectedLayerId(id);
    setEditingTextId(id);
    return id;
  }, [nextZIndex]);

  const deleteLayer = useCallback((id: string) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setSelectedLayerId((prev) => (prev === id ? null : prev));
    setEditMode('none');
  }, []);

  const duplicateLayer = useCallback(
    (id: string) => {
      const src = layersRef.current.find((l) => l.id === id);
      if (!src) return;
      const newId = uid();
      const copy: CanvasLayer = {
        ...src,
        id: newId,
        x: src.x + 24,
        y: src.y + 24,
        zIndex: nextZIndex(),
      };
      setLayers((prev) => [...prev, copy]);
      setSelectedLayerId(newId);
    },
    [nextZIndex],
  );

  const bringToFront = useCallback(
    (id: string) => {
      const top = nextZIndex();
      setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, zIndex: top } : l)));
    },
    [nextZIndex],
  );

  const sendToBack = useCallback((id: string) => {
    setLayers((prev) => {
      const minZ = prev.reduce((m, l) => Math.min(m, l.zIndex), 0);
      return prev.map((l) => (l.id === id ? { ...l, zIndex: minZ - 1 } : l));
    });
  }, []);

  const toggleVisible = useCallback((id: string) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));
  }, []);

  const reorderLayers = useCallback((from: number, to: number) => {
    setLayers((prev) => {
      const sorted = [...prev].sort((a, b) => b.zIndex - a.zIndex);
      if (from < 0 || from >= sorted.length || to < 0 || to >= sorted.length) return prev;
      const [moved] = sorted.splice(from, 1);
      sorted.splice(to, 0, moved);
      // 重新分配 zIndex（从高到低）
      return sorted.map((l, i) => ({ ...l, zIndex: sorted.length - i }));
    });
  }, []);

  const updateLayer = useCallback((id: string, patch: Partial<CanvasLayer>) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  /* ============================================================ *
   * 视口操作：缩放
   * ============================================================ */
  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const v = viewRef.current;
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const newZoom = clampZoom(v.zoom * factor);
      const wx = (mx - v.panX) / v.zoom;
      const wy = (my - v.panY) / v.zoom;
      pendingView.current = {
        panX: mx - wx * newZoom,
        panY: my - wy * newZoom,
        zoom: newZoom,
      };
      scheduleView();
    },
    [scheduleView],
  );

  const setZoomAtCenter = useCallback(
    (newZoom: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const v = viewRef.current;
      const mx = rect.width / 2;
      const my = rect.height / 2;
      const wx = (mx - v.panX) / v.zoom;
      const wy = (my - v.panY) / v.zoom;
      const z = clampZoom(newZoom);
      pendingView.current = { panX: mx - wx * z, panY: my - wy * z, zoom: z };
      scheduleView();
    },
    [scheduleView],
  );

  const zoomFit = useCallback(() => {
    const visible = layersRef.current.filter((l) => l.visible);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (visible.length === 0) {
      pendingView.current = { panX: 0, panY: 0, zoom: 1 };
      scheduleView();
      return;
    }
    const minX = Math.min(...visible.map((l) => l.x));
    const minY = Math.min(...visible.map((l) => l.y));
    const maxX = Math.max(...visible.map((l) => l.x + l.width));
    const maxY = Math.max(...visible.map((l) => l.y + l.height));
    const w = maxX - minX;
    const h = maxY - minY;
    const pad = 80;
    const z = clampZoom(Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h));
    pendingView.current = {
      panX: rect.width / 2 - (minX + w / 2) * z,
      panY: rect.height / 2 - (minY + h / 2) * z,
      zoom: z,
    };
    scheduleView();
  }, [scheduleView]);

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(e.clientX, e.clientY, factor);
    },
    [zoomAt],
  );

  /* ============================================================ *
   * 交互：指针事件
   * ============================================================ */
  const endInteraction = useCallback(() => {
    if (windowMoveRef.current) window.removeEventListener('pointermove', windowMoveRef.current);
    if (windowUpRef.current) window.removeEventListener('pointerup', windowUpRef.current);
    windowMoveRef.current = null;
    windowUpRef.current = null;
    interactionRef.current = { type: null, startScreenX: 0, startScreenY: 0, startPanX: 0, startPanY: 0 };
  }, []);

  const beginInteraction = useCallback(
    (e: ReactPointerEvent, inter: Interaction) => {
      e.stopPropagation();
      interactionRef.current = inter;
      const move = (ev: PointerEvent) => {
        const it = interactionRef.current;
        if (!it.type) return;
        const dxScreen = ev.clientX - it.startScreenX;
        const dyScreen = ev.clientY - it.startScreenY;
        const v = viewRef.current;
        const dxWorld = dxScreen / v.zoom;
        const dyWorld = dyScreen / v.zoom;

        if (it.type === 'pan') {
          pendingView.current = { panX: it.startPanX + dxScreen, panY: it.startPanY + dyScreen };
          scheduleView();
        } else if (it.type === 'move' && it.layerId && it.startLayer) {
          const start = it.startLayer;
          setLayers((prev) =>
            prev.map((l) =>
              l.id === it.layerId
                ? { ...l, x: start.x + dxWorld, y: start.y + dyWorld }
                : l,
            ),
          );
        } else if (it.type === 'resize' && it.layerId && it.startLayer && it.handle) {
          const start = it.startLayer;
          const ratio =
            start.type === 'image' && start.width > 0 ? start.height / start.width : null;
          const next = computeResize(it.handle, start, dxWorld, dyWorld, ratio);
          setLayers((prev) =>
            prev.map((l) => (l.id === it.layerId ? { ...l, ...next } : l)),
          );
        }
      };
      const up = () => endInteraction();
      windowMoveRef.current = move;
      windowUpRef.current = up;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [scheduleView, endInteraction],
  );

  /* ---- 视口背景按下：平移 / 取消选择 ---- */
  const onViewportPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button === 2) return; // 右键交给 contextmenu
      if (editMode === 'inpaint') return; // 重绘模式不平移
      // 空白处单击取消选择
      if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-grid')) {
        setSelectedLayerId(null);
      }
      if (tool === 'pan' || tool === 'select' || tool === 'eraser') {
        const v = viewRef.current;
        beginInteraction(e, {
          type: 'pan',
          startScreenX: e.clientX,
          startScreenY: e.clientY,
          startPanX: v.panX,
          startPanY: v.panY,
        });
      }
    },
    [tool, editMode, beginInteraction],
  );

  /* ---- 图层按下：选择 / 移动 ---- */
  const onLayerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, layer: CanvasLayer) => {
      if (e.button === 2) return;
      if (editMode === 'inpaint') return;
      if (tool === 'pan') {
        onViewportPointerDown(e);
        return;
      }
      setSelectedLayerId(layer.id);
      if (tool === 'select' || tool === 'text') {
        beginInteraction(e, {
          type: 'move',
          startScreenX: e.clientX,
          startScreenY: e.clientY,
          startPanX: 0,
          startPanY: 0,
          layerId: layer.id,
          startLayer: layer,
        });
      }
    },
    [tool, editMode, beginInteraction, onViewportPointerDown],
  );

  /* ---- 缩放手柄按下 ---- */
  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, dir: HandleDir, layer: CanvasLayer) => {
      if (e.button === 2) return;
      e.stopPropagation();
      beginInteraction(e, {
        type: 'resize',
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        startPanX: 0,
        startPanY: 0,
        layerId: layer.id,
        handle: dir,
        startLayer: layer,
      });
    },
    [beginInteraction],
  );

  /* ---- 右键菜单 ---- */
  const onContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>, layer: CanvasLayer) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedLayerId(layer.id);
      setContextMenu({ x: e.clientX, y: e.clientY, layerId: layer.id });
    },
    [],
  );

  const onViewportContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  /* ---- 双击进入编辑 ---- */
  const onLayerDoubleClick = useCallback(
    (layer: CanvasLayer) => {
      if (layer.type === 'text') {
        setEditingTextId(layer.id);
        setSelectedLayerId(layer.id);
        return;
      }
      if (layer.type === 'image' && layer.url) {
        setSelectedLayerId(layer.id);
        enterInpaint(layer);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* ============================================================ *
   * 局部重绘（Inpainting）
   * ============================================================ */
  const enterInpaint = useCallback((layer: CanvasLayer) => {
    if (layer.type !== 'image' || !layer.url) return;
    setEditMode('inpaint');
    setTool('brush');
    maskLayerIdRef.current = layer.id;
    // 创建数据层遮罩画布（白底透明）
    const data = document.createElement('canvas');
    data.width = Math.max(1, Math.round(layer.width));
    data.height = Math.max(1, Math.round(layer.height));
    maskDataRef.current = data;
    maskLastPoint.current = null;
  }, []);

  const exitEditMode = useCallback(() => {
    setEditMode('none');
    maskDisplayRef.current = null;
    maskDataRef.current = null;
    maskLastPoint.current = null;
    maskLayerIdRef.current = null;
    setTool('select');
  }, []);

  const clearMask = useCallback(() => {
    const data = maskDataRef.current;
    const disp = maskDisplayRef.current;
    if (data) {
      const ctx = data.getContext('2d');
      ctx?.clearRect(0, 0, data.width, data.height);
    }
    if (disp) {
      const ctx = disp.getContext('2d');
      ctx?.clearRect(0, 0, disp.width, disp.height);
    }
    maskLastPoint.current = null;
  }, []);

  const paintMask = useCallback(
    (clientX: number, clientY: number) => {
      const layer = selectedLayer;
      const data = maskDataRef.current;
      const disp = maskDisplayRef.current;
      if (!layer || !data || !disp) return;
      const world = screenToWorld(clientX, clientY);
      const cx = world.x - layer.x;
      const cy = world.y - layer.y;
      // 画布坐标 = 世界坐标（画布缓冲与图层世界尺寸一致）
      const drawStroke = (ctx: CanvasRenderingContext2D | null, color: string) => {
        if (!ctx) return;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushSize;
        ctx.strokeStyle = color;
        ctx.beginPath();
        const last = maskLastPoint.current;
        if (last) {
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(cx, cy);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, brushSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      };
      drawStroke(data.getContext('2d'), '#ffffff');
      drawStroke(disp.getContext('2d'), 'rgba(255, 59, 92, 0.55)');
      maskLastPoint.current = { x: cx, y: cy };
    },
    [selectedLayer, brushSize, screenToWorld],
  );

  const onMaskPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (editMode !== 'inpaint') return;
      e.stopPropagation();
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      maskLastPoint.current = null;
      paintMask(e.clientX, e.clientY);
      const move = (ev: PointerEvent) => paintMask(ev.clientX, ev.clientY);
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        maskLastPoint.current = null;
        try {
          (ev.target as HTMLCanvasElement).releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [editMode, paintMask],
  );

  const applyInpaint = useCallback(async () => {
    const layer = selectedLayer;
    if (!layer || !layer.url) return;
    const data = maskDataRef.current;
    if (!data) {
      setError('请先涂抹重绘区域');
      return;
    }
    if (!inpaintPrompt.trim()) {
      setError('请输入重绘提示词');
      return;
    }
    // 合成黑白遮罩（黑=保留，白=重绘）
    const out = document.createElement('canvas');
    out.width = data.width;
    out.height = data.height;
    const octx = out.getContext('2d');
    if (!octx) return;
    octx.fillStyle = '#000000';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(data, 0, 0);
    const maskUrl = out.toDataURL('image/png');

    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${apiBase}/api/image/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          prompt: inpaintPrompt.trim(),
          imageUrl: layer.url,
          maskUrl,
          model: editModel,
        }),
      });
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
      const json = await resp.json();
      const urls = normalizeImages(json);
      if (urls.length === 0) throw new Error('未返回任何图片，请稍后重试');
      setLayers((prev) =>
        prev.map((l) => (l.id === layer.id ? { ...l, url: urls[0] } : l)),
      );
      exitEditMode();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, [selectedLayer, inpaintPrompt, apiBase, editModel, exitEditMode]);

  /* ============================================================ *
   * 扩图（Outpainting）
   * ============================================================ */
  const applyOutpaint = useCallback(async () => {
    const layer = selectedLayer;
    if (!layer || !layer.url) return;
    setLoading(true);
    setError(null);
    try {
      const img = await loadImage(layer.url);
      const iw = img.naturalWidth || layer.width;
      const ih = img.naturalHeight || layer.height;
      const ext = 0.5; // 扩展比例
      const extW = Math.round(iw * ext);
      const extH = Math.round(ih * ext);

      let ox = 0;
      let oy = 0;
      let nw = iw;
      let nh = ih;
      const regions: { x: number; y: number; w: number; h: number }[] = [];

      const d = outpaintDirection;
      if (d === 'left' || d === 'all') {
        ox += extW;
        nw += extW;
        regions.push({ x: 0, y: 0, w: extW, h: nh });
      }
      if (d === 'right' || d === 'all') {
        nw += extW;
        regions.push({ x: nw - extW, y: 0, w: extW, h: nh });
      }
      if (d === 'up' || d === 'all') {
        oy += extH;
        nh += extH;
        // 上方区域在已有 nw 基础上；重新校正前面的区域高度
        regions.push({ x: 0, y: 0, w: nw, h: extH });
      }
      if (d === 'down' || d === 'all') {
        nh += extH;
        regions.push({ x: 0, y: nh - extH, w: nw, h: extH });
      }
      if (regions.length === 0) throw new Error('无效的扩展方向');

      // 合成源图（原图放置在偏移位置，扩展区透明）
      const src = document.createElement('canvas');
      src.width = nw;
      src.height = nh;
      const sctx = src.getContext('2d');
      if (!sctx) throw new Error('画布初始化失败');
      sctx.drawImage(img, ox, oy, iw, ih);
      const sourceUrl = src.toDataURL('image/png');

      // 合成遮罩（扩展区为白）
      const mask = document.createElement('canvas');
      mask.width = nw;
      mask.height = nh;
      const mctx = mask.getContext('2d');
      if (!mctx) throw new Error('画布初始化失败');
      mctx.fillStyle = '#000000';
      mctx.fillRect(0, 0, nw, nh);
      mctx.fillStyle = '#ffffff';
      regions.forEach((r) => mctx.fillRect(r.x, r.y, r.w, r.h));
      const maskUrl = mask.toDataURL('image/png');

      const resp = await fetch(`${apiBase}/api/image/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          prompt: outpaintPrompt.trim() || '自然扩展图像内容',
          imageUrl: sourceUrl,
          maskUrl,
          model: editModel,
        }),
      });
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
      const json = await resp.json();
      const urls = normalizeImages(json);
      if (urls.length === 0) throw new Error('未返回任何图片，请稍后重试');

      // 按比例更新图层世界尺寸与位置
      const scale = layer.width / iw;
      const newDispW = nw * scale;
      const newDispH = nh * (layer.height / ih);
      const newX = layer.x - ox * scale;
      const newY = layer.y - oy * (layer.height / ih);
      setLayers((prev) =>
        prev.map((l) =>
          l.id === layer.id
            ? { ...l, url: urls[0], x: newX, y: newY, width: newDispW, height: newDispH }
            : l,
        ),
      );
      exitEditMode();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, [selectedLayer, outpaintPrompt, outpaintDirection, apiBase, editModel, exitEditMode]);

  /* ============================================================ *
   * AI 生成
   * ============================================================ */
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setError('请输入提示词');
      return;
    }
    if (!model) {
      setError('请选择模型');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${apiBase}/api/image/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), model, size, count: 1 }),
      });
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
      const json = await resp.json();
      const urls = normalizeImages(json);
      if (urls.length === 0) throw new Error('未返回任何图片，请稍后重试');
      const { width, height } = sizeToDisplay(size);
      addImageLayer(urls[0], width, height, true);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, [prompt, model, size, apiBase, addImageLayer]);

  /* ============================================================ *
   * 导出 PNG
   * ============================================================ */
  const handleExport = useCallback(async () => {
    const visible = layersRef.current.filter((l) => l.visible);
    if (visible.length === 0) {
      setError('画布上没有可导出的图层');
      return;
    }
    setExporting(true);
    setError(null);
    try {
      const minX = Math.min(...visible.map((l) => l.x));
      const minY = Math.min(...visible.map((l) => l.y));
      const maxX = Math.max(...visible.map((l) => l.x + l.width));
      const maxY = Math.max(...visible.map((l) => l.y + l.height));
      const w = Math.ceil(maxX - minX);
      const h = Math.ceil(maxY - minY);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('画布初始化失败');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const sorted = [...visible].sort((a, b) => a.zIndex - b.zIndex);
      for (const layer of sorted) {
        if (layer.type === 'image' && layer.url) {
          try {
            const img = await loadImage(layer.url);
            ctx.globalAlpha = layer.opacity;
            ctx.drawImage(img, layer.x - minX, layer.y - minY, layer.width, layer.height);
            ctx.globalAlpha = 1;
          } catch {
            /* 跳过加载失败的图层 */
          }
        } else if (layer.type === 'text' && layer.text) {
          ctx.globalAlpha = layer.opacity;
          const fontSize = Math.max(12, layer.height * 0.7);
          ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', sans-serif`;
          ctx.fillStyle = '#1a1a2e';
          ctx.textBaseline = 'middle';
          ctx.fillText(layer.text, layer.x - minX + 4, layer.y - minY + layer.height / 2);
          ctx.globalAlpha = 1;
        }
      }

      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `aurora-canvas-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    } catch (e) {
      setError(formatError(e));
    } finally {
      setExporting(false);
    }
  }, []);

  /* ============================================================ *
   * 工具切换
   * ============================================================ */
  const handleToolChange = useCallback(
    (t: Tool) => {
      if (t === 'text') {
        addTextLayer();
        setTool('select');
        return;
      }
      setTool(t);
      if (t !== 'brush' && editMode === 'inpaint') {
        exitEditMode();
      }
    },
    [addTextLayer, editMode, exitEditMode],
  );

  /* ============================================================ *
   * 键盘快捷键
   * ============================================================ */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (e.key === 'Escape') (target as HTMLElement).blur();
        return;
      }
      if (e.key === 'Escape') {
        if (editMode !== 'none') exitEditMode();
        else setSelectedLayerId(null);
        setContextMenu(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLayerId) deleteLayer(selectedLayerId);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedLayerId) duplicateLayer(selectedLayerId);
      } else if (e.key === '0') {
        setZoomAtCenter(1);
      } else if (e.key === '=' || e.key === '+') {
        setZoomAtCenter(viewRef.current.zoom * 1.2);
      } else if (e.key === '-') {
        setZoomAtCenter(viewRef.current.zoom / 1.2);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode, selectedLayerId, deleteLayer, duplicateLayer, exitEditMode, setZoomAtCenter]);

  /* ============================================================ *
   * 文字图层编辑
   * ============================================================ */
  const commitText = useCallback(
    (id: string, value: string) => {
      updateLayer(id, { text: value || '文字' });
      setEditingTextId(null);
    },
    [updateLayer],
  );

  /* ============================================================ *
   * 渲染
   * ============================================================ */
  const contentStyle: CSSProperties = {
    transform: `translate(${pan.panX}px, ${pan.panY}px) scale(${zoom})`,
    ...({ ['--canvas-zoom' as string]: zoom } as CSSProperties),
  };

  const gridStyle: CSSProperties = {
    backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
    backgroundPosition: `${pan.panX}px ${pan.panY}px`,
  };

  const cursorClass = useMemo(() => {
    if (editMode === 'inpaint') return 'canvas-viewport--brush';
    if (tool === 'pan') return 'canvas-viewport--pan';
    if (tool === 'eraser') return 'canvas-viewport--eraser';
    return '';
  }, [tool, editMode]);

  return (
    <div className={`canvas-root${className ? ` ${className}` : ''}`}>
      <Toolbar
        tool={tool}
        onTool={handleToolChange}
        onZoomFit={zoomFit}
        onZoomActual={() => setZoomAtCenter(1)}
        onExport={handleExport}
        exporting={exporting}
      />

      <div className="canvas-body">
        <AIGenSidebar
          prompt={prompt}
          onPrompt={setPrompt}
          models={models}
          model={model}
          modelsLoading={modelsLoading}
          onModel={setModel}
          size={size}
          onSize={setSize}
          loading={loading}
          onGenerate={handleGenerate}
        />

        {/* 画布视口 */}
        <div
          ref={viewportRef}
          className={`canvas-viewport ${cursorClass}`}
          onPointerDown={onViewportPointerDown}
          onWheel={onWheel}
          onContextMenu={onViewportContextMenu}
        >
          <div ref={gridRef} className="canvas-grid" style={gridStyle} />

          <div ref={contentRef} className="canvas-content" style={contentStyle}>
            {layers
              .filter((l) => l.visible)
              .sort((a, b) => a.zIndex - b.zIndex)
              .map((layer) => {
                const isSelected = layer.id === selectedLayerId;
                const showHandles =
                  isSelected && editMode !== 'inpaint' && tool !== 'pan';
                const layerStyle: CSSProperties = {
                  left: layer.x,
                  top: layer.y,
                  width: layer.width,
                  height: layer.height,
                  transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
                  opacity: layer.opacity,
                  zIndex: layer.zIndex,
                };
                return (
                  <div
                    key={layer.id}
                    className={`canvas-layer${isSelected ? ' canvas-layer--selected' : ''}`}
                    style={layerStyle}
                    onPointerDown={(e) => onLayerPointerDown(e, layer)}
                    onDoubleClick={() => onLayerDoubleClick(layer)}
                    onContextMenu={(e) => onContextMenu(e, layer)}
                  >
                    {layer.type === 'image' && layer.url ? (
                      <img
                        src={layer.url}
                        alt=""
                        draggable={false}
                        className="canvas-layer__img"
                      />
                    ) : layer.type === 'text' ? (
                      editingTextId === layer.id ? (
                        <input
                          className="canvas-layer__text-input"
                          defaultValue={layer.text}
                          autoFocus
                          onFocus={(e) => e.target.select()}
                          onBlur={(e) => commitText(layer.id, e.target.value)}
                          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter') commitText(layer.id, e.currentTarget.value);
                            if (e.key === 'Escape') setEditingTextId(null);
                          }}
                        />
                      ) : (
                        <div className="canvas-layer__text">{layer.text}</div>
                      )
                    ) : null}

                    {/* 选中边框与缩放手柄 */}
                    {showHandles && (
                      <>
                        <div className="canvas-layer__outline" />
                        {HANDLES.map((dir) => (
                          <div
                            key={dir}
                            className={`canvas-handle canvas-handle--${dir}`}
                            onPointerDown={(e) => onHandlePointerDown(e, dir, layer)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                );
              })}

            {/* 局部重绘遮罩画布 */}
            {editMode === 'inpaint' && selectedLayer && (
              <canvas
                key={`mask-${selectedLayer.id}`}
                ref={(el) => {
                  maskDisplayRef.current = el;
                  if (el) {
                    el.width = Math.max(1, Math.round(selectedLayer.width));
                    el.height = Math.max(1, Math.round(selectedLayer.height));
                  }
                }}
                className="canvas-mask"
                style={{
                  left: selectedLayer.x,
                  top: selectedLayer.y,
                  width: selectedLayer.width,
                  height: selectedLayer.height,
                  zIndex: selectedLayer.zIndex + 1,
                }}
                onPointerDown={onMaskPointerDown}
              />
            )}
          </div>

          {/* 编辑面板 */}
          <EditPanel
            mode={editMode}
            layer={selectedLayer}
            inpaintPrompt={inpaintPrompt}
            onInpaintPrompt={setInpaintPrompt}
            brushSize={brushSize}
            onBrushSize={setBrushSize}
            onClearMask={clearMask}
            outpaintPrompt={outpaintPrompt}
            onOutpaintPrompt={setOutpaintPrompt}
            outpaintDirection={outpaintDirection}
            onOutpaintDirection={setOutpaintDirection}
            loading={loading}
            onApply={editMode === 'inpaint' ? applyInpaint : applyOutpaint}
            onClose={exitEditMode}
          />

          {/* 编辑模式入口按钮 */}
          {selectedLayer && selectedLayer.type === 'image' && editMode === 'none' && (
            <div className="canvas-editentry">
              <button
                type="button"
                className="canvas-editentry__btn"
                onClick={() => enterInpaint(selectedLayer)}
                title="局部重绘"
              >
                <WandIcon size={15} /> 局部重绘
              </button>
              <button
                type="button"
                className="canvas-editentry__btn"
                onClick={() => setEditMode('outpaint')}
                title="扩图"
              >
                <ExpandIcon size={15} /> 扩图
              </button>
            </div>
          )}

          {/* 状态栏 */}
          <div className="canvas-statusbar">
            <span className="canvas-statusbar__zoom">{Math.round(zoom * 100)}%</span>
            <span className="canvas-statusbar__sep" />
            <span className="canvas-statusbar__coord">
              {tool === 'brush' && editMode === 'inpaint' ? '重绘模式' : tool === 'pan' ? '平移模式' : '选择模式'}
            </span>
            <span className="canvas-statusbar__sep" />
            <span className="canvas-statusbar__layers">{layers.length} 图层</span>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="canvas-error" role="alert">
              <AlertIcon size={16} className="canvas-error__icon" />
              <span className="canvas-error__msg">{error}</span>
              <button
                type="button"
                className="canvas-error__close"
                onClick={() => setError(null)}
                aria-label="关闭"
              >
                <CloseIcon size={14} />
              </button>
            </div>
          )}
        </div>

        <LayersSidebar
          layers={layers}
          selectedId={selectedLayerId}
          onSelect={setSelectedLayerId}
          onToggleVisible={toggleVisible}
          onDelete={deleteLayer}
          onDuplicate={duplicateLayer}
          onReorder={reorderLayers}
        />
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onDelete={deleteLayer}
          onDuplicate={duplicateLayer}
          onFront={bringToFront}
          onBack={sendToBack}
        />
      )}
    </div>
  );
};

export default FreeCanvas;
