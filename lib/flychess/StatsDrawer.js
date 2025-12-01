import { createCanvas } from "@napi-rs/canvas"

export async function drawStats(game) {
  const width = 800
  const height = 150 + game.sides.length * 260
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext("2d")

  ctx.fillStyle = "#f0f2f5"
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = "#333"
  ctx.font = "bold 40px Arial"
  ctx.textAlign = "center"
  ctx.fillText("飞行棋战绩统计", width / 2, 60)

  let y = 100
  for (const side of game.sides) {
    drawPlayerStats(ctx, side, y, width)
    y += 260
  }

  return canvas.toBuffer("image/png")
}

function drawPlayerStats(ctx, side, y, width) {
  const padding = 20
  const boxHeight = 240

  ctx.fillStyle = "#fff"
  ctx.shadowColor = "rgba(0,0,0,0.1)"
  ctx.shadowBlur = 10
  ctx.fillRect(padding, y, width - padding * 2, boxHeight)
  ctx.shadowBlur = 0

  ctx.fillStyle = side.color
  ctx.fillRect(padding, y, 10, boxHeight)

  ctx.fillStyle = "#333"
  ctx.font = "bold 24px Arial"
  ctx.textAlign = "left"
  ctx.fillText(`玩家: ${side.q} (${side.color})`, padding + 30, y + 40)
  if (side.win) {
    ctx.fillStyle = "#FFD700"
    ctx.fillText("👑 胜利", width - 150, y + 40)
  }

  ctx.fillStyle = "#333"
  ctx.font = "20px Arial"
  ctx.fillText("骰子统计:", padding + 30, y + 80)

  const totalRolls = Object.values(side.stats.diceRolls).reduce((a, b) => a + b, 0)
  let dx = padding + 30
  const dy = y + 120
  const barWidth = 40
  const maxBarHeight = 60

  for (let i = 1; i <= 6; i++) {
    const count = side.stats.diceRolls[i] || 0
    const pct = totalRolls > 0 ? ((count / totalRolls) * 100).toFixed(1) : "0.0"

    const h = totalRolls > 0 ? (count / totalRolls) * maxBarHeight * 2.5 : 0
    const actualH = Math.min(h, maxBarHeight)

    ctx.fillStyle = getColorHex(side.color)
    ctx.fillRect(dx, dy + maxBarHeight - actualH, barWidth, actualH)

    ctx.fillStyle = "#666"
    ctx.font = "12px Arial"
    ctx.textAlign = "center"
    ctx.fillText(`${i}`, dx + barWidth / 2, dy + maxBarHeight + 15)
    ctx.fillText(`${count}`, dx + barWidth / 2, dy + maxBarHeight - actualH - 5)
    ctx.fillText(`${pct}%`, dx + barWidth / 2, dy + maxBarHeight + 30)

    dx += 60
  }

  ctx.fillStyle = "#333"
  ctx.font = "20px Arial"
  ctx.textAlign = "left"
  ctx.fillText("攻击统计:", width / 2 + 20, y + 80)

  let ay = y + 110
  let hasAttacks = false
  for (const [color, count] of Object.entries(side.stats.attacks)) {
    if (count > 0) {
      ctx.fillStyle = getColorHex(color)
      ctx.font = "bold 16px Arial"
      ctx.fillText(`攻击 ${color}: ${count} 次`, width / 2 + 20, ay)
      ay += 25
      hasAttacks = true
    }
  }
  if (!hasAttacks) {
    ctx.fillStyle = "#999"
    ctx.font = "italic 16px Arial"
    ctx.fillText("和平主义者 (无攻击)", width / 2 + 20, ay)
  }
}

function getColorHex(color) {
  switch (color) {
    case "red":
      return "#FF4D4F"
    case "blue":
      return "#1890FF"
    case "green":
      return "#52C41A"
    case "yellow":
      return "#FAAD14"
    default:
      return "#888"
  }
}
