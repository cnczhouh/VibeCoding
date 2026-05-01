# -*- coding: utf-8 -*-
"""
Git Easy: a small Chinese GUI wrapper for common Git workflows.

It intentionally uses only Python's standard library so it can run on a
fresh Windows machine as long as Python and Git are installed.
"""

from __future__ import annotations

import datetime as _dt
import os
import queue
import shutil
import subprocess
import threading
import zipfile
from pathlib import Path
from tkinter import (
    BOTH,
    DISABLED,
    END,
    LEFT,
    NORMAL,
    RIGHT,
    TOP,
    X,
    Y,
    Button,
    Entry,
    Frame,
    Label,
    LabelFrame,
    Listbox,
    Scrollbar,
    StringVar,
    Tk,
    Text,
    filedialog,
    messagebox,
    simpledialog,
)


APP_VERSION = "范围保护版 2026-05-02"
APP_TITLE = f"Git 简易助手 - {APP_VERSION}"


class GitError(RuntimeError):
    """Raised when a Git command exits with a non-zero status."""

    def __init__(self, command: list[str], output: str) -> None:
        super().__init__(output)
        self.command = command
        self.output = output


def git_available() -> bool:
    return shutil.which("git") is not None


def run_git(repo: Path, args: list[str], check: bool = True) -> str:
    command = ["git", "-c", "core.quotepath=false", "-C", str(repo), *args]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = (completed.stdout or "") + (completed.stderr or "")
    output = output.strip()
    if check and completed.returncode != 0:
        raise GitError(command, output or f"命令失败，退出码：{completed.returncode}")
    return output


def run_git_anywhere(path: Path, args: list[str], check: bool = True) -> str:
    command = ["git", "-c", "core.quotepath=false", "-C", str(path), *args]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = (completed.stdout or "") + (completed.stderr or "")
    output = output.strip()
    if check and completed.returncode != 0:
        raise GitError(command, output or f"命令失败，退出码：{completed.returncode}")
    return output


def try_git(path: Path, args: list[str]) -> str:
    command = ["git", "-c", "core.quotepath=false", "-C", str(path), *args]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        return ""
    return ((completed.stdout or "") + (completed.stderr or "")).strip()


def repo_root(path: Path) -> Path | None:
    try:
        root = run_git_anywhere(path, ["rev-parse", "--show-toplevel"])
    except GitError:
        return None
    return Path(root.strip()).resolve()


def now_stamp() -> str:
    return _dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def selected_scope(repo: Path, selected: Path) -> list[str]:
    try:
        relative = selected.resolve().relative_to(repo.resolve())
    except ValueError:
        return []
    text = relative.as_posix()
    if not text or text == ".":
        return []
    return [text]


def with_scope(args: list[str], scope: list[str]) -> list[str]:
    if not scope:
        return args
    return [*args, "--", *scope]


def scope_hint(repo: Path, selected: Path) -> str:
    scope = selected_scope(repo, selected)
    if not scope:
        return "当前选择的是整个 Git 项目。"
    return f"当前只处理你选择的文件夹：{selected}"


def scoped_status(repo: Path, scope: list[str]) -> list[str]:
    output = run_git(repo, with_scope(["status", "--short", "--untracked-files=all"], scope), check=False)
    return [line for line in output.splitlines() if line.strip()]


def format_status_preview(lines: list[str], limit: int = 18) -> str:
    if not lines:
        return "没有文件需要保存。"
    shown = lines[:limit]
    more = len(lines) - len(shown)
    text = "\n".join(shown)
    if more > 0:
        text += f"\n... 还有 {more} 个文件"
    return text


def risky_status_lines(lines: list[str]) -> list[str]:
    risky_parts = [
        ".claude/worktrees/",
        "/node_modules/",
        "node_modules/",
        "/__pycache__/",
        "__pycache__/",
        "/postgres-data/",
        "postgres-data/",
        "/pg_wal/",
        "/pg_xact/",
    ]
    result: list[str] = []
    for line in lines:
        normalized = line.replace("\\", "/")
        if any(part in normalized for part in risky_parts):
            result.append(line)
    return result


