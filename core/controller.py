"""应用主控制器。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

from core.sampler import ColorCheckerSampler, SampleResult
from core.source import FrameSource


@dataclass
class ProcessedFrame:
    frame: np.ndarray
    sample_result: Optional[SampleResult]


class AppController:
    def __init__(self) -> None:
        self.source = FrameSource()
        self.sampler = ColorCheckerSampler()

    def load_image(self, path: str) -> np.ndarray:
        return self.source.load_image(path)

    def open_video(self, path: str) -> None:
        self.source.open_video(path)

    def open_camera(self, index: int = 0) -> None:
        self.source.open_camera(index)

    def open_screen(self, index: int = 1) -> None:
        self.source.open_screen(index)

    def next_frame(self, quad: Optional[np.ndarray]) -> Optional[ProcessedFrame]:
        frame = self.source.read()
        if frame is None:
            return None

        sample_result = None
        if quad is not None:
            sample_result = self.sampler.sample(frame, quad)
        return ProcessedFrame(frame=frame, sample_result=sample_result)

    def set_inner_ratio(self, ratio: float) -> None:
        self.sampler.inner_ratio = ratio

    def release(self) -> None:
        self.source.release()
