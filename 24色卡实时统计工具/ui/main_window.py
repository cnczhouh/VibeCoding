"""主窗口。"""

from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import (
    QApplication,
    QDoubleSpinBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from core.controller import AppController
from ui.floating_stats import FloatingStatsWindow
from ui.overlay_view import OverlayView


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("24色卡实时统计工具")
        self.resize(1280, 860)

        self.controller = AppController()
        self.current_quad = None
        self.current_frame = None

        self.overlay = OverlayView()
        self.overlay.quadChanged.connect(self._on_quad_changed)

        self.stats_window = FloatingStatsWindow()
        self.stats_window.show()

        self.timer = QTimer(self)
        self.timer.timeout.connect(self._refresh_frame)
        self.timer.start(33)

        self.inner_ratio_spin = QDoubleSpinBox()
        self.inner_ratio_spin.setRange(0.3, 0.95)
        self.inner_ratio_spin.setSingleStep(0.05)
        self.inner_ratio_spin.setValue(0.6)
        self.inner_ratio_spin.valueChanged.connect(self._on_inner_ratio_changed)

        self.camera_spin = QSpinBox()
        self.camera_spin.setRange(0, 10)

        self.screen_spin = QSpinBox()
        self.screen_spin.setRange(1, 10)
        self.screen_spin.setValue(1)

        open_image_button = QPushButton("打开图片")
        open_image_button.clicked.connect(self._open_image)

        open_video_button = QPushButton("打开视频")
        open_video_button.clicked.connect(self._open_video)

        open_camera_button = QPushButton("打开摄像头")
        open_camera_button.clicked.connect(self._open_camera)

        open_screen_button = QPushButton("采集屏幕")
        open_screen_button.clicked.connect(self._open_screen)

        reset_roi_button = QPushButton("重置 ROI")
        reset_roi_button.clicked.connect(self.overlay.reset_quad)

        control_layout = QHBoxLayout()
        control_layout.addWidget(open_image_button)
        control_layout.addWidget(open_video_button)
        control_layout.addWidget(open_camera_button)
        control_layout.addWidget(open_screen_button)
        control_layout.addWidget(reset_roi_button)
        control_layout.addWidget(QLabel("采样比例"))
        control_layout.addWidget(self.inner_ratio_spin)
        control_layout.addWidget(QLabel("摄像头索引"))
        control_layout.addWidget(self.camera_spin)
        control_layout.addWidget(QLabel("屏幕索引"))
        control_layout.addWidget(self.screen_spin)
        control_layout.addStretch(1)

        container = QWidget()
        layout = QVBoxLayout(container)
        layout.addLayout(control_layout)
        layout.addWidget(self.overlay)
        self.setCentralWidget(container)

    def closeEvent(self, event) -> None:
        self.controller.release()
        self.stats_window.close()
        super().closeEvent(event)

    def _open_image(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "选择图片", str(Path.cwd()), "Images (*.png *.jpg *.jpeg *.bmp)")
        if not path:
            return
        try:
            frame = self.controller.load_image(path)
            self.current_frame = frame
            self.overlay.set_frame(frame)
            self._refresh_static_image()
        except Exception as exc:  # noqa: BLE001
            self._show_error(str(exc))

    def _open_video(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "选择视频", str(Path.cwd()), "Videos (*.mp4 *.avi *.mov *.mkv)")
        if not path:
            return
        try:
            self.controller.open_video(path)
            self.current_frame = None
        except Exception as exc:  # noqa: BLE001
            self._show_error(str(exc))

    def _open_camera(self) -> None:
        try:
            self.controller.open_camera(self.camera_spin.value())
            self.current_frame = None
        except Exception as exc:  # noqa: BLE001
            self._show_error(str(exc))

    def _open_screen(self) -> None:
        try:
            self.controller.open_screen(self.screen_spin.value())
            self.current_frame = None
        except Exception as exc:  # noqa: BLE001
            self._show_error(str(exc))

    def _on_quad_changed(self, quad) -> None:
        self.current_quad = quad
        if self.controller.source.info.mode == "image":
            self._refresh_static_image()

    def _on_inner_ratio_changed(self, value: float) -> None:
        self.controller.set_inner_ratio(value)
        if self.controller.source.info.mode == "image":
            self._refresh_static_image()

    def _refresh_static_image(self) -> None:
        processed = self.controller.next_frame(self.current_quad)
        if processed is None:
            return
        self.current_frame = processed.frame
        self.overlay.set_frame(processed.frame)
        self.stats_window.update_result(processed.sample_result)

    def _refresh_frame(self) -> None:
        if self.controller.source.info.mode in {"empty", "image"}:
            return

        processed = self.controller.next_frame(self.current_quad)
        if processed is None:
            return
        self.current_frame = processed.frame
        self.overlay.set_frame(processed.frame)
        self.stats_window.update_result(processed.sample_result)

    def _show_error(self, message: str) -> None:
        QMessageBox.critical(self, "错误", message)


def run() -> None:
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())