class GitEasyApp:
    def __init__(self, root: Tk) -> None:
        self.root = root
        self.root.title(APP_TITLE)
        self.root.geometry("980x680")
        self.root.minsize(820, 560)

        self.queue: queue.Queue[tuple[str, str]] = queue.Queue()
        self.repo_var = StringVar(value=str(Path.cwd()))
        self.status_var = StringVar(value="请选择一个项目文件夹")
        self.branch_var = StringVar(value="分支：-")
        self.remote_var = StringVar(value="远程：-")
        self.git_root_var = StringVar(value="Git 管理目录：-")
        self.next_step_var = StringVar(value="下一步：先点“选择文件夹”，选你要管理的项目。")
        self.buttons: list[Button] = []

        self._build_ui()
        self.root.after(100, self._drain_queue)

        if not git_available():
            messagebox.showerror(
                "找不到 Git",
                "这台电脑还没有安装 Git。请先安装 Git for Windows，再打开这个工具。",
            )
            self._set_buttons_state(DISABLED)
            return

        self.use_current_folder()

    @property
    def selected_path(self) -> Path:
        return Path(self.repo_var.get()).expanduser().resolve()

    @property
    def selected_repo(self) -> Path | None:
        return repo_root(self.selected_path)

    def _build_ui(self) -> None:
        outer = Frame(self.root, padx=14, pady=12)
        outer.pack(fill=BOTH, expand=True)

        header = Frame(outer)
        header.pack(fill=X)
        Label(header, text=APP_TITLE, font=("Microsoft YaHei UI", 18, "bold")).pack(side=LEFT)
        Label(
            header,
            text="把常见 Git 操作变成安全按钮",
            fg="#555555",
            font=("Microsoft YaHei UI", 10),
        ).pack(side=LEFT, padx=(12, 0))

        picker = LabelFrame(outer, text="项目位置", padx=10, pady=10)
        picker.pack(fill=X, pady=(12, 8))
        Entry(picker, textvariable=self.repo_var, font=("Consolas", 10)).pack(
            side=LEFT, fill=X, expand=True, padx=(0, 8)
        )
        Button(picker, text="选择文件夹", command=self.choose_folder).pack(side=LEFT, padx=3)
        Button(picker, text="使用当前文件夹", command=self.use_current_folder).pack(side=LEFT, padx=3)
        Button(picker, text="初始化为 Git 项目", command=self.init_repo).pack(side=LEFT, padx=3)

        info = Frame(outer)
        info.pack(fill=X, pady=(0, 8))
        self._info_label(info, self.status_var).pack(side=LEFT, fill=X, expand=True, padx=(0, 8))
        self._info_label(info, self.branch_var).pack(side=LEFT, fill=X, expand=True, padx=(0, 8))
        self._info_label(info, self.remote_var).pack(side=LEFT, fill=X, expand=True, padx=(0, 8))
        self._info_label(info, self.git_root_var).pack(side=LEFT, fill=X, expand=True)

        next_step = LabelFrame(outer, text="下一步建议", padx=10, pady=8)
        next_step.pack(fill=X, pady=(0, 8))
        Label(
            next_step,
            textvariable=self.next_step_var,
            anchor="w",
            justify=LEFT,
            font=("Microsoft YaHei UI", 11, "bold"),
            fg="#1f4e79",
        ).pack(fill=X)

        body = Frame(outer)
        body.pack(fill=BOTH, expand=True)

        actions = LabelFrame(body, text="按需要点按钮", padx=10, pady=10)
        actions.pack(side=LEFT, fill=Y, padx=(0, 10))

        self._add_button(actions, "我该怎么用？", self.show_beginner_help)
        self._add_button(actions, "1 看看当前情况", self.refresh_status)
        self._add_button(actions, "2 保存这次修改", self.commit_changes)
        self._add_button(actions, "3 和远程同步", self.sync_repo)
        self._add_button(actions, "备份修改", self.backup_changes)
        self._add_button(actions, "设置名字和邮箱", self.set_identity)
        self._add_button(actions, "连接远程仓库", self.set_remote)
        self._add_button(actions, "只下载最新修改", self.pull_latest)
        self._add_button(actions, "只上传我的版本", self.push_changes)
        self._add_button(actions, "查看保存历史", self.show_history)
        self._add_button(actions, "创建新分支", self.create_branch)
        self._add_button(actions, "切换分支", self.switch_branch)
        self._add_button(actions, "撤销已管理文件修改", self.restore_tracked_changes)

        right = Frame(body)
        right.pack(side=RIGHT, fill=BOTH, expand=True)

        log_box = LabelFrame(right, text="执行记录", padx=8, pady=8)
        log_box.pack(fill=BOTH, expand=True)
        scroll = Scrollbar(log_box)
        scroll.pack(side=RIGHT, fill=Y)
        self.log = Text(
            log_box,
            wrap="word",
            font=("Microsoft YaHei UI", 10),
            height=20,
            yscrollcommand=scroll.set,
        )
        self.log.pack(fill=BOTH, expand=True)
        scroll.config(command=self.log.yview)

    def _info_label(self, parent: Frame, variable: StringVar) -> Label:
        return Label(
            parent,
            textvariable=variable,
            anchor="w",
            justify=LEFT,
            padx=10,
            pady=8,
            relief="groove",
            font=("Microsoft YaHei UI", 10),
        )

    def _add_button(self, parent: Frame, text: str, command) -> None:
        button = Button(parent, text=text, command=command, width=20, pady=6)
        button.pack(fill=X, pady=3)
        self.buttons.append(button)

    def _set_buttons_state(self, state: str) -> None:
        for button in self.buttons:
            button.config(state=state)

    def _log(self, text: str) -> None:
        self.log.insert(END, text + "\n")
        self.log.see(END)

    def _drain_queue(self) -> None:
        while True:
            try:
                kind, payload = self.queue.get_nowait()
            except queue.Empty:
                break
            if kind == "log":
                self._log(payload)
            elif kind == "done":
                self._set_buttons_state(NORMAL)
                self.refresh_status(background=True)
            elif kind == "error":
                self._set_buttons_state(NORMAL)
                self._log(payload)
                messagebox.showerror("操作失败", payload)
                self.refresh_status(background=True)
        self.root.after(100, self._drain_queue)

    def _worker(self, title: str, job) -> None:
        def run() -> None:
            self.queue.put(("log", f"\n▶ {title}"))
            try:
                result = job()
            except GitError as exc:
                detail = friendly_git_error(exc.output)
                self.queue.put(("error", detail))
                return
            except Exception as exc:  # pragma: no cover - GUI safety net
                self.queue.put(("error", f"发生了意外错误：{exc}"))
                return
            if result:
                self.queue.put(("log", result))
            self.queue.put(("log", f"✓ {title} 完成"))
            self.queue.put(("done", ""))

        self._set_buttons_state(DISABLED)
        threading.Thread(target=run, daemon=True).start()

    def _require_repo(self) -> Path | None:
        path = self.selected_path
        if not path.exists():
            messagebox.showwarning("文件夹不存在", "请选择一个已经存在的项目文件夹。")
            return None
        root = repo_root(path)
        if root is None:
            messagebox.showwarning(
                "还不是 Git 项目",
                "这个文件夹还没有启用 Git。你可以先点击“初始化为 Git 项目”。",
            )
            return None
        return root

    def show_beginner_help(self) -> None:
        messagebox.showinfo(
            "新手用法",
            "最常用只记这三步：\n\n"
            "1. 点“选择文件夹”，选你的项目。\n"
            "2. 点“看看当前情况”，看工具给出的下一步建议。\n"
            "3. 改完文件后，点“保存这次修改”。需要同步到远程时，再点“和远程同步”。\n\n"
            "第一次使用如果保存失败，通常是还没设置名字和邮箱，点“设置名字和邮箱”即可。\n\n"
            "不确定要不要撤销时，先点“备份修改”。\n\n"
            f"当前工具版本：{APP_VERSION}",
        )

    def choose_folder(self) -> None:
        picked = filedialog.askdirectory(title="选择你的项目文件夹")
        if picked:
            self.repo_var.set(picked)
            self.refresh_status()

    def use_current_folder(self) -> None:
        current = Path(__file__).resolve().parent
        self.repo_var.set(str(current))
        self.refresh_status()

    def refresh_status(self, background: bool = False) -> None:
        def update() -> None:
            path = self.selected_path
            if not path.exists():
                self.status_var.set("状态：文件夹不存在")
                self.branch_var.set("分支：-")
                self.remote_var.set("远程：-")
                self.git_root_var.set("Git 管理目录：-")
                self.next_step_var.set("下一步：点“选择文件夹”，选一个已经存在的项目文件夹。")
                return

            root = repo_root(path)
            if root is None:
                self.status_var.set("状态：还不是 Git 项目")
                self.branch_var.set("分支：-")
                self.remote_var.set("远程：-")
                self.git_root_var.set("Git 管理目录：-")
                self.next_step_var.set("下一步：如果这是你要管理的项目，点“初始化为 Git 项目”。")
                self._log(f"当前文件夹：{path}\n还没有启用 Git。")
                return

            branch = try_git(root, ["branch", "--show-current"])
            if not branch:
                branch = try_git(root, ["rev-parse", "--short", "HEAD"]) or "还没有保存过版本"

            upstream = try_git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
            remote = upstream.strip() or "未连接上游分支"

            scope = selected_scope(root, path)
            short = run_git(root, with_scope(["status", "--porcelain=v1"], scope), check=False)
            changes = [line for line in short.splitlines() if line.strip()]
            if not changes:
                status = "状态：干净，没有未保存修改"
                if upstream.strip():
                    self.next_step_var.set("下一步：现在很干净。改完文件后，回来点“保存这次修改”。")
                else:
                    self.next_step_var.set("下一步：本地已干净；如果要上传到 GitHub/Gitee，先点“连接远程仓库”。")
            else:
                status = f"状态：有 {len(changes)} 个未保存变化"
                self.next_step_var.set("下一步：如果这些修改要保留，点“保存这次修改”；工具只会保存你选择的文件夹。")

            self.status_var.set(status)
            self.branch_var.set(f"分支：{branch}")
            self.remote_var.set(f"远程：{remote}")
            self.git_root_var.set(f"Git 管理目录：{root}")

            readable = run_git(root, with_scope(["status", "--short", "--branch"], scope), check=False)
            if path != root:
                location = f"你选择的文件夹：{path}\nGit 实际管理目录：{root}\n{scope_hint(root, path)}"
            else:
                location = f"当前文件夹：{root}"
            self._log(f"{location}\n{readable or '没有未保存修改'}")

        try:
            update()
            if not background:
                self._log("已刷新。")
        except GitError as exc:
            detail = friendly_git_error(exc.output)
            self._log(detail)
            if not background:
                messagebox.showerror("刷新失败", detail)
        except Exception as exc:  # pragma: no cover - GUI safety net
            if not background:
                messagebox.showerror("刷新失败", f"发生了意外错误：{exc}")

    def init_repo(self) -> None:
        path = self.selected_path
        if not path.exists():
            messagebox.showwarning("文件夹不存在", "请选择一个已经存在的项目文件夹。")
            return
        if repo_root(path) is not None:
            messagebox.showinfo("已经启用", "这个文件夹已经是 Git 项目了。")
            return
        if not messagebox.askyesno(
            "确认初始化",
            "要在这个文件夹里启用 Git 吗？这会新建一个隐藏的 .git 目录。",
        ):
            return

        def job() -> str:
            return run_git_anywhere(path, ["init"]) or "Git 项目已初始化。"

        self._worker("初始化 Git 项目", job)

    def commit_changes(self) -> None:
        repo = self._require_repo()
        if repo is None:
            return
        selected = self.selected_path
        scope = selected_scope(repo, selected)
        if not has_changes(repo, scope):
            messagebox.showinfo("无需保存", "当前没有未保存修改。")
            return
        preview_lines = scoped_status(repo, scope)
        risky_lines = risky_status_lines(preview_lines)
        if risky_lines:
            messagebox.showerror(
                "已拦截这次保存",
                "工具发现将要保存的内容里有运行缓存、依赖目录或数据库文件。\n\n"
                "这些通常不应该上传到 Git。\n\n"
                "可疑内容：\n"
                f"{format_status_preview(risky_lines)}\n\n"
                "建议：选择更具体的项目文件夹，或先配置 .gitignore。",
            )
            self._log("已拦截保存：检测到运行缓存、依赖目录或数据库文件。")
            return
        if not scope and len(preview_lines) > 50:
            messagebox.showerror(
                "变化太多，已拦截",
                "你当前选择的是整个 Git 项目，而且将要保存的文件超过 50 个。\n\n"
                "为了避免误保存其它项目，请改为选择具体子文件夹后再保存。",
            )
            self._log("已拦截保存：根目录变化太多，请选择具体子文件夹。")
            return
        if not scope:
            ok = messagebox.askyesno(
                "将保存整个 Git 项目",
                "你当前选择的是 Git 项目根目录，所以会保存整个项目里的修改。\n\n"
                "将要保存的内容：\n"
                f"{format_status_preview(preview_lines)}\n\n"
                "确认继续吗？",
            )
        else:
            ok = messagebox.askyesno(
                "确认保存范围",
                f"工具只会保存你选择的文件夹：\n{selected}\n\n"
                "将要保存的内容：\n"
                f"{format_status_preview(preview_lines)}\n\n"
                "确认继续吗？",
            )
        if not ok:
            self._log("已取消保存。")
            return
        message = simpledialog.askstring(
            "保存当前版本",
            "给这次保存起个简短名字，例如：更新首页文案",
        )
        if not message:
            return
        message = message.strip()
        if not message:
            return

        def job() -> str:
            added = run_git(repo, with_scope(["add", "-A"], scope))
            committed = run_git(repo, with_scope(["commit", "-m", message], scope))
            return join_outputs(scope_hint(repo, selected), added, committed)

        self._worker("保存当前版本", job)

    def pull_latest(self) -> None:
        repo = self._require_repo()
        if repo is None:
            return

        def job() -> str:
            return run_git(repo, ["pull", "--rebase", "--autostash"]) or "已经是最新。"

        self._worker("拉取最新修改", job)

    def push_changes(self) -> None:
        repo = self._require_repo()
        if repo is None:
            return

        def job() -> str:
            branch = try_git(repo, ["branch", "--show-current"])
            upstream = try_git(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
            if branch and not upstream.strip():
                return run_git(repo, ["push", "-u", "origin", branch])
            return run_git(repo, ["push"]) or "已经上传。"

        self._worker("上传我的版本", job)

    def sync_repo(self) -> None:
        repo = self._require_repo()
        if repo is None:
            return
        selected = self.selected_path
        scope = selected_scope(repo, selected)
        if has_changes(repo, scope):
            if not messagebox.askyesno(
                "还有未保存修改",
                "你选择的文件夹里还有未保存修改。建议先点“保存这次修改”。\n\n"
                "继续同步会先临时收起修改，再拉取远端内容。继续吗？",
            ):
                return

        def job() -> str:
            pulled = run_git(repo, ["pull", "--rebase", "--autostash"])
            branch = try_git(repo, ["branch", "--show-current"])
            upstream = try_git(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
            if branch and not upstream.strip():
                pushed = run_git(repo, ["push", "-u", "origin", branch])
            else:
                pushed = run_git(repo, ["push"])
            return join_outputs(pulled or "拉取完成。", pushed or "上传完成。")

        self._worker("一键同步", job)

    def create_branch(self) -> None:
        repo = self._require_repo()
        if repo is None:
            return
        branch = simpledialog.askstring(
            "创建新分支",
            "输入新分支名字，例如：feature-login 或 fix-typo",
        )
        if not branch:
            return
        branch = branch.strip()
        if not branch:
            return

        def job() -> str:
            return run_git(repo, ["switch", "-c", branch]) or f"已创建并切换到 {branch}。"

        self._worker("创建新分支", job)

    def switch_branch(self) -> None:
        repo = self._require_repo()
        if repo is None:
            return
        branches_output = run_git(repo, ["branch", "--format=%(refname:short)"], check=False)
        branches = [line.strip() for line in branches_output.splitlines() if line.strip()]
        if not branches:
            messagebox.showinfo("没有分支", "当前项目还没有可切换的分支。")
            return

        chooser = BranchChooser(self.root, branches)
        self.root.wait_window(chooser.window)
        selected = chooser.selected
        if not selected:
            return

        def job() -> str:
            return run_git(repo, ["switch", selected]) or f"已切换到 {selected}。"

        self._worker("切换分支", job)

    def set_remote(self) -> None:
        repo = self._require_repo()
        if repo is None:
            return
        url = simpledialog.askstring(
            "连接远程仓库",
            "粘贴 GitHub/Gitee 等平台给你的仓库地址：",
        )
        if not url:
            return
        url = url.strip()
        if not url:
            return

        def job() -> str:
            existing = try_git(repo, ["remote", "get-url", "origin"])
            if existing:
                run_git(repo, ["remote", "set-url", "origin", url])
                return f"已把 origin 地址更新为：{url}"
            run_git(repo, ["remote", "add", "origin", url])
            return f"已连接远程仓库：{url}"

        self._worker("连接远程仓库", job)

    def set_identity(self) -> None:
        repo = self._require_repo()
        if repo is None:
            return
        name_default = try_git(self.selected_path, ["config", "--global", "user.name"])
        email_default = try_git(self.selected_path, ["config", "--global", "user.email"])
        name = simpledialog.askstring(
            "设置名字",
            "输入你的名字。这个名字会出现在保存记录里：",
            initialvalue=name_default.strip(),
        )
        if not name:
            return
        email = simpledialog.askstring(
            "设置邮箱",
            "输入你的邮箱。建议和 GitHub/Gitee 账号邮箱一致：",
            initialvalue=email_default.strip(),
        )
        if not email:
            return
        name = name.strip()
        email = email.strip()
        if not name or not email:
            return
        use_global = messagebox.askyesno(
            "保存范围",
            "要把这个名字和邮箱设置为这台电脑的默认 Git 身份吗？\n\n选择“否”则只设置当前项目。",
        )

        def job() -> str:
            if use_global:
                base = ["config", "--global"]
                target = self.selected_path
                scope = "这台电脑的默认 Git 身份"
            else:
                if repo is None:
                    raise GitError(["git", "config"], "当前文件夹不是 Git 项目。")
                base = ["config"]
                target = repo
                scope = "当前项目的 Git 身份"
            run_git_anywhere(target, [*base, "user.name", name])
            run_git_anywhere(target, [*base, "user.email", email])
            return f"已设置{scope}：{name} <{email}>"

        self._worker("设置名字和邮箱", job)

    def show_history(self) -> None:
        repo = self._require_repo()
        if repo is None:
            return
        selected = self.selected_path
        scope = selected_scope(repo, selected)

        def job() -> str:
            history = try_git(
                repo,
                with_scope(["log", "--oneline", "--decorate", "--graph", "--date=short", "-20"], scope),
            )
            return history or "还没有保存过版本。"

        self._worker("查看最近历史", job)

    def backup_changes(self) -> None:
        repo = self._require_repo()
        if repo is None:
            return
        selected = self.selected_path
        scope = selected_scope(repo, selected)
        if not has_changes(repo, scope):
            messagebox.showinfo("无需备份", "当前没有未保存修改。")
            return

        def job() -> str:
            backup_dir = Path.home() / "Documents" / "GitEasyBackups" / f"{repo.name}-{now_stamp()}"
            backup_dir.mkdir(parents=True, exist_ok=True)

            if has_head(repo):
                diff = run_git(repo, with_scope(["diff", "HEAD", "--binary"], scope), check=False)
            else:
                diff = join_outputs(
                    run_git(repo, with_scope(["diff", "--cached", "--binary"], scope), check=False),
                    run_git(repo, with_scope(["diff", "--binary"], scope), check=False),
                )
            patch_path = backup_dir / "changes.patch"
            patch_path.write_text(diff, encoding="utf-8")

            untracked = run_git(
                repo,
                with_scope(["ls-files", "--others", "--exclude-standard"], scope),
                check=False,
            )
            files = [line.strip() for line in untracked.splitlines() if line.strip()]
            zip_path = backup_dir / "new-files.zip"
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for rel in files:
                    source = repo / rel
                    if source.is_file():
                        archive.write(source, rel)

            return f"备份已保存到：{backup_dir}"

        self._worker("备份未保存修改", job)

    def restore_tracked_changes(self) -> None:
        repo = self._require_repo()
        if repo is None:
            return
        selected = self.selected_path
        scope = selected_scope(repo, selected)
        if not has_changes(repo, scope):
            messagebox.showinfo("无需撤销", "当前没有未保存修改。")
            return
        if not messagebox.askyesno(
            "确认撤销",
            "这会撤销你选择文件夹里已经被 Git 管理的文件修改，但会保留新建文件。\n\n"
            "建议先点“备份修改”。继续吗？",
        ):
            return

        def job() -> str:
            target = scope or ["."]
            reset = run_git(repo, ["restore", "--staged", "--", *target], check=False)
            restore = run_git(repo, ["restore", "--", *target], check=False)
            return join_outputs(reset, restore) or "已撤销已管理文件的未保存修改；新建文件已保留。"

        self._worker("撤销已管理文件修改", job)


class BranchChooser:
    def __init__(self, parent: Tk, branches: list[str]) -> None:
        from tkinter import Toplevel

        self.selected: str | None = None
        self.window = Toplevel(parent)
        self.window.title("切换分支")
        self.window.geometry("360x320")
        self.window.transient(parent)
        self.window.grab_set()

        Label(self.window, text="选择要切换到的分支：", padx=10, pady=10).pack(fill=X)
        self.listbox = Listbox(self.window, height=10)
        self.listbox.pack(fill=BOTH, expand=True, padx=10)
        for branch in branches:
            self.listbox.insert(END, branch)
        self.listbox.selection_set(0)
        self.listbox.bind("<Double-Button-1>", lambda _event: self.choose())

        buttons = Frame(self.window, padx=10, pady=10)
        buttons.pack(fill=X)
        Button(buttons, text="取消", command=self.window.destroy).pack(side=RIGHT, padx=(6, 0))
        Button(buttons, text="切换", command=self.choose).pack(side=RIGHT)

    def choose(self) -> None:
        indexes = self.listbox.curselection()
        if indexes:
            self.selected = self.listbox.get(indexes[0])
        self.window.destroy()


def has_changes(repo: Path, scope: list[str] | None = None) -> bool:
    status = run_git(repo, with_scope(["status", "--porcelain=v1"], scope or []), check=False)
    return bool(status.strip())


def has_head(repo: Path) -> bool:
    return bool(try_git(repo, ["rev-parse", "--verify", "HEAD"]))


def join_outputs(*parts: str) -> str:
    return "\n".join(part.strip() for part in parts if part and part.strip())


def friendly_git_error(output: str) -> str:
    if not output:
        return "Git 没有返回详细错误。"
    lower = output.lower()
    hints: list[str] = []
    if "please tell me who you are" in lower or "user.email" in lower:
        hints.append("提示：你还没有设置 Git 的名字和邮箱。可以点击“设置名字和邮箱”后再保存版本。")
    if "no upstream branch" in lower or "has no upstream branch" in lower:
        hints.append("提示：当前分支还没有连接远程分支。先点“连接远程仓库”，再点“上传我的版本”。")
    if "does not appear to be a git repository" in lower or "could not read from remote repository" in lower:
        hints.append("提示：可能还没有连接远程仓库，或远程地址/权限不对。")
    if "not a git repository" in lower:
        hints.append("提示：这个文件夹还没有启用 Git。")
    if "conflict" in lower or "merge" in lower and "fix conflicts" in lower:
        hints.append("提示：远端和本地改到了同一处，需要人工选择保留哪一边。")
    if "repository not found" in lower or "authentication failed" in lower:
        hints.append("提示：远程地址或账号权限可能不对。")
    return join_outputs(output, *hints)


def main() -> None:
    root = Tk()
    GitEasyApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
