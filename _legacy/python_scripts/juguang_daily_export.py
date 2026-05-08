#!/usr/bin/env python3
"""
juguang_daily_export.py — 每日自动下载聚光投放数据（标准投笔记报表 + 简单投笔记报表）

流程：
  1. CDP 连接 Chrome → 打开聚光后台
  2. 标准投笔记报表：日期选昨天 → 滚动到数据明细 → 下载
  3. 简单投笔记报表：日期选昨天 → 滚动到数据明细 → 下载
  4. CSV 按日期重命名存入 Data OS/raw/juguang_*/inbox/

前置条件：
  - Chrome 运行中，已登录 ad.xiaohongshu.com
  - CDP Proxy 运行中 (localhost:3456)

用法：
  python juguang_daily_export.py                # 正常执行
  python juguang_daily_export.py --dry-run      # 只截图不下载
  python juguang_daily_export.py --standard     # 只下载标准投
  python juguang_daily_export.py --simple       # 只下载简单投
"""

import asyncio
import argparse
import logging
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path

from cdp_client import CdpPage

# ── 路径 ──
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_OS = SCRIPT_DIR.parent.parent
LOG_DIR = DATA_OS / "logs" / "juguang"
DOWNLOAD_DIR = Path.home() / "Downloads"

RAW_STANDARD = DATA_OS / "raw" / "juguang_standard" / "inbox"
RAW_SIMPLE = DATA_OS / "raw" / "juguang_simple" / "inbox"

# ── 聚光 URL ──
JG_STANDARD_URL = "https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note"
JG_SIMPLE_URL = "https://ad.xiaohongshu.com/aurora/ad/datareports-createsimple/note"


def setup_logging() -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / f"run-{datetime.now().strftime('%Y-%m-%d')}.log"
    logger = logging.getLogger("juguang")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%H:%M:%S")
    for h in [logging.FileHandler(log_file, encoding="utf-8"), logging.StreamHandler()]:
        h.setFormatter(fmt)
        logger.addHandler(h)
    return logger


async def _wait_for_chrome(log: logging.Logger, max_wait: int = 600) -> bool:
    import time
    start = time.time()
    while time.time() - start < max_wait:
        try:
            await CdpPage.ensure_proxy()
            targets = await CdpPage.list_targets()
            if targets:
                return True
        except Exception:
            pass
        wait = 30
        remaining = int(max_wait - (time.time() - start))
        if remaining <= 0:
            break
        log.info("Chrome/CDP 未就绪，%d秒后重试（剩余%d秒）...", wait, remaining)
        await asyncio.sleep(wait)
    return False


async def _navigate_to_jg(page: "CdpPage", url: str, log: logging.Logger) -> bool:
    """导航到聚光页面，检查登录状态。"""
    await page.goto(url)
    await asyncio.sleep(5)

    for i in range(10):
        info = await page.info()
        if "login" not in info.get("url", "") and "passport" not in info.get("url", ""):
            return True
        if i == 0:
            log.info("聚光需要登录，等待 session 恢复...")
        await asyncio.sleep(30)

    log.error("聚光未登录，5分钟内未恢复 session")
    return False


