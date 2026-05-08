"""基于 web-access CDP Proxy 的浏览器操作客户端。

替代 Playwright 直连，通过 HTTP API 调用 localhost:3456 的 CDP Proxy。
Proxy 由 web-access skill 提供，自动发现 Chrome 端口、常驻后台运行。

源自 ~/Desktop/Trend-Scout/tools/cdp_client.py，本地副本供 NAS 部署使用。
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import httpx

PROXY_BASE = os.environ.get("CDP_PROXY_URL", "http://localhost:3456")
CHECK_DEPS_SCRIPT = Path.home() / ".claude" / "skills" / "web-access" / "scripts" / "check-deps.sh"

# 共享的 httpx 客户端（模块级，避免每次调用都新建连接）
_shared_client: httpx.AsyncClient | None = None
_client_lock = asyncio.Lock()


async def _get_client() -> httpx.AsyncClient:
    """获取或创建共享的 httpx 异步客户端。"""
    global _shared_client
    async with _client_lock:
        if _shared_client is None or _shared_client.is_closed:
            _shared_client = httpx.AsyncClient(base_url=PROXY_BASE, timeout=60.0)
    return _shared_client


async def close_shared_client():
    """关闭共享的 httpx 客户端。"""
    global _shared_client
    if _shared_client and not _shared_client.is_closed:
        await _shared_client.aclose()
        _shared_client = None


class CdpPage:
    """封装一个 CDP Proxy tab 的操作接口。

    每个实例对应一个浏览器 tab（由 target_id 标识）。
    所有操作通过 HTTP 调用 CDP Proxy 完成。
    """

    def __init__(self, target_id: str):
        self.target_id = target_id

    # ── 静态方法：Proxy 管理 ──

    @staticmethod
    async def ensure_proxy():
        """确保 CDP Proxy 已启动且可用。

        调用 web-access 的 check-deps.sh 脚本，该脚本会：
        1. 检查 Node.js 版本
        2. 检查 Chrome 远程调试端口
        3. 启动 CDP Proxy（如果未运行）
        """
        if not CHECK_DEPS_SCRIPT.exists():
            raise RuntimeError(
                f"web-access skill 未安装，找不到 {CHECK_DEPS_SCRIPT}\n"
                "请先安装：git clone https://github.com/eze-is/web-access ~/.claude/skills/web-access"
            )
        proc = await asyncio.create_subprocess_exec(
            "bash", str(CHECK_DEPS_SCRIPT),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            output = (stdout or b"").decode() + (stderr or b"").decode()
            raise RuntimeError(f"CDP Proxy 启动失败：\n{output}")

    @staticmethod
    async def list_targets() -> list[dict]:
        """列出浏览器中所有打开的页面 tab。"""
        client = await _get_client()
        resp = await client.get("/targets")
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    async def new_tab(url: str = "about:blank") -> "CdpPage":
        """创建新的后台 tab 并等待页面加载。"""
        client = await _get_client()
        resp = await client.get("/new", params={"url": url})
        resp.raise_for_status()
        data = resp.json()
        return CdpPage(data["targetId"])

    # ── 实例方法：页面操作 ──

    async def eval(self, expression: str):
        """在当前 tab 中执行 JavaScript 并返回结果。"""
        client = await _get_client()
        resp = await client.post(
            "/eval",
            params={"target": self.target_id},
            content=expression,
        )
        data = resp.json()
        if resp.status_code >= 400 or "error" in data:
            raise RuntimeError(data.get("error", f"eval 失败: HTTP {resp.status_code}"))
        return data.get("value")

    async def goto(self, url: str):
        """导航到指定 URL，自动等待页面加载完成。"""
        client = await _get_client()
        resp = await client.get(
            "/navigate",
            params={"target": self.target_id, "url": url},
        )
        resp.raise_for_status()
        return resp.json()

    async def reload(self):
        """刷新当前页面，等待加载完成。"""
        client = await _get_client()
        try:
            await client.post(
                "/eval",
                params={"target": self.target_id},
                content="location.reload()",
                timeout=5.0,
            )
        except (httpx.ReadTimeout, httpx.RemoteProtocolError):
            pass
        await asyncio.sleep(1.5)
        for _ in range(20):
            try:
                info = await self.info()
                if info.get("ready") == "complete":
                    return
            except Exception:
                pass
            await asyncio.sleep(0.5)
        print("[CdpPage] 警告：reload 等待超时，页面可能未完全加载")

    async def click(self, selector: str) -> dict:
        """通过 JS 点击元素。"""
        client = await _get_client()
        resp = await client.post(
            "/click",
            params={"target": self.target_id},
            content=selector,
        )
        data = resp.json()
        if resp.status_code >= 400 or "error" in data:
            raise RuntimeError(data.get("error", f"click 失败: {selector}"))
        return data

    async def click_at(self, selector: str) -> dict:
        """通过 CDP 真实鼠标事件点击元素。"""
        client = await _get_client()
        resp = await client.post(
            "/clickAt",
            params={"target": self.target_id},
            content=selector,
        )
        data = resp.json()
        if resp.status_code >= 400 or "error" in data:
            raise RuntimeError(data.get("error", f"clickAt 失败: {selector}"))
        return data

    async def scroll(self, y: int = 3000, direction: str | None = None):
        """滚动页面。"""
        params = {"target": self.target_id}
        if direction:
            params["direction"] = direction
        else:
            params["y"] = str(y)
        client = await _get_client()
        resp = await client.get("/scroll", params=params)
        resp.raise_for_status()
        return resp.json()

    async def screenshot(self, file: str) -> dict:
        """截取当前页面截图并保存到文件。"""
        client = await _get_client()
        resp = await client.get(
            "/screenshot",
            params={"target": self.target_id, "file": file},
        )
        resp.raise_for_status()
        return resp.json()

    async def info(self) -> dict:
        """获取当前页面信息（title, url, ready）。"""
        client = await _get_client()
        resp = await client.get(
            "/info",
            params={"target": self.target_id},
        )
        resp.raise_for_status()
        return resp.json()

    async def title(self) -> str:
        data = await self.info()
        return data.get("title", "")

    async def url(self) -> str:
        data = await self.info()
        return data.get("url", "")

    async def dispatch_key(self, key: str):
        """模拟键盘按键。"""
        safe_key = json.dumps(key)
        await self.eval(f"""(() => {{
            const evt = new KeyboardEvent('keydown', {{
                key: {safe_key}, code: {safe_key}, bubbles: true, cancelable: true
            }});
            document.dispatchEvent(evt);
        }})()""")

    async def close(self):
        """关闭当前 tab。"""
        client = await _get_client()
        resp = await client.get("/close", params={"target": self.target_id})
        resp.raise_for_status()

    async def disconnect(self):
        """关闭当前 tab 并释放 HTTP 客户端资源。"""
        try:
            await self.close()
        except Exception:
            pass
        await close_shared_client()
