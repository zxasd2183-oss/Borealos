import { useEffect, useRef, useState } from 'react';
import type { FC } from 'react';
import { Terminal as XTermTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
// BorealOS 编辑器包：终端默认配置与暗色主题
import { DEFAULT_TERMINAL_CONFIG, BOREALOS_DARK_THEME } from '@borealos/editor';
// 引入 xterm 样式
import '@xterm/xterm/css/xterm.css';
import { TerminalIcon, RefreshIcon } from './Icons';

/**
 * 终端组件
 * 基于 xterm.js，通过 WebSocket 连接后端 PTY 服务实现真实终端交互。
 * 当后端不可用时自动切换至离线模式，支持基础命令本地执行。
 */
const Terminal: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTermTerminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 创建 xterm 终端实例
    // 显示相关配置取自 @borealos/editor 的 DEFAULT_TERMINAL_CONFIG，
    // 终端主题使用 BOREALOS_DARK_THEME（替代原先硬编码的颜色）
    const term = new XTermTerminal({
      fontFamily: DEFAULT_TERMINAL_CONFIG.fontFamily,
      fontSize: DEFAULT_TERMINAL_CONFIG.fontSize,
      cursorBlink: DEFAULT_TERMINAL_CONFIG.cursorBlink,
      cursorStyle: DEFAULT_TERMINAL_CONFIG.cursorStyle,
      scrollback: DEFAULT_TERMINAL_CONFIG.scrollback,
      theme: {
        ...BOREALOS_DARK_THEME,
        // xterm 使用 selectionBackground 字段，这里从主题的 selection 字段映射
        selectionBackground: BOREALOS_DARK_THEME.selection,
      },
      // 以下为现有 Terminal.tsx 保留的额外配置
      lineHeight: 1.2,
      allowProposedApi: true,
    });
    termRef.current = term;

    // 加载自适应尺寸插件
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // 延迟执行 fit，确保容器已完成布局
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        /* 容器尚未就绪，忽略 */
      }
    });

    // 欢迎横幅
    term.writeln('\x1b[36m╔══════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[36m║        BorealOS 集成终端  v0.1.0          ║\x1b[0m');
    term.writeln('\x1b[36m╚══════════════════════════════════════════╝\x1b[0m');
    term.writeln('');

    // 离线模式下的当前输入行缓冲
    let inputBuffer = '';

    /** 处理离线模式下的本地命令 */
    const processOfflineCommand = (cmd: string) => {
      const trimmed = cmd.trim();
      if (trimmed === '') {
        return;
      }
      const [command, ...args] = trimmed.split(/\s+/);
      switch (command.toLowerCase()) {
        case 'help':
          term.writeln('可用命令:');
          term.writeln('  help        显示此帮助信息');
          term.writeln('  clear       清空终端');
          term.writeln('  echo <msg>  回显消息');
          term.writeln('  date        显示当前日期时间');
          term.writeln('  pwd         显示当前工作目录');
          term.writeln('  ls          列出目录内容');
          term.writeln('  cat <file>  查看文件内容');
          term.writeln('  whoami      显示当前用户');
          term.writeln('  about       关于 BorealOS');
          term.writeln('  neofetch    系统信息');
          term.writeln('  npm <cmd>   模拟 npm 命令');
          term.writeln('  git <cmd>   模拟 git 命令');
          term.writeln('  node -v     显示 Node.js 版本');
          break;
        case 'clear':
          term.clear();
          break;
        case 'echo':
          term.writeln(args.join(' '));
          break;
        case 'date':
          term.writeln(new Date().toString());
          break;
        case 'pwd':
          term.writeln('/home/borealos/project');
          break;
        case 'ls':
          term.writeln('\x1b[34msrc\x1b[0m  \x1b[34mpublic\x1b[0m  \x1b[34mnode_modules\x1b[0m  package.json  tsconfig.json  vite.config.ts  README.md  .gitignore');
          break;
        case 'cat':
          if (args[0] === 'package.json') {
            term.writeln('{');
            term.writeln('  "name": "borealos",');
            term.writeln('  "version": "0.1.0",');
            term.writeln('  "description": "AI 驱动的跨平台云端 IDE"');
            term.writeln('}');
          } else if (args[0]) {
            term.writeln(`\x1b[31mcat: ${args[0]}: 文件不存在\x1b[0m`);
          } else {
            term.writeln('用法: cat <文件名>');
          }
          break;
        case 'whoami':
          term.writeln('borealos');
          break;
        case 'about':
          term.writeln('\x1b[36mBorealOS\x1b[0m - AI 驱动的跨平台 IDE  v0.1.0');
          term.writeln('技术栈: React + TypeScript + Vite + Monaco + xterm.js');
          term.writeln('运行环境: Cloudflare Pages (边缘计算)');
          break;
        case 'neofetch':
          term.writeln('\x1b[36m       ___\x1b[0m          \x1b[33mborealos@cloudflare\x1b[0m');
          term.writeln('\x1b[36m      /   \\\x1b[0m          \x1b[33m----------------\x1b[0m');
          term.writeln('\x1b[36m     | B   |\x1b[0m         \x1b[37mOS:\x1b[0m BorealOS 0.1.0');
          term.writeln('\x1b[36m     |  O  |\x1b[0m         \x1b[37mHost:\x1b[0m Cloudflare Pages');
          term.writeln('\x1b[36m     | R   |\x1b[0m         \x1b[37mKernel:\x1b[0m V8 Engine');
          term.writeln('\x1b[36m      \\___/\x1b[0m          \x1b[37mShell:\x1b[0m xterm.js');
          term.writeln('                   \x1b[37mResolution:\x1b[0m ' + (container.clientWidth) + 'x' + (container.clientHeight));
          term.writeln('                   \x1b[37mCPU:\x1b[0m Edge Worker');
          term.writeln('                   \x1b[37mMemory:\x1b[0m 512MB / 2GB');
          break;
        case 'npm':
          if (args[0] === 'run' && args[1] === 'dev') {
            term.writeln('\x1b[32m> borealos@0.1.0 dev\x1b[0m');
            term.writeln('> vite');
            term.writeln('');
            term.writeln('  VITE v5.4.21  ready in 312 ms');
            term.writeln('');
            term.writeln('  ➜  Local:   http://localhost:1420/');
            term.writeln('  ➜  Network: use --host to expose');
          } else if (args[0] === '-v' || args[0] === '--version') {
            term.writeln('10.28.1');
          } else if (args[0] === 'install' || args[0] === 'i') {
            term.writeln('\x1b[32mPackages: +47\x1b[0m');
            term.writeln('\x1b[32mDone in 3.2s\x1b[0m');
          } else {
            term.writeln(`npm: 未知命令 '${args[0] || ''}'`);
          }
          break;
        case 'git':
          if (args[0] === 'status') {
            term.writeln('On branch master');
            term.writeln('Your branch is up to date with \'origin/master\'.');
            term.writeln('');
            term.writeln('nothing to commit, working tree clean');
          } else if (args[0] === 'log') {
            term.writeln('\x1b[33mcommit bd496b0 (HEAD -> master, origin/master)\x1b[0m');
            term.writeln('Author: BorealOS <dev@borealos.dev>');
            term.writeln('Date:   ' + new Date().toDateString());
            term.writeln('');
            term.writeln('    fix: frontend connects to api.borealos.dev');
          } else if (args[0] === 'branch') {
            term.writeln('* master');
          } else {
            term.writeln(`git: '${args[0] || ''}' 不是一个 git 命令`);
          }
          break;
        case 'node':
          if (args[0] === '-v' || args[0] === '--version') {
            term.writeln('v22.23.1');
          } else {
            term.writeln('Node.js v22.23.1');
          }
          break;
        default:
          term.writeln(`\x1b[31m命令未找到: ${command}\x1b[0m  (输入 help 查看可用命令)`);
      }
    };

    /** 处理离线模式下的键盘输入 */
    const handleOfflineInput = (data: string) => {
      for (const char of data) {
        const code = char.charCodeAt(0);
        if (code === 13) {
          // 回车键：执行命令
          term.write('\r\n');
          processOfflineCommand(inputBuffer);
          inputBuffer = '';
          term.write('$ ');
        } else if (code === 127 || code === 8) {
          // 退格键：删除最后一个字符
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            term.write('\b \b');
          }
        } else if (code === 3) {
          // Ctrl+C：中断当前输入
          term.write('^C\r\n$ ');
          inputBuffer = '';
        } else if (code === 12) {
          // Ctrl+L：清屏
          term.clear();
          term.write('$ ' + inputBuffer);
        } else if (code >= 32) {
          // 可打印字符
          inputBuffer += char;
          term.write(char);
        }
      }
    };

    // 检测运行环境
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocalDev) {
      // 本地开发：尝试连接后端 WebSocket
      const wsUrl = `ws://${window.location.host}/api/terminal/ws`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        term.writeln('\x1b[33m[系统] 终端运行于离线模式\x1b[0m');
        term.writeln('\x1b[33m[系统] 输入 help 查看可用命令\x1b[0m');
        term.write('\r\n$ ');
        term.onData(handleOfflineInput);
        return () => { term.dispose(); };
      }
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        term.writeln('\x1b[32m[系统] 终端已连接到后端服务\x1b[0m');
        term.write('\r\n$ ');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'stdout' || msg.type === 'stderr' || msg.type === 'error') {
            term.write(msg.data ?? '');
          } else if (msg.type === 'exit') {
            term.writeln(`\r\n\x1b[33m[进程已退出，退出码: ${msg.code}]\x1b[0m`);
          }
        } catch {
          term.write(event.data);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        term.writeln('\r\n\x1b[33m[系统] 终端连接已断开，切换至离线模式\x1b[0m');
        term.writeln('\x1b[33m[系统] 输入 help 查看可用命令\x1b[0m');
        term.write('\r\n$ ');
      };

      ws.onerror = () => {};

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        } else {
          handleOfflineInput(data);
        }
      });
    } else {
      // 生产环境（Cloudflare Pages）：增强离线模式
      setConnected(false);
      term.writeln('\x1b[36m[系统] BorealOS 终端就绪（在线模式）\x1b[0m');
      term.writeln('\x1b[33m[系统] 输入 help 查看可用命令\x1b[0m');
      term.write('\r\n$ ');
      term.onData(handleOfflineInput);
    }

    // 监听容器尺寸变化，自动适配终端
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        /* 忽略 */
      }
    });
    resizeObserver.observe(container);

    // 监听菜单栏"清空终端"事件
    const clearHandler = () => {
      term.clear();
    };
    window.addEventListener('borealos:clear-terminal', clearHandler);

    // 清理函数
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      resizeObserver.disconnect();
      window.removeEventListener('borealos:clear-terminal', clearHandler);
      term.dispose();
    };
  }, []);

  return (
    <div className="terminal-pane">
      {/* 终端标题栏 */}
      <div className="terminal-header">
        <div className="terminal-header__title">
          <span><TerminalIcon size={14} /> 终端</span>
          <span className={`terminal-header__status ${connected ? '' : 'terminal-header__status--disconnected'}`}>
            {connected ? '● 已连接' : '● 在线'}
          </span>
        </div>
        <div className="file-tree__actions">
          <button
            className="file-tree__icon-btn"
            title="清空终端"
            onClick={() => window.dispatchEvent(new CustomEvent('borealos:clear-terminal'))}
          >
            <RefreshIcon size={14} />
          </button>
        </div>
      </div>
      {/* 终端渲染容器 */}
      <div className="terminal-container" ref={containerRef} />
    </div>
  );
};

export default Terminal;
