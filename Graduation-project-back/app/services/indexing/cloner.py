"""仓库克隆：目标目录已存在则跳过，失败抛错终止。"""

from __future__ import annotations

import subprocess
from pathlib import Path


def clone_repo(repo_url: str, target_dir: str) -> str:
    """克隆仓库到本地目录，返回目录路径。

    已存在时跳过克隆（单版本不更新），失败时抛 RuntimeError 终止建库。
    """
    target = Path(target_dir)
    if target.exists():
        print(f"仓库已存在，跳过克隆: {target}")
        return str(target)

    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"开始克隆 {repo_url} -> {target}")
    try:
        subprocess.run(
            ["git", "clone", "--depth", "1", repo_url, str(target)],
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"克隆仓库失败: {repo_url}") from exc

    print(f"克隆完成: {target}")
    return str(target)
