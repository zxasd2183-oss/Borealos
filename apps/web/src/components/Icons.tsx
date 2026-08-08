/**
 * Aurora SVG 图标系统
 * 品牌设计 · 极光主题 · 统一视觉风格
 */
import type { FC } from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

const Svg: FC<IconProps & { children: React.ReactNode }> = ({ size = 16, className, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ flexShrink: 0 }}
  >
    {children}
  </svg>
);

/* ==================== 活动栏图标 ==================== */

export const ExplorerIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    <path d="M3 10h18" />
  </Svg>
);

export const SearchIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
);

export const GitIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <path d="M6 8.5V15a3 3 0 0 0 3 3h7" />
    <path d="M18 8.5c0 4-5 4-6 7" />
  </Svg>
);

export const AiIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 2L9.5 8.5L3 11l6.5 2.5L12 20l2.5-6.5L21 11l-6.5-2.5L12 2z" />
    <path d="M12 7v3M12 14v3" opacity="0.5" />
  </Svg>
);

export const SettingsIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
);

/* ==================== 通用操作图标 ==================== */

export const ChevronRightIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

export const ChevronDownIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const CloseIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const PlusIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const RefreshIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </Svg>
);

export const CollapseIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M9 11l-4 4 4 4M5 15h10M15 5l4 4-4 4M19 9H9" />
  </Svg>
);

export const SendIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M22 2L11 13" />
    <path d="M22 2l-7 20-4-9-9-4 20-7z" />
  </Svg>
);

export const CheckIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Svg>
);

export const TerminalIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M4 17l6-5-6-5M12 19h8" />
    <rect x="2" y="3" width="20" height="18" rx="2" />
  </Svg>
);

export const SearchSmallIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
);

export const GearIcon: FC<IconProps> = (p) => <SettingsIcon {...p} />;

/* ==================== 记忆大脑图标 ==================== */

export const BrainIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 2a3 3 0 0 0-3 3v.5A3 3 0 0 0 6 8a3 3 0 0 0-1 5.83A3 3 0 0 0 8 19a3 3 0 0 0 4 1 3 3 0 0 0 4-1 3 3 0 0 0 3-5.17A3 3 0 0 0 18 8a3 3 0 0 0-3-2.5V5a3 3 0 0 0-3-3z" fill="currentColor" fillOpacity="0.1" />
    <path d="M12 5v14M9 8h.01M15 8h.01M9 16h.01M15 16h.01" />
  </Svg>
);

export const SyncIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 0 1-9 9c-2.5 0-4.8-1-6.5-2.7L3 21" />
    <path d="M3 12a9 9 0 0 1 9-9c2.5 0 4.8 1 6.5 2.7L21 3" />
    <path d="M21 3v6h-6M3 21v-6h6" />
  </Svg>
);

export const EditIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </Svg>
);

/* ==================== 用量/进度图标 ==================== */

export const ChartIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M3 3v18h18" />
    <rect x="7" y="13" width="3" height="5" rx="0.5" fill="currentColor" fillOpacity="0.3" />
    <rect x="12" y="9" width="3" height="9" rx="0.5" fill="currentColor" fillOpacity="0.5" />
    <rect x="17" y="5" width="3" height="13" rx="0.5" fill="currentColor" fillOpacity="0.7" />
  </Svg>
);

export const RocketIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </Svg>
);

export const ZapIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" fillOpacity="0.2" />
  </Svg>
);

export const ClockIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </Svg>
);

export const TargetIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
  </Svg>
);

export const LayersIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" fill="currentColor" fillOpacity="0.15" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </Svg>
);

export const TrendingUpIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </Svg>
);

export const CoinIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity="0.1" />
    <path d="M12 6v12M9 9h4.5a2 2 0 0 1 0 4H9M9 13h5a2 2 0 0 1 0 4H9" />
  </Svg>
);

/* ==================== 文件类型图标 ==================== */

export const FolderIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" fill="currentColor" fillOpacity="0.15" />
  </Svg>
);

export const FolderOpenIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z" fill="currentColor" fillOpacity="0.15" />
    <path d="M3 9l2.5 9a1 1 0 0 0 1 .8h12a1 1 0 0 0 1-.8L22 9H3z" fill="currentColor" fillOpacity="0.1" />
    <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M3 9l2.5 9a1 1 0 0 0 1 .8h12a1 1 0 0 0 1-.8L22 9H3z" />
  </Svg>
);

export const FileIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </Svg>
);

