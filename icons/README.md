# 图标资产

Chrome / Edge 扩展需要 3 个尺寸的 PNG 图标：

| 文件名 | 尺寸 | 用途 |
|---|---|---|
| `icon-16.png` | 16×16 | 工具栏小图标 |
| `icon-48.png` | 48×48 | chrome://extensions/ 管理页 |
| `icon-128.png` | 128×128 | 商店列表页 |

## 准备步骤

1. 用 AI 生成一张 **1024×1024** 的原图（提示词在对话里）
2. 把原图放进这个目录命名 `icon-source.png`
3. 跑 `npm run icons` 或下面这条命令自动切尺寸：

```bash
# macOS 自带的 sips
sips -z 16 16 icon-source.png --out icon-16.png
sips -z 48 48 icon-source.png --out icon-48.png
sips -z 128 128 icon-source.png --out icon-128.png
```

4. 完成后让作者更新 `manifest.json` 加上 icons 字段，重新跑 `./install.sh` 验证

## 注意

- **背景透明 OR 实色都可以**，但小尺寸下要保证主体清晰
- **不要含细字 / 渐变细节**——16×16 会糊掉
- 红色主色调，与 Chrome 工具栏的灰白对比鲜明
