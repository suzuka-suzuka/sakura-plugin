import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas"
import path from "node:path"
import { pluginresources } from "../path.js"
import fs from "node:fs"

// 注册自定义字体
try {
  const fontPath = path.join(pluginresources, "sign", "font")
  if (fs.existsSync(fontPath)) {
    const fontFiles = fs.readdirSync(fontPath).filter(f => f.endsWith(".ttf") || f.endsWith(".otf"))
    if (fontFiles.length > 0) {
      GlobalFonts.registerFromPath(path.join(fontPath, fontFiles[0]), "CustomFont")
    }
  }
} catch (err) {
  console.warn("[好感度] 自定义字体加载失败")
}

// 注册系统 emoji 字体，保证昵称中的 emoji 能正常绘制（Windows / Linux 均尝试）
const systemEmojiFonts = [
  { path: "C:\\Windows\\Fonts\\seguiemj.ttf", name: "SegoeUIEmoji" }, // Windows 彩色 emoji
  { path: "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf", name: "NotoColorEmoji" }, // Linux 彩色 emoji
  { path: "/usr/share/fonts/opentype/noto/NotoColorEmoji.ttf", name: "NotoColorEmoji" },
]
for (const font of systemEmojiFonts) {
  try {
    if (fs.existsSync(font.path)) {
      GlobalFonts.registerFromPath(font.path, font.name)
    }
  } catch (err) {
    console.warn(`[好感度] 加载 emoji 字体失败: ${font.path}`)
  }
}

export default class FavorabilityImageGenerator {
  constructor() {
    this.width = 800
    this.height = 500
  }

  async generate(nameA, nameB, favorabilityAtoB, favorabilityBtoA, qqA, qqB) {
    const canvas = createCanvas(this.width, this.height)
    const ctx = canvas.getContext("2d")

    this.drawBackground(ctx)

    this.drawTitle(ctx)

    const centerY = this.height / 2 + 20
    const leftX = 200
    const rightX = 600
    const avatarSize = 80

    await this.drawAvatars(ctx, leftX, rightX, centerY, avatarSize, qqA, qqB)

    this.drawUserNames(ctx, leftX, rightX, centerY, avatarSize, nameA, nameB)

    this.drawFavorabilityArrows(
      ctx,
      leftX,
      rightX,
      centerY,
      avatarSize,
      favorabilityAtoB,
      favorabilityBtoA,
    )

    this.drawFooter(ctx, favorabilityAtoB, favorabilityBtoA)

    return canvas.toBuffer("image/png")
  }