export const TsIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" fill="#3178c6" stroke="none" />
    <text x="12" y="16" fontSize="9" fontWeight="bold" fill="#fff" textAnchor="middle" stroke="none">TS</text>
  </Svg>
);

export const TsxIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" fill="#3178c6" stroke="none" />
    <text x="12" y="16" fontSize="8" fontWeight="bold" fill="#fff" textAnchor="middle" stroke="none">TSX</text>
  </Svg>
);

export const JsIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" fill="#f7df1e" stroke="none" />
    <text x="12" y="16" fontSize="9" fontWeight="bold" fill="#000" textAnchor="middle" stroke="none">JS</text>
  </Svg>
);

export const JsonIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" fill="#cbcb41" stroke="none" />
    <text x="12" y="16" fontSize="8" fontWeight="bold" fill="#000" textAnchor="middle" stroke="none">{`{}`}</text>
  </Svg>
);

export const CssIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" fill="#1572b6" stroke="none" />
    <text x="12" y="16" fontSize="8" fontWeight="bold" fill="#fff" textAnchor="middle" stroke="none">CSS</text>
  </Svg>
);

export const HtmlIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" fill="#e34c26" stroke="none" />
    <text x="12" y="16" fontSize="8" fontWeight="bold" fill="#fff" textAnchor="middle" stroke="none">HTML</text>
  </Svg>
);

export const MdIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" fill="#519aba" stroke="none" />
    <text x="12" y="16" fontSize="8" fontWeight="bold" fill="#fff" textAnchor="middle" stroke="none">MD</text>
  </Svg>
);

export const SvgIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" fill="#ffb13b" stroke="none" />
    <text x="12" y="16" fontSize="7" fontWeight="bold" fill="#000" textAnchor="middle" stroke="none">SVG</text>
  </Svg>
);

/**
 * 根据文件名获取对应的文件类型图标
 */
export function getFileTypeIcon(name: string): FC<IconProps> {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'tsx': return TsxIcon;
    case 'ts': return TsIcon;
    case 'jsx': return JsIcon;
    case 'js': return JsIcon;
    case 'json': return JsonIcon;
    case 'css': return CssIcon;
    case 'scss':
    case 'sass': return CssIcon;
    case 'html': return HtmlIcon;
    case 'md': return MdIcon;
    case 'svg':
    case 'xml': return SvgIcon;
    default: return FileIcon;
  }
}

/* ==================== 品牌 Logo — Aurora 极光 ==================== */

export const AuroraLogo: FC<IconProps> = ({ size = 24, className }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} style={{ flexShrink: 0 }}>
    <defs>
      <linearGradient id="al-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#06071A" />
        <stop offset="100%" stopColor="#160830" />
      </linearGradient>
      <linearGradient id="al-g1" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#00E5BB" />
        <stop offset="48%" stopColor="#3D8EFF" />
        <stop offset="100%" stopColor="#BF5AF2" />
      </linearGradient>
      <linearGradient id="al-g2" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#64D2FF" />
        <stop offset="100%" stopColor="#9B6BFF" />
      </linearGradient>
      <filter id="al-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="1.2" result="blur" />
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    {/* 深空背景 */}
    <rect width="32" height="32" rx="8.5" fill="url(#al-bg)" />
    {/* 主极光弧 — 最亮 */}
    <path d="M3 20 C7 15 11 13 16 15 C21 17 25 14 29 10"
          stroke="url(#al-g1)" strokeWidth="2.6" strokeLinecap="round" fill="none"
          filter="url(#al-glow)" />
    {/* 第二弧 */}
    <path d="M3 24.5 C7 21 11 19 16 20.5 C21 22 25 20 29 17.5"
          stroke="url(#al-g2)" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.7" />
    {/* 第三弧 — 最淡 */}
    <path d="M3 15 C7 10 11 8 16 10 C21 12 25 9.5 29 6"
          stroke="url(#al-g1)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.4" />
    {/* 星点 */}
    <circle cx="27" cy="5.5" r="1.2" fill="white" opacity="0.9" />
    <circle cx="6"  cy="7"   r="0.7" fill="#64D2FF" opacity="0.75" />
    <circle cx="22" cy="26"  r="0.55" fill="#BF5AF2" opacity="0.6" />
    {/* 外描边高光 */}
    <rect width="32" height="32" rx="8.5" fill="none"
          stroke="rgba(100,210,255,0.18)" strokeWidth="0.75" />
  </svg>
);

/* ==================== 多视图导航图标 ==================== */

