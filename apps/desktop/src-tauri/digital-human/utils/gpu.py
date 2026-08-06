# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — GPU/CUDA 检测模块
=====================================

本模块负责检测系统的 GPU 环境，包括：
  - GPU 是否可用
  - GPU 设备名称
  - 显存总量与可用量
  - CUDA 版本
  - PyTorch 版本

检测策略（按优先级降级）：
  1. 优先使用 torch.cuda（最准确，能获取显存信息）
  2. 降级到 nvidia-smi 命令行（不需要 PyTorch）
  3. 最终降级到 CPU only 模式
"""

import logging
import re
import subprocess
import shutil
from typing import Dict, Optional

logger = logging.getLogger(__name__)


def detect_gpu() -> dict:
    """
    检测 GPU 信息，返回完整的 GPU 环境信息。

    返回字典结构：
    {
        "available": bool,           # GPU 是否可用
        "device_name": str,          # GPU 设备名称
        "vram_total": int,           # 显存总量（字节），0 表示未知
        "vram_free": int,            # 可用显存（字节），0 表示未知
        "vram_used": int,            # 已用显存（字节），0 表示未知
        "cuda_version": str,         # CUDA 版本
        "torch_version": str,        # PyTorch 版本（若安装）
        "device_count": int,         # GPU 数量
        "fallback": str,             # 检测方式: "torch" / "nvidia-smi" / "cpu"
    }

    Returns:
        dict: GPU 环境信息字典
    """
    # 尝试方法 1：使用 PyTorch 检测
    result = _detect_via_torch()
    if result is not None:
        logger.info(f"GPU 检测完成（通过 PyTorch）: {result['device_name']}")
        return result

    # 尝试方法 2：使用 nvidia-smi 命令行检测
    result = _detect_via_nvidia_smi()
    if result is not None:
        logger.info(f"GPU 检测完成（通过 nvidia-smi）: {result['device_name']}")
        return result

    # 方法 3：CPU only 模式
    logger.info("GPU 不可用，将使用 CPU 推理模式")
    return {
        "available": False,
        "device_name": "CPU",
        "vram_total": 0,
        "vram_free": 0,
        "vram_used": 0,
        "cuda_version": None,
        "torch_version": _get_torch_version(),
        "device_count": 0,
        "fallback": "cpu",
    }


def _detect_via_torch() -> Optional[dict]:
    """
    通过 PyTorch 的 torch.cuda 检测 GPU 信息。
    这是最可靠的方式，能获取精确的显存信息。

    Returns:
        dict 或 None（如果 PyTorch 不可用或没有 GPU）
    """
    try:
        import torch
    except ImportError:
        logger.debug("PyTorch 未安装，跳过 torch.cuda 检测")
        return None

    torch_version = torch.__version__

    # 检查 CUDA 是否可用
    if not torch.cuda.is_available():
        logger.debug("torch.cuda 不可用")
        return None

    device_count = torch.cuda.device_count()
    if device_count == 0:
        return None

    # 获取第一个 GPU 的信息
    device_name = torch.cuda.get_device_name(0)
    cuda_version = torch.version.cuda

    # 获取显存信息
    try:
        vram_total = torch.cuda.get_device_properties(0).total_memory
    except Exception as e:
        logger.warning(f"获取 GPU 总显存失败: {e}")
        vram_total = 0

    try:
        vram_free, vram_total_cached = torch.cuda.mem_get_info(0)
        # mem_get_info 返回 (free, total)
        if vram_total == 0:
            vram_total = vram_total_cached
    except Exception as e:
        logger.warning(f"获取 GPU 可用显存失败: {e}")
        vram_free = 0

    vram_used = vram_total - vram_free if vram_total > 0 else 0

    return {
        "available": True,
        "device_name": device_name,
        "vram_total": int(vram_total),
        "vram_free": int(vram_free),
        "vram_used": int(vram_used),
        "cuda_version": str(cuda_version) if cuda_version else "unknown",
        "torch_version": torch_version,
        "device_count": device_count,
        "fallback": "torch",
    }


def _detect_via_nvidia_smi() -> Optional[dict]:
    """
    通过 nvidia-smi 命令行检测 GPU 信息。
    在 PyTorch 不可用时的降级方案。

    Returns:
        dict 或 None（如果 nvidia-smi 不可用）
    """
    # 检查 nvidia-smi 命令是否存在
    nvidia_smi_path = shutil.which("nvidia-smi")
    if nvidia_smi_path is None:
        logger.debug("nvidia-smi 命令不存在")
        return None

    try:
        # 使用 nvidia-smi 查询 GPU 信息
        # --query-gpu: 指定要查询的属性
        # --format=csv,noheader,nounits: CSV 格式输出，无表头，无单位
        result = subprocess.run(
            [
                nvidia_smi_path,
                "--query-gpu=name,memory.total,memory.free,memory.used,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )

        if result.returncode != 0:
            logger.warning(f"nvidia-smi 执行失败: {result.stderr}")
            return None

        # 解析输出
        # 输出格式示例: NVIDIA GeForce RTX 4090, 24564, 22000, 2564, 535.129.03
        lines = result.stdout.strip().split("\n")
        if not lines or not lines[0].strip():
            return None

        # 取第一行（第一个 GPU）
        parts = [p.strip() for p in lines[0].split(",")]
        if len(parts) < 4:
            return None

        device_name = parts[0]
        vram_total_mb = int(parts[1])
        vram_free_mb = int(parts[2])
        vram_used_mb = int(parts[3])
        driver_version = parts[4] if len(parts) > 4 else "unknown"

        # 查询 CUDA 版本
        cuda_version = _get_cuda_version_from_nvidia_smi(nvidia_smi_path)

        return {
            "available": True,
            "device_name": device_name,
            "vram_total": vram_total_mb * 1024 * 1024,  # MB → bytes
            "vram_free": vram_free_mb * 1024 * 1024,
            "vram_used": vram_used_mb * 1024 * 1024,
            "cuda_version": cuda_version,
            "torch_version": _get_torch_version(),
            "device_count": len(lines),
            "fallback": "nvidia-smi",
            "driver_version": driver_version,
        }

    except subprocess.TimeoutExpired:
        logger.warning("nvidia-smi 执行超时")
        return None
    except (ValueError, IndexError) as e:
        logger.warning(f"解析 nvidia-smi 输出失败: {e}")
        return None
    except Exception as e:
        logger.warning(f"通过 nvidia-smi 检测 GPU 失败: {e}")
        return None


def _get_cuda_version_from_nvidia_smi(nvidia_smi_path: str) -> str:
    """
    从 nvidia-smi 的输出中提取 CUDA 版本号。

    Args:
        nvidia_smi_path: nvidia-smi 可执行文件路径

    Returns:
        CUDA 版本字符串，如 "12.1"，解析失败返回 "unknown"
    """
    try:
        result = subprocess.run(
            [nvidia_smi_path],
            capture_output=True,
            text=True,
            timeout=10,
        )
        # nvidia-smi 的输出中包含类似 "CUDA Version: 12.1" 的信息
        match = re.search(r"CUDA Version:\s*([\d.]+)", result.stdout)
        if match:
            return match.group(1)
    except Exception:
        pass
    return "unknown"


def _get_torch_version() -> Optional[str]:
    """获取 PyTorch 版本号，未安装返回 None"""
    try:
        import torch
        return torch.__version__
    except ImportError:
        return None


def get_gpu_info() -> dict:
    """
    获取 GPU 信息的便捷接口（detect_gpu 的别名）。
    保留此函数是为了提供更语义化的接口名称。

    Returns:
        dict: GPU 环境信息字典
    """
    return detect_gpu()


def is_cuda_available() -> bool:
    """
    快速检查 CUDA 是否可用。

    Returns:
        bool: True 表示 GPU 可用
    """
    info = detect_gpu()
    return info["available"]


def get_device():
    """
    获取 PyTorch 设备对象（torch.device）。
    如果 GPU 不可用，返回 CPU 设备。

    Returns:
        torch.device: 设备对象
    """
    try:
        import torch
        if torch.cuda.is_available():
            return torch.device("cuda:0")
        return torch.device("cpu")
    except ImportError:
        logger.warning("PyTorch 未安装，无法获取设备对象")
        return None


def get_vram_info() -> dict:
    """
    获取当前 GPU 显存的实时使用情况。

    Returns:
        dict: {"total": int, "free": int, "used": int}（字节）
              如果 GPU 不可用，所有值为 0
    """
    try:
        import torch
        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info(0)
            return {
                "total": int(total),
                "free": int(free),
                "used": int(total - free),
            }
    except Exception as e:
        logger.debug(f"获取显存信息失败: {e}")

    return {"total": 0, "free": 0, "used": 0}


def clear_gpu_cache() -> None:
    """
    清空 PyTorch 的 GPU 缓存，释放显存。
    在切换模型或显存不足时调用。
    """
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
            logger.info("已清空 GPU 缓存")
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"清空 GPU 缓存失败: {e}")


def format_bytes(num_bytes: int) -> str:
    """
    将字节数格式化为人类可读的字符串。

    Args:
        num_bytes: 字节数

    Returns:
        str: 格式化后的字符串，如 "8.0 GB"
    """
    if num_bytes == 0:
        return "0 B"

    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(num_bytes)
    unit_index = 0

    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024.0
        unit_index += 1

    return f"{size:.1f} {units[unit_index]}"


if __name__ == "__main__":
    # 模块直接运行时，打印 GPU 信息
    import json

    logging.basicConfig(level=logging.DEBUG)
    info = detect_gpu()
    print("=" * 50)
    print("GPU 检测结果:")
    print("=" * 50)
    print(json.dumps(info, indent=2, ensure_ascii=False))
    print(f"\n显存信息: {format_bytes(info['vram_total'])} 总计, "
          f"{format_bytes(info['vram_free'])} 可用")
    print(f"设备对象: {get_device()}")
    print("=" * 50)
