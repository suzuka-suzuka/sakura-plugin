import { createCanvas, loadImage } from "@napi-rs/canvas"
import EconomyImageGenerator from "./ImageGenerator.js"

export default class FishingImageGenerator extends EconomyImageGenerator {
  constructor() {
    super()
    this.fontFamily = 'ZhuZiAYuan, "MotoyaMaru", "Noto Color Emoji", "Noto Sans SC", sans-serif'
  }

  async generateFishingRecord(userData, history, targetName, targetId) {
    const columns = 2
    const padding = 20
    const itemHeight = 100
    const headerHeight = 220
    
    const width = 800
    const itemWidth = (width - (columns + 1) * padding) / columns
    
    const rows = Math.ceil(history.length / columns)
    const height = Math.max(600, headerHeight + rows * (itemHeight + padding) + padding)
    
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    
    this.drawSakuraBackground(ctx, width, height)
    
    // Draw Header
    // Avatar
    const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${targetId}&s=640`
    await this.drawAvatar(ctx, avatarUrl, 40, 40, 140)
    
    // Info
    ctx.fillStyle = '#5D4037'
    ctx.font = `bold 40px ${this.fontFamily}`
    ctx.fillText(`${targetName} 的钓鱼记录`, 200, 80)
    
    ctx.font = `28px ${this.fontFamily}`
    ctx.fillText(`🎣 总钓鱼次数：${userData.totalCatch || 0} 次`, 200, 130)
    ctx.fillText(`💰 总收益：${userData.totalEarnings || 0} 樱花币`, 200, 170)
    
    // Draw History
    const startY = headerHeight
    
    for (let i = 0; i < history.length; i++) {
        const item = history[i]
        const col = i % columns
        const row = Math.floor(i / columns)
        
        const x = padding + col * (itemWidth + padding)
        const y = startY + row * (itemHeight + padding)
        
        // Item Background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
        this.drawRoundedRect(ctx, x, y, itemWidth, itemHeight, 15)
        ctx.fill()
        
        // Fish Avatar
        if (item.isDangerous) {
            // 危险生物 - 绘制占位圆形背景
            ctx.fillStyle = 'rgba(255, 100, 100, 0.3)'
            ctx.beginPath()
            ctx.arc(x + 10 + 40, y + 10 + 40, 40, 0, Math.PI * 2)
            ctx.fill()
            
            // 绘制问号或骷髅图标
            ctx.fillStyle = '#CC3333'
            ctx.font = `bold 48px ${this.fontFamily}`
            ctx.textAlign = 'center'
            ctx.fillText('💀', x + 10 + 40, y + 10 + 55)
            ctx.textAlign = 'left'
        } else {
            const fishAvatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${item.targetUserId}&s=100`
            await this.drawAvatar(ctx, fishAvatarUrl, x + 10, y + 10, 80)
        }
        
        // Fish Info
        ctx.fillStyle = '#5D4037'
        ctx.font = `bold 24px ${this.fontFamily}`
        const name = item.name || item.targetUserId
        ctx.fillText(this.truncateText(ctx, String(name), itemWidth - 100), x + 100, y + 45)
        
