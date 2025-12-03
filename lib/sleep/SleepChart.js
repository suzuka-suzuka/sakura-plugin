import { createCanvas } from "@napi-rs/canvas"

export async function drawSleepChart(history, senderName) {
  const recentHistory = history.slice(-7)

  const labels = recentHistory.map(h => {
    const date = new Date(h.date)
    return `${date.getMonth() + 1}/${date.getDate()}`
  })
  const data = recentHistory.map(h => h.duration / (1000 * 60 * 60))

  const total = data.reduce((a, b) => a + b, 0)
  const average = total / data.length

  const canvas = createCanvas(800, 500)
  const ctx = canvas.getContext("2d")

  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, 800, 500)

  ctx.fillStyle = "#333333"
  ctx.font = "bold 24px Arial"
  ctx.textAlign = "center"
  ctx.fillText(`${senderName} 的睡眠分析`, 400, 40)

  const chartX = 60
  const chartY = 80
  const chartWidth = 700
  const chartHeight = 350

  ctx.beginPath()
  ctx.moveTo(chartX, chartY)
  ctx.lineTo(chartX, chartY + chartHeight)
  ctx.lineTo(chartX + chartWidth, chartY + chartHeight)
  ctx.strokeStyle = "#666666"
  ctx.lineWidth = 2
  ctx.stroke()

  const maxVal = Math.max(12, ...data)
  const yStep = maxVal / 5
  ctx.textAlign = "right"
  ctx.font = "14px Arial"
  ctx.fillStyle = "#666666"
  for (let i = 0; i <= 5; i++) {
    const y = chartY + chartHeight - (i * chartHeight) / 5
    const val = (i * yStep).toFixed(1)
    ctx.fillText(val + "h", chartX - 10, y + 5)

    ctx.beginPath()
    ctx.moveTo(chartX, y)
    ctx.lineTo(chartX + chartWidth, y)
    ctx.strokeStyle = "#eeeeee"
    ctx.lineWidth = 1
    ctx.stroke()
  }

  const barWidth = 50
  const gap = (chartWidth - barWidth * data.length) / (data.length + 1)

  data.forEach((val, i) => {
    const x = chartX + gap + i * (barWidth + gap)
    const barHeight = (val / maxVal) * chartHeight
    const y = chartY + chartHeight - barHeight

    ctx.fillStyle = val >= average ? "#4CAF50" : "#FF9800"
    ctx.fillRect(x, y, barWidth, barHeight)

    ctx.fillStyle = "#333333"
    ctx.textAlign = "center"
    ctx.fillText(val.toFixed(1), x + barWidth / 2, y - 5)

    ctx.fillStyle = "#666666"
    ctx.fillText(labels[i], x + barWidth / 2, chartY + chartHeight + 20)
  })

  const avgY = chartY + chartHeight - (average / maxVal) * chartHeight
  ctx.beginPath()
  ctx.moveTo(chartX, avgY)
  ctx.lineTo(chartX + chartWidth, avgY)
  ctx.strokeStyle = "#FF5722"
  ctx.lineWidth = 2
  ctx.setLineDash([5, 5])
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = "#FF5722"
  ctx.textAlign = "right"
  ctx.fillText(`平均: ${average.toFixed(1)}h`, chartX + chartWidth - 10, avgY - 10)

  return canvas.toBuffer("image/png")
}
