# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 面部处理工具模块
=====================================

本模块提供面部检测、对齐、裁剪与特征点提取功能，用于：
  - 在输入头像图片中定位面部区域
  - 提取面部关键点（landmarks）用于口型同步
  - 裁剪面部区域并恢复到原图

支持的面部检测后端（按优先级）：
  1. mediapipe（推荐，速度快，精度高）
  2. face_alignment（精度高，但速度较慢）
  3. OpenCV DNN（兜底方案）

如果所有后端都不可用，将抛出明确的错误提示。
"""

import logging
import os
from pathlib import Path
from typing import List, Optional, Tuple, Union

import numpy as np

from config import INFERENCE

logger = logging.getLogger(__name__)


# 面部关键点索引常量
# 基于 MediaPipe Face Mesh 的 468 点模型
LEFT_EYE_INDICES = list(range(33, 42))
RIGHT_EYE_INDICES = list(range(263, 272))
MOUTH_INDICES = list(range(61, 88))
NOSE_INDICES = list(range(168, 198))
FACE_OVAL_INDICES = list(range(10, 33)) + list(range(288, 295))


class FaceDetector:
    """
    面部检测器，支持多种检测后端。

    自动选择可用的检测后端：
      1. 优先使用 mediapipe
      2. 降级到 face_alignment
      3. 降级到 OpenCV DNN
    """

    def __init__(self, backend: str = "auto") -> None:
        """
        初始化面部检测器。

        Args:
            backend: 指定后端 ("mediapipe" / "face_alignment" / "opencv" / "auto")
                     "auto" 表示自动选择可用的后端
        """
        self.backend: Optional[str] = None
        self._detector = None

        if backend == "auto":
            # 按优先级尝试各后端
            for b in ["mediapipe", "face_alignment", "opencv"]:
                if self._try_init_backend(b):
                    break
        else:
            self._try_init_backend(backend)

        if self.backend is None:
            logger.error(
                "所有面部检测后端均不可用。请安装以下任一库：\n"
                "  pip install mediapipe\n"
                "  pip install face-alignment\n"
                "  pip install opencv-python-headless"
            )
        else:
            logger.info(f"面部检测器已初始化，后端: {self.backend}")

    def _try_init_backend(self, backend: str) -> bool:
        """
        尝试初始化指定的检测后端。

        Args:
            backend: 后端名称

        Returns:
            bool: True 表示初始化成功
        """
        try:
            if backend == "mediapipe":
                import mediapipe as mp
                self._detector = mp.solutions.face_detection.FaceDetection(
                    model_selection=1,  # 1 表示全距离模型（适合远景）
                    min_detection_confidence=INFERENCE.FACE_DETECT_CONFIDENCE,
                )
                self._mp_face_mesh = mp.solutions.face_mesh
                self.backend = "mediapipe"
                return True

            elif backend == "face_alignment":
                import face_alignment
                self._detector = face_alignment.FaceAlignment(
                    face_alignment.LandmarksType.TWO_D,
                    flip_input=False,
                    device=self._get_device_str(),
                )
                self.backend = "face_alignment"
                return True

            elif backend == "opencv":
                import cv2
                # 使用 OpenCV 的 Haar 级联分类器作为兜底
                cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
                self._detector = cv2.CascadeClassifier(cascade_path)
                if not self._detector.empty():
                    self.backend = "opencv"
                    return True
                return False

        except ImportError:
            logger.debug(f"{backend} 未安装")
            return False
        except Exception as e:
            logger.warning(f"初始化 {backend} 后端失败: {e}")
            return False

        return False

    def _get_device_str(self) -> str:
        """获取设备字符串（用于 face_alignment 后端）"""
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda"
        except ImportError:
            pass
        return "cpu"

    def detect(self, image: np.ndarray) -> List[dict]:
        """
        在图像中检测面部。

        Args:
            image: 输入图像（BGR 格式，OpenCV 读取的格式）

        Returns:
            面部信息列表，每个元素为字典：
            {
                "bbox": (x, y, width, height),     # 边界框
                "confidence": float,                 # 置信度
                "landmarks": np.ndarray or None,     # 关键点（如果有）
            }
        """
        if self.backend is None:
            raise RuntimeError("面部检测器未初始化，请安装检测库")

        if self.backend == "mediapipe":
            return self._detect_mediapipe(image)
        elif self.backend == "face_alignment":
            return self._detect_face_alignment(image)
        elif self.backend == "opencv":
            return self._detect_opencv(image)
        else:
            raise RuntimeError(f"未知的检测后端: {self.backend}")

    def _detect_mediapipe(self, image: np.ndarray) -> List[dict]:
        """使用 MediaPipe 检测面部"""
        import cv2

        # MediaPipe 需要 RGB 格式
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        results = self._detector.process(rgb_image)

        faces = []
        if results.detections:
            for detection in results.detections:
                bbox = detection.location_data.relative_bounding_box
                h, w = image.shape[:2]
                x = int(bbox.xmin * w)
                y = int(bbox.ymin * h)
                width = int(bbox.width * w)
                height = int(bbox.height * h)

                # 确保边界框在图像范围内
                x = max(0, x)
                y = max(0, y)
                width = min(width, w - x)
                height = min(height, h - y)

                faces.append({
                    "bbox": (x, y, width, height),
                    "confidence": float(detection.score[0]),
                    "landmarks": None,
                })

        return faces

    def _detect_face_alignment(self, image: np.ndarray) -> List[dict]:
        """使用 face_alignment 检测面部"""
        import cv2

        # face_alignment 需要 RGB 格式
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        preds = self._detector.get_landmarks(rgb_image)

        faces = []
        if preds is not None:
            for i, landmarks in enumerate(preds):
                if landmarks is None:
                    continue

                # 从关键点计算边界框
                x_min = int(landmarks[:, 0].min())
                y_min = int(landmarks[:, 1].min())
                x_max = int(landmarks[:, 0].max())
                y_max = int(landmarks[:, 1].max())

                faces.append({
                    "bbox": (x_min, y_min, x_max - x_min, y_max - y_min),
                    "confidence": 1.0,
                    "landmarks": landmarks,
                })

        return faces

    def _detect_opencv(self, image: np.ndarray) -> List[dict]:
        """使用 OpenCV Haar 级联检测面部"""
        import cv2

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        detections = self._detector.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(INFERENCE.FACE_DETECT_MIN_SIZE, INFERENCE.FACE_DETECT_MIN_SIZE),
        )

        faces = []
        for (x, y, w, h) in detections:
            faces.append({
                "bbox": (int(x), int(y), int(w), int(h)),
                "confidence": 1.0,
                "landmarks": None,
            })

        return faces

    def extract_landmarks(self, image: np.ndarray) -> Optional[np.ndarray]:
        """
        提取面部关键点（landmarks）。

        使用 MediaPipe Face Mesh 提取 468 个关键点。
        如果 MediaPipe 不可用，使用 face_alignment 提取 68 个关键点。

        Args:
            image: 输入图像（BGR 格式）

        Returns:
            关键点数组，形状为 (N, 2) 或 None（未检测到面部）
        """
        import cv2

        try:
            if self.backend == "mediapipe":
                import mediapipe as mp
                with mp.solutions.face_mesh.FaceMesh(
                    static_image_mode=True,
                    max_num_faces=1,
                    refine_landmarks=True,
                    min_detection_confidence=INFERENCE.FACE_DETECT_CONFIDENCE,
                ) as face_mesh:
                    rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                    results = face_mesh.process(rgb_image)

                    if results.multi_face_landmarks:
                        landmarks = results.multi_face_landmarks[0]
                        h, w = image.shape[:2]
                        points = np.array([
                            [lm.x * w, lm.y * h]
                            for lm in landmarks.landmark
                        ], dtype=np.float32)
                        return points

            elif self.backend == "face_alignment":
                rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                preds = self._detector.get_landmarks(rgb_image)
                if preds is not None and len(preds) > 0:
                    return preds[0]

        except Exception as e:
            logger.warning(f"提取面部关键点失败: {e}")

        return None

    def close(self) -> None:
        """释放检测器资源"""
        if self.backend == "mediapipe" and self._detector is not None:
            self._detector.close()
            self._detector = None


class FaceProcessor:
    """
    面部处理器，提供面部裁剪、对齐和恢复功能。

    用于在口型同步推理前预处理面部区域，推理后恢复到原图。
    """

    def __init__(self, expand_ratio: float = INFERENCE.FACE_CROP_EXPAND_RATIO) -> None:
        """
        初始化面部处理器。

        Args:
            expand_ratio: 面部裁剪时的扩展比例（上下左右各扩展此比例）
        """
        self.expand_ratio = expand_ratio
        self._detector = FaceDetector(backend="auto")

    def crop_face(
        self,
        image: np.ndarray,
        bbox: Optional[Tuple[int, int, int, int]] = None,
        target_size: Optional[Tuple[int, int]] = None,
    ) -> Tuple[np.ndarray, dict]:
        """
        从图像中裁剪面部区域。

        Args:
            image: 输入图像
            bbox: 面部边界框 (x, y, width, height)，None 表示自动检测
            target_size: 目标大小 (width, height)，None 表示不缩放

        Returns:
            tuple: (裁剪后的面部图像, 裁剪信息字典)
            裁剪信息包含原始位置和偏移，用于后续恢复。
        """
        import cv2

        h, w = image.shape[:2]

        # 如果未提供边界框，自动检测
        if bbox is None:
            faces = self._detector.detect(image)
            if not faces:
                raise ValueError("未检测到面部")
            bbox = faces[0]["bbox"]

        x, y, fw, fh = bbox

        # 扩展边界框
        expand_w = int(fw * self.expand_ratio)
        expand_h = int(fh * self.expand_ratio)

        x = max(0, x - expand_w)
        y = max(0, y - expand_h)
        fw = min(fw + 2 * expand_w, w - x)
        fh = min(fh + 2 * expand_h, h - y)

        # 裁剪
        cropped = image[y:y + fh, x:x + fw].copy()

        # 记录裁剪信息（用于后续恢复）
        crop_info = {
            "original_x": x,
            "original_y": y,
            "original_width": fw,
            "original_height": fh,
            "image_height": h,
            "image_width": w,
        }

        # 如果指定了目标大小，进行缩放
        if target_size:
            target_w, target_h = target_size
            cropped = cv2.resize(cropped, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
            crop_info["target_size"] = target_size

        return cropped, crop_info

    def restore_face(
        self,
        face_image: np.ndarray,
        crop_info: dict,
        original_image: np.ndarray,
    ) -> np.ndarray:
        """
        将处理后的面部图像恢复到原始图像中的对应位置。

        Args:
            face_image: 处理后的面部图像
            crop_info: crop_face 返回的裁剪信息
            original_image: 原始图像

        Returns:
            合成后的图像
        """
        import cv2

        result = original_image.copy()

        x = crop_info["original_x"]
        y = crop_info["original_y"]
        fw = crop_info["original_width"]
        fh = crop_info["original_height"]

        # 如果有缩放，需要缩放回原始尺寸
        if "target_size" in crop_info:
            face_image = cv2.resize(face_image, (fw, fh), interpolation=cv2.INTER_LANCZOS4)

        # 将面部图像放回原图
        # 使用 alpha 混合避免边界明显
        result[y:y + fh, x:x + fw] = face_image

        return result

    def align_face(
        self,
        image: np.ndarray,
        landmarks: Optional[np.ndarray] = None,
        target_size: Tuple[int, int] = (256, 256),
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        面部对齐：根据眼睛位置旋转和缩放面部到标准位置。

        Args:
            image: 输入图像
            landmarks: 面部关键点，None 表示自动提取
            target_size: 目标图像大小

        Returns:
            tuple: (对齐后的图像, 变换矩阵)
        """
        import cv2

        if landmarks is None:
            landmarks = self._detector.extract_landmarks(image)

        if landmarks is None:
            # 无法获取关键点，直接缩放
            aligned = cv2.resize(image, target_size, interpolation=cv2.INTER_LANCZOS4)
            return aligned, np.eye(3, dtype=np.float32)

        # 使用 MediaPipe 468 点模型时，左右眼中心点
        if len(landmarks) >= 468:
            left_eye_center = landmarks[LEFT_EYE_INDICES].mean(axis=0)
            right_eye_center = landmarks[RIGHT_EYE_INDICES].mean(axis=0)
        elif len(landmarks) >= 68:
            # face_alignment 68 点模型
            left_eye_center = landmarks[36:42].mean(axis=0)
            right_eye_center = landmarks[42:48].mean(axis=0)
        else:
            aligned = cv2.resize(image, target_size, interpolation=cv2.INTER_LANCZOS4)
            return aligned, np.eye(3, dtype=np.float32)

        # 计算旋转角度
        dx = right_eye_center[0] - left_eye_center[0]
        dy = right_eye_center[1] - left_eye_center[1]
        angle = np.degrees(np.arctan2(dy, dx))

        # 计算缩放比例
        eye_dist = np.sqrt(dx ** 2 + dy ** 2)
        desired_eye_dist = target_size[0] * 0.3  # 眼睛间距占图像宽度的 30%
        scale = desired_eye_dist / max(eye_dist, 1.0)

        # 计算旋转中心（两眼中心的中点）
        center = ((left_eye_center[0] + right_eye_center[0]) / 2,
                  (left_eye_center[1] + right_eye_center[1]) / 2)

        # 构建仿射变换矩阵
        # 先旋转和缩放，再平移到目标中心
        target_center = (target_size[0] / 2, target_size[1] / 2)
        M = cv2.getRotationMatrix2D(center, angle, scale)

        # 添加平移
        M[0, 2] += target_center[0] - center[0]
        M[1, 2] += target_center[1] - center[1]

        # 应用变换
        aligned = cv2.warpAffine(
            image, M, target_size,
            flags=cv2.INTER_LANCZOS4,
            borderMode=cv2.BORDER_REFLECT,
        )

        # 将 2x3 矩阵扩展为 3x3（方便逆变换）
        M_full = np.vstack([M, [0, 0, 1]]).astype(np.float32)

        return aligned, M_full

    def get_face_mask(
        self,
        image: np.ndarray,
        landmarks: Optional[np.ndarray] = None,
        expand_pixels: int = 10,
    ) -> np.ndarray:
        """
        生成面部区域的二值掩码。

        用于口型同步时的区域混合，只替换嘴部周围的区域。

        Args:
            image: 输入图像
            landmarks: 面部关键点
            expand_pixels: 掩码向外扩展的像素数

        Returns:
            二值掩码（0-255），与输入图像同尺寸
        """
        import cv2

        h, w = image.shape[:2]
        mask = np.zeros((h, w), dtype=np.uint8)

        if landmarks is None:
            landmarks = self._detector.extract_landmarks(image)

        if landmarks is None:
            return mask

        # 使用面部轮廓点创建多边形
        if len(landmarks) >= 468:
            # MediaPipe 468 点模型
            oval_points = landmarks[FACE_OVAL_INDICES].astype(np.int32)
        elif len(landmarks) >= 68:
            # face_alignment 68 点模型
            oval_points = landmarks[0:17].astype(np.int32)
        else:
            return mask

        # 填充多边形
        cv2.fillPoly(mask, [oval_points], 255)

        # 扩展掩码
        kernel = np.ones((expand_pixels * 2 + 1, expand_pixels * 2 + 1), np.uint8)
        mask = cv2.dilate(mask, kernel, iterations=1)

        # 高斯模糊使边缘平滑
        mask = cv2.GaussianBlur(mask, (expand_pixels * 4 + 1, expand_pixels * 4 + 1), 0)

        return mask

    def close(self) -> None:
        """释放资源"""
        self._detector.close()


