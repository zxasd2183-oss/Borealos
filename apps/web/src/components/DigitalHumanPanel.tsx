/**
 * Aurora Digital Human Panel — 数字人模块
 * ------------------------------------------------------------
 * 自研数字人编排管线前端界面
 *
 * 架构设计：自研编排管线 + 云端模型能力
 *   管线由 Aurora 自主编排，各阶段可灵活组合云端/本地能力：
 *     Stage 1: LLM 文案优化（通义千问 / OpenAI / Ollama）
 *     Stage 2: TTS 语音合成（Edge-TTS / Azure）
 *     Stage 3: 形象图片预处理（本地裁剪/增强）
 *     Stage 4: 云端视频合成（阿里通义万相 / 火山引擎 / D-ID / HeyGen）
 *     Stage 5: 后处理（下载/字幕/水印）
 *
 * 双模式：
 *   - 云端管线：自研编排 + 云端模型，无需高端 GPU，适合所有设备
 *   - 本地推理：基于开源模型本地部署，完全离线运行
 *     - MuseTalk 1.5 (腾讯) — 实时口型同步，30fps+
 *     - SadTalker — 单图+音频生成说话视频
 *     - Wav2Lip — 轻量级口型同步
 *     - EchoMimic V2 — 半身动画
 *     - Hallo2 — 4K长视频生成
 *
 * 架构：
 *   前端 (本组件) ──invoke──> Rust (digital_human.rs) ──HTTP──> Python (server.py)
 *                                       │
 *                                       ├── 启动/管理 Python 子进程
 *                                       ├── 转发 API 请求
 *                                       └── 推送进度事件到前端
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { invoke, isTauri, onTauriEvent } from '../lib/tauri-env';
import {
  VideoIcon,
  MicIcon,
  PlayIcon,
  StopIcon,
  DownloadIcon,
  PlusIcon,
  RefreshIcon,
  SparkleIcon,
  CheckIcon,
  SettingsIcon,
  UploadIcon,
} from './Icons';

// ===== 类型定义 =====

type ModelType = 'musetalk' | 'sadtalker' | 'wav2lip' | 'echomimic' | 'hallo2';
type GenerationStatus = 'idle' | 'preparing' | 'generating' | 'completed' | 'error';
type AudioSource = 'tts' | 'upload';
type EngineStatus = 'stopped' | 'starting' | 'running' | 'error';

interface Avatar {
  id: string;
  name: string;
  imagePath: string;
  thumbnail?: string;
  isCustom: boolean;
}

interface GenerationResult {
  videoPath: string;
  duration: number;
  resolution: string;
  modelUsed: string;
  processingTime: number;
}

interface ModelInfo {
  id: ModelType;
  name: string;
  description: string;
  features: string[];
  vramRequired: string;
  speed: string;
  quality: string;
  realtime: boolean;
  maxResolution: string;
  installed: boolean;
}

interface SystemInfo {
  gpuAvailable: boolean;
  gpuName: string;
  vramTotal: string;
  vramFree: string;
  cudaVersion: string;
  ffmpegAvailable: boolean;
  pythonVersion: string;
}

interface DownloadProgress {
  modelType: string;
  progress: number;
  message: string;
  speed: string;
}

interface GenerateProgress {
  progress: number;
  message: string;
  log: string;
}

// ===== 云端管线类型 =====

type GenerationMode = 'local' | 'cloud';

interface CloudProvider {
  id: string;
  name: string;
  requires_api_key: boolean;
  china_available: boolean;
  docs_url: string;
  configured: boolean;
  models: CloudModel[];
}

interface CloudModel {
  id: string;
  name: string;
  description: string;
  max_resolution: string;
  price_per_second: number;
  features: string[];
  recommended?: boolean;
}

interface PipelineStageProgress {
  stage: string;
  progress: number;
  message: string;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
}

interface ScriptStyle {
  id: string;
  name: string;
}

// ===== 模型信息（默认值，运行时从后端更新 installed 状态）=====

const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: 'musetalk',
    name: 'MuseTalk 1.5',
    description: '腾讯 Lyra Lab 开源，实时高保真口型同步，在 V100 上可达 30fps+',
    features: ['实时推理', '256×256 面部区域', '多语言支持', '潜在空间修复'],
    vramRequired: '4GB+',
    speed: '极快 (30fps+)',
    quality: '高',
    realtime: true,
    maxResolution: '1080p',
    installed: false,
  },
  {
    id: 'sadtalker',
    name: 'SadTalker',
    description: '单张图片 + 音频生成自然说话头部视频，支持头部运动和表情',
    features: ['3DMM 驱动', '头部运动', '自然表情', '全身支持'],
    vramRequired: '6GB+',
    speed: '中等',
    quality: '高',
    realtime: false,
    maxResolution: '512p',
    installed: false,
  },
  {
    id: 'wav2lip',
    name: 'Wav2Lip',
    description: '轻量级口型同步模型，低算力设备可用 (GTX 1060+)',
    features: ['轻量级', '低算力友好', '基础口型同步', '快速生成'],
    vramRequired: '2GB+',
    speed: '快',
    quality: '中',
    realtime: true,
    maxResolution: '480p',
    installed: false,
  },
  {
    id: 'echomimic',
    name: 'EchoMimic V2',
    description: '蚂蚁集团开源，半身人体动画，支持音频+姿态驱动',
    features: ['半身动画', '姿态驱动', '音频驱动', '自然肢体语言'],
    vramRequired: '8GB+',
    speed: '慢',
    quality: '极高',
    realtime: false,
    maxResolution: '1080p',
    installed: false,
  },
  {
    id: 'hallo2',
    name: 'Hallo2',
    description: '支持 4K 分辨率、长达 1 小时的肖像动画生成 (ICLR 2025)',
    features: ['4K 分辨率', '长视频 (60min+)', '高保真', '多阶段管线'],
    vramRequired: '12GB+',
    speed: '慢',
    quality: '极高',
    realtime: false,
    maxResolution: '4K',
    installed: false,
  },
];

// ===== 预设形象 =====

const PRESET_AVATARS: Avatar[] = [
  { id: 'preset-1', name: 'Aurora Assistant', imagePath: '', isCustom: false },
  { id: 'preset-2', name: 'Professional Male', imagePath: '', isCustom: false },
  { id: 'preset-3', name: 'Professional Female', imagePath: '', isCustom: false },
];

// ===== 主组件 =====

const DigitalHumanPanel: React.FC = () => {
  // ---- 状态 ----
  const [avatars, setAvatars] = useState<Avatar[]>(PRESET_AVATARS);
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelType>('musetalk');
  const [audioSource, setAudioSource] = useState<AudioSource>('tts');
  const [ttsText, setTtsText] = useState('');
  const [ttsVoice, setTtsVoice] = useState('zh-CN-XiaoxiaoNeural');
  const [uploadedAudio, setUploadedAudio] = useState<string>('');
  const [uploadedAudioPath, setUploadedAudioPath] = useState<string>('');
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  // ---- 云端管线状态 ----
  const [generationMode, setGenerationMode] = useState<GenerationMode>('cloud');
  const [cloudProviders, setCloudProviders] = useState<CloudProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('aliyun_wan');
  const [selectedCloudModel, setSelectedCloudModel] = useState<string>('emo');
  const [cloudApiKey, setCloudApiKey] = useState<string>('');
  const [llmApiKey, setLlmApiKey] = useState<string>('');
  const [enableScriptOptimization, setEnableScriptOptimization] = useState<boolean>(true);
  const [scriptStyle, setScriptStyle] = useState<string>('natural');
  const [scriptStyles, setScriptStyles] = useState<ScriptStyle[]>([]);
  const [cloudResolution, setCloudResolution] = useState<string>('480p');
  const [pipelineStages, setPipelineStages] = useState<PipelineStageProgress[]>([]);
  const [pipelineTaskId, setPipelineTaskId] = useState<string>('');
  const [optimizedScript, setOptimizedScript] = useState<string>('');
  const [estimatedCost, setEstimatedCost] = useState<{cost: number; currency: string; detail: string} | null>(null);

  // ---- 引擎状态 ----
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('stopped');
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [models, setModels] = useState<ModelInfo[]>(DEFAULT_MODELS);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const isTauriEnv = isTauri();

  // 自动滚动日志
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ---- 组件挂载：自动检测系统环境和引擎状态 ----
  useEffect(() => {
    if (!isTauriEnv) return;

    // 检查引擎是否已运行
    invoke<boolean>('dh_health_check')
      .then((running) => {
        if (running) {
          setEngineStatus('running');
          refreshSystemInfo();
          refreshModels();
        } else {
          setEngineStatus('stopped');
        }
      })
      .catch(() => setEngineStatus('stopped'));

    // 监听生成进度事件
    const unlistenProgress = onTauriEvent<GenerateProgress>('dh-progress', (data) => {
      if (data.progress !== undefined) {
        setProgress(data.progress);
      }
      if (data.message) {
        setProgressMsg(data.message);
      }
      if (data.log) {
        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${data.log}`]);
      }
    });

    // 监听模型下载进度事件
    const unlistenDownload = onTauriEvent<DownloadProgress>('dh-download-progress', (data) => {
      setDownloadProgress(data);
      if (data.progress >= 100) {
        setDownloadingModel(null);
        refreshModels();
      }
    });

    // 监听管线进度事件
    const unlistenPipelineProgress = onTauriEvent<{task_id: string; status: string; progress: number; stage: string; message: string}>('dh-pipeline-progress', (data) => {
      setProgress(data.progress);
      setProgressMsg(data.message);
      addLog(`[${data.stage}] ${data.message}`);

      // 更新阶段状态
      setPipelineStages((prev) => {
        const existing = prev.find(s => s.stage === data.stage);
        if (existing) {
          return prev.map(s => s.stage === data.stage ? {
            ...s,
            progress: data.progress,
            message: data.message,
            status: data.progress >= 100 ? 'completed' : 'running',
          } : s);
        }
        return [...prev, {
          stage: data.stage,
          progress: data.progress,
          message: data.message,
          status: 'running' as const,
        }];
      });
    });

    // 监听管线完成事件
    const unlistenPipelineDone = onTauriEvent<{task_id: string; status: string; result: any; error: string | null}>('dh-pipeline-done', (data) => {
      if (data.status === 'completed' && data.result) {
        const r = data.result;
        setResult({
          videoPath: r.video_path || '',
          duration: r.audio_duration || 0,
          resolution: cloudResolution,
          modelUsed: r.stages?.map((s: any) => s.description).join(' → ') || '云端管线',
          processingTime: r.total_duration || 0,
        });
        setOptimizedScript(r.optimized_script || '');
        setStatus('completed');
        addLog('✓ 云端管线执行完成');
      } else {
        setError(data.error || '管线执行失败');
        setStatus('error');
        addLog(`✗ 管线失败: ${data.error}`);
      }
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenDownload.then((fn) => fn());
      unlistenPipelineProgress.then((fn) => fn());
      unlistenPipelineDone.then((fn) => fn());
    };
  }, [isTauriEnv]);

  // ---- 加载云端提供商列表 ----
  useEffect(() => {
    if (!isTauriEnv || generationMode !== 'cloud') return;

    invoke<{providers: CloudProvider[]} | CloudProvider[]>('dh_list_cloud_providers')
      .then((result: any) => {
        const providers: CloudProvider[] = Array.isArray(result) ? result : result.providers;
        setCloudProviders(providers);
        const configured = providers.find((p: CloudProvider) => p.configured);
        if (configured) {
          setSelectedProvider(configured.id);
        }
      })
      .catch((err: any) => {
        addLog(`加载云端提供商失败: ${err}`);
      });

    // 加载文案优化风格
    invoke<{styles: ScriptStyle[]} | ScriptStyle[]>('dh_list_script_styles')
      .then((result: any) => {
        const styles = Array.isArray(result) ? result : result.styles;
        setScriptStyles(styles);
      })
      .catch(() => {});
  }, [isTauriEnv, generationMode]);

  // ---- 刷新系统信息 ----
  const refreshSystemInfo = useCallback(async () => {
    if (!isTauriEnv) return;
    try {
      const info = await invoke<SystemInfo>('dh_system_info');
      setSystemInfo(info);
    } catch (err) {
      console.error('获取系统信息失败:', err);
    }
  }, [isTauriEnv]);

  // ---- 刷新模型列表 ----
  const refreshModels = useCallback(async () => {
    if (!isTauriEnv) return;
    try {
      const backendModels = await invoke<Array<{ id: string; name: string; installed: boolean; size: string; description: string }>>('dh_list_models');
      setModels((prev) =>
        prev.map((m) => {
          const backend = backendModels.find((bm) => bm.id === m.id);
          return backend ? { ...m, installed: backend.installed } : m;
        }),
      );
    } catch (err) {
      console.error('获取模型列表失败:', err);
    }
  }, [isTauriEnv]);

  // ---- 启动引擎 ----
  const handleStartEngine = useCallback(async () => {
    if (!isTauriEnv) return;
    setEngineStatus('starting');
    addLog('正在启动数字人推理引擎...');
    try {
      await invoke('dh_start_engine');
      setEngineStatus('running');
      addLog('✓ 推理引擎已启动');
      refreshSystemInfo();
      refreshModels();
    } catch (err) {
      setEngineStatus('error');
      setError(`引擎启动失败: ${err}`);
      addLog(`✗ 引擎启动失败: ${err}`);
    }
  }, [isTauriEnv, refreshSystemInfo, refreshModels]);

  // ---- 停止引擎 ----
  const handleStopEngine = useCallback(async () => {
    if (!isTauriEnv) return;
    try {
      await invoke('dh_stop_engine');
      setEngineStatus('stopped');
      setSystemInfo(null);
      addLog('推理引擎已停止');
    } catch (err) {
      setError(`停止引擎失败: ${err}`);
    }
  }, [isTauriEnv]);

  // ---- 下载模型 ----
  const handleDownloadModel = useCallback(async (modelType: string) => {
    if (!isTauriEnv) return;
    if (downloadingModel) return;
    setDownloadingModel(modelType);
    setDownloadProgress({ modelType, progress: 0, message: '准备下载...', speed: '' });
    addLog(`开始下载模型: ${modelType}`);
    try {
      await invoke('dh_download_model', { modelType });
      addLog(`✓ 模型下载完成: ${modelType}`);
      refreshModels();
    } catch (err) {
      addLog(`✗ 模型下载失败: ${err}`);
      setError(`模型下载失败: ${err}`);
    } finally {
      setDownloadingModel(null);
      setDownloadProgress(null);
    }
  }, [isTauriEnv, downloadingModel, refreshModels]);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // ---- 上传头像 ----
  const handleUploadAvatar = useCallback(async (file: File) => {
    if (!isTauriEnv) {
      // 非Tauri环境用URL
      const url = URL.createObjectURL(file);
      const newAvatar: Avatar = {
        id: `custom-${Date.now()}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        imagePath: url,
        thumbnail: url,
        isCustom: true,
      };
      setAvatars((prev) => [...prev, newAvatar]);
      setSelectedAvatar(newAvatar);
      return;
    }

    try {
      // Tauri 环境：通过后端保存文件
      const { open } = await import('@tauri-apps/plugin-dialog');
      // 已有文件对象，直接处理
      const path = (file as unknown as { path?: string }).path || file.name;
      const newAvatar: Avatar = {
        id: `custom-${Date.now()}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        imagePath: path,
        isCustom: true,
      };
      setAvatars((prev) => [...prev, newAvatar]);
      setSelectedAvatar(newAvatar);
      addLog(`已添加自定义形象: ${file.name}`);
    } catch (err) {
      setError(`上传头像失败: ${err}`);
    }
  }, [isTauriEnv, addLog]);

  // ---- 上传音频 ----
  const handleUploadAudio = useCallback(async (file: File) => {
    setUploadedAudio(file.name);
    if (isTauriEnv) {
      const path = (file as unknown as { path?: string }).path || file.name;
      setUploadedAudioPath(path);
    } else {
      setUploadedAudioPath(URL.createObjectURL(file));
    }
  }, [isTauriEnv]);

  // ---- 选择头像文件（Tauri 环境使用原生对话框）----
  const handleSelectAvatarFile = useCallback(async () => {
    if (!isTauriEnv) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) handleUploadAvatar(file);
      };
      input.click();
      return;
    }

    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      });
      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[\\/]/).pop() || 'avatar';
        const newAvatar: Avatar = {
          id: `custom-${Date.now()}`,
          name: fileName.replace(/\.[^.]+$/, ''),
          imagePath: selected,
          isCustom: true,
        };
        setAvatars((prev) => [...prev, newAvatar]);
        setSelectedAvatar(newAvatar);
        addLog(`已添加自定义形象: ${fileName}`);
      }
    } catch (err) {
      setError(`选择文件失败: ${err}`);
    }
  }, [isTauriEnv, handleUploadAvatar, addLog]);

  // ---- 选择音频文件（Tauri 环境使用原生对话框）----
  const handleSelectAudioFile = useCallback(async () => {
    if (!isTauriEnv) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) handleUploadAudio(file);
      };
      input.click();
      return;
    }

    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] }],
      });
      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[\\/]/).pop() || 'audio';
        setUploadedAudio(fileName);
        setUploadedAudioPath(selected);
      }
    } catch (err) {
      setError(`选择文件失败: ${err}`);
    }
  }, [isTauriEnv, handleUploadAudio]);

  // ---- 生成数字人视频 ----
  const handleGenerate = useCallback(async () => {
    if (!selectedAvatar) {
      setError('请先选择一个数字人形象');
      return;
    }
    if (audioSource === 'tts' && !ttsText.trim()) {
      setError('请输入文字内容');
      return;
    }
    if (audioSource === 'upload' && !uploadedAudioPath) {
      setError('请上传音频文件');
      return;
    }

    const currentModel = models.find((m) => m.id === selectedModel);
    if (currentModel && !currentModel.installed && isTauriEnv) {
      setError(`模型 ${currentModel.name} 未安装，请先下载`);
      return;
    }

    setError('');
    setStatus('preparing');
    setProgress(0);
    setResult(null);
    setLogs([]);
    addLog('初始化数字人引擎...');
    addLog(`模型: ${currentModel?.name}`);
    addLog(`形象: ${selectedAvatar.name}`);
    addLog(`音频源: ${audioSource === 'tts' ? 'TTS 语音合成' : '上传音频'}`);

    try {
      if (isTauriEnv && engineStatus === 'running') {
        // 真实 Tauri 环境：调用后端命令
        setStatus('generating');
        addLog('正在发送生成请求...');

        const genResult = await invoke<GenerationResult>('dh_generate', {
          request: {
            avatarPath: selectedAvatar.imagePath,
            modelType: selectedModel,
            audioSource: audioSource,
            ttsText: audioSource === 'tts' ? ttsText : null,
            ttsVoice: audioSource === 'tts' ? ttsVoice : null,
            audioPath: audioSource === 'upload' ? uploadedAudioPath : null,
            outputResolution: '512',
            fps: 25,
          },
        });

        setResult(genResult);
        setStatus('completed');
        addLog('✓ 数字人视频生成成功');
      } else if (!isTauriEnv) {
        // 非Tauri环境：模拟生成流程
        setStatus('generating');
        const steps = [
          { pct: 10, msg: '正在初始化推理引擎...' },
          { pct: 20, msg: '加载模型权重...' },
          { pct: 30, msg: '预处理人物图片...' },
          { pct: 40, msg: '提取面部特征...' },
          { pct: 50, msg: audioSource === 'tts' ? 'TTS 语音合成中...' : '加载音频文件...' },
          { pct: 60, msg: '提取音频特征 (Whisper)...' },
          { pct: 70, msg: '生成口型同步帧...' },
          { pct: 80, msg: '面部修复与增强...' },
          { pct: 90, msg: '合成视频流...' },
          { pct: 100, msg: '生成完成！' },
        ];

        for (const step of steps) {
          setProgress(step.pct);
          setProgressMsg(step.msg);
          addLog(step.msg);
          await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
        }

        setResult({
          videoPath: '/tmp/aurora_digital_human_' + Date.now() + '.mp4',
          duration: 15,
          resolution: '1080p',
          modelUsed: currentModel?.name || '',
          processingTime: 8.5,
        });
        setStatus('completed');
        addLog('✓ 数字人视频生成成功');
      } else {
        // Tauri 环境但引擎未启动
        setError('推理引擎未启动，请先启动引擎');
        setStatus('error');
        addLog('✗ 推理引擎未启动');
      }
    } catch (err) {
      setError(String(err));
      setStatus('error');
      addLog(`✗ 错误: ${err}`);
    }
  }, [selectedAvatar, selectedModel, audioSource, ttsText, ttsVoice, uploadedAudioPath, isTauriEnv, engineStatus, models, addLog]);

  const handleReset = useCallback(() => {
    setStatus('idle');
    setProgress(0);
    setResult(null);
    setError('');
    setLogs([]);
    setPipelineStages([]);
    setOptimizedScript('');
  }, []);

  // ---- 配置云端提供商 ----
  const handleConfigureProvider = useCallback(async () => {
    if (!isTauriEnv || !cloudApiKey) return;

    try {
      const config: Record<string, string> = { api_key: cloudApiKey };
      await invoke('dh_configure_cloud_provider', {
        providerId: selectedProvider,
        config,
      });
      addLog(`✓ ${selectedProvider} 配置成功`);

      // 刷新提供商列表
      const result = await invoke<any>('dh_list_cloud_providers');
      const providers = Array.isArray(result) ? result : result.providers;
      setCloudProviders(providers);
    } catch (err) {
      setError(`配置失败: ${err}`);
      addLog(`✗ 配置失败: ${err}`);
    }
  }, [isTauriEnv, cloudApiKey, selectedProvider, addLog]);

  // ---- 估算云端成本 ----
  useEffect(() => {
    if (!isTauriEnv || generationMode !== 'cloud' || !selectedProvider || !ttsText) {
      setEstimatedCost(null);
      return;
    }

    // 估算视频时长（中文约200字/分钟）
    const textLength = ttsText.length;
    const estimatedDuration = Math.max(5, Math.ceil(textLength / 200 * 60));

    invoke<{cost: number; currency: string; detail: string}>('dh_estimate_cost', {
      providerId: selectedProvider,
      modelName: selectedCloudModel,
      durationSeconds: estimatedDuration,
    })
      .then(cost => setEstimatedCost(cost))
      .catch(() => setEstimatedCost(null));
  }, [isTauriEnv, generationMode, selectedProvider, selectedCloudModel, ttsText]);

  // ---- 运行云端管线 ----
  const handlePipelineRun = useCallback(async () => {
    if (!selectedAvatar) {
      setError('请先选择一个数字人形象');
      return;
    }
    if (!ttsText.trim()) {
      setError('请输入文字内容');
      return;
    }

    const provider = cloudProviders.find(p => p.id === selectedProvider);
    if (provider && !provider.configured && !cloudApiKey) {
      setError(`请先配置 ${provider.name} 的 API Key`);
      return;
    }

    setError('');
    setStatus('preparing');
    setProgress(0);
    setResult(null);
    setLogs([]);
    setPipelineStages([]);
    setOptimizedScript('');
    addLog('启动自研编排管线...');
    addLog(`提供商: ${provider?.name || selectedProvider}`);
    addLog(`模型: ${selectedCloudModel}`);

    // 如果有 API Key 但未配置，先配置
    if (cloudApiKey && provider && !provider.configured) {
      await handleConfigureProvider();
    }

    // 云端模式：如果引擎未运行，自动启动（轻量模式，无需 GPU）
    if (isTauriEnv && engineStatus !== 'running') {
      addLog('正在启动编排服务（云端模式，无需 GPU）...');
      try {
        await invoke('dh_start_engine');
        setEngineStatus('running');
        addLog('✓ 编排服务已启动');
      } catch (err) {
        setError(`编排服务启动失败: ${err}`);
        setStatus('error');
        addLog(`✗ 编排服务启动失败: ${err}`);
        return;
      }
    }

    try {
      setStatus('generating');
      addLog('正在提交管线任务...');

      const resp = await invoke<{task_id: string; status: string; message: string}>('dh_pipeline_run', {
        request: {
          script: ttsText,
          avatar_path: selectedAvatar.imagePath,
          voice: ttsVoice,
          provider_id: selectedProvider,
          model_name: selectedCloudModel,
          resolution: cloudResolution,
          enable_script_optimization: enableScriptOptimization,
          script_style: scriptStyle,
          llm_api_key: llmApiKey,
          add_watermark: false,
          add_subtitles: false,
        },
      });

      setPipelineTaskId(resp.task_id);
      addLog(`管线任务已创建: ${resp.task_id}`);

      // 初始化阶段列表
      setPipelineStages([
        { stage: 'script_optimization', progress: 0, message: '等待开始', status: 'pending' },
        { stage: 'tts_synthesis', progress: 0, message: '等待开始', status: 'pending' },
        { stage: 'avatar_processing', progress: 0, message: '等待开始', status: 'pending' },
        { stage: 'cloud_synthesis', progress: 0, message: '等待开始', status: 'pending' },
        { stage: 'post_processing', progress: 0, message: '等待开始', status: 'pending' },
      ]);

    } catch (err) {
      setError(String(err));
      setStatus('error');
      addLog(`✗ 管线启动失败: ${err}`);
    }
  }, [selectedAvatar, ttsText, ttsVoice, selectedProvider, selectedCloudModel, cloudResolution,
      enableScriptOptimization, scriptStyle, llmApiKey, cloudApiKey, cloudProviders,
      isTauriEnv, engineStatus, addLog, handleConfigureProvider]);

  // ---- 取消管线任务 ----
  const handleCancelPipeline = useCallback(async () => {
    if (!pipelineTaskId) return;
    try {
      await invoke('dh_pipeline_cancel', { taskId: pipelineTaskId });
      addLog('管线任务已取消');
      setStatus('idle');
    } catch (err) {
      setError(`取消失败: ${err}`);
    }
  }, [pipelineTaskId, addLog]);

  const currentModel = models.find((m) => m.id === selectedModel)!;

  // ===== 渲染 =====

  return (
    <div className="dh-panel">
      {/* ============ 顶部工具栏 ============ */}
      <div className="dh-toolbar">
        <div className="dh-toolbar__left">
          <VideoIcon size={20} />
          <span className="dh-toolbar__title">数字人引擎</span>
          <span className="dh-toolbar__badge">
            {generationMode === 'cloud' ? '自研管线 · 云端模型' : '自研 · 本地推理'}
          </span>
          {/* 模式切换 */}
          <div className="dh-mode-switch">
            <button
              className={`dh-mode-btn ${generationMode === 'cloud' ? 'active' : ''}`}
              onClick={() => setGenerationMode('cloud')}
            >
              云端管线
            </button>
            <button
              className={`dh-mode-btn ${generationMode === 'local' ? 'active' : ''}`}
              onClick={() => setGenerationMode('local')}
            >
              本地推理
            </button>
          </div>
        </div>
        <div className="dh-toolbar__actions">
          {/* 引擎状态指示器 — 仅本地模式显示 */}
          {generationMode === 'local' && (
            <>
              <div className={`dh-engine-indicator dh-engine-indicator--${engineStatus}`}>
                <span className="dh-engine-dot" />
                <span className="dh-engine-text">
                  {engineStatus === 'running' ? '运行中' : engineStatus === 'starting' ? '启动中' : engineStatus === 'error' ? '错误' : '未启动'}
                </span>
              </div>
              {/* 启动/停止引擎 */}
              {engineStatus === 'running' ? (
                <button className="dh-btn dh-btn--ghost dh-btn--danger" onClick={handleStopEngine} title="停止引擎">
                  <StopIcon size={15} />
                </button>
              ) : (
                <button
                  className="dh-btn dh-btn--ghost"
                  onClick={handleStartEngine}
                  disabled={engineStatus === 'starting'}
                  title="启动引擎"
                >
                  <PlayIcon size={15} />
                </button>
              )}
            </>
          )}
          <button className="dh-btn dh-btn--ghost" onClick={() => setShowSettings(!showSettings)} title="引擎设置">
            <SettingsIcon size={15} />
          </button>
          <button className="dh-btn dh-btn--ghost" onClick={handleReset} title="重置">
            <RefreshIcon size={15} />
          </button>
        </div>
      </div>

      <div className="dh-content">
        {/* ============ 左侧：形象选择 + 引擎状态 ============ */}
        <div className="dh-sidebar">
          {/* 数字人形象 */}
          <div className="dh-section-title">
            <span>数字人形象</span>
            <button className="dh-btn dh-btn--small dh-btn--primary" onClick={handleSelectAvatarFile}>
              <PlusIcon size={14} />
              添加
            </button>
          </div>
          <div className="dh-avatar-list">
            {avatars.map((avatar) => (
              <div
                key={avatar.id}
                className={`dh-avatar-card ${selectedAvatar?.id === avatar.id ? 'selected' : ''}`}
                onClick={() => setSelectedAvatar(avatar)}
              >
                <div className="dh-avatar-thumb">
                  {avatar.thumbnail ? (
                    <img src={avatar.thumbnail} alt={avatar.name} />
                  ) : (
                    <div className="dh-avatar-placeholder">
                      <VideoIcon size={32} />
                    </div>
                  )}
                </div>
                <div className="dh-avatar-info">
                  <div className="dh-avatar-name">{avatar.name}</div>
                  <div className="dh-avatar-type">
                    {avatar.isCustom ? '自定义' : '预设'}
                  </div>
                </div>
                {selectedAvatar?.id === avatar.id && (
                  <div className="dh-avatar-check">
                    <CheckIcon size={14} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 引擎状态 — 本地推理模式显示硬件信息，云端模式显示连接状态 */}
          <div className="dh-engine-status">
            <div className="dh-section-title">
              {generationMode === 'cloud' ? '云端状态' : '引擎状态'}
            </div>
            {generationMode === 'cloud' ? (
              <div className="dh-status-grid">
                <div className="dh-status-item">
                  <span className="dh-status-label">管线模式</span>
                  <span className="dh-status-value ok">自研编排</span>
                </div>
                <div className="dh-status-item">
                  <span className="dh-status-label">提供商</span>
                  <span className="dh-status-value">
                    {cloudProviders.find(p => p.id === selectedProvider)?.name || '未选择'}
                  </span>
                </div>
                <div className="dh-status-item">
                  <span className="dh-status-label">国内可用</span>
                  <span className={`dh-status-value ${cloudProviders.find(p => p.id === selectedProvider)?.china_available ? 'ok' : 'warn'}`}>
                    {cloudProviders.find(p => p.id === selectedProvider)?.china_available ? '是' : '否'}
                  </span>
                </div>
                <div className="dh-status-item">
                  <span className="dh-status-label">配置状态</span>
                  <span className={`dh-status-value ${cloudProviders.find(p => p.id === selectedProvider)?.configured ? 'ok' : 'warn'}`}>
                    {cloudProviders.find(p => p.id === selectedProvider)?.configured ? '已配置' : '未配置'}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="dh-status-grid">
                  <div className="dh-status-item">
                    <span className="dh-status-label">GPU</span>
                    <span className={`dh-status-value ${systemInfo?.gpuAvailable ? 'ok' : 'warn'}`}>
                      {systemInfo ? (systemInfo.gpuAvailable ? systemInfo.gpuName : 'CPU 模式') : '未检测'}
                    </span>
                  </div>
                  <div className="dh-status-item">
                    <span className="dh-status-label">显存</span>
                    <span className="dh-status-value">
                      {systemInfo?.gpuAvailable ? `${systemInfo.vramFree} / ${systemInfo.vramTotal}` : '—'}
                    </span>
                  </div>
                  <div className="dh-status-item">
                    <span className="dh-status-label">CUDA</span>
                    <span className={`dh-status-value ${systemInfo?.cudaVersion ? 'ok' : 'warn'}`}>
                      {systemInfo?.cudaVersion || '—'}
                    </span>
                  </div>
                  <div className="dh-status-item">
                    <span className="dh-status-label">FFmpeg</span>
                    <span className={`dh-status-value ${systemInfo?.ffmpegAvailable ? 'ok' : 'warn'}`}>
                      {systemInfo ? (systemInfo.ffmpegAvailable ? '已安装' : '未安装') : '—'}
                    </span>
                  </div>
                  <div className="dh-status-item">
                    <span className="dh-status-label">Python</span>
                    <span className={`dh-status-value ${systemInfo?.pythonVersion ? 'ok' : 'warn'}`}>
                      {systemInfo?.pythonVersion || '—'}
                    </span>
                  </div>
                </div>
                {engineStatus !== 'running' && isTauriEnv && (
                  <button className="dh-btn dh-btn--small dh-btn--primary dh-btn--full" onClick={handleStartEngine} disabled={engineStatus === 'starting'}>
                    <PlayIcon size={14} />
                    {engineStatus === 'starting' ? '启动中...' : '启动推理引擎'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* ============ 右侧：配置 + 生成 ============ */}
        <div className="dh-main">
          {/* 模型选择 — 仅本地推理模式显示 */}
          {generationMode === 'local' && (
          <div className="dh-section">
            <div className="dh-section-title">
              <span>驱动模型</span>
              {isTauriEnv && engineStatus === 'running' && (
                <button className="dh-btn dh-btn--small dh-btn--ghost" onClick={refreshModels}>
                  <RefreshIcon size={13} />
                  刷新
                </button>
              )}
            </div>
            <div className="dh-model-grid">
              {models.map((model) => (
                <div
                  key={model.id}
                  className={`dh-model-card ${selectedModel === model.id ? 'selected' : ''} ${!model.installed ? 'not-installed' : ''}`}
                  onClick={() => setSelectedModel(model.id)}
                >
                  <div className="dh-model-header">
                    <span className="dh-model-name">{model.name}</span>
                    {model.realtime && <span className="dh-model-tag dh-model-tag--realtime">实时</span>}
                    {model.installed ? (
                      <span className="dh-model-tag dh-model-tag--ready">已安装</span>
                    ) : (
                      <span className="dh-model-tag dh-model-tag--todo">未安装</span>
                    )}
                  </div>
                  <div className="dh-model-desc">{model.description}</div>
                  <div className="dh-model-stats">
                    <span title="显存需求">GPU: {model.vramRequired}</span>
                    <span title="生成速度">速度: {model.speed}</span>
                    <span title="画质">画质: {model.quality}</span>
                    <span title="最大分辨率">Max: {model.maxResolution}</span>
                  </div>
                  {/* 未安装时显示下载按钮 */}
                  {!model.installed && isTauriEnv && engineStatus === 'running' && (
                    <button
                      className="dh-btn dh-btn--small dh-btn--primary dh-btn--full"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadModel(model.id);
                      }}
                      disabled={!!downloadingModel}
                    >
                      {downloadingModel === model.id ? (
                        <>
                          <RefreshIcon size={13} className="dh-spin" />
                          下载中 {downloadProgress?.progress || 0}%
                        </>
                      ) : (
                        <>
                          <DownloadIcon size={13} />
                          下载模型
                        </>
                      )}
                    </button>
                  )}
                  {/* 下载进度条 */}
                  {downloadingModel === model.id && downloadProgress && (
                    <div className="dh-download-progress">
                      <div className="dh-progress-bar">
                        <div className="dh-progress-fill" style={{ width: `${downloadProgress.progress}%` }} />
                      </div>
                      <div className="dh-download-info">
                        <span>{downloadProgress.message}</span>
                        {downloadProgress.speed && <span>{downloadProgress.speed}</span>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          )}

          {/* 音频输入 */}
          <div className="dh-section">
            <div className="dh-section-title">音频输入</div>
            <div className="dh-audio-tabs">
              <button
                className={`dh-tab ${audioSource === 'tts' ? 'active' : ''}`}
                onClick={() => setAudioSource('tts')}
              >
                文字转语音 (TTS)
              </button>
              <button
                className={`dh-tab ${audioSource === 'upload' ? 'active' : ''}`}
                onClick={() => setAudioSource('upload')}
              >
                上传音频文件
              </button>
            </div>

            {audioSource === 'tts' ? (
              <div className="dh-tts-area">
                <textarea
                  className="dh-textarea"
                  placeholder="输入要让数字人说的文字..."
                  value={ttsText}
                  onChange={(e) => setTtsText(e.target.value)}
                  rows={4}
                  maxLength={500}
                />
                <div className="dh-tts-controls">
                  <select
                    className="dh-select"
                    value={ttsVoice}
                    onChange={(e) => setTtsVoice(e.target.value)}
                  >
                    <optgroup label="中文">
                      <option value="zh-CN-XiaoxiaoNeural">晓晓 (女)</option>
                      <option value="zh-CN-YunxiNeural">云希 (男)</option>
                      <option value="zh-CN-YunyangNeural">云扬 (男)</option>
                      <option value="zh-CN-XiaoyiNeural">晓伊 (女)</option>
                      <option value="zh-CN-YunfengNeural">云枫 (男)</option>
                      <option value="zh-CN-XiaomengNeural">晓梦 (女)</option>
                      <option value="zh-CN-XiaochenNeural">晓辰 (女)</option>
                      <option value="zh-CN-XiaohanNeural">晓涵 (女)</option>
                      <option value="zh-CN-XiaomoNeural">晓墨 (女)</option>
                      <option value="zh-CN-XiaoqiuNeural">晓秋 (女)</option>
                      <option value="zh-CN-XiaoruiNeural">晓睿 (女)</option>
                      <option value="zh-CN-XiaoshuangNeural">晓双 (女)</option>
                      <option value="zh-CN-XiaoyanNeural">晓颜 (女)</option>
                      <option value="zh-CN-XiaozhenNeural">晓甄 (女)</option>
                      <option value="zh-CN-YunjianNeural">云健 (男)</option>
                    </optgroup>
                    <optgroup label="English">
                      <option value="en-US-JennyNeural">Jenny (F)</option>
                      <option value="en-US-GuyNeural">Guy (M)</option>
                      <option value="en-US-AriaNeural">Aria (F)</option>
                      <option value="en-US-DavisNeural">Davis (M)</option>
                      <option value="en-US-AmberNeural">Amber (F)</option>
                      <option value="en-US-BrandonNeural">Brandon (M)</option>
                      <option value="en-GB-SoniaNeural">Sonia (F)</option>
                      <option value="en-GB-RyanNeural">Ryan (M)</option>
                    </optgroup>
                    <optgroup label="日本語">
                      <option value="ja-JP-NanamiNeural">七海 (女)</option>
                      <option value="ja-JP-KeitaNeural">圭太 (男)</option>
                    </optgroup>
                    <optgroup label="한국어">
                      <option value="ko-KR-SunHiNeural">선히 (女)</option>
                      <option value="ko-KR-InJoonNeural">인준 (男)</option>
                    </optgroup>
                  </select>
                  <span className="dh-char-count">{ttsText.length}/500</span>
                </div>
                {/* TTS 预览按钮 */}
                {isTauriEnv && engineStatus === 'running' && ttsText.trim() && (
                  <button
                    className="dh-btn dh-btn--small dh-btn--ghost"
                    onClick={async () => {
                      try {
                        addLog('TTS 预览合成中...');
                        const audioPath = await invoke<string>('dh_tts', { text: ttsText, voice: ttsVoice });
                        addLog(`✓ TTS 合成完成: ${audioPath}`);
                      } catch (err) {
                        addLog(`✗ TTS 合成失败: ${err}`);
                      }
                    }}
                  >
                    <MicIcon size={14} />
                    预览语音
                  </button>
                )}
              </div>
            ) : (
              <div className="dh-upload-area">
                <button className="dh-upload-label" onClick={handleSelectAudioFile}>
                  <UploadIcon size={32} />
                  <span>{uploadedAudio || '点击选择音频文件 (WAV/MP3, <60s)'}</span>
                </button>
              </div>
            )}
          </div>

          {/* 云端管线配置（仅云端模式显示） */}
          {generationMode === 'cloud' && (
            <div className="dh-section">
              <div className="dh-section-title">
                <span>云端管线配置</span>
                {estimatedCost && (
                  <span className="dh-cost-estimate">
                    预估费用: <strong>{estimatedCost.cost} {estimatedCost.currency}</strong>
                    <span className="dh-cost-detail">{estimatedCost.detail}</span>
                  </span>
                )}
              </div>

              {/* 提供商选择 */}
              <div className="dh-cloud-config">
                <div className="dh-config-row">
                  <label className="dh-config-label">云端提供商</label>
                  <select
                    className="dh-select"
                    value={selectedProvider}
                    onChange={(e) => {
                      setSelectedProvider(e.target.value);
                      const p = cloudProviders.find(p => p.id === e.target.value);
                      if (p && p.models.length > 0) {
                        setSelectedCloudModel(p.models[0].id);
                      }
                    }}
                  >
                    {cloudProviders.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.china_available ? '(国内可用)' : ''} {p.configured ? '✓' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 模型选择 */}
                {cloudProviders.find(p => p.id === selectedProvider)?.models && (
                  <div className="dh-config-row">
                    <label className="dh-config-label">模型</label>
                    <select
                      className="dh-select"
                      value={selectedCloudModel}
                      onChange={(e) => setSelectedCloudModel(e.target.value)}
                    >
                      {cloudProviders.find(p => p.id === selectedProvider)?.models.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.price_per_second}元/秒) {m.recommended ? '★推荐' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 分辨率 */}
                <div className="dh-config-row">
                  <label className="dh-config-label">分辨率</label>
                  <select
                    className="dh-select"
                    value={cloudResolution}
                    onChange={(e) => setCloudResolution(e.target.value)}
                  >
                    <option value="480p">480p</option>
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>

                {/* API Key */}
                {cloudProviders.find(p => p.id === selectedProvider)?.requires_api_key &&
                 !cloudProviders.find(p => p.id === selectedProvider)?.configured && (
                  <div className="dh-config-row">
                    <label className="dh-config-label">API Key</label>
                    <input
                      type="password"
                      className="dh-input"
                      placeholder="输入云端提供商 API Key..."
                      value={cloudApiKey}
                      onChange={(e) => setCloudApiKey(e.target.value)}
                    />
                    <button
                      className="dh-btn dh-btn--small dh-btn--primary"
                      onClick={handleConfigureProvider}
                      disabled={!cloudApiKey}
                    >
                      配置
                    </button>
                  </div>
                )}

                {/* 文案优化设置 */}
                <div className="dh-config-row dh-config-row--toggle">
                  <label className="dh-config-label">
                    LLM 文案优化
                    <span className="dh-config-hint">调用大模型润色文案，使播报更自然</span>
                  </label>
                  <input
                    type="checkbox"
                    checked={enableScriptOptimization}
                    onChange={(e) => setEnableScriptOptimization(e.target.checked)}
                  />
                </div>

                {enableScriptOptimization && (
                  <>
                    <div className="dh-config-row">
                      <label className="dh-config-label">优化风格</label>
                      <select
                        className="dh-select"
                        value={scriptStyle}
                        onChange={(e) => setScriptStyle(e.target.value)}
                      >
                        {scriptStyles.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="dh-config-row">
                      <label className="dh-config-label">LLM API Key (通义千问)</label>
                      <input
                        type="password"
                        className="dh-input"
                        placeholder="输入通义千问 API Key (用于文案优化)..."
                        value={llmApiKey}
                        onChange={(e) => setLlmApiKey(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 管线阶段进度（云端管线执行中显示） */}
          {generationMode === 'cloud' && pipelineStages.length > 0 && (status === 'generating' || status === 'preparing') && (
            <div className="dh-section">
              <div className="dh-section-title">管线执行进度</div>
              <div className="dh-pipeline-stages">
                {pipelineStages.map((s, i) => (
                  <div key={i} className={`dh-pipeline-stage dh-pipeline-stage--${s.status}`}>
                    <div className="dh-pipeline-stage-header">
                      <span className="dh-pipeline-stage-name">
                        {s.stage === 'script_optimization' && '文案优化'}
                        {s.stage === 'tts_synthesis' && '语音合成'}
                        {s.stage === 'avatar_processing' && '形象处理'}
                        {s.stage === 'cloud_synthesis' && '云端视频合成'}
                        {s.stage === 'post_processing' && '后处理'}
                      </span>
                      <span className="dh-pipeline-stage-status">
                        {s.status === 'completed' && '✓'}
                        {s.status === 'running' && `${s.progress}%`}
                        {s.status === 'pending' && '等待'}
                        {s.status === 'failed' && '✗'}
                        {s.status === 'skipped' && '跳过'}
                      </span>
                    </div>
                    {s.status === 'running' && (
                      <div className="dh-pipeline-stage-bar">
                        <div className="dh-pipeline-stage-fill" style={{ width: `${s.progress}%` }} />
                      </div>
                    )}
                    {s.message && s.status === 'running' && (
                      <div className="dh-pipeline-stage-msg">{s.message}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 文案优化结果展示 */}
          {generationMode === 'cloud' && optimizedScript && enableScriptOptimization && (
            <div className="dh-section">
              <div className="dh-section-title">
                <span>文案优化结果</span>
                <SparkleIcon size={14} />
              </div>
              <div className="dh-optimized-script">
                <div className="dh-optimized-original">
                  <span className="dh-optimized-label">原文</span>
                  <p>{ttsText}</p>
                </div>
                <div className="dh-optimized-arrow">↓</div>
                <div className="dh-optimized-result">
                  <span className="dh-optimized-label">优化后</span>
                  <p>{optimizedScript}</p>
                </div>
              </div>
            </div>
          )}

          {/* 生成按钮 */}
          <div className="dh-generate-bar">
            <div className="dh-generate-info">
              {selectedAvatar ? (
                <span>形象: <strong>{selectedAvatar.name}</strong></span>
              ) : (
                <span className="dh-warn">请选择数字人形象</span>
              )}
              {generationMode === 'cloud' ? (
                <span>云端: <strong>{cloudProviders.find(p => p.id === selectedProvider)?.name || selectedProvider}</strong></span>
              ) : (
                <span>模型: <strong>{currentModel.name}</strong></span>
              )}
            </div>
            {generationMode === 'cloud' ? (
              <button
                className="dh-btn dh-btn--primary dh-btn--large"
                onClick={handlePipelineRun}
                disabled={status === 'preparing' || status === 'generating'}
              >
                {status === 'generating' ? (
                  <>
                    <RefreshIcon size={16} className="dh-spin" />
                    管线执行中...
                  </>
                ) : status === 'preparing' ? (
                  '准备中...'
                ) : (
                  <>
                    <SparkleIcon size={16} />
                    启动云端管线
                  </>
                )}
              </button>
            ) : (
              <button
                className="dh-btn dh-btn--primary dh-btn--large"
                onClick={handleGenerate}
                disabled={status === 'preparing' || status === 'generating' || (isTauriEnv && engineStatus !== 'running')}
              >
                {status === 'generating' ? (
                  <>
                    <RefreshIcon size={16} className="dh-spin" />
                    生成中...
                  </>
                ) : status === 'preparing' ? (
                  '准备中...'
                ) : isTauriEnv && engineStatus !== 'running' ? (
                  '请先启动引擎'
                ) : (
                  <>
                    <SparkleIcon size={16} />
                    生成数字人视频
                  </>
                )}
              </button>
            )}
            {status === 'generating' && generationMode === 'cloud' && pipelineTaskId && (
              <button className="dh-btn dh-btn--ghost" onClick={handleCancelPipeline}>
                取消
              </button>
            )}
          </div>

          {/* 进度区 */}
          {(status === 'generating' || status === 'preparing') && (
            <div className="dh-progress">
              <div className="dh-progress-bar">
                <div className="dh-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="dh-progress-info">
                <span>{progressMsg}</span>
                <span className="dh-progress-percent">{progress}%</span>
              </div>
            </div>
          )}

          {/* 日志区 */}
          {logs.length > 0 && (
            <div className="dh-logs">
              <div className="dh-logs-header">
                推理日志
                <button className="dh-btn dh-btn--small dh-btn--ghost" onClick={() => setLogs([])}>
                  清除
                </button>
              </div>
              <div className="dh-logs-body">
                {logs.map((log, i) => (
                  <div key={i} className="dh-log-line">{log}</div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {/* 结果区 */}
          {status === 'completed' && result && (
            <div className="dh-result">
              <div className="dh-result-header">
                <CheckIcon size={20} />
                <span>生成成功</span>
              </div>
              <div className="dh-result-video">
                {isTauriEnv ? (
                  <video controls src={`file://${result.videoPath}`} className="dh-video-player" />
                ) : (
                  <div className="dh-video-placeholder">
                    <PlayIcon size={48} />
                    <span>数字人视频预览</span>
                  </div>
                )}
              </div>
              <div className="dh-result-stats">
                <div><span>时长</span><strong>{result.duration}s</strong></div>
                <div><span>分辨率</span><strong>{result.resolution}</strong></div>
                <div><span>模型</span><strong>{result.modelUsed}</strong></div>
                <div><span>耗时</span><strong>{result.processingTime}s</strong></div>
              </div>
              <div className="dh-result-actions">
                <button className="dh-btn dh-btn--ghost">
                  <DownloadIcon size={16} />
                  下载视频
                </button>
                <button className="dh-btn dh-btn--primary" onClick={handleReset}>
                  重新生成
                </button>
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {status === 'error' && (
            <div className="dh-error">
              <span>{error}</span>
              <button className="dh-btn dh-btn--ghost" onClick={handleReset}>重试</button>
            </div>
          )}

          {/* 设置面板 */}
          {showSettings && (
            <div className="dh-settings-panel">
              <div className="dh-section-title">引擎配置</div>
              <div className="dh-settings-info">
                {generationMode === 'cloud' ? (
                  <>
                    <p className="dh-settings-hint">
                      <strong>自研编排管线模式</strong>：Aurora 自主编排整个数字人生成流程，
                      各阶段灵活组合云端模型能力，无需高端 GPU 即可生成高质量数字人视频。
                    </p>
                    <p className="dh-settings-hint">管线流程：</p>
                    <ol className="dh-settings-steps">
                      <li>LLM 文案优化 — 调用通义千问/OpenAI 润色文案</li>
                      <li>TTS 语音合成 — Edge-TTS/Azure 生成语音</li>
                      <li>形象预处理 — 本地裁剪/增强人物图片</li>
                      <li>云端视频合成 — 调用云端数字人 API</li>
                      <li>后处理 — 下载视频/添加字幕/水印</li>
                    </ol>
                    <p className="dh-settings-hint">
                      支持的云端提供商：阿里通义万相、火山引擎、D-ID、HeyGen、自定义 API
                    </p>
                  </>
                ) : (
                  <>
                    <p className="dh-settings-hint">
                      <strong>本地推理模式</strong>：基于开源模型在本地运行，所有数据不会上传到云端。
                      需要 NVIDIA GPU 和 CUDA 环境。
                    </p>
                    <p className="dh-settings-hint">首次使用需要：</p>
                    <ol className="dh-settings-steps">
                      <li>安装 Python 3.9+ 和 CUDA（如有 NVIDIA GPU）</li>
                      <li>安装 FFmpeg</li>
                      <li>运行 <code>pip install -r requirements.txt</code> 安装 Python 依赖</li>
                      <li>点击「启动推理引擎」</li>
                      <li>下载需要的模型（首次约 2-6 GB）</li>
                      <li>开始生成数字人视频</li>
                    </ol>
                  </>
                )}
              </div>
              <div className="dh-settings-actions">
                <button
                  className="dh-btn dh-btn--primary"
                  onClick={async () => {
                    await refreshSystemInfo();
                    await refreshModels();
                  }}
                >
                  <RefreshIcon size={15} />
                  检测环境
                </button>
                {engineStatus === 'running' ? (
                  <button className="dh-btn dh-btn--ghost" onClick={handleStopEngine}>
                    <StopIcon size={15} />
                    停止引擎
                  </button>
                ) : (
                  <button className="dh-btn dh-btn--primary" onClick={handleStartEngine} disabled={engineStatus === 'starting'}>
                    <PlayIcon size={15} />
                    启动引擎
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DigitalHumanPanel;
