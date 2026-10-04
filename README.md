# 音频文件夹

把音频文件放进这个文件夹就能用，**不用改代码**。

主文件名和 `game.js` 顶部 `AUDIO.files` 里写的一致即可，扩展名会自动匹配 ——
`music.mp3`、`music.wav`、`music.ogg` 丢哪个进去都能认出来。缺哪个文件都不会报错，
游戏会安静地跳过，控制台（F12）会列出每个音效实际加载到的是哪个文件。

## 需要的文件

| 文件名 | 什么时候响 | 建议 |
| --- | --- | --- |
| `music` | 游戏进行中循环播放，越醉播放速度会略微加快 | 20 秒以上的循环 BGM |
| `eat` | 吃到一瓶酒 | 短促，0.2 秒左右 |
| `stage` | 醉酒升一档（TIPSY / DIZZY / WASTED / BLACKOUT） | 提示音 |
| `crash` | 撞围栏或把自己绕死 | 撞击 / 翻车 |
| `start` | 点 START / RETRY 开局 | 起跑音 |
| `click` | 点右上角静音开关 | 咔哒声 |

格式支持 mp3 / wav / ogg，随便哪种都行。要换成别的文件名或别的扩展名，
改 `game.js` 里 `AUDIO.files` 对应的候选列表即可（每一项可以写一个名字，
也可以写 `["xxx.mp3", "xxx.wav"]` 这样的一列，按顺序找）。

## 音量

在 `game.js` 顶部：

```js
const AUDIO = {
  master: 0.9,        // 总音量，0 ~ 1
  musicVolume: 0.55,  // 背景音乐
  sfxVolume: 0.9,     // 音效
  musicRate: 0.06,    // 越醉越快：1 + 0.06 = 最多快 6%
  ...
};
```

## 检查有没有加载成功

按 F12 打开控制台，1.5 秒后会打印一行，例如：

```
[audio] music=music.wav，eat=没找到，stage=没找到，crash=没找到，start=没找到，click=没找到
```

只要 `music=music.wav` 这样显示了实际文件名，就说明加载成功了；
BGM 真正开始播放时还会再打印一行 `[audio] BGM 开始播放：music.wav`。

## 小声提醒

- 浏览器不允许网页自动出声，必须等玩家先点一下（点 START 就算），
  所以 BGM 是开局那一刻才开始放的，这是正常现象。
- 用手机测试时，iOS 也需要一次触摸才会出声。
- 右键 `index.html` → Open with Live Server 打开也可以，但直接双击打开
  同样能放音频，不需要起服务器。
