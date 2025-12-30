import { createCanvas, loadImage } from "@napi-rs/canvas"
import EconomyImageGenerator from "./ImageGenerator.js"

export default class FishingImageGenerator extends EconomyImageGenerator {
  constructor() {
    super()
    this.fontFamily = '"ZhuZiAYuan", "MotoyaMaru", sans-serif'
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
        const fishAvatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${item.targetUserId}&s=100`
        await this.drawAvatar(ctx, fishAvatarUrl, x + 10, y + 10, 80)
        
        // Fish Info
        ctx.fillStyle = '#5D4037'
        ctx.font = `bold 24px ${this.fontFamily}`
        const name = item.name || item.targetUserId
        ctx.fillText(this.truncateText(ctx, String(name), itemWidth - 100), x + 100, y + 45)
        
        ctx.font = `20px ${this.fontFamily}`
        ctx.fillStyle = '#795548'
        ctx.fillText(`被钓: ${item.count} 次`, x + 100, y + 80)
    }
    
    return canvas.toBuffer('image/png')
  }
  
  truncateText(ctx, text, maxWidth) {
      if (ctx.measureText(text).width <= maxWidth) return text
      let len = text.length
      while (len > 0 && ctx.measureText(text.substring(0, len) + '...').width > maxWidth) {
          len--
      }
      return text.substring(0, len) + '...'
  }
}
