"""Java 文件遍历与 AST 层级切分 + fixed 固定切分基线。

层级规则：class / interface / enum 各成一个类型级切片；其下 method / constructor
各成成员级切片，通过 parent_temp_key 关联父类型（入库时映射为真实 parent_chunk_id）。

enhanced_text：向量化输入 = 语义前缀（[类型: 所属类] 签名） + 原文，提升检索语义。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import tree_sitter_java
from tree_sitter import Language, Parser

_LANGUAGE = Language(tree_sitter_java.language())
_PARSER = Parser(_LANGUAGE)

TYPE_NODE_TYPES = {
    "class_declaration": "class",
    "interface_declaration": "interface",
    "enum_declaration": "enum",
}
MEMBER_NODE_TYPES = {
    "method_declaration": "method",
    "constructor_declaration": "constructor",
}

# fixed 基线窗口参数：每片 40 行，相邻重叠 10 行
WINDOW_LINES = 40
OVERLAP_LINES = 10


@dataclass
class ChunkData:
    """单个切片的中间表示（入库前）。"""

    chunk_type: str
    name: str | None
    signature: str | None
    content: str
    start_line: int
    end_line: int
    strategy: str
    parent_temp_key: str | None
    chunk_index: int
    owner_name: str | None = None  # 方法/构造器的所属类名，用于增强文本
    temp_key: str | None = None    # 类型切片自身的临时键，供入库时映射子切片的父 id

    @property
    def enriched_text(self) -> str:
        """拼接语义前缀后的向量化输入文本。"""
        if self.chunk_type == "fixed":
            prefix = f"[fixed: {self.start_line}-{self.end_line}]"
        else:
            owner = self.owner_name or self.name or ""
            label = f"[{self.chunk_type}: {owner}]" if owner else f"[{self.chunk_type}]"
            prefix = f"{label} {self.signature}".strip() if self.signature else label
        return f"{prefix}\n{self.content}"


def walk_paths(root_dir: str, suffix: str = ".java") -> list[str]:
    """递归查找指定后缀的文件，返回排序后的路径列表。"""
    root = Path(root_dir)
    return sorted(str(p) for p in root.rglob(f"*{suffix}"))


def _node_text(source: bytes, node) -> str:
    return source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _name_of(source: bytes, node) -> str | None:
    name_node = node.child_by_field_name("name")
    return _node_text(source, name_node) if name_node is not None else None


def _signature_of(source: bytes, node) -> str:
    """取方法体/类体之前的头部文本，即修饰符 + 返回类型 + 名称 + 参数。"""
    body = node.child_by_field_name("body")
    head_end = body.start_byte if body is not None else node.end_byte
    return source[node.start_byte : head_end].decode("utf-8", errors="replace").strip()


def split_fixed(source: str) -> list[ChunkData]:
    """按固定行窗口切分，作为 AST 切分的对照组基线。"""
    lines = source.splitlines()
    chunks: list[ChunkData] = []
    if not lines:
        return chunks

    step = WINDOW_LINES - OVERLAP_LINES
    start = 0
    idx = 0
    while start < len(lines):
        end = min(start + WINDOW_LINES, len(lines))
        chunks.append(
            ChunkData(
                chunk_type="fixed",
                name=None,
                signature=None,
                content="\n".join(lines[start:end]),
                start_line=start + 1,
                end_line=end,
                strategy="fixed",
                parent_temp_key=None,
                chunk_index=idx,
                owner_name=None,
            )
        )
        idx += 1
        if end >= len(lines):
            break
        start += step
    return chunks


def chunk_java_file(
    path: str, source: str
) -> tuple[list[ChunkData], list[ChunkData], bool]:
    """解析单个 Java 文件，返回 (ast_chunks, fixed_chunks, parse_ok)。

    解析失败时 ast_chunks 为空、parse_ok=False，fixed_chunks 仍作为兜底产出。
    """
    fixed_chunks = split_fixed(source)
    source_bytes = source.encode("utf-8")

    try:
        tree = _PARSER.parse(source_bytes)
    except Exception:
        return [], fixed_chunks, False

    root = tree.root_node
    if root.has_error:
        return [], fixed_chunks, False

    ast_chunks: list[ChunkData] = []
    counter = {"idx": 0, "temp": 0}

    def add(
        node,
        chunk_type: str,
        parent_temp_key: str | None,
        owner_name: str | None,
        temp_key: str | None = None,
    ) -> None:
        ast_chunks.append(
            ChunkData(
                chunk_type=chunk_type,
                name=_name_of(source_bytes, node),
                signature=_signature_of(source_bytes, node),
                content=_node_text(source_bytes, node),
                start_line=node.start_point[0] + 1,
                end_line=node.end_point[0] + 1,
                strategy="ast",
                parent_temp_key=parent_temp_key,
                chunk_index=counter["idx"],
                owner_name=owner_name,
                temp_key=temp_key,
            )
        )
        counter["idx"] += 1

    def visit(node, parent_temp_key: str | None, enclosing_type_name: str | None) -> None:
        if node.type in TYPE_NODE_TYPES:
            temp_key = f"temp-{counter['temp']}"
            counter["temp"] += 1
            name = _name_of(source_bytes, node)
            add(node, TYPE_NODE_TYPES[node.type], parent_temp_key, owner_name=name, temp_key=temp_key)
            for child in node.children:
                visit(child, temp_key, name)
        elif node.type in MEMBER_NODE_TYPES:
            add(node, MEMBER_NODE_TYPES[node.type], parent_temp_key, owner_name=enclosing_type_name)
            # 不递归成员内部，避免把局部类/匿名类误当切片
        else:
            for child in node.children:
                visit(child, parent_temp_key, enclosing_type_name)

    for child in root.children:
        visit(child, None, None)

    return ast_chunks, fixed_chunks, True
