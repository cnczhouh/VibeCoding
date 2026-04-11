"""统一管理图片、视频、摄像头和屏幕输入。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from mss import mss


@dataclass
class SourceInfo:
    mode: str
    path: Optional[str] = None
    camera_index: Optional[int] = None
    screen_index: Optional[int] = None


class FrameSource:
    def __init__(self) -> None:
        self._capture: Optional[cv2.VideoCapture] = None
        self._image: Optional[np.ndarray] = None
        self._screen: Optional[mss] = None
        self._monitor: Optional[dict] = None
        self._info = SourceInfo(mode="empty")

    @property
    def info(self) -> SourceInfo:
        return self._info

    def load_image(self, path: str) -> np.ndarray:
        image = cv2.imread(path, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"无法读取图片: {path}")
        self.release()
        self._image = image
        self._info = SourceInfo(mode="image", path=path)
        return image.copy()

    def open_video(self, path: str) -> None:
        self.release()
        capture = cv2.VideoCapture(str(Path(path)))
        if not capture.isOpened():
            raise ValueError(f"无法打开视频: {path}")
        self._capture = capture
        self._info = SourceInfo(mode="video", path=path)

    def open_camera(self, index: int = 0) -> None:
        self.release()
        capture = cv2.VideoCapture(index)
        if not capture.isOpened():
            raise ValueError(f"无法打开摄像头: {index}")
        self._capture = capture
        self._info = SourceInfo(mode="camera", camera_index=index)

    def open_screen(self, index: int = 1) -> None:
        self.release()
        screen = mss()
        monitors = screen.monitors
        if index < 1 or index >= len(monitors):
            screen.close()
            raise ValueError(f"无效屏幕索引: {index}，可用范围 1-{len(monitors) - 1}")
        self._screen = screen
        self._monitor = monitors[index]
        self._info = SourceInfo(mode="screen", screen_index=index)

    def read(self) -> Optional[np.ndarray]:
        if self._info.mode == "image":
            if self._image is None:
                return None
            return self._image.copy()

        if self._info.mode == "screen":
            if self._screen is None or self._monitor is None:
                return None
            shot = self._screen.grab(self._monitor)
            frame = np.array(shot, dtype=np.uint8)
            return cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

        if self._capture is None:
            return None

        ok, frame = self._capture.read()
        if not ok:
            if self._info.mode == "video":
                self._capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ok, frame = self._capture.read()
            if not ok:
                return None
        return frame

    def release(self) -> None:
        if self._capture is not None:
            self._capture.release()
            self._capture = None
        if self._screen is not None:
            self._screen.close()
            self._screen = None
        self._monitor = None
        self._image = None
        self._info = SourceInfo(mode="empty")
