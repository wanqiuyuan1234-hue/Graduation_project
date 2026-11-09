"""模块视图的派生逻辑（纯函数，便于单测与复用）。

这里集中实现 v2 文档里的 C 档规则：
- summary  ← chunk.signature 清洗/截断
- tags     ← 路径段 + extends/implements + 注解白名单 + 类型
- complexity ← 行数 + 分支关键字计数（非严格 McCabe）
- parameters ← signature 括号内按顶层逗号解析
- ast_path ← parent_chunk_id 链
- token_count ← content 字符数估算
"""

from __future__ import annotations

import math
import os
import re
from typing import Iterable

MAX_SUMMARY_LEN = 120

CHUNK_TYPE_TO_MODULE_TYPE = {
    "class": "class",
    "interface": "interface",
    "enum": "enum",
    "method": "function",
    "constructor": "function",
}

# 只保留有示意价值的注解，避免卡片标签被 @Override 之类噪声占满
ANNOTATION_WHITELIST = ("Deprecated", "FunctionalInterface", "SerializedName")

_BRANCH_RE = re.compile(r"\b(if|for|while|switch|catch)\b")
_INHERIT_RE = re.compile(r"\b(?:extends|implements)\s+([\w.]+)")


def map_module_type(chunk_type: str) -> str:
    """切片类型 → 前端 ModuleType。"""
    return CHUNK_TYPE_TO_MODULE_TYPE.get(chunk_type, "function")


def build_summary(
    signature: str | None,
    chunk_type: str,
    name: str | None,
    start_line: int,
    end_line: int,
) -> str:
    """用 signature 生成声明式摘要（不是语义摘要）。

    规则：剔除 `@` 开头的注解行 → 折叠空白 → 去掉行尾 `{` → 超长在空格处截断。
    signature 为空（fixed 切片）时按行号兜底。
    """
    if not signature:
        if chunk_type == "fixed":
            return f"固定窗口：第 {start_line}-{end_line} 行"
        return f"{name}（无签名）" if name else chunk_type

    lines = [ln for ln in signature.splitlines() if not ln.strip().startswith("@")]
    s = " ".join(" ".join(lines).split()).rstrip("{").strip()
    if len(s) > MAX_SUMMARY_LEN:
        cut = s[:MAX_SUMMARY_LEN].rsplit(" ", 1)[0]
        s = (cut if cut else s[:MAX_SUMMARY_LEN]) + "…"
    return s or f"{chunk_type} {name or ''}".strip()


def derive_tags(
    file_path: str,
    signature: str | None,
    chunk_type: str,
    max_tags: int = 4,
) -> list[str]:
    """结构化标签：路径末两段 + 继承类型 + 白名单注解 + 类型。"""
    tags: list[str] = []

    normalized = file_path.replace("\\", "/")
    dirs = [seg for seg in normalized.split("/")[:-1] if seg]
    # 取最后 1–2 段目录作为业务域线索（如 internal / bind）
    for seg in dirs[-2:]:
        if seg not in tags:
            tags.append(seg)

    if signature:
        m = _INHERIT_RE.search(signature)
        if m:
            inherited = m.group(1).split(".")[-1]
            if inherited and inherited not in tags:
                tags.append(inherited)

        for ann in ANNOTATION_WHITELIST:
            if f"@{ann}" in signature and f"@{ann}" not in tags:
                tags.append(f"@{ann}")

    module_type = map_module_type(chunk_type)
    if module_type not in tags:
        tags.append(module_type)

    return tags[:max_tags]


def estimate_complexity(content: str, line_count: int) -> str:
    """复杂度分级：分支关键字数 + 每 50 行折算 1。

    不是严格圈复杂度（不含 &&/||/?: 与嵌套深度），论文中需注明公式。
    """
    branch_count = len(_BRANCH_RE.findall(content))
    score = branch_count + math.ceil(line_count / 50)
    if score <= 5:
        return "low"
    if score <= 15:
        return "medium"
    return "high"


def estimate_token_count(content: str | None) -> int:
    """字符数估算 token（一期），二期改用 tokenizer 精确计数。"""
    if not content:
        return 0
    return max(1, round(len(content) / 4.0))


def parse_params(signature: str | None) -> list[dict]:
    """从 signature 解析参数名与类型；Java 无默认值，必填恒为 True。"""
    if not signature or "(" not in signature:
        return []

    start = signature.index("(")
    depth = 0
    end: int | None = None
    for i in range(start, len(signature)):
        ch = signature[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end is None:
        return []

    raw = signature[start + 1 : end]
    parts: list[str] = []
    depth = 0
    buf = ""
    for ch in raw:
        if ch in "<([":
            depth += 1
        elif ch in ">)]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(buf)
            buf = ""
        else:
            buf += ch
    if buf.strip():
        parts.append(buf)

    out: list[dict] = []
    for part in parts:
        cleaned = re.sub(r"@\w+(\([^)]*\))?", "", part)
        cleaned = re.sub(r"\bfinal\b", "", cleaned)
        tokens = cleaned.strip().split()
        if len(tokens) < 2:
            continue
        out.append(
            {
                "name": tokens[-1].replace("...", "").replace("[]", ""),
                "type": " ".join(tokens[:-1]),
                "required": True,
                "description": "",
                "default": None,
            }
        )
    return out


def build_ast_path(file_path: str, names: Iterable[str]) -> str:
    """文件名 > 外层类型 > ... > 当前类型。"""
    basename = os.path.basename(file_path)
    chain = [basename] + [n for n in names if n]
    return " > ".join(chain)


def read_git_branch(clone_dir: str | None) -> str | None:
    """从 clone_dir/.git/HEAD 读取分支名；detached 时返回短 hash；读不到返回 None。"""
    if not clone_dir:
        return None
    head = os.path.join(clone_dir, ".git", "HEAD")
    try:
        with open(head, "r", encoding="utf-8") as f:
            content = f.read().strip()
    except OSError:
        return None
    if content.startswith("ref:"):
        return content.rsplit("/", 1)[-1].strip() or None
    return content[:8] or None
