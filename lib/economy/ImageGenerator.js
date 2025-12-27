import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas"
import path from "node:path"
import { pluginresources } from "../path.js"

const fontPathMain = path.join(pluginresources, "sign", "font", "FZFWZhuZiAYuanJWD.ttf")
const fontPathKaomoji = path.join(pluginresources, "sign", "font", "MotoyaMaruStd-W5.otf")

// 尝试注册字体，如果sign插件已经注册过可能会报错或者忽略，这里为了保险起见
try {
    GlobalFonts.registerFromPath(fontPathMain, "ZhuZiAYuan")
    GlobalFonts.registerFromPath(fontPathKaomoji, "MotoyaMaru")
} catch (e) {
    // 忽略重复注册错误
}

export default class EconomyImageGenerator {
  constructor() {
    this.width = 800
    this.height = 600
  }

  // 绘制圆角矩形
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

  // 绘制圆形头像
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
        // 头像加载失败，绘制占位符
        ctx.fillStyle = "#CCCCCC"
        ctx.beginPath()
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2, true)
        ctx.fill()
    }
  }

  async generateStatusImage(data) {
    const canvas = createCanvas(this.width, 400)
    const ctx = canvas.getContext("2d")

    // 背景
    ctx.fillStyle = "#F0F2F5"
    ctx.fillRect(0, 0, this.width, 400)

    // 卡片背景
    ctx.fillStyle = "#FFFFFF"
    ctx.shadowColor = "rgba(0, 0, 0, 0.1)"
    ctx.shadowBlur = 10
    this.drawRoundedRect(ctx, 20, 20, this.width - 40, 360, 20)
    ctx.fill()
    ctx.shadowBlur = 0

    // 头像
    await this.drawAvatar(ctx, data.avatarUrl, 50, 50, 100)

    // 用户名
    ctx.fillStyle = "#333333"
    ctx.font = 'bold 40px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.fillText(data.nickname, 170, 90)

    // ID
    ctx.fillStyle = "#999999"
    ctx.font = '24px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.fillText(`ID: ${data.userId}`, 170, 130)

    // 分割线
    ctx.strokeStyle = "#EEEEEE"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(50, 180)
    ctx.lineTo(this.width - 50, 180)
    ctx.stroke()

    // 属性展示
    const drawStat = (label, value, x, y, color) => {
        ctx.fillStyle = "#666666"
        ctx.font = '28px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
        ctx.fillText(label, x, y)
        
        ctx.fillStyle = color
        ctx.font = 'bold 36px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
        ctx.fillText(value, x, y + 45)
    }

    drawStat("当前等级", `Lv.${data.level}`, 50, 240, "#FF9800")
    drawStat("樱花币", `${data.coins}`, 300, 240, "#E91E63")
    drawStat("当前经验", `${data.experience}`, 550, 240, "#2196F3")

    // 经验条
    const expBarY = 320
    const expBarWidth = this.width - 100
    const expBarHeight = 20
    
    // 计算升级所需经验 (假设公式与 sign.js 一致: 100 * level^2)
    const currentLevelExp = 100 * Math.pow(data.level - 1, 2)
    const nextLevelExp = 100 * Math.pow(data.level, 2)
    const levelTotalExp = nextLevelExp - currentLevelExp
    const currentExpInLevel = data.experience - currentLevelExp
    const progress = Math.min(1, Math.max(0, currentExpInLevel / levelTotalExp))

    // 进度条背景
    ctx.fillStyle = "#E0E0E0"
    this.drawRoundedRect(ctx, 50, expBarY, expBarWidth, expBarHeight, 10)
    ctx.fill()

    // 进度条前景
    ctx.fillStyle = "#4CAF50"
    this.drawRoundedRect(ctx, 50, expBarY, expBarWidth * progress, expBarHeight, 10)
    ctx.fill()

    // 进度文字
    ctx.fillStyle = "#999999"
    ctx.font = '20px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.textAlign = "right"
    ctx.fillText(`${currentExpInLevel} / ${levelTotalExp}`, this.width - 50, expBarY - 10)
    ctx.textAlign = "left"

    return canvas.toBuffer("image/png")
  }

  async generateRankingImage(data) {
    // data: { title: string, list: [{ rank, avatarUrl, nickname, value, userId }] }
    const itemHeight = 100
    const headerHeight = 120
    const padding = 20
    const listHeight = data.list.length * (itemHeight + padding)
    const height = headerHeight + listHeight + padding
    
    const canvas = createCanvas(this.width, height)
    const ctx = canvas.getContext("2d")

    // 背景
    ctx.fillStyle = "#F0F2F5"
    ctx.fillRect(0, 0, this.width, height)

    // 标题
    ctx.fillStyle = "#333333"
    ctx.font = 'bold 48px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.textAlign = "center"
    ctx.fillText(data.title, this.width / 2, 80)
    ctx.textAlign = "left"

    // 列表
    for (let i = 0; i < data.list.length; i++) {
        const item = data.list[i]
        const y = headerHeight + i * (itemHeight + padding)
        
        // 卡片背景
        ctx.fillStyle = "#FFFFFF"
        ctx.shadowColor = "rgba(0, 0, 0, 0.05)"
        ctx.shadowBlur = 5
        this.drawRoundedRect(ctx, 20, y, this.width - 40, itemHeight, 15)
        ctx.fill()
        ctx.shadowBlur = 0

        // 排名
        ctx.font = 'bold 40px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
        if (item.rank <= 3) {
            ctx.fillStyle = item.rank === 1 ? "#FFD700" : (item.rank === 2 ? "#C0C0C0" : "#CD7F32")
        } else {
            ctx.fillStyle = "#999999"
        }
        ctx.textAlign = "center"
        ctx.fillText(`#${item.rank}`, 70, y + 65)
        ctx.textAlign = "left"

        // 头像
        await this.drawAvatar(ctx, item.avatarUrl, 120, y + 10, 80)

        // 昵称
        ctx.fillStyle = "#333333"
        ctx.font = 'bold 32px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
        ctx.fillText(item.nickname, 220, y + 60)

        // 数值
        ctx.fillStyle = "#E91E63"
        ctx.font = 'bold 36px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
        ctx.textAlign = "right"
        ctx.fillText(`${item.value}`, this.width - 50, y + 65)
        ctx.textAlign = "left"
    }

    return canvas.toBuffer("image/png")
  }
  async generateTransferImage(data) {
    const canvas = createCanvas(this.width, 400)
    const ctx = canvas.getContext("2d")

    // 背景
    ctx.fillStyle = "#F0F2F5"
    ctx.fillRect(0, 0, this.width, 400)

    // 卡片背景
    ctx.fillStyle = "#FFFFFF"
    ctx.shadowColor = "rgba(0, 0, 0, 0.1)"
    ctx.shadowBlur = 10
    this.drawRoundedRect(ctx, 20, 20, this.width - 40, 360, 20)
    ctx.fill()
    ctx.shadowBlur = 0

    const centerY = 150
    const leftX = 150
    const rightX = 650
    const avatarSize = 120

    // 头像
    await this.drawAvatar(ctx, data.sender.avatarUrl, leftX - avatarSize/2, centerY - avatarSize/2, avatarSize)
    await this.drawAvatar(ctx, data.receiver.avatarUrl, rightX - avatarSize/2, centerY - avatarSize/2, avatarSize)

    // 箭头
    ctx.strokeStyle = "#E91E63"
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(leftX + avatarSize/2 + 20, centerY)
    ctx.lineTo(rightX - avatarSize/2 - 20, centerY)
    ctx.stroke()

    // 箭头头部
    ctx.beginPath()
    ctx.moveTo(rightX - avatarSize/2 - 20, centerY)
    ctx.lineTo(rightX - avatarSize/2 - 40, centerY - 10)
    ctx.lineTo(rightX - avatarSize/2 - 40, centerY + 10)
    ctx.closePath()
    ctx.fillStyle = "#E91E63"
    ctx.fill()

    // 金额
    ctx.fillStyle = "#E91E63"
    ctx.font = 'bold 36px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.textAlign = "center"
    ctx.fillText(`转账 ${data.amount}`, this.width / 2, centerY - 20)
    ctx.textAlign = "left"

    // 昵称
    ctx.fillStyle = "#333333"
    ctx.font = 'bold 28px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.textAlign = "center"
    ctx.fillText(data.sender.nickname, leftX, centerY + avatarSize/2 + 40)
    ctx.fillText(data.receiver.nickname, rightX, centerY + avatarSize/2 + 40)

    // 余额
    ctx.fillStyle = "#666666"
    ctx.font = '24px ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
    ctx.fillText(`剩余: ${data.sender.coins}`, leftX, centerY + avatarSize/2 + 80)
    ctx.fillText(`剩余: ${data.receiver.coins}`, rightX, centerY + avatarSize/2 + 80)
    ctx.textAlign = "left"

    return canvas.toBuffer("image/png")
  }}
