#!/usr/bin/env python3
"""
通过 CDP 自动从电商平台商家后台导出报表数据，直接落入对应 raw/*/inbox/。

前置条件：
  - Chrome 运行中，已登录各平台商家后台
  - CDP Proxy 运行中 (localhost:3456，由 web-access skill 提供)
  - 各平台的 api_url 已通过 DevTools Network 确认并填入 EXPORTS 配置

用法：
  python3 export_platform_data.py              # 导出所有 enabled 平台
  python3 export_platform_data.py xhs          # 只导 group=xhs 的任务
  python3 export_platform_data.py qianfan juguang  # 多个 group
  python3 export_platform_data.py --list       # 列出所有任务及状态
  python3 export_platform_data.py --dry-run    # 检查 CDP 连接，不实际导出

原理（与 ~/Documents/我的语料库/tools/dashboard/export_creator_data.py 相同）：
  复用 Chrome 中已登录的商家后台 tab，通过 JS eval 在 tab 内调用 fetch()，
  利用已有 session cookie 调用数据导出 API，把响应 blob 转 base64 传回 Python，
  保存为文件并路由到对应 raw/*/inbox/ 目录，供现有 pipeline 处理。

─────────────────────────────────────────────────────────────────────
如何填入 api_url（一次性操作，每个报表做一次）：
  1. 在 Chrome 中打开对应平台商家后台，登录
  2. 手动点击"导出/下载"按钮
  3. DevTools → Network → 找到触发下载的请求
  4. 右键该请求 → Copy → Copy as fetch
  5. 从复制内容中提取：
     - URL 的路径部分（不含 domain）→ 填入 api_url
     - method → 填入 method
     - body（如有）→ 填入 body（dict 格式）
  6. 将 enabled 改为 True
─────────────────────────────────────────────────────────────────────

日期占位符（params 和 body 中可用）：
  {today}      → YYYYMMDD（今天）
  {start_date} → YYYYMMDD（今天 - days_back 天）
  {today_dash} → YYYY-MM-DD
  {start_dash} → YYYY-MM-DD（带连字符版）
"""

import asyncio
import base64
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

from cdp_client import CdpPage

# ── 路径 ──
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_OS = SCRIPT_DIR.parent.parent
RAW = DATA_OS / "raw"

