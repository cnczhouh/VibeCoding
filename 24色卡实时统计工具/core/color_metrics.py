"""颜色统计与 Delta E 计算。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import cv2
import numpy as np


@dataclass
class PatchMeasurement:
    index: int
    name: str
    rgb: tuple[int, int, int]
    gray: float
    lab: tuple[float, float, float]
    delta_e: float


@dataclass
class SummaryMeasurement:
    average_delta_e: float
    maximum_delta_e: float
    brightest_patch: str
    darkest_patch: str


def bgr_to_rgb_mean(patch: np.ndarray) -> tuple[int, int, int]:
    means = patch.reshape(-1, 3).mean(axis=0)
    b, g, r = means
    return int(round(r)), int(round(g)), int(round(b))


def gray_mean(patch: np.ndarray) -> float:
    gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
    return float(gray.mean())


def srgb_to_lab(rgb: Iterable[float]) -> tuple[float, float, float]:
    rgb_arr = np.asarray(list(rgb), dtype=np.float32) / 255.0
    linear = np.where(
        rgb_arr <= 0.04045,
        rgb_arr / 12.92,
        ((rgb_arr + 0.055) / 1.055) ** 2.4,
    )

    matrix = np.array(
        [
            [0.4124564, 0.3575761, 0.1804375],
            [0.2126729, 0.7151522, 0.0721750],
            [0.0193339, 0.1191920, 0.9503041],
        ],
        dtype=np.float32,
    )
    xyz = matrix @ linear
    xyz_ref = np.array([0.95047, 1.0, 1.08883], dtype=np.float32)
    xyz_scaled = xyz / xyz_ref

    epsilon = 216 / 24389
    kappa = 24389 / 27
    f = np.where(xyz_scaled > epsilon, xyz_scaled ** (1 / 3), (kappa * xyz_scaled + 16) / 116)

    l = 116 * f[1] - 16
    a = 500 * (f[0] - f[1])
    b = 200 * (f[1] - f[2])
    return float(l), float(a), float(b)


def delta_e_76(lab1: Iterable[float], lab2: Iterable[float]) -> float:
    arr1 = np.asarray(list(lab1), dtype=np.float32)
    arr2 = np.asarray(list(lab2), dtype=np.float32)
    return float(np.linalg.norm(arr1 - arr2))


def build_summary(measurements: list[PatchMeasurement]) -> SummaryMeasurement:
    average_delta = float(np.mean([m.delta_e for m in measurements])) if measurements else 0.0
    maximum_delta = float(np.max([m.delta_e for m in measurements])) if measurements else 0.0
    brightest = max(measurements, key=lambda item: item.gray).name if measurements else "-"
    darkest = min(measurements, key=lambda item: item.gray).name if measurements else "-"
    return SummaryMeasurement(
        average_delta_e=average_delta,
        maximum_delta_e=maximum_delta,
        brightest_patch=brightest,
        darkest_patch=darkest,
    )
