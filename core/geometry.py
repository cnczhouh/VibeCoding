"""24 色卡 ROI、透视变换与网格坐标工具。"""

from __future__ import annotations

from typing import Iterable

import cv2
import numpy as np

PATCH_COLS = 6
PATCH_ROWS = 4
DEFAULT_WARP_WIDTH = 600
DEFAULT_WARP_HEIGHT = 400


def order_points(points: np.ndarray) -> np.ndarray:
    pts = np.asarray(points, dtype=np.float32)
    if pts.shape != (4, 2):
        raise ValueError("points 必须是 4x2")

    sums = pts.sum(axis=1)
    diffs = np.diff(pts, axis=1).reshape(-1)

    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = pts[np.argmin(sums)]
    ordered[2] = pts[np.argmax(sums)]
    ordered[1] = pts[np.argmin(diffs)]
    ordered[3] = pts[np.argmax(diffs)]
    return ordered


def default_quad(width: int, height: int, margin_ratio: float = 0.15) -> np.ndarray:
    mx = width * margin_ratio
    my = height * margin_ratio
    return np.array(
        [
            [mx, my],
            [width - mx, my],
            [width - mx, height - my],
            [mx, height - my],
        ],
        dtype=np.float32,
    )


def compute_perspective_transform(points: np.ndarray, warp_size: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    ordered = order_points(points)
    width, height = warp_size
    destination = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(ordered, destination)
    inverse = cv2.getPerspectiveTransform(destination, ordered)
    return matrix, inverse


def warp_card(image: np.ndarray, points: np.ndarray, warp_size: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    matrix, inverse = compute_perspective_transform(points, warp_size)
    width, height = warp_size
    warped = cv2.warpPerspective(image, matrix, (width, height))
    return warped, inverse


def patch_rectangles(warp_size: tuple[int, int], inner_ratio: float) -> list[tuple[int, int, int, int]]:
    width, height = warp_size
    patch_w = width / PATCH_COLS
    patch_h = height / PATCH_ROWS
    margin_x = patch_w * (1 - inner_ratio) / 2
    margin_y = patch_h * (1 - inner_ratio) / 2

    rects: list[tuple[int, int, int, int]] = []
    for row in range(PATCH_ROWS):
        for col in range(PATCH_COLS):
            x0 = int(round(col * patch_w + margin_x))
            y0 = int(round(row * patch_h + margin_y))
            x1 = int(round((col + 1) * patch_w - margin_x))
            y1 = int(round((row + 1) * patch_h - margin_y))
            rects.append((x0, y0, x1, y1))
    return rects


def grid_points(warp_size: tuple[int, int]) -> tuple[list[np.ndarray], list[np.ndarray]]:
    width, height = warp_size
    vertical_lines: list[np.ndarray] = []
    horizontal_lines: list[np.ndarray] = []

    for col in range(1, PATCH_COLS):
        x = width * col / PATCH_COLS
        vertical_lines.append(np.array([[x, 0], [x, height]], dtype=np.float32))

    for row in range(1, PATCH_ROWS):
        y = height * row / PATCH_ROWS
        horizontal_lines.append(np.array([[0, y], [width, y]], dtype=np.float32))

    return vertical_lines, horizontal_lines


def rect_centers(rects: Iterable[tuple[int, int, int, int]]) -> np.ndarray:
    centers = []
    for x0, y0, x1, y1 in rects:
        centers.append(((x0 + x1) / 2, (y0 + y1) / 2))
    return np.asarray(centers, dtype=np.float32)


def map_points_back(points: np.ndarray, inverse_matrix: np.ndarray) -> np.ndarray:
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
    mapped = cv2.perspectiveTransform(pts, inverse_matrix)
    return mapped.reshape(-1, 2)


def map_line_back(line: np.ndarray, inverse_matrix: np.ndarray) -> np.ndarray:
    return map_points_back(line, inverse_matrix)