export const WorkIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.15" />
    <rect x="14" y="3" width="7" height="4" rx="1.5" fill="currentColor" fillOpacity="0.1" />
    <rect x="14" y="10" width="7" height="11" rx="1.5" fill="currentColor" fillOpacity="0.2" />
    <rect x="3" y="13" width="7" height="8" rx="1.5" fill="currentColor" fillOpacity="0.1" />
  </Svg>
);

export const ImageIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" fillOpacity="0.3" />
    <path d="M21 15l-5-5L5 21" />
  </Svg>
);

export const CanvasIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 3v18" opacity="0.4" />
    <circle cx="6" cy="6" r="1" fill="currentColor" />
    <circle cx="18" cy="18" r="1" fill="currentColor" />
    <circle cx="6" cy="18" r="1" fill="currentColor" fillOpacity="0.5" />
    <circle cx="18" cy="6" r="1" fill="currentColor" fillOpacity="0.5" />
  </Svg>
);

export const CodeIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
    <line x1="14" y1="4" x2="10" y2="20" opacity="0.5" />
  </Svg>
);

export const ServerIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="6" rx="1.5" fill="currentColor" fillOpacity="0.1" />
    <rect x="3" y="14" width="18" height="6" rx="1.5" fill="currentColor" fillOpacity="0.1" />
    <circle cx="7" cy="7" r="0.8" fill="currentColor" />
    <circle cx="7" cy="17" r="0.8" fill="currentColor" />
    <line x1="11" y1="7" x2="17" y2="7" opacity="0.5" />
    <line x1="11" y1="17" x2="17" y2="17" opacity="0.5" />
  </Svg>
);

export const BrowserIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="2" y="3" width="20" height="18" rx="2" />
    <path d="M2 8h20" />
    <circle cx="5" cy="5.5" r="0.5" fill="currentColor" />
    <circle cx="7" cy="5.5" r="0.5" fill="currentColor" />
    <circle cx="9" cy="5.5" r="0.5" fill="currentColor" />
  </Svg>
);

export const VideoIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="2" y="6" width="14" height="12" rx="2" fill="currentColor" fillOpacity="0.1" />
    <path d="M16 10l6-3v10l-6-3" />
  </Svg>
);

export const GridIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.15" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.15" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.15" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.15" />
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);

/* ==================== 操作工具图标 ==================== */

export const PaperclipIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Svg>
);

export const MicIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" fillOpacity="0.15" />
    <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </Svg>
);

export const ScreenshotIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" fillOpacity="0.15" />
  </Svg>
);

export const DownloadIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Svg>
);

export const CopyIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
);

export const PlayIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" fillOpacity="0.2" />
  </Svg>
);

export const StopIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" fillOpacity="0.2" />
  </Svg>
);

export const SparkleIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" fill="currentColor" fillOpacity="0.15" />
    <path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16z" fill="currentColor" fillOpacity="0.3" />
  </Svg>
);

export const UploadIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 4v10M12 4l-4 4M12 4l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
  </Svg>
);

/* ==================== 新增功能图标 ==================== */

export const AudioIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" fill="currentColor" fillOpacity="0.2" />
    <circle cx="18" cy="16" r="3" fill="currentColor" fillOpacity="0.2" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Svg>
);

export const TemplateIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="5" rx="1.5" fill="currentColor" fillOpacity="0.15" />
    <rect x="3" y="10" width="8" height="11" rx="1.5" fill="currentColor" fillOpacity="0.1" />
    <rect x="13" y="10" width="8" height="5" rx="1.5" fill="currentColor" fillOpacity="0.1" />
    <rect x="13" y="17" width="8" height="4" rx="1.5" fill="currentColor" fillOpacity="0.1" />
    <rect x="3" y="3" width="18" height="5" rx="1.5" />
    <rect x="3" y="10" width="8" height="11" rx="1.5" />
    <rect x="13" y="10" width="8" height="5" rx="1.5" />
    <rect x="13" y="17" width="8" height="4" rx="1.5" />
  </Svg>
);

export const AdminIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 2L3 7v5c0 5.25 3.75 10.17 9 11.33C17.25 22.17 21 17.25 21 12V7L12 2z" fill="currentColor" fillOpacity="0.1" />
    <path d="M12 2L3 7v5c0 5.25 3.75 10.17 9 11.33C17.25 22.17 21 17.25 21 12V7L12 2z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);

/** 兼容旧引用 */
export const BorealOsLogo = AuroraLogo;
