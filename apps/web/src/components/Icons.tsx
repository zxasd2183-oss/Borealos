/**
 * BorealOS SVG 图标系统
 * 替代所有 emoji 图标，提供清晰、统一的视觉风格
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

/* ==================== 品牌 Logo ==================== */

export const BorealOsLogo: FC<IconProps> = ({ size = 24, className }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} style={{ flexShrink: 0 }}>
    <defs>
      <linearGradient id="boreal-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#007acc" />
        <stop offset="100%" stopColor="#4ec9b0" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="7" fill="url(#boreal-grad)" />
    <path d="M16 6L8 26h3l2-5h6l2 5h3L16 6z" fill="#fff" />
    <path d="M13.5 18l2.5-6 2.5 6h-5z" fill="url(#boreal-grad)" />
  </svg>
);