# ─────────────────────────────────────────────────────────────────────
# 导出任务配置
# 每条对应一个 API 下载请求。
# 填好 api_url 后将 enabled 改为 True 即可启用。
# ─────────────────────────────────────────────────────────────────────
EXPORTS = [
    # ══════════════════════════════════════════
    # 小红书商家后台
    # 需要 Carl 提供：tab_match（后台域名）、fallback_url、api_url
    # ══════════════════════════════════════════
    {
        "key": "xhs_shangjia",
        "group": "xhs",
        "name": "XHS 商家成交数据概览",
        "tab_match": None,       # TODO: 填入商家后台的域名，如 "xxx.xiaohongshu.com"
        "fallback_url": None,    # TODO: 填入商家后台完整 URL
        "api_url": None,         # TODO: DevTools Network 捕获导出请求后填入路径
        "method": "GET",
        "params": {},
        "body": None,
        "filename": "商家成交数据概览-all.xlsx",
        "dest_inbox": "store_xiaoting",
        "days_back": 30,
        "enabled": False,
    },
    {
        "key": "xhs_notes",
        "group": "xhs",
        "name": "XHS 商品笔记数据",
        "tab_match": None,       # TODO
        "fallback_url": None,    # TODO
        "api_url": None,         # TODO
        "method": "GET",
        "params": {},
        "body": None,
        "filename": "商品笔记数据-{today_dash}.xlsx",
        "dest_inbox": "content_notes",
        "days_back": 7,
        "enabled": False,
    },
    # ══════════════════════════════════════════
    # 千帆投放平台
    # 需要 Carl 提供：tab_match、fallback_url、api_url
    # ══════════════════════════════════════════
    {
        "key": "xhs_qianfan_std",
        "group": "qianfan",
        "name": "千帆标准投放数据",
        "tab_match": None,       # TODO
        "fallback_url": None,    # TODO
        "api_url": None,         # TODO
        "method": "GET",
        "params": {
            "start_date": "{start_date}",
            "end_date": "{today}",
        },
        "body": None,
        "filename": "千帆标准投放数据-{today_dash}.csv",
        "dest_inbox": "store_xiaoting",
        "days_back": 30,
        "enabled": False,
    },
    {
        "key": "xhs_qianfan_simple",
        "group": "qianfan",
        "name": "千帆简单投放数据",
        "tab_match": None,       # TODO
        "fallback_url": None,    # TODO
        "api_url": None,         # TODO
        "method": "GET",
        "params": {
            "start_date": "{start_date}",
            "end_date": "{today}",
        },
        "body": None,
        "filename": "千帆简单投放数据-{today_dash}.csv",
        "dest_inbox": "store_xiaoting",
        "days_back": 30,
        "enabled": False,
    },
    # ══════════════════════════════════════════
    # 聚光投放平台
    # 需要 Carl 提供：tab_match、fallback_url、api_url
    # ══════════════════════════════════════════
    {
        "key": "xhs_juguang_std",
        "group": "juguang",
        "name": "聚光标准投放数据",
        "tab_match": None,       # TODO
        "fallback_url": None,    # TODO
        "api_url": None,         # TODO
        "method": "GET",
        "params": {
            "start_date": "{start_date}",
            "end_date": "{today}",
        },
        "body": None,
        "filename": "聚光标准投放数据-{today_dash}.csv",
        "dest_inbox": "store_xiaoting",
        "days_back": 30,
        "enabled": False,
    },
    {
        "key": "xhs_juguang_simple",
        "group": "juguang",
        "name": "聚光简单投放数据",
        "tab_match": None,       # TODO
        "fallback_url": None,    # TODO
        "api_url": None,         # TODO
        "method": "GET",
        "params": {
            "start_date": "{start_date}",
            "end_date": "{today}",
        },
        "body": None,
        "filename": "聚光简单投放数据-{today_dash}.csv",
        "dest_inbox": "store_xiaoting",
        "days_back": 30,
        "enabled": False,
    },
    {
        "key": "xhs_juguang_note",
        "group": "juguang",
        "name": "聚光笔记维度数据",
        "tab_match": None,       # TODO
        "fallback_url": None,    # TODO
        "api_url": None,         # TODO
        "method": "GET",
        "params": {},
        "body": None,
        "filename": "聚光笔记维度数据-{today_dash}.csv",
        "dest_inbox": "store_xiaoting",
        "days_back": 30,
        "enabled": False,
    },
    # ══════════════════════════════════════════
    # 天猫商家后台
    # 需要 Carl 提供：tab_match、fallback_url、api_url
    # ══════════════════════════════════════════
    {
        "key": "tmall_store",
        "group": "tmall",
        "name": "天猫店铺数据报表",
        "tab_match": None,       # TODO
        "fallback_url": None,    # TODO
        "api_url": None,         # TODO
        "method": "GET",
        "params": {},
        "body": None,
        "filename": "天猫店铺报表-{today_dash}.xlsx",
        "dest_inbox": "tmall",
        "days_back": 30,
        "enabled": False,
    },
    # ══════════════════════════════════════════
    # 抖音商家后台
    # 需要 Carl 提供：tab_match、fallback_url、api_url
    # ══════════════════════════════════════════
    {
        "key": "douyin_store",
        "group": "douyin",
        "name": "抖音店铺数据报表",
        "tab_match": None,       # TODO
        "fallback_url": None,    # TODO
        "api_url": None,         # TODO
        "method": "GET",
        "params": {},
        "body": None,
        "filename": "抖音店铺报表-{today_dash}.xlsx",
        "dest_inbox": "douyin",
        "days_back": 30,
        "enabled": False,
    },
]


# ─────────────────────────────────────────────────────────────────────
# 内部工具函数
# ─────────────────────────────────────────────────────────────────────

def _inject_dates(obj, days_back: int):
    """将 {today} / {start_date} 等占位符替换为实际日期字符串。"""
    today = datetime.now()
    start = today - timedelta(days=days_back)
    replacements = {
        "{today}":      today.strftime("%Y%m%d"),
        "{start_date}": start.strftime("%Y%m%d"),
        "{today_dash}": today.strftime("%Y-%m-%d"),
        "{start_dash}": start.strftime("%Y-%m-%d"),
    }
    if isinstance(obj, str):
        for k, v in replacements.items():
            obj = obj.replace(k, v)
        return obj
    if isinstance(obj, dict):
        return {k: _inject_dates(v, days_back) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_inject_dates(v, days_back) for v in obj]
    return obj


async def _find_tab(task: dict) -> tuple["CdpPage | None", bool]:
    """查找已登录的 tab；找不到则新开一个。返回 (page, is_new_tab)。"""
    if not task.get("tab_match") or not task.get("fallback_url"):
        return None, False

    targets = await CdpPage.list_targets()
    for t in targets:
        if task["tab_match"] in t.get("url", ""):
            return CdpPage(t["targetId"]), False

    page = await CdpPage.new_tab(task["fallback_url"])
    await asyncio.sleep(4)
    info = await page.info()
    if "login" in info.get("url", "") or "passport" in info.get("url", ""):
        await page.close()
        return None, False
    return page, True


