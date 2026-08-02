/**
 * 终端 WebSocket 路由
 *
 * WS /api/terminal/ws - 交互式终端
 *
 * 工作原理：
 * - 每个 WebSocket 连接对应一个独立的 shell 子进程
 * - 客户端通过 stdin 消息类型发送输入（包含换行符）
 * - shell 的 stdout/stderr 实时流式返回给客户端
 * - Windows 使用 PowerShell，其他系统使用 bash
 * - 连接关闭时自动终止子进程
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { spawn, execSync, type ChildProcess } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import type { TerminalMessage, TerminalOutput } from '../types';

/**
 * 查找可用的 shell 可执行文件完整路径
 * 在沙箱环境中 PATH 可能不包含系统目录，需要手动定位
 */
function findShell(): { cmd: string; args: string[] } {
  const isWindows = os.platform() === 'win32';

  if (isWindows) {
    // 常见 PowerShell 路径
    const psPaths = [
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe',
    ];
    // PowerShell 7+ 路径
    const pwshPaths = [
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe',
    ];

    for (const p of [...pwshPaths, ...psPaths]) {
      if (fs.existsSync(p)) {
        return { cmd: p, args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass'] };
      }
    }

    // 尝试通过 where 命令查找
    try {
      const found = execSync('where powershell.exe', { encoding: 'utf-8' }).trim().split('\n')[0].trim();
      if (found && fs.existsSync(found)) {
        return { cmd: found, args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass'] };
      }
    } catch { /* ignore */ }

    // 回退到 cmd.exe
    const cmdPath = 'C:\\Windows\\System32\\cmd.exe';
    if (fs.existsSync(cmdPath)) {
      return { cmd: cmdPath, args: [] };
    }
  }

  // Linux/macOS
  const bashPaths = ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash'];
  for (const p of bashPaths) {
    if (fs.existsSync(p)) {
      return { cmd: p, args: ['-i'] };
    }
  }

  return { cmd: isWindows ? 'powershell.exe' : 'bash', args: isWindows ? ['-NoLogo'] : ['-i'] };
}

const terminalRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // WebSocket /api/terminal/ws - 交互式终端
  fastify.get('/api/terminal/ws', { websocket: true }, (socket, request) => {
    fastify.log.info('终端 WebSocket 已连接');

    // 查找可用的 shell
    const { cmd: shell, args: shellArgs } = findShell();

    // 构建环境变量，补充系统路径
    const isWindows = os.platform() === 'win32';
    const systemPath = isWindows
      ? 'C:\\Windows\\System32;C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Windows'
      : '';
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      PATH: process.env.PATH ? `${process.env.PATH};${systemPath}` : systemPath,
    };

    // 启动 shell 子进程
    const shellProcess: ChildProcess = spawn(shell, shellArgs, {
      cwd: os.homedir(),
      env,
    });

    fastify.log.info(
      `终端进程已启动: ${shell} (PID: ${shellProcess.pid})`,
    );

    /**
     * 安全发送消息到 WebSocket 客户端
     * readyState 1 = WebSocket.OPEN
     */
    function sendToClient(data: TerminalOutput): void {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify(data));
      }
    }

    // 子进程标准输出 -> 发送到客户端
    shellProcess.stdout?.on('data', (data: Buffer) => {
      sendToClient({
        type: 'stdout',
        data: data.toString('utf-8'),
      });
    });

    // 子进程标准错误 -> 发送到客户端
    shellProcess.stderr?.on('data', (data: Buffer) => {
      sendToClient({
        type: 'stderr',
        data: data.toString('utf-8'),
      });
    });

    // 子进程退出
    shellProcess.on('close', (code: number | null) => {
      fastify.log.info(`终端进程已退出，退出码: ${code}`);
      sendToClient({
        type: 'exit',
        code: code ?? 0,
      });
      // 进程退出后关闭 WebSocket 连接
      if (socket.readyState === 1) {
        socket.close();
      }
    });

    // 子进程错误
    shellProcess.on('error', (err: Error) => {
      fastify.log.error(`终端进程错误: ${err.message}`);
      sendToClient({
        type: 'error',
        data: `终端进程错误: ${err.message}`,
      });
    });

    // 接收 WebSocket 消息
    socket.on('message', (rawMessage) => {
      try {
        const msg = JSON.parse(rawMessage.toString()) as TerminalMessage;

        switch (msg.type) {
          case 'stdin':
            // 将输入写入子进程的标准输入
            // 注意：客户端需要包含换行符（\n 或 \r）来提交命令
            if (msg.data !== undefined && shellProcess.stdin?.writable) {
              shellProcess.stdin.write(msg.data);
            }
            break;

          case 'resize':
            // 调整终端窗口大小
            // 注意：当前使用 child_process.spawn，不支持真正的 PTY 窗口大小调整
            // 后续版本将通过 node-pty 实现完整的 PTY 支持
            fastify.log.debug(
              `终端调整大小请求: cols=${msg.cols}, rows=${msg.rows}（当前版本暂不支持）`,
            );
            break;

          case 'kill':
            // 终止子进程
            fastify.log.info('收到 kill 信号，终止终端进程');
            shellProcess.kill('SIGTERM');
            break;

          default:
            fastify.log.warn(
              `未知的终端消息类型: ${(msg as { type: string }).type}`,
            );
        }
      } catch {
        // 如果消息不是 JSON 格式，直接当作输入处理
        if (shellProcess.stdin?.writable) {
          shellProcess.stdin.write(rawMessage.toString());
        }
      }
    });

    // WebSocket 关闭时终止子进程
    socket.on('close', () => {
      fastify.log.info('终端 WebSocket 已断开，清理子进程');
      if (!shellProcess.killed) {
        shellProcess.kill('SIGTERM');
      }
    });

    // WebSocket 错误
    socket.on('error', (err: Error) => {
      fastify.log.error(`终端 WebSocket 错误: ${err.message}`);
      if (!shellProcess.killed) {
        shellProcess.kill('SIGTERM');
      }
    });
  });
};

export default terminalRoutes;