async def _select_date_yesterday(page: "CdpPage", log: logging.Logger) -> bool:
    """点开聚光的日期选择器，选昨天。"""
    yesterday = datetime.now() - timedelta(days=1)
    yesterday_day = str(yesterday.day)
    yesterday_str = yesterday.strftime("%Y-%m-%d")
    yesterday_month = yesterday.month

    # 点击日期选择器 wrapper
    calendar_open = False
    for attempt in range(3):
        await page.eval('''(() => {
            const els = document.querySelectorAll('.d-daterangepicker-wrapper');
            for (const el of els) {
                const r = el.getBoundingClientRect();
                if (r.top > 100 && r.top < 200 && r.x > 1100) {
                    const startInput = el.querySelector('input') || el;
                    startInput.click();
                    return true;
                }
            }
        })()''')
        await asyncio.sleep(1.5)

        has_calendar = await page.eval('''(() => {
            return document.querySelectorAll('.d-datepicker-cell-center').length > 0;
        })()''')
        if has_calendar:
            calendar_open = True
            break
        log.info("日历未弹出，重试 %d/3...", attempt + 1)

    if not calendar_open:
        log.error("日历 3 次重试后仍未弹出")
        return False

    # 处理跨月：如果昨天在上个月，先翻页
    need_prev = await page.eval(f'''(() => {{
        const headers = document.querySelectorAll('[class*=datepicker] [class*=header], [class*=datepicker] [class*=title]');
        for (const h of headers) {{
            const text = h.textContent.trim();
            if (text.includes('{yesterday_month}月')) return false;
        }}
        return true;
    }})()''')
    if need_prev:
        log.info("昨天在上个月，翻页...")
        await page.eval('''(() => {
            const arrows = document.querySelectorAll('[class*=datepicker] [class*=prev], [class*=datepicker] button');
            for (const a of arrows) {
                const r = a.getBoundingClientRect();
                if (r.top > 100 && r.top < 250 && r.x < 1100 && r.width < 40) {
                    a.click();
                    return true;
                }
            }
        })()''')
        await asyncio.sleep(1)

    # 点击昨天作为开始日期
    clicked = await page.eval(f'''(() => {{
        const cells = document.querySelectorAll('.d-datepicker-cell-center');
        for (const cell of cells) {{
            const r = cell.getBoundingClientRect();
            const text = cell.textContent.trim();
            const cls = cell.className || '';
            if (text === '{yesterday_day}'
                && !cls.includes('disabled')
                && !cls.includes('prev-month') && !cls.includes('next-month')
                && !cls.includes('other')
                && r.top > 100 && r.top < 600 && r.x > 800) {{
                cell.click();
                return true;
            }}
        }}
        return false;
    }})()''')
    if not clicked:
        log.error("未找到昨天的日期 %s", yesterday_day)
        return False
    await asyncio.sleep(1)

    # 点击昨天作为结束日期
    await page.eval(f'''(() => {{
        const cells = document.querySelectorAll('.d-datepicker-cell-center');
        for (const cell of cells) {{
            const r = cell.getBoundingClientRect();
            const text = cell.textContent.trim();
            const cls = cell.className || '';
            if (text === '{yesterday_day}'
                && !cls.includes('disabled')
                && !cls.includes('prev-month') && !cls.includes('next-month')
                && !cls.includes('other')
                && r.top > 100 && r.top < 600 && r.x > 800) {{
                cell.click();
                return true;
            }}
        }}
    }})()''')
    await asyncio.sleep(2)

    log.info("日期已设为 %s", yesterday_str)
    return True


async def _click_download(page: "CdpPage", log: logging.Logger) -> bool:
    """滚动到数据明细，点击下载图标。"""
    # 滚动加载页面
    await page.scroll(3000)
    await asyncio.sleep(2)

    found = await page.eval('''(() => {
        const els = document.querySelectorAll('*');
        for (const el of els) {
            if (el.textContent.trim() === '数据明细' && el.children.length === 0) {
                el.scrollIntoView({block: 'start'});
                return true;
            }
        }
        return false;
    })()''')
    if not found:
        log.error("未找到「数据明细」区域")
        return False
    await asyncio.sleep(1)

    # 点击下载按钮（arrow-down SVG，fallback 用最右边按钮）
    clicked = await page.eval('''(() => {
        const els = document.querySelectorAll('*');
        let detailY = null;
        for (const el of els) {
            if (el.textContent.trim() === '数据明细' && el.children.length === 0) {
                detailY = el.getBoundingClientRect().top;
                break;
            }
        }
        if (!detailY) return false;

        const buttons = document.querySelectorAll('button');
        let rightmostBtn = null;
        let rightmostX = 0;

        for (const btn of buttons) {
            const r = btn.getBoundingClientRect();
            if (Math.abs(r.top - detailY) < 30 && r.x > 1000) {
                const svg = btn.querySelector('svg');
                if (svg) {
                    const paths = Array.from(svg.querySelectorAll('path')).map(p => p.getAttribute('d') || '');
                    if (paths.some(p => p.includes('33') && p.includes('23') && p.includes('24'))) {
                        btn.click();
                        return 'svg';
                    }
                }
                if (r.x > rightmostX) {
                    rightmostX = r.x;
                    rightmostBtn = btn;
                }
            }
        }

        if (rightmostBtn) {
            rightmostBtn.click();
            return 'fallback';
        }
        return false;
    })()''')
    if not clicked:
        log.error("未找到下载图标按钮")
        return False

    log.info("已点击下载按钮")
    return True


