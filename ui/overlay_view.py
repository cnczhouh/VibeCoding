"""图像显示与四点 ROI 交互。"""

from __future__ import annotations

from typing import Optional

import cv2
import numpy as np
from PySide6.QtCore import QPointF, Qt, Signal
from PySide6.QtGui import QImage, QMouseEvent, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QLabel

from core.geometry import (
    DEFAULT_WARP_HEIGHT,
    DEFAULT_WARP_WIDTH,
    compute_perspective_transform,
    default_quad,
    grid_points,
    map_line_back,
)


class OverlayView(QLabel):
    quadChanged = Signal(object)

    def __init__(self) -> None:
        super().__init__()
        self.setMinimumSize(960, 640)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setMouseTracking(True)
        self._frame: Optional[np.ndarray] = None
        self._display_pixmap = QPixmap()
        self._quad: Optional[np.ndarray] = None
        self._drag_index: Optional[int] = None
        self._scale = 1.0
        self._offset = QPointF(0.0, 0.0)

    def set_frame(self, frame: np.ndarray) -> None:
        self._frame = frame.copy()
        if self._quad is None:
            height, width = frame.shape[:2]
            self._quad = default_quad(width, height)
            self.quadChanged.emit(self._quad.copy())
        self._update_pixmap()
        self.update()

    def quad(self) -> Optional[np.ndarray]:
        if self._quad is None:
            return None
        return self._quad.copy()

    def reset_quad(self) -> None:
        if self._frame is None:
            return
        height, width = self._frame.shape[:2]
        self._quad = default_quad(width, height)
        self.quadChanged.emit(self._quad.copy())
        self.update()

    def paintEvent(self, event) -> None:
        super().paintEvent(event)
        if self._frame is None or self._quad is None:
            return

        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        points = [self._image_to_widget(point) for point in self._quad]

        line_pen = QPen(Qt.GlobalColor.green, 2)
        painter.setPen(line_pen)
        for index in range(4):
            painter.drawLine(points[index], points[(index + 1) % 4])

        self._draw_grid(painter)

        handle_pen = QPen(Qt.GlobalColor.yellow, 2)
        painter.setPen(handle_pen)
        painter.setBrush(Qt.GlobalColor.red)
        for point in points:
            painter.drawEllipse(point, 6, 6)

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self._update_pixmap()

    def mousePressEvent(self, event: QMouseEvent) -> None:
        if self._quad is None:
            return
        pos = event.position()
        for index, point in enumerate(self._quad):
            if self._distance(self._image_to_widget(point), pos) < 12:
                self._drag_index = index
                return

    def mouseMoveEvent(self, event: QMouseEvent) -> None:
        if self._quad is None or self._drag_index is None:
            return
        image_pos = self._widget_to_image(event.position())
        if image_pos is None:
            return
        self._quad[self._drag_index] = image_pos
        self.quadChanged.emit(self._quad.copy())
        self.update()

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:
        self._drag_index = None
        super().mouseReleaseEvent(event)

    def _draw_grid(self, painter: QPainter) -> None:
        if self._quad is None:
            return

        _, inverse = compute_perspective_transform(self._quad, (DEFAULT_WARP_WIDTH, DEFAULT_WARP_HEIGHT))
        vertical_lines, horizontal_lines = grid_points((DEFAULT_WARP_WIDTH, DEFAULT_WARP_HEIGHT))

        grid_pen = QPen(Qt.GlobalColor.cyan, 1)
        painter.setPen(grid_pen)

        for line in vertical_lines + horizontal_lines:
            mapped = map_line_back(line, inverse)
            p0 = self._image_to_widget(mapped[0])
            p1 = self._image_to_widget(mapped[1])
            painter.drawLine(p0, p1)

    def _update_pixmap(self) -> None:
        if self._frame is None:
            self.clear()
            return

        rgb = cv2.cvtColor(self._frame, cv2.COLOR_BGR2RGB)
        height, width, channels = rgb.shape
        bytes_per_line = channels * width
        image = QImage(rgb.data, width, height, bytes_per_line, QImage.Format.Format_RGB888)
        pixmap = QPixmap.fromImage(image.copy())
        scaled = pixmap.scaled(self.size(), Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
        self._display_pixmap = scaled
        self.setPixmap(scaled)

        self._scale = min(self.width() / width, self.height() / height)
        display_w = width * self._scale
        display_h = height * self._scale
        self._offset = QPointF((self.width() - display_w) / 2, (self.height() - display_h) / 2)

    def _image_to_widget(self, point: np.ndarray) -> QPointF:
        return QPointF(self._offset.x() + point[0] * self._scale, self._offset.y() + point[1] * self._scale)

    def _widget_to_image(self, point: QPointF) -> Optional[np.ndarray]:
        if self._frame is None:
            return None
        x = (point.x() - self._offset.x()) / self._scale
        y = (point.y() - self._offset.y()) / self._scale
        height, width = self._frame.shape[:2]
        x = float(np.clip(x, 0, width - 1))
        y = float(np.clip(y, 0, height - 1))
        return np.array([x, y], dtype=np.float32)

    @staticmethod
    def _distance(p1: QPointF, p2: QPointF) -> float:
        return ((p1.x() - p2.x()) ** 2 + (p1.y() - p2.y()) ** 2) ** 0.5