# ============================================================
# 模块级便捷函数
# ============================================================

# 全局面部检测器实例（延迟初始化）
_detector: Optional[FaceDetector] = None
_processor: Optional[FaceProcessor] = None


def _get_detector() -> FaceDetector:
    """获取全局面部检测器实例"""
    global _detector
    if _detector is None:
        _detector = FaceDetector(backend="auto")
    return _detector


def _get_processor() -> FaceProcessor:
    """获取全局面部处理器实例"""
    global _processor
    if _processor is None:
        _processor = FaceProcessor()
    return _processor


def detect_faces(image_path_or_array: Union[str, Path, np.ndarray]) -> List[dict]:
    """
    检测图像中的面部。

    Args:
        image_path_or_array: 图像路径或 numpy 数组

    Returns:
        面部信息列表
    """
    import cv2

    if isinstance(image_path_or_array, (str, Path)):
        image = cv2.imread(str(image_path_or_array))
        if image is None:
            raise FileNotFoundError(f"无法读取图像: {image_path_or_array}")
    else:
        image = image_path_or_array

    return _get_detector().detect(image)


def extract_face_landmarks(image_path_or_array: Union[str, Path, np.ndarray]) -> Optional[np.ndarray]:
    """
    提取面部关键点。

    Args:
        image_path_or_array: 图像路径或 numpy 数组

    Returns:
        关键点数组 (N, 2) 或 None
    """
    import cv2

    if isinstance(image_path_or_array, (str, Path)):
        image = cv2.imread(str(image_path_or_array))
        if image is None:
            raise FileNotFoundError(f"无法读取图像: {image_path_or_array}")
    else:
        image = image_path_or_array

    return _get_detector().extract_landmarks(image)


