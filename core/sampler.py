"""24 色卡采样与统计。"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from core.color_metrics import PatchMeasurement, SummaryMeasurement, bgr_to_rgb_mean, build_summary, delta_e_76, gray_mean, srgb_to_lab
from core.geometry import DEFAULT_WARP_HEIGHT, DEFAULT_WARP_WIDTH, patch_rectangles, warp_card
from core.reference import PATCH_NAMES, REFERENCE_SRGB


@dataclass
class SampleResult:
    warped: np.ndarray
    measurements: list[PatchMeasurement]
    summary: SummaryMeasurement


class ColorCheckerSampler:
    def __init__(self, warp_size: tuple[int, int] = (DEFAULT_WARP_WIDTH, DEFAULT_WARP_HEIGHT), inner_ratio: float = 0.6) -> None:
        self.warp_size = warp_size
        self.inner_ratio = inner_ratio
        self._reference_labs = [srgb_to_lab(rgb) for rgb in REFERENCE_SRGB]

    def sample(self, frame: np.ndarray, quad: np.ndarray) -> SampleResult:
        warped, _ = warp_card(frame, quad, self.warp_size)
        rects = patch_rectangles(self.warp_size, self.inner_ratio)

        measurements: list[PatchMeasurement] = []
        for index, rect in enumerate(rects):
            x0, y0, x1, y1 = rect
            patch = warped[y0:y1, x0:x1]
            rgb = bgr_to_rgb_mean(patch)
            gray = gray_mean(patch)
            lab = srgb_to_lab(rgb)
            delta_e = delta_e_76(lab, self._reference_labs[index])
            measurements.append(
                PatchMeasurement(
                    index=index,
                    name=PATCH_NAMES[index],
                    rgb=rgb,
                    gray=gray,
                    lab=lab,
                    delta_e=delta_e,
                )
            )

        return SampleResult(warped=warped, measurements=measurements, summary=build_summary(measurements))
