# docs/

这个目录放 README 里引用的图片。

## screenshot.png

README 顶部那张界面截图，1913 × 1026，内容是「填入示例数据」之后的卡片状态：
三种优先级（A/B/C）的字母标与色轨、两条定时任务的胶囊时间、两条未设时间的任务。

**如果以后要重截**（比如界面改版了）：

1. 用 `python launcher.pyw` 打开 <http://localhost:8000/index.html>，先 **Ctrl + F5** 硬刷新
2. 卡片底部点「清空全部」，再点「填入示例数据」——保证图上只有一批干净、时间合理的示例
3. Windows 按 `Win + Shift + S` 截图，存成 `docs/screenshot.png`（文件名必须是这个）
4. 窗口宽度 1500px 以上，这样缩到 README 里的小字还看得清