async def _wait_and_move_file(
    log: logging.Logger, dest_dir: Path, prefix: str,
    existing: set, timeout: int = 60,
) -> "Path | None":
    """等待 CSV 文件下载完成，重命名并移动。"""
    yesterday_str = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    for _ in range(timeout // 2):
        await asyncio.sleep(2)
        current = set(DOWNLOAD_DIR.glob("*.csv"))
        new_files = current - existing
        if new_files:
            completed = [f for f in new_files if not f.name.endswith(".crdownload")]
            if completed:
                src = max(completed, key=lambda f: f.stat().st_mtime)
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / f"{prefix}-{yesterday_str}.csv"
                if dest.exists():
                    log.info("⏭️ %s 已存在，跳过覆盖", dest.name)
                    src.unlink()
                    return dest
                shutil.move(str(src), str(dest))
                log.info("✓ %s → %s (%d KB)", src.name, dest.relative_to(DATA_OS), dest.stat().st_size // 1024)
                return dest

    log.error("下载超时（%d秒）", timeout)
    return None


async def download_report(
    report_type: str, url: str, dest_dir: Path, prefix: str,
    log: logging.Logger, dry_run: bool = False,
) -> "Path | None":
    """下载一个聚光报表。"""
    log.info("── %s ──", report_type)

    targets = await CdpPage.list_targets()
    jg_tabs = [t for t in targets if "ad.xiaohongshu.com/aurora" in t.get("url", "")]

    usable = [t for t in jg_tabs if "chrome-error" not in t.get("url", "")]
    if usable:
        page = CdpPage(usable[0]["targetId"])
    else:
        xhs_tabs = [t for t in targets if "xiaohongshu" in t.get("url", "") and "chrome-error" not in t.get("url", "")]
        if xhs_tabs:
            page = CdpPage(xhs_tabs[0]["targetId"])
        else:
            page = await CdpPage.new_tab(url)
            await asyncio.sleep(5)

    if not await _navigate_to_jg(page, url, log):
        return None

    # 选日期
    if not await _select_date_yesterday(page, log):
        return None

    if dry_run:
        await page.screenshot(str(LOG_DIR / f"dry-run-{prefix}.png"))
        log.info("DRY-RUN: 截图已保存")
        return None

    # 等数据加载
    await asyncio.sleep(3)

    existing = set(DOWNLOAD_DIR.glob("*.csv"))

    if not await _click_download(page, log):
        return None

    return await _wait_and_move_file(log, dest_dir, prefix, existing)


async def run(args) -> int:
    log = setup_logging()
    log.info("=" * 50)
    log.info("juguang_daily_export start (dry_run=%s)", args.dry_run)

    if not await _wait_for_chrome(log):
        log.error("Chrome/CDP 10分钟内未就绪，放弃")
        return 1

    results = []

    if not args.simple:
        r = await download_report(
            "标准投笔记报表", JG_STANDARD_URL,
            RAW_STANDARD, "聚光标准投-笔记报表",
            log, args.dry_run,
        )
        results.append(("标准投", r))

    if not args.standard:
        r = await download_report(
            "简单投笔记报表", JG_SIMPLE_URL,
            RAW_SIMPLE, "聚光简单投-笔记报表",
            log, args.dry_run,
        )
        results.append(("简单投", r))

    ok = sum(1 for _, r in results if r is not None)
    total = len(results)
    log.info("done: %d/%d 成功", ok, total)

    # 下载完成后触发日报推送（不阻塞退出码）
    if not args.dry_run and ok > 0:
        try:
            import subprocess
            report_script = DATA_OS.parent / "Automate" / "workflows" / "ad_daily_report" / "juguang_report.py"
            r = subprocess.run(
                ["/usr/bin/python3", str(report_script)],
                capture_output=True, text=True, timeout=60
            )
            if r.returncode == 0:
                log.info("聚光日报已推送")
            else:
                log.warning("聚光日报推送失败: %s", r.stderr.strip()[:200])
        except Exception as e:
            log.warning("调用日报脚本异常: %s", e)

    return 0 if ok == total else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--standard", action="store_true", help="只下载标准投")
    p.add_argument("--simple", action="store_true", help="只下载简单投")
    args = p.parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
