import { useEffect, useRef, useState } from 'react';
import type { FC } from 'react';

interface SplashScreenProps {
  onFinish: () => void;
}

/** 星尘粒子 */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  twinkle: number;
  color: string;
}

/** 极光丝带控制点 */
interface AuroraPoint {
  offset: number;
  speed: number;
  amplitude: number;
}

const AURORA_COLORS = [
  '0, 122, 255',    // Apple Blue
  '88, 86, 214',    // Purple
  '100, 210, 255',  // Teal
  '0, 122, 255',    // Apple Blue (repeat for density)
];

/**
 * Aurora CG 启动动画
 *
 * 阶段流程：
 *   0.0s — 0.6s : 星尘涌现，深空展开
 *   0.6s — 1.4s : 极光波纹从底部升起
 *   1.4s — 2.2s : Logo 从极光中凝聚成形
 *   2.2s — 2.8s : 品牌名 "Aurora" 逐字点亮
 *   2.8s — 3.4s : 进度条加载完成
 *   3.4s — 4.0s : 整体淡出，进入应用
 */
const SplashScreen: FC<SplashScreenProps> = ({ onFinish }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState(0);
  const [brandReveal, setBrandReveal] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const animationRef = useRef<number>(0);

  // ---- 阶段推进 ----
  useEffect(() => {
    const timers: number[] = [];
    timers.push(window.setTimeout(() => setPhase(1), 600));
    timers.push(window.setTimeout(() => setPhase(2), 1400));
    timers.push(window.setTimeout(() => setPhase(3), 2200));

    // 品牌名逐字揭示
    const brandChars = 'Aurora'.length;
    for (let i = 0; i < brandChars; i++) {
      timers.push(
        window.setTimeout(() => setBrandReveal(i + 1), 2200 + i * 100),
      );
    }

    // 进度条完成 → 淡出
    timers.push(window.setTimeout(() => setFadeOut(true), 3400));
    timers.push(window.setTimeout(() => onFinish(), 4100));

    return () => timers.forEach(clearTimeout);
  }, [onFinish]);

  // ---- Canvas 星尘 + 极光粒子系统 ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // 初始化星尘粒子
    const particleCount = Math.min(180, Math.floor((width * height) / 8000));
    const particles: Particle[] = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        size: Math.random() * 1.5 + 0.3,
        opacity: Math.random() * 0.5 + 0.2,
        twinkle: Math.random() * Math.PI * 2,
        color: AURORA_COLORS[Math.floor(Math.random() * AURORA_COLORS.length)],
      });
    }

    // 极光丝带控制点
    const auroraRibbons: AuroraPoint[][] = [];
    for (let r = 0; r < 3; r++) {
      const points: AuroraPoint[] = [];
      for (let i = 0; i < 6; i++) {
        points.push({
          offset: Math.random() * Math.PI * 2,
          speed: 0.3 + Math.random() * 0.4,
          amplitude: 30 + Math.random() * 60,
        });
      }
      auroraRibbons.push(points);
    }

    let frame = 0;
    const startTime = performance.now();

    const render = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      frame++;

      // 浅色背景 — macOS 27 风格网格渐变
      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      bgGrad.addColorStop(0, '#f5f5fa');
      bgGrad.addColorStop(0.5, '#eeeef5');
      bgGrad.addColorStop(1, '#f0f0f8');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 网格渐变光晕
      const orb1 = ctx.createRadialGradient(width * 0.15, height * 0.15, 0, width * 0.15, height * 0.15, width * 0.5);
      orb1.addColorStop(0, 'rgba(0, 122, 255, 0.12)');
      orb1.addColorStop(1, 'rgba(0, 122, 255, 0)');
      ctx.fillStyle = orb1;
      ctx.fillRect(0, 0, width, height);

      const orb2 = ctx.createRadialGradient(width * 0.85, height * 0.25, 0, width * 0.85, height * 0.25, width * 0.45);
      orb2.addColorStop(0, 'rgba(88, 86, 214, 0.10)');
      orb2.addColorStop(1, 'rgba(88, 86, 214, 0)');
      ctx.fillStyle = orb2;
      ctx.fillRect(0, 0, width, height);

      // ---- 星尘 ----
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.twinkle += 0.02;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        const twinkleOpacity = p.opacity * (0.5 + 0.5 * Math.sin(p.twinkle));

        // 星尘光晕
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
        glow.addColorStop(0, `rgba(${p.color}, ${twinkleOpacity * 0.8})`);
        glow.addColorStop(1, `rgba(${p.color}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
        ctx.fill();

        // 星尘核心 — 使用极光色
        ctx.fillStyle = `rgba(${p.color}, ${twinkleOpacity * 0.6})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // ---- 极光波纹（阶段 1 后出现） ----
      if (elapsed > 0.6) {
        const auroraProgress = Math.min(1, (elapsed - 0.6) / 0.8);
        const baseY = height * 0.65;

        auroraRibbons.forEach((ribbon, ri) => {
          const ribbonColor = AURORA_COLORS[ri % AURORA_COLORS.length];
          const ribbonOpacity = auroraProgress * (0.12 - ri * 0.03);

          ctx.beginPath();
          ctx.moveTo(0, height);

          const segments = 80;
          for (let s = 0; s <= segments; s++) {
            const x = (s / segments) * width;
            let y = baseY;

            ribbon.forEach((point, pi) => {
              const wave =
                Math.sin(elapsed * point.speed + point.offset + (s / segments) * Math.PI * 2) *
                point.amplitude *
                auroraProgress;
              y += wave * (1 / (pi + 1));
            });

            y += ri * 20;
            if (s === 0) {
              ctx.lineTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }

          ctx.lineTo(width, height);
          ctx.closePath();

          const auroraGrad = ctx.createLinearGradient(0, baseY - 80, 0, height);
          auroraGrad.addColorStop(0, `rgba(${ribbonColor}, 0)`);
          auroraGrad.addColorStop(0.3, `rgba(${ribbonColor}, ${ribbonOpacity})`);
          auroraGrad.addColorStop(0.7, `rgba(${ribbonColor}, ${ribbonOpacity * 0.5})`);
          auroraGrad.addColorStop(1, `rgba(${ribbonColor}, 0)`);
          ctx.fillStyle = auroraGrad;
          ctx.fill();
        });

        // 极光顶部辉光线
        if (elapsed > 0.8) {
          const lineOpacity = Math.min(1, (elapsed - 0.8) / 0.6) * 0.3;
          ctx.strokeStyle = `rgba(0, 122, 255, ${lineOpacity})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let s = 0; s <= 80; s++) {
            const x = (s / 80) * width;
            let y = baseY;
            auroraRibbons[0].forEach((point, pi) => {
              const wave =
                Math.sin(elapsed * point.speed + point.offset + (s / 80) * Math.PI * 2) *
                point.amplitude;
              y += wave * (1 / (pi + 1));
            });
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      // ---- Logo 中心光晕（阶段 2 后） ----
      if (elapsed > 1.4) {
        const glowProgress = Math.min(1, (elapsed - 1.4) / 0.8);
        const cx = width / 2;
        const cy = height / 2 - 30;
        const glowRadius = 80 + Math.sin(elapsed * 2) * 10;

        const logoGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius * 2);
        logoGlow.addColorStop(0, `rgba(0, 122, 255, ${glowProgress * 0.25})`);
        logoGlow.addColorStop(0.3, `rgba(88, 86, 214, ${glowProgress * 0.12})`);
        logoGlow.addColorStop(1, 'rgba(0, 122, 255, 0)');
        ctx.fillStyle = logoGlow;
        ctx.fillRect(cx - glowRadius * 2, cy - glowRadius * 2, glowRadius * 4, glowRadius * 4);

        // 光线放射
        if (glowProgress > 0.5) {
          const rayOpacity = (glowProgress - 0.5) * 0.4;
          const rayCount = 8;
          ctx.strokeStyle = `rgba(0, 122, 255, ${rayOpacity})`;
          ctx.lineWidth = 1;
          for (let i = 0; i < rayCount; i++) {
            const angle = (i / rayCount) * Math.PI * 2 + elapsed * 0.3;
            const innerR = 40;
            const outerR = 60 + Math.sin(elapsed * 3 + i) * 15;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
            ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
            ctx.stroke();
          }
        }
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const brandText = 'Aurora';
  const brandChars = brandText.split('');

  return (
    <div className={`splash-screen ${fadeOut ? 'splash-screen--fadeout' : ''}`}>
      {/* Canvas 背景：星尘 + 极光 */}
      <canvas ref={canvasRef} className="splash-canvas" />

      {/* CSS 极光层 — 辅助光效 */}
      <div className="splash-aurora-layer">
        <div className="splash-aurora-ribbon splash-aurora-ribbon--1" />
        <div className="splash-aurora-ribbon splash-aurora-ribbon--2" />
        <div className="splash-aurora-ribbon splash-aurora-ribbon--3" />
      </div>

      {/* 中心内容 */}
      <div className="splash-content">
        {/* Logo */}
        <div className={`splash-logo ${phase >= 2 ? 'splash-logo--visible' : ''}`}>
          <div className="splash-logo__glow" />
          <svg width="80" height="80" viewBox="0 0 32 32" fill="none" className="splash-logo__svg">
            <defs>
              <linearGradient id="splash-aurora-1" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#007AFF" />
                <stop offset="50%" stopColor="#5856D6" />
                <stop offset="100%" stopColor="#64D2FF" />
              </linearGradient>
              <linearGradient id="splash-aurora-2" x1="20%" y1="100%" x2="80%" y2="0%">
                <stop offset="0%" stopColor="#0066d6" />
                <stop offset="60%" stopColor="#007AFF" />
                <stop offset="100%" stopColor="#64D2FF" />
              </linearGradient>
              <radialGradient id="splash-glow" cx="50%" cy="60%" r="50%">
                <stop offset="0%" stopColor="#007AFF" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#007AFF" stopOpacity="0" />
              </radialGradient>
              <clipPath id="splash-clip">
                <rect width="32" height="32" rx="8" />
              </clipPath>
            </defs>
            <rect width="32" height="32" rx="8" fill="#1a1a2e" />
            <g clipPath="url(#splash-clip)">
              <rect width="32" height="32" fill="url(#splash-glow)" />
              <path d="M-2 28 Q4 20 2 12 Q0 6 6 0 L10 0 Q6 8 8 14 Q10 22 4 28 Z" fill="url(#splash-aurora-1)" opacity="0.9" />
              <path d="M34 28 Q28 22 30 14 Q32 8 26 2 L22 0 Q26 10 24 16 Q22 24 28 28 Z" fill="url(#splash-aurora-2)" opacity="0.8" />
              <path d="M14 28 Q13 18 15 10 Q16 4 16 0 L18 0 Q17 6 17 12 Q17 20 18 28 Z" fill="url(#splash-aurora-1)" opacity="0.65" />
              <circle cx="22" cy="8" r="0.8" fill="#fff" opacity="0.8" />
              <circle cx="9" cy="6" r="0.6" fill="#fff" opacity="0.6" />
              <circle cx="25" cy="14" r="0.5" fill="#fff" opacity="0.5" />
            </g>
            <rect width="32" height="32" rx="8" fill="none" stroke="rgba(0, 122, 255, 0.4)" strokeWidth="0.5" />
          </svg>
        </div>

        {/* 品牌名 */}
        <div className={`splash-brand ${phase >= 3 ? 'splash-brand--visible' : ''}`}>
          {brandChars.map((char, i) => (
            <span
              key={i}
              className="splash-brand__char"
              style={{ animationDelay: `${0.1 * i}s` }}
            >
              {char}
            </span>
          ))}
        </div>

        {/* 副标题 */}
        <div className={`splash-tagline ${phase >= 3 ? 'splash-tagline--visible' : ''}`}>
          极光智能 · 触手可及
        </div>

        {/* 进度条 */}
        <div className={`splash-progress ${phase >= 3 ? 'splash-progress--visible' : ''}`}>
          <div className="splash-progress__bar">
            <div className="splash-progress__fill" />
          </div>
          <div className="splash-progress__dots">
            <span className="splash-progress__dot" />
            <span className="splash-progress__dot" />
            <span className="splash-progress__dot" />
          </div>
        </div>
      </div>

      {/* 底部版本号 */}
      <div className={`splash-version ${phase >= 3 ? 'splash-version--visible' : ''}`}>
        Aurora v1.0.0
      </div>
    </div>
  );
};

export default SplashScreen;
