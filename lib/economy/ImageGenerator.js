import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas"
import path from "node:path"
import { pluginresources } from "../path.js"

const fontPathMain = path.join(pluginresources, "sign", "font", "FZFWZhuZiAYuanJWD.ttf")
const fontPathKaomoji = path.join(pluginresources, "sign", "font", "MotoyaMaruStd-W5.otf")

try {
    GlobalFonts.registerFromPath(fontPathMain, "ZhuZiAYuan")
    GlobalFonts.registerFromPath(fontPathKaomoji, "MotoyaMaru")
} catch (e) {
}

export default class EconomyImageGenerator {
  constructor() {
    this.width = 800
    this.height = 600
  }

  drawSakuraBackground(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, '#FFE4F3')
    gradient.addColorStop(0.5, '#FFF0F8')
    gradient.addColorStop(1, '#FFE4F3')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    // 绘制樱花花瓣
    const petalCount = 20
    for (let i = 0; i < petalCount; i++) {
      const x = Math.random() * width
      const y = Math.random() * height
      const size = Math.random() * 20 + 10
      const opacity = Math.random() * 0.3 + 0.2
      this.drawSakuraPetal(ctx, x, y, size, opacity)
    }
  }

  drawSakuraPetal(ctx, x, y, size, opacity) {
    ctx.save()
    ctx.globalAlpha = opacity
    ctx.fillStyle = '#FFB3D9'
    
    for (let i = 0; i < 5; i++) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate((Math.PI * 2 * i) / 5)
      ctx.beginPath()
      ctx.ellipse(size * 0.3, 0, size * 0.4, size * 0.2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    
    ctx.fillStyle = '#FF69B4'
    ctx.beginPath()
    ctx.arc(x, y, size * 0.15, 0, Math.PI * 2)
    ctx.fill()
    
    ctx.restore()
  }

  wrapText(ctx, text, maxWidth) {
    const chars = text.split('')
    let line = ''
    let lines = []
    
    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i]
      const metrics = ctx.measureText(testLine)
      if (metrics.width > maxWidth && i > 0) {
        lines.push(line)
        line = chars[i]
      } else {
        line = testLine
      }
    }
    lines.push(line)
    return lines
  }

  drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  async drawAvatar(ctx, url, x, y, size) {
    try {
        const img = await loadImage(url)
        ctx.save()
        ctx.beginPath()
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2, true)
        ctx.closePath()
        ctx.clip()
        ctx.drawImage(img, x, y, size, size)
        ctx.restore()
    } catch (e) {
        ctx.fillStyle = "#CCCCCC"
        ctx.beginPath()
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2, true)
        ctx.fill()
    }
  }

  async generateStatusImage(data) {
    const canvas = createCanvas(this.width, 400)
    const ctx = canvas.getContext("2d")

    this.drawSakuraBackground(ctx, this.width, 400)

    ctx.fillStyle = "rgba(255, 255, 255, 0.85)"
    ctx.shadowColor = "rgba(255, 105, 180, 0.2)"
    ctx.shadowBlur = 15
    this.drawRoundedRect(ctx, 20, 20, this.width - 40, 360, 20)
    ctx.fill()
    ctx.shadowBlur = 0

    await this.drawAvatar(ctx, data.avatarUrl, 50, 50, 100)

    ctx.fillStyle = "#FF69B4"
    ctx.font = 'bold 28px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    const nicknameLines = this.wrapText(ctx, data.nickname, this.width - 200)
    if (nicknameLines.length === 1) {
      ctx.fillText(nicknameLines[0], 170, 85)
    } else {
      ctx.fillText(nicknameLines[0], 170, 70)
      ctx.font = '24px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
      ctx.fillText(nicknameLines[1], 170, 100)
    }

    ctx.fillStyle = "#999999"
    ctx.font = '20px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.fillText(`ID: ${data.userId}`, 170, 130)

    ctx.strokeStyle = "#EEEEEE"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(50, 180)
    ctx.lineTo(this.width - 50, 180)
    ctx.stroke()

    const drawStat = (label, value, x, y, color) => {
        ctx.fillStyle = "#666666"
        ctx.font = '24px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
        ctx.fillText(label, x, y)
        
        ctx.fillStyle = color
        ctx.font = 'bold 30px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
        ctx.fillText(value, x, y + 45)
    }

    drawStat("当前等级", `Lv.${data.level}`, 50, 240, "#FF69B4")
    drawStat("樱花币", `${data.coins}`, 300, 240, "#FF1493")
    drawStat("当前经验", `${data.experience}`, 550, 240, "#FFB3D9")

    const expBarY = 320
    const expBarWidth = this.width - 100
    const expBarHeight = 20
    
    const currentLevelExp = 100 * Math.pow(data.level - 1, 2)
    const nextLevelExp = 100 * Math.pow(data.level, 2)
    const levelTotalExp = nextLevelExp - currentLevelExp
    const currentExpInLevel = data.experience - currentLevelExp
    const progress = Math.min(1, Math.max(0, currentExpInLevel / levelTotalExp))

    ctx.fillStyle = "#FFE4F3"
    this.drawRoundedRect(ctx, 50, expBarY, expBarWidth, expBarHeight, 10)
    ctx.fill()

    ctx.fillStyle = "#FF69B4"
    this.drawRoundedRect(ctx, 50, expBarY, expBarWidth * progress, expBarHeight, 10)
    ctx.fill()

    ctx.fillStyle = "#999999"
    ctx.font = '18px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.textAlign = "right"
    ctx.fillText(`${currentExpInLevel} / ${levelTotalExp}`, this.width - 50, expBarY - 10)
    ctx.textAlign = "left"

    return canvas.toBuffer("image/png")
  }

  async generateRankingImage(data) {
    const itemHeight = 100
    const headerHeight = 120
    const padding = 20
    const listHeight = data.list.length * (itemHeight + padding)
    const height = headerHeight + listHeight + padding
    
    const canvas = createCanvas(this.width, height)
    const ctx = canvas.getContext("2d")

    this.drawSakuraBackground(ctx, this.width, height)

    ctx.fillStyle = "#FF1493"
    ctx.font = 'bold 40px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.textAlign = "center"
    ctx.fillText(data.title, this.width / 2, 80)
    ctx.textAlign = "left"

    for (let i = 0; i < data.list.length; i++) {
        const item = data.list[i]
        const y = headerHeight + i * (itemHeight + padding)
        
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)"
        ctx.shadowColor = "rgba(255, 105, 180, 0.15)"
        ctx.shadowBlur = 8
        this.drawRoundedRect(ctx, 20, y, this.width - 40, itemHeight, 15)
        ctx.fill()
        ctx.shadowBlur = 0

        ctx.font = 'bold 36px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
        if (item.rank <= 3) {
            ctx.fillStyle = item.rank == 1 ? "#FF1493" : (item.rank == 2 ? "#FF69B4" : "#FFB3D9")
        } else {
            ctx.fillStyle = "#FFC0CB"
        }
        ctx.textAlign = "center"
        ctx.fillText(`${item.rank}`, 70, y + 65)
        ctx.textAlign = "left"

        await this.drawAvatar(ctx, item.avatarUrl, 120, y + 10, 80)

        ctx.fillStyle = "#FF1493"
        ctx.font = 'bold 28px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
        const valueText = `${item.value}`
        const valueWidth = ctx.measureText(valueText).width
        ctx.textAlign = "right"
        ctx.fillText(valueText, this.width - 50, y + 65)
        ctx.textAlign = "left"

        ctx.fillStyle = "#666666"
        ctx.font = 'bold 24px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
        
        const nicknameX = 220
        const maxNicknameWidth = this.width - 50 - valueWidth - 20 - nicknameX
        
        const lines = this.wrapText(ctx, item.nickname, maxNicknameWidth)

        if (lines.length > 2) {
             lines[1] = lines[1] + '...'
             lines.length = 2
        }

        if (lines.length === 1) {
            ctx.fillText(lines[0], nicknameX, y + 60)
        } else {
            ctx.font = 'bold 20px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
            ctx.fillText(lines[0], nicknameX, y + 45)
            ctx.fillText(lines[1], nicknameX, y + 75)
        }
    }

    return canvas.toBuffer("image/png")
  }
  async generateTransferImage(data) {
    const canvas = createCanvas(this.width, 450)
    const ctx = canvas.getContext("2d")

    this.drawSakuraBackground(ctx, this.width, 450)

    const centerY = 150
    const leftX = 150
    const rightX = 650
    const avatarSize = 120

    await this.drawAvatar(ctx, data.sender.avatarUrl, leftX - avatarSize/2, centerY - avatarSize/2, avatarSize)
    await this.drawAvatar(ctx, data.receiver.avatarUrl, rightX - avatarSize/2, centerY - avatarSize/2, avatarSize)

    ctx.strokeStyle = "#FF69B4"
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(leftX + avatarSize/2 + 20, centerY)
    ctx.lineTo(rightX - avatarSize/2 - 20, centerY)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(rightX - avatarSize/2 - 20, centerY)
    ctx.lineTo(rightX - avatarSize/2 - 40, centerY - 10)
    ctx.lineTo(rightX - avatarSize/2 - 40, centerY + 10)
    ctx.closePath()
    ctx.fillStyle = "#FF69B4"
    ctx.fill()

    ctx.fillStyle = "#FF1493"
    ctx.font = 'bold 32px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.textAlign = "center"
    ctx.fillText(`转账 ${data.amount} 樱花币`, this.width / 2, centerY - 20)
    ctx.textAlign = "left"

    ctx.fillStyle = "#666666"
    ctx.font = 'bold 24px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.textAlign = "center"
    
    const senderLines = this.wrapText(ctx, data.sender.nickname, 200)
    if (senderLines.length === 1) {
      ctx.fillText(senderLines[0], leftX, centerY + avatarSize/2 + 40)
    } else {
      ctx.font = 'bold 20px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
      ctx.fillText(senderLines[0], leftX, centerY + avatarSize/2 + 35)
      ctx.fillText(senderLines.length > 2 ? senderLines[1] + '...' : senderLines[1], leftX, centerY + avatarSize/2 + 58)
    }

    const receiverLines = this.wrapText(ctx, data.receiver.nickname, 200)
    ctx.font = 'bold 24px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    if (receiverLines.length === 1) {
      ctx.fillText(receiverLines[0], rightX, centerY + avatarSize/2 + 40)
    } else {
      ctx.font = 'bold 20px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
      ctx.fillText(receiverLines[0], rightX, centerY + avatarSize/2 + 35)
      ctx.fillText(receiverLines.length > 2 ? receiverLines[1] + '...' : receiverLines[1], rightX, centerY + avatarSize/2 + 58)
    }

    ctx.fillStyle = "#FF69B4"
    ctx.font = '22px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.fillText(`当前樱花币: ${data.sender.coins}`, leftX, centerY + avatarSize/2 + 95)
    ctx.fillText(`当前樱花币: ${data.receiver.coins}`, rightX, centerY + avatarSize/2 + 95)
    ctx.textAlign = "left"

    return canvas.toBuffer("image/png")
  }}