  drawBackground(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, this.width, this.height)
    gradient.addColorStop(0, "#FFE5E5")
    gradient.addColorStop(0.5, "#FFF0F5")
    gradient.addColorStop(1, "#FFE5E5")
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, this.width, this.height)
  }

  drawTitle(ctx) {
    ctx.fillStyle = "#FF69B4"
    ctx.font = 'bold 36px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = "center"
    ctx.fillText("好感度", this.width / 2, 60)

    ctx.strokeStyle = "#FFB6C1"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(100, 90)
    ctx.lineTo(700, 90)
    ctx.stroke()
  }

  async drawAvatars(ctx, leftX, rightX, centerY, avatarSize, qqA, qqB) {
    try {
      const avatarA = await loadImage(`https://q1.qlogo.cn/g?b=qq&nk=${qqA}&s=640`).catch(
        () => null,
      )
      const avatarB = await loadImage(`https://q1.qlogo.cn/g?b=qq&nk=${qqB}&s=640`).catch(
        () => null,
      )

      if (avatarA) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(leftX, centerY, avatarSize / 2, 0, Math.PI * 2)
        ctx.closePath()
        ctx.clip()
        ctx.drawImage(
          avatarA,
          leftX - avatarSize / 2,
          centerY - avatarSize / 2,
          avatarSize,
          avatarSize,
        )
        ctx.restore()
      } else {
        this.drawDefaultAvatar(ctx, leftX, centerY, avatarSize)
      }

      if (avatarB) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(rightX, centerY, avatarSize / 2, 0, Math.PI * 2)
        ctx.closePath()
        ctx.clip()
        ctx.drawImage(
          avatarB,
          rightX - avatarSize / 2,
          centerY - avatarSize / 2,
          avatarSize,
          avatarSize,
        )
        ctx.restore()
      } else {
        this.drawDefaultAvatar(ctx, rightX, centerY, avatarSize)
      }
    } catch (err) {
      this.drawDefaultAvatar(ctx, leftX, centerY, avatarSize)
      this.drawDefaultAvatar(ctx, rightX, centerY, avatarSize)
    }

    ctx.strokeStyle = "#FF69B4"
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(leftX, centerY, avatarSize / 2 + 2, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(rightX, centerY, avatarSize / 2 + 2, 0, Math.PI * 2)
    ctx.stroke()
  }

  drawDefaultAvatar(ctx, x, y, size) {
    ctx.fillStyle = "#FFB6C1"
    ctx.beginPath()
    ctx.arc(x, y, size / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  drawUserNames(ctx, leftX, rightX, centerY, avatarSize, nameA, nameB) {
    ctx.fillStyle = "#333333"
    ctx.font = 'bold 20px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif'

    const leftNameY = centerY + avatarSize / 2 + 25
    const leftAlignX = leftX + avatarSize / 2
    const leftMaxWidth = leftAlignX - 50
    this.drawWrappedTextAligned(ctx, nameA, leftAlignX, leftNameY, leftMaxWidth, "left-align-right")

    const rightNameY = centerY + avatarSize / 2 + 25
    const rightAlignX = rightX - avatarSize / 2
    const rightMaxWidth = this.width - rightAlignX - 50
    this.drawWrappedTextAligned(
      ctx,
      nameB,
      rightAlignX,
      rightNameY,
      rightMaxWidth,
      "right-align-left",
    )
  }

  drawWrappedTextAligned(ctx, text, x, y, maxWidth, mode) {
    if (typeof text === 'string') text = text.replace(/[\x00-\x1F\x7F]/g, '')
    const lineHeight = 24

    const textWidth = ctx.measureText(text).width
    if (textWidth <= maxWidth) {
      if (mode === "left-align-right") {
        ctx.textAlign = "right"
        ctx.fillText(text, x, y)
      } else {
        ctx.textAlign = "left"
        ctx.fillText(text, x, y)
      }
      return
    }

    const chars = [...text]
    let line = ""
    let lines = []

    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i]
      const testWidth = ctx.measureText(testLine).width

      if (testWidth > maxWidth && line.length > 0) {
        lines.push(line)
        line = chars[i]
      } else {
        line = testLine
      }
    }

    if (line.length > 0) {
      lines.push(line)
    }

    for (let i = 0; i < lines.length; i++) {
      if (mode === "left-align-right") {
        ctx.textAlign = "right"
        ctx.fillText(lines[i], x, y + i * lineHeight)
      } else {
        ctx.textAlign = "left"
        ctx.fillText(lines[i], x, y + i * lineHeight)
      }
    }
  }

  drawWrappedText(ctx, text, x, y, maxWidth, lineHeight = 22) {
    if (typeof text === 'string') text = text.replace(/[\x00-\x1F\x7F]/g, '')
    const textWidth = ctx.measureText(text).width
    if (textWidth <= maxWidth) {
      ctx.fillText(text, x, y + lineHeight)
      return
    }

    const chars = [...text]
    let line = ""
    let lines = []

    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i]
      const testWidth = ctx.measureText(testLine).width

      if (testWidth > maxWidth && line.length > 0) {
        lines.push(line)
        line = chars[i]
      } else {
        line = testLine
      }
    }

    if (line.length > 0) {
      lines.push(line)
    }

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x, y + lineHeight + i * lineHeight)
    }
  }

  drawFavorabilityArrows(
    ctx,
    leftX,
    rightX,
    centerY,
    avatarSize,
    favorabilityAtoB,
    favorabilityBtoA,
  ) {
    const arrowY1 = centerY - 60
    this.drawArrow(
      ctx,
      leftX + avatarSize / 2 + 20,
      arrowY1,
      rightX - avatarSize / 2 - 20,
      arrowY1,
      "#FF1493",
      3,
    )

    this.drawFavorabilityWithHeart(ctx, favorabilityAtoB, (leftX + rightX) / 2, arrowY1, "#FF1493")

    const arrowY2 = centerY + 60
    this.drawArrow(
      ctx,
      rightX - avatarSize / 2 - 20,
      arrowY2,
      leftX + avatarSize / 2 + 20,
      arrowY2,
      "#9370DB",
      3,
    )

    this.drawFavorabilityWithHeart(ctx, favorabilityBtoA, (leftX + rightX) / 2, arrowY2, "#9370DB")
  }

  drawFavorabilityWithHeart(ctx, favorability, x, y, color) {
    const heartSize = 35
    const absFavorability = Math.abs(favorability)
    const heartCount = Math.floor(absFavorability / 100) + 1
    const fillPercent = absFavorability % 100

    const heartColor = favorability >= 0 ? color : "#999999"

    if (heartCount > 5) {
      const heartX = x - heartSize / 2 - 15
      const heartY = y - 50
      this.drawHeart(ctx, heartX, heartY, heartSize, heartColor, 100)

      ctx.fillStyle = heartColor
      ctx.font = 'bold 24px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = "left"
      ctx.fillText(`x${heartCount}`, x + heartSize / 2 - 10, y - 35)
    } else {
      const totalWidth = heartCount * (heartSize + 8) - 8
      const startX = x - totalWidth / 2

      for (let i = 0; i < heartCount; i++) {
        const heartX = startX + i * (heartSize + 8) + heartSize / 2
        const heartY = y - 50

        if (i < heartCount - 1) {
          this.drawHeart(ctx, heartX, heartY, heartSize, heartColor, 100)
        } else {
          this.drawHeart(ctx, heartX, heartY, heartSize, heartColor, fillPercent)
        }
      }
    }

    ctx.fillStyle = color
    ctx.font = 'bold 18px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = "center"
    ctx.fillText(favorability.toString(), x, y + 25)
  }

  drawHeart(ctx, x, y, size, color, fillPercent) {
    ctx.save()

    const createHeartPath = () => {
      ctx.beginPath()
      const topY = y
      const bottomY = y + size * 0.85

      ctx.moveTo(x, topY + size * 0.3)
      ctx.bezierCurveTo(x, topY, x - size / 2, topY, x - size / 2, topY + size * 0.3)
      ctx.bezierCurveTo(
        x - size / 2,
        topY + size * 0.45,
        x - size / 4,
        topY + size * 0.55,
        x,
        bottomY,
      )

      ctx.bezierCurveTo(
        x + size / 4,
        topY + size * 0.55,
        x + size / 2,
        topY + size * 0.45,
        x + size / 2,
        topY + size * 0.3,
      )
      ctx.bezierCurveTo(x + size / 2, topY, x, topY, x, topY + size * 0.3)
      ctx.closePath()
    }

    createHeartPath()
    ctx.strokeStyle = color
    ctx.lineWidth = 2.5
    ctx.stroke()

    if (fillPercent > 0) {
      ctx.save()

      const clipHeight = size * 0.85 * (fillPercent / 100)
      ctx.beginPath()
      ctx.rect(x - size / 2 - 5, y + size * 0.85 - clipHeight, size + 10, clipHeight + 5)
      ctx.clip()

      createHeartPath()
      ctx.fillStyle = color
      ctx.fill()

      ctx.restore()
    }

    ctx.restore()
  }

  drawFavorabilityLabel(ctx, text, x, y, color) {
    ctx.font = 'bold 20px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif'
    const textWidth = ctx.measureText(text).width
    const bgX = x - textWidth / 2 - 10
    const bgY = y - 35

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)"
    this.roundRect(ctx, bgX, bgY, textWidth + 20, 35, 8)
    ctx.fill()

    ctx.strokeStyle = color
    ctx.lineWidth = 2
    this.roundRect(ctx, bgX, bgY, textWidth + 20, 35, 8)
    ctx.stroke()

    ctx.fillStyle = color
    ctx.textAlign = "center"
    ctx.fillText(text, x, y - 12)
  }

  drawArrow(ctx, fromX, fromY, toX, toY, color, lineWidth = 2) {
    const headLength = 15
    const angle = Math.atan2(toY - fromY, toX - fromX)

    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = lineWidth

    ctx.beginPath()
    ctx.moveTo(fromX, fromY)
    ctx.lineTo(toX, toY)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(toX, toY)
    ctx.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6),
    )
    ctx.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6),
    )
    ctx.closePath()
    ctx.fill()
  }

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + width - radius, y)
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
    ctx.lineTo(x + width, y + height - radius)
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
    ctx.lineTo(x + radius, y + height)
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
  }

  getFavorabilityMessage(favorabilityAtoB, favorabilityBtoA) {
    const diff = favorabilityAtoB - favorabilityBtoA

    if (favorabilityAtoB < 10 && favorabilityBtoA < 10) {
      const strangerMessages = [
        "💭 你们还是陌生人呢，多多互动增进感情吧~",
        "💭 缘分才刚刚开始，要好好把握哦！",
        "💭 陌生的两个人，说不定能成为好朋友呢？",
        "💭 从零开始培养感情，一切都充满可能！",
        "💭 多聊聊天多互动，慢慢就熟悉啦~",
        "💭 新的相遇新的开始，期待你们的故事！",
      ]
      return strangerMessages[Math.floor(Math.random() * strangerMessages.length)]
    }

    if (favorabilityAtoB > 100 && favorabilityBtoA > 100) {
      const loveMessages = [
        "💕 双向奔赴的爱情真美好，祝你们永远幸福！",
        "💕 哇~真是令人羡慕的关系呢，甜甜的！",
        "💕 互相喜欢真好，要一直这么甜蜜下去哦！",
        "💕 这就是爱情的模样吧，好浪漫好甜！",
        "💕 彼此珍惜对方，百年好合~",
        "💕 天生一对的感觉，永远幸福快乐！",
      ]
      return loveMessages[Math.floor(Math.random() * loveMessages.length)]
    }

    if (diff > 20) {
      const oneWayMessages = [
        "🌧️ 不要做舔狗啦，要好好爱自己哦~",
        "🌧️ 单方面的付出很累的，爱要相互才有意义...",
        "🌧️ 爱是双向奔赴呢，不要委屈自己啦！",
        "🌧️ 如果TA不回应你的心意，那就潇洒放手吧~",
        "🌧️ 你值得被更好地对待，不要一味付出哦！",
        "🌧️ 感情需要平等，别让自己太卑微啦...",
      ]
      return oneWayMessages[Math.floor(Math.random() * oneWayMessages.length)]
    }

    if (diff < -20) {
      const beLovedMessages = [
        "🌸 有人这么喜欢你呢，真是幸福的事~",
        "🌸 被人深爱着好幸福，记得好好珍惜哦！",
        "🌸 要珍惜喜欢你的人呀，TA的心意很真诚！",
        "🌸 TA对你的心意满满的，你感受到了吗？",
        "🌸 被这样爱着是种幸运，好好珍惜这份感情吧~",
        "🌸 有人默默守护着你呢，要懂得回应哦！",
      ]
      return beLovedMessages[Math.floor(Math.random() * beLovedMessages.length)]
    }

    const generalMessages = [
      "💝 好感度会随着互动次数慢慢增加哦~",
      "💝 多多交流多多互动，感情会越来越好的！",
      "💝 感情需要双方共同经营呢，加油！",
      "💝 继续保持互动，慢慢培养感情吧~",
      "💝 你们的关系还不错呢，再接再厉！",
      "💝 保持这样的互动频率就很好啦，棒棒哒！",
    ]
    return generalMessages[Math.floor(Math.random() * generalMessages.length)]
  }

  drawFooter(ctx, favorabilityAtoB, favorabilityBtoA) {
    const message = this.getFavorabilityMessage(favorabilityAtoB, favorabilityBtoA)
    ctx.fillStyle = "#999999"
    ctx.font = '16px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = "center"
    ctx.fillText(message, this.width / 2, this.height - 30)
  }

  async generateRanking(title, rankingData, userName) {
    if (typeof userName === 'string') userName = userName.replace(/[\x00-\x1F\x7F]/g, '')
    const width = 900
    const height = 80 + rankingData.length * 70 + 100
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext("2d")

    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, "#FFE5E5")
    gradient.addColorStop(0.5, "#FFF0F5")
    gradient.addColorStop(1, "#FFE5E5")
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = "#FF69B4"
    ctx.font = "bold 36px CustomFont"
    ctx.textAlign = "center"
    ctx.fillText(title, width / 2, 50)

    ctx.fillStyle = "#999999"
    ctx.font = '18px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(`${userName} 的好感度排行榜`, width / 2, 80)

    ctx.strokeStyle = "#FFB6C1"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(100, 95)
    ctx.lineTo(width - 100, 95)
    ctx.stroke()

    let startY = 130
    for (let i = 0; i < rankingData.length; i++) {
      const item = rankingData[i]
      const y = startY + i * 70

      await this.drawRankingItem(ctx, i + 1, item, y, width)
    }

    ctx.fillStyle = "#999999"
    ctx.font = '14px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = "center"
    ctx.fillText("💝 持续互动可以增加好感度哦~", width / 2, height - 30)

    return canvas.toBuffer("image/png")
  }

  async drawRankingItem(ctx, rank, item, y, canvasWidth) {
    const leftMargin = 80
    const heartSize = 30

    ctx.fillStyle = rank <= 3 ? "#FF69B4" : "#666666"
    ctx.font = rank <= 3 ? 'bold 28px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif' : 'bold 24px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = "right"
    const rankText = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`
    ctx.fillText(rankText, leftMargin, y + 25)

    ctx.fillStyle = "#333333"
    ctx.font = 'bold 20px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = "left"
    const nameX = leftMargin + 30
    const maxNameWidth = 200
    this.drawWrappedText(ctx, item.name, nameX, y + 5, maxNameWidth, 22)

    const heartsX = nameX + maxNameWidth + 20
    const favorability = item.favorability
    const absFavorability = Math.abs(favorability)
    const heartCount = Math.max(1, Math.floor(absFavorability / 100) + 1)
    const fillPercent = absFavorability % 100
    const color = favorability >= 0 ? "#FF1493" : "#999999"

    if (heartCount > 5) {
      this.drawHeart(ctx, heartsX + heartSize / 2, y + 10, heartSize, color, 100)

      ctx.fillStyle = color
      ctx.font = 'bold 24px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = "left"
      ctx.fillText(`x${heartCount}`, heartsX + heartSize + 10, y + 25)
    } else {
      for (let i = 0; i < heartCount; i++) {
        const heartX = heartsX + i * (heartSize + 5)

        if (i < heartCount - 1) {
          this.drawHeart(ctx, heartX + heartSize / 2, y + 10, heartSize, color, 100)
        } else {
          this.drawHeart(ctx, heartX + heartSize / 2, y + 10, heartSize, color, fillPercent)
        }
      }
    }

    ctx.fillStyle = color
    ctx.font = 'bold 24px CustomFont, "SegoeUIEmoji", "NotoColorEmoji", "Noto Sans SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = "right"
    ctx.fillText(favorability.toString(), canvasWidth - 80, y + 25)

    if (rank <= 9) {
      ctx.strokeStyle = "#FFD0E0"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(leftMargin, y + 50)
      ctx.lineTo(canvasWidth - 80, y + 50)
      ctx.stroke()
    }
  }
}
