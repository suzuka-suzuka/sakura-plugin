import { createCanvas, loadImage} from "@napi-rs/canvas"
import axios from "axios"
import path from "path"
import { pluginresources } from "../../lib/path.js"

const assetsDir = path.join(pluginresources, "flychess/img/")

const AVATAR_POSITIONS = {
  green: { x: 125, y: 122 },
  red: { x: 823, y: 125 },
  yellow: { x: 125, y: 822 },
  blue: { x: 822, y: 824 },
}
const DICE_POSITION = { x: 455, y: 460 }
const COLOR_DRAW_ORDER = ["red", "blue", "green", "yellow"]
const PIECE_LAYOUTS = {
  1: [{ dx: 5, dy: 5, size: 40 }],
  2: [
    { dx: 0, dy: 0, size: 34 },
    { dx: 16, dy: 16, size: 34 },
  ],
  3: [
    { dx: 0, dy: 0, size: 30 },
    { dx: 20, dy: 0, size: 30 },
    { dx: 10, dy: 20, size: 30 },
  ],
  4: [
    { dx: 0, dy: 0, size: 26 },
    { dx: 24, dy: 0, size: 26 },
    { dx: 0, dy: 24, size: 26 },
    { dx: 24, dy: 24, size: 26 },
  ],
}

const ASSETS_CACHE = {
  background: null,
  dice: {},
  pieces: {},
}

async function loadAssets() {
  try {
    ASSETS_CACHE.background = await loadImage(path.join(assetsDir, "background.png"))

    for (let i = 1; i <= 6; i++) {
      ASSETS_CACHE.dice[i] = await loadImage(path.join(assetsDir, `${i}.jpg`))
    }

    for (const color of ["red", "blue", "green", "yellow"]) {
      ASSETS_CACHE.pieces[color] = await loadImage(path.join(assetsDir, `${color}.png`))
    }

    logger.info("[飞行棋] 图像资源加载成功！")
  } catch (error) {
    logger.error("[飞行棋] 加载图像资源时出错:", error)
  }
}

async function getAvatar(url, size = 40) {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" })
    const image = await loadImage(response.data)

    const canvas = createCanvas(size, size)
    const ctx = canvas.getContext("2d")
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2, true)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(image, 0, 0, size, size)

    return canvas
  } catch (error) {
    logger.error(`获取头像失败: ${url}`, error)
    return null
  }
}

function getPieceIndex(piece) {
  return parseInt(piece.id.split("-")[1], 10) + 1
}

function groupPiecesByColor(pieces) {
  const groupsByColor = new Map()

  for (const piece of pieces) {
    if (!groupsByColor.has(piece.color)) {
      groupsByColor.set(piece.color, [])
    }
    groupsByColor.get(piece.color).push(piece)
  }

  return [...groupsByColor.entries()]
    .sort(([leftColor], [rightColor]) => {
      const leftIndex = COLOR_DRAW_ORDER.indexOf(leftColor)
      const rightIndex = COLOR_DRAW_ORDER.indexOf(rightColor)
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex)
    })
    .map(([, colorPieces]) =>
      colorPieces.sort((left, right) => getPieceIndex(left) - getPieceIndex(right))
    )
}

function drawPieceLabel(ctx, label, x, y, size) {
  let fontSize = Math.max(9, Math.round(size * (label.length > 1 ? 0.42 : 0.55)))

  while (fontSize > 8) {
    ctx.font = `bold ${fontSize}px sans-serif`
    if (ctx.measureText(label).width <= size - 4) {
      break
    }
    fontSize--
  }

  ctx.lineWidth = Math.max(2, Math.round(size / 12))
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)"
  ctx.fillStyle = "black"
  ctx.strokeText(label, x + size / 2, y + size / 2)
  ctx.fillText(label, x + size / 2, y + size / 2)
}

function drawPieceGroup(ctx, pieces, layout, originX, originY) {
  const firstPiece = pieces[0]
  const pieceImage = ASSETS_CACHE.pieces[firstPiece.color]
  if (!pieceImage) {
    return
  }

  const x = originX + layout.dx
  const y = originY + layout.dy
  const size = layout.size
  const pieceNumbers = pieces.map(getPieceIndex).join(",")

  ctx.drawImage(pieceImage, x, y, size, size)
  drawPieceLabel(ctx, pieceNumbers, x, y, size)
}

async function drawGameBoard(game, diceResult = 0) {
  if (!ASSETS_CACHE.background) {
    logger.error("[飞行棋] 背景图片未加载，无法绘制。")
    return null
  }

  const canvas = createCanvas(ASSETS_CACHE.background.width, ASSETS_CACHE.background.height)
  const ctx = canvas.getContext("2d")

  ctx.drawImage(ASSETS_CACHE.background, 0, 0)

  const gameState = game.getGameState()
  ctx.font = "bold 20px sans-serif"
  ctx.fillStyle = "black"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"

  const piecesByPosition = new Map()
  for (const piece of gameState.pieces) {
    if (piece.position && typeof piece.position.id !== "undefined") {
      if (!piecesByPosition.has(piece.position.id)) {
        piecesByPosition.set(piece.position.id, [])
      }
      piecesByPosition.get(piece.position.id).push(piece)
    }
  }

  for (const [, piecesOnSpot] of piecesByPosition.entries()) {
    if (piecesOnSpot.length === 0) continue

    const firstPiece = piecesOnSpot[0]
    const originX = parseInt(firstPiece.position.left, 10)
    const originY = parseInt(firstPiece.position.top, 10)
    const colorGroups = groupPiecesByColor(piecesOnSpot)
    const layouts = PIECE_LAYOUTS[Math.min(colorGroups.length, 4)]

    colorGroups.forEach((pieces, index) => {
      drawPieceGroup(ctx, pieces, layouts[index], originX, originY)
    })
  }

  for (const side of game.sides) {
    const avatarUrl = `http://q1.qlogo.cn/g?b=qq&nk=${side.q}&s=100`
    const avatarImage = await getAvatar(avatarUrl)
    const pos = AVATAR_POSITIONS[side.color]
    if (avatarImage && pos) {
      ctx.drawImage(avatarImage, pos.x, pos.y)
    }
  }

  if (diceResult > 0 && diceResult <= 6) {
    const diceImage = ASSETS_CACHE.dice[diceResult]
    if (diceImage) {
      ctx.drawImage(diceImage, DICE_POSITION.x, DICE_POSITION.y, 70, 70)
    }
  }

  return canvas.toBuffer("image/jpeg", { quality: 0.8 })
}

export { loadAssets, drawGameBoard }
