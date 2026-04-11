"""悬浮统计窗口。"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QHeaderView, QLabel, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget

from core.sampler import SampleResult


class FloatingStatsWindow(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("24色卡统计悬浮窗")
        self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
        self.resize(540, 720)

        self.summary_label = QLabel("等待图像输入")
        self.table = QTableWidget(24, 5)
        self.table.setHorizontalHeaderLabels(["#", "Name", "RGB", "Gray", "ΔE76"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)

        layout = QVBoxLayout(self)
        layout.addWidget(self.summary_label)
        layout.addWidget(self.table)

    def update_result(self, result: SampleResult | None) -> None:
        if result is None:
            self.summary_label.setText("等待 ROI / 图像")
            self.table.clearContents()
            return

        summary = result.summary
        self.summary_label.setText(
            f"平均 ΔE76: {summary.average_delta_e:.2f} | 最大 ΔE76: {summary.maximum_delta_e:.2f} | "
            f"最亮: {summary.brightest_patch} | 最暗: {summary.darkest_patch}"
        )

        for row, measurement in enumerate(result.measurements):
            self.table.setItem(row, 0, QTableWidgetItem(str(measurement.index + 1)))
            self.table.setItem(row, 1, QTableWidgetItem(measurement.name))
            self.table.setItem(row, 2, QTableWidgetItem(str(measurement.rgb)))
            self.table.setItem(row, 3, QTableWidgetItem(f"{measurement.gray:.1f}"))
            self.table.setItem(row, 4, QTableWidgetItem(f"{measurement.delta_e:.2f}"))