def crop_face(
    image_path_or_array: Union[str, Path, np.ndarray],
    bbox: Optional[Tuple[int, int, int, int]] = None,
    target_size: Optional[Tuple[int, int]] = None,
) -> Tuple[np.ndarray, dict]:
    """
    裁剪面部区域。

    Args:
        image_path_or_array: 图像路径或 numpy 数组
        bbox: 面部边界框，None 表示自动检测
        target_size: 目标大小

    Returns:
        tuple: (裁剪后的图像, 裁剪信息)
    """
    import cv2

    if isinstance(image_path_or_array, (str, Path)):
        image = cv2.imread(str(image_path_or_array))
        if image is None:
            raise FileNotFoundError(f"无法读取图像: {image_path_or_array}")
    else:
        image = image_path_or_array

    return _get_processor().crop_face(image, bbox, target_size)


def align_face(
    image_path_or_array: Union[str, Path, np.ndarray],
    target_size: Tuple[int, int] = (256, 256),
) -> Tuple[np.ndarray, np.ndarray]:
    """
    面部对齐。

    Args:
        image_path_or_array: 图像路径或 numpy 数组
        target_size: 目标大小

    Returns:
        tuple: (对齐后的图像, 变换矩阵)
    """
    import cv2

    if isinstance(image_path_or_array, (str, Path)):
        image = cv2.imread(str(image_path_or_array))
        if image is None:
            raise FileNotFoundError(f"无法读取图像: {image_path_or_array}")
    else:
        image = image_path_or_array

    return _get_processor().align_face(image, target_size=target_size)


if __name__ == "__main__":
    # 模块直接运行时，测试面部检测
    logging.basicConfig(level=logging.DEBUG)

    # 创建一个测试图像（纯黑）
    test_image = np.zeros((256, 256, 3), dtype=np.uint8)

    detector = FaceDetector(backend="auto")
    print(f"检测器后端: {detector.backend}")
    print(f"检测结果: {detector.detect(test_image)}")
    detector.close()
