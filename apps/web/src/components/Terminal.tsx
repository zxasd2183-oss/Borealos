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
          term.writeln('可用命令（离线模式）:');
          term.writeln('  help        显示此帮助信息');
          term.writeln('  clear       清空终端');
          term.writeln('  echo <msg>  回显消息');
          term.writeln('  date        显示当前日期时间');
          term.writeln('  pwd         显示当前工作目录');
          term.writeln('  ls          列出目录内容');
          term.writeln('  whoami      显示当前用户');
          term.writeln('  about       关于 BorealOS');
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
          term.writeln('\x1b[34msrc\x1b[0m  \x1b[34mpublic\x1b[0m  package.json  tsconfig.json  vite.config.ts  README.md');
          break;
        case 'whoami':
          term.writeln('borealos');
          break;
        case 'about':
          term.writeln('\x1b[36mBorealOS\x1b[0m - AI 驱动的跨平台 IDE  v0.1.0');
          term.writeln('技术栈: React + TypeScript + Vite + Monaco + xterm.js');
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

    // 建立 WebSocket 连接（通过 Vite 代理转发到后端 3001 端口）
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/terminal/ws`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      // WebSocket 创建失败，直接进入离线模式
      term.writeln('\x1b[33m[系统] 无法建立 WebSocket 连接，终端运行于离线模式\x1b[0m');
      term.writeln('\x1b[33m[系统] 输入 help 查看可用命令\x1b[0m');
      term.write('\r\n$ ');
      term.onData(handleOfflineInput);
      return () => {
        term.dispose();
      };
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      term.writeln('\x1b[32m[系统] 终端已连接到后端服务\x1b[0m');
      term.write('\r\n$ ');
    };

    ws.onmessage = (event) => {
      // 后端发送 JSON 格式消息：{ type: 'stdout'|'stderr'|'exit'|'error', data?: string, code?: number }
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'stdout' || msg.type === 'stderr' || msg.type === 'error') {
          term.write(msg.data ?? '');
        } else if (msg.type === 'exit') {
          term.writeln(`\r\n\x1b[33m[进程已退出，退出码: ${msg.code}]\x1b[0m`);
        }
      } catch {
        // 非 JSON 消息，直接写入终端
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      term.writeln('\r\n\x1b[33m[系统] 终端连接已断开，切换至离线模式\x1b[0m');
      term.writeln('\x1b[33m[系统] 输入 help 查看可用命令\x1b[0m');
      term.write('\r\n$ ');
    };

    ws.onerror = () => {
      // 错误由 onclose 统一处理
    };

    // 用户输入：已连接则发送到后端，否则本地处理
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      } else {
        handleOfflineInput(data);
      }
    });

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
      ws.close();
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
            {connected ? '● 已连接' : '● 离线模式'}
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