        ctx.font = `20px ${this.fontFamily}`
        ctx.fillStyle = item.isDangerous ? '#CC3333' : '#795548'
        ctx.fillText(item.isDangerous ? `击败: ${item.count} 次` : `被钓: ${item.count} 次`, x + 100, y + 80)
    }
    
    return canvas.toBuffer('image/png')
  }

  async generateFishingRankingImage(data) {
    const itemHeight = 100
    const headerHeight = 120
    const padding = 20
    const listHeight = data.list.length * (itemHeight + padding)
    const height = headerHeight + listHeight + padding
    
    const canvas = createCanvas(this.width, height)
    const ctx = canvas.getContext('2d')

    this.drawSakuraBackground(ctx, this.width, height)

    // 标题
    ctx.fillStyle = "#FF1493"
    ctx.font = `bold 40px ${this.fontFamily}`
    ctx.textAlign = "center"
    ctx.fillText(data.title, this.width / 2, 80)
    ctx.textAlign = "left"

    for (let i = 0; i < data.list.length; i++) {
        const item = data.list[i]
        const y = headerHeight + i * (itemHeight + padding)
        
        // 卡片背景
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)"
        ctx.shadowColor = "rgba(255, 105, 180, 0.15)"
        ctx.shadowBlur = 8
        this.drawRoundedRect(ctx, 20, y, this.width - 40, itemHeight, 15)
        ctx.fill()
        ctx.shadowBlur = 0

        // 排名
        ctx.font = `bold 36px ${this.fontFamily}`
        if (item.rank <= 3) {
            ctx.fillStyle = item.rank == 1 ? "#FF1493" : (item.rank == 2 ? "#FF69B4" : "#FFB3D9")
        } else {
            ctx.fillStyle = "#FFC0CB"
        }
        ctx.textAlign = "center"
        ctx.fillText(`${item.rank}`, 70, y + 65)
        ctx.textAlign = "left"

        // 头像
        await this.drawAvatar(ctx, item.avatarUrl, 120, y + 10, 80)

        // 昵称
        ctx.fillStyle = "#666666"
        ctx.font = `bold 24px ${this.fontFamily}`
        
        const nicknameX = 220
        // 右侧显示收益和次数
        const valueText = `💰 ${item.totalEarnings}`
        const countText = `🎣 ${item.totalCatch}次`
        
        ctx.fillStyle = "#FF1493"
        ctx.font = `bold 26px ${this.fontFamily}`
        ctx.textAlign = "right"
        ctx.fillText(valueText, this.width - 50, y + 45)
        
        ctx.fillStyle = "#888888"
        ctx.font = `20px ${this.fontFamily}`
        ctx.fillText(countText, this.width - 50, y + 75)
        ctx.textAlign = "left"

        // 昵称（左侧）
        ctx.fillStyle = "#666666"
        ctx.font = `bold 24px ${this.fontFamily}`
        const maxNicknameWidth = this.width - 280
        const lines = this.wrapText(ctx, item.nickname, maxNicknameWidth)

        if (lines.length > 2) {
             lines[1] = lines[1] + '...'
             lines.length = 2
        }

        if (lines.length === 1) {
            ctx.fillText(lines[0], nicknameX, y + 60)
        } else {
            ctx.font = `bold 20px ${this.fontFamily}`
            ctx.fillText(lines[0], nicknameX, y + 45)
            ctx.fillText(lines[1], nicknameX, y + 75)
        }
    }

    return canvas.toBuffer("image/png")
  }
  
  truncateText(ctx, text, maxWidth) {
      if (ctx.measureText(text).width <= maxWidth) return text
      let len = text.length
      while (len > 0 && ctx.measureText(text.substring(0, len) + '...').width > maxWidth) {
          len--
      }
      return text.substring(0, len) + '...'
  }

  async generateCatchResult(data) {
    const width = 600
    const height = 850
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')

    this.drawSakuraBackground(ctx, width, height)

    // 卡片背景
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)"
    ctx.shadowColor = "rgba(0, 0, 0, 0.1)"
    ctx.shadowBlur = 20
    this.drawRoundedRect(ctx, 40, 40, width - 80, height - 80, 30)
    ctx.fill()
    ctx.shadowBlur = 0

    // 标题
    ctx.fillStyle = "#FF69B4"
    ctx.font = `bold 48px ${this.fontFamily}`
    ctx.textAlign = "center"
    ctx.fillText("🎉 钓鱼成功！", width / 2, 120)

    // 鱼的头像
    const avatarSize = 200
    const avatarX = (width - avatarSize) / 2
    const avatarY = 160
    
    // 头像光环
    ctx.beginPath()
    ctx.arc(width / 2, avatarY + avatarSize / 2, avatarSize / 2 + 10, 0, Math.PI * 2)
    ctx.fillStyle = data.rarity.color === '🟠' ? '#FFD700' : // 传说
                   data.rarity.color === '🟣' ? '#DA70D6' : // 史诗
                   data.rarity.color === '🔵' ? '#87CEEB' : // 稀有
                   data.rarity.color === '🟢' ? '#90EE90' : '#E0E0E0' // 精良/普通
    ctx.fill()

    await this.drawAvatar(ctx, data.fishAvatarUrl, avatarX, avatarY, avatarSize)

    // 鱼的名字（不包含身份）
    ctx.fillStyle = "#333333"
    ctx.font = `bold 36px ${this.fontFamily}`
    const fullName = `${data.fishNameBonus}【${data.fishName}】`
    
    // 简单的自动换行处理
    const lines = this.wrapText(ctx, fullName, width - 120)
    let textY = 420
    for (const line of lines) {
        ctx.fillText(line, width / 2, textY)
        textY += 45
    }

    // 身份（放在名字下方）
    if (data.role === "owner" || data.role === "admin") {
        textY += 10
        ctx.fillStyle = data.role === "owner" ? "#FFD700" : "#87CEEB"
        ctx.font = `bold 28px ${this.fontFamily}`
        const roleName = data.role === "owner" ? "👑 群主" : "⭐ 管理员"
        ctx.fillText(roleName, width / 2, textY)
        textY += 10
    }

    // 稀有度
    textY += 20
    ctx.font = `bold 32px ${this.fontFamily}`
    ctx.fillStyle = data.rarity.color === '🟠' ? '#FF8C00' : 
                   data.rarity.color === '🟣' ? '#800080' : 
                   data.rarity.color === '🔵' ? '#0000CD' : 
                   data.rarity.color === '🟢' ? '#006400' : '#696969'
    ctx.fillText(`${data.rarity.color} ${data.rarity.name}`, width / 2, textY)

    // 新鲜度
    textY += 50
    ctx.fillStyle = "#666666"
    ctx.font = `24px ${this.fontFamily}`
    const freshnessPercent = (data.freshness * 100).toFixed(2) + "%"
    ctx.fillText(`新鲜度：${freshnessPercent}`, width / 2, textY)

    // 重量
    textY += 35
    ctx.fillText(`重量：${data.weight}`, width / 2, textY)

    // 收益
    textY += 60
    ctx.fillStyle = "#FF1493"
    ctx.font = `bold 40px ${this.fontFamily}`
    ctx.fillText(`💰 +${data.price} 樱花币`, width / 2, textY)

    // 底部装饰
    ctx.fillStyle = "#FFB6C1"
    ctx.font = `20px ${this.fontFamily}`
    ctx.fillText("Sakura Fishing System", width / 2, height - 40)

    return canvas.toBuffer('image/png')
  }
}