async def _export_one(task: dict, dry_run: bool = False) -> Path | None:
    """执行单个导出任务，返回保存的文件路径，失败返回 None。"""
    name = task["name"]

    missing = [f for f in ("tab_match", "fallback_url", "api_url") if not task.get(f)]
    if missing:
        print(f"  [{name}] 跳过（待 Carl 填写：{', '.join(missing)}）")
        return None

    if not task.get("enabled"):
        print(f"  [{name}] 跳过（enabled=False）")
        return None

    days_back = task.get("days_back", 30)

    # 注入日期占位符
    api_url = _inject_dates(task["api_url"], days_back)
    params  = _inject_dates(task.get("params") or {}, days_back)
    body    = _inject_dates(task.get("body"), days_back)
    filename = _inject_dates(task["filename"], days_back)

    # 拼装 query string
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        api_url = f"{api_url}{'&' if '?' in api_url else '?'}{qs}"

    method = task.get("method", "GET").upper()

    print(f"  [{name}] 查找 tab ({task['tab_match']})...")

    if dry_run:
        print(f"  [{name}] dry-run，跳过实际导出")
        return None

    page, is_new_tab = await _find_tab(task)
    if not page:
        print(f"  [{name}] ✗ 未找到已登录的 tab，请先在 Chrome 中登录 {task['fallback_url']}")
        return None

    info = await page.info()
    print(f"  [{name}] 页面: {info.get('title', '?')[:40]}")

    # 确保在正确域名
    if task["tab_match"] not in info.get("url", ""):
        await page.goto(task["fallback_url"])
        await asyncio.sleep(3)

    # 构造 fetch body JS 字符串
    body_js = "undefined"
    if body is not None:
        body_js = f"JSON.stringify({json.dumps(body, ensure_ascii=False)})"

    print(f"  [{name}] 调用导出 API ({method} {api_url[:60]}...)...")

    try:
        b64 = await page.eval(f"""
            (async () => {{
                const opts = {{
                    method: '{method}',
                    credentials: 'include'
                }};
                const bodyStr = {body_js};
                if (bodyStr !== undefined) {{
                    opts.headers = {{'Content-Type': 'application/json'}};
                    opts.body = bodyStr;
                }}
                const resp = await fetch('{api_url}', opts);
                if (!resp.ok) return null;
                const blob = await resp.blob();
                const buf = await blob.arrayBuffer();
                const bytes = new Uint8Array(buf);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) {{
                    binary += String.fromCharCode(bytes[i]);
                }}
                return btoa(binary);
            }})()
        """)
    except Exception as e:
        print(f"  [{name}] ✗ JS eval 失败: {e}")
        if is_new_tab:
            await page.close()
        return None

    if is_new_tab:
        await page.close()

    if not b64:
        print(f"  [{name}] ✗ API 返回空或非 2xx")
        return None

    # 解码并落盘到 inbox
    data = base64.b64decode(b64)
    dest_dir = RAW / task["dest_inbox"] / "inbox"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_file = dest_dir / filename
    dest_file.write_bytes(data)
    print(f"  [{name}] ✓ {len(data):,} bytes → {dest_file.relative_to(DATA_OS)}")
    return dest_file


# ─────────────────────────────────────────────────────────────────────
# 公开入口
# ─────────────────────────────────────────────────────────────────────

async def export_groups(groups: list[str] | None, dry_run: bool = False) -> dict[str, Path | None]:
    """导出指定 group 的所有任务（None 表示全部）。"""
    print("\n[1/2] 确保 CDP Proxy 可用...")
    if not dry_run:
        await CdpPage.ensure_proxy()
    else:
        print("  dry-run 模式，跳过 CDP Proxy 检查")

    tasks = EXPORTS if groups is None else [t for t in EXPORTS if t["group"] in groups]
    print(f"\n[2/2] 执行 {len(tasks)} 个导出任务...")

    results: dict[str, Path | None] = {}
    for task in tasks:
        result = await _export_one(task, dry_run=dry_run)
        results[task["key"]] = result

    return results


def main() -> int:
    args = sys.argv[1:]

    # --list
    if "--list" in args:
        print(f"{'KEY':<25} {'GROUP':<12} {'状态':<8} 名称")
        print("-" * 70)
        for t in EXPORTS:
            status = "✓ 启用" if t.get("enabled") else "○ 待配置"
            print(f"{t['key']:<25} {t['group']:<12} {status:<8} {t['name']}")
        return 0

    dry_run = "--dry-run" in args
    args = [a for a in args if not a.startswith("--")]

    # 过滤出有效的 group 名
    valid_groups = {t["group"] for t in EXPORTS}
    groups = [a for a in args if a in valid_groups] or None
    if args and groups is None:
        unknown = [a for a in args if a not in valid_groups]
        print(f"未知 group：{unknown}。可用：{sorted(valid_groups)}")
        return 1

    results = asyncio.run(export_groups(groups, dry_run=dry_run))

    ok    = sum(1 for v in results.values() if v is not None)
    skipped = sum(1 for t in EXPORTS if not t.get("enabled"))
    total = len(results)

    print(f"\n导出完成: {ok}/{total} 成功（{skipped} 个任务尚未配置 api_url）")
    return 0 if ok == total else 1


if __name__ == "__main__":
    sys.exit(main())
