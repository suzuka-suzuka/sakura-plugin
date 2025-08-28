import { createCanvas, loadImage} from "canvas"
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

    return loadImage(canvas.toBuffer())
  } catch (error) {
    logger.error(`获取头像失败: ${url}`, error)
    return null
  }
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
    const pieceImage = ASSETS_CACHE.pieces[firstPiece.color]

    if (pieceImage) {
      const x = parseInt(firstPiece.position.left, 10) + 5
      const y = parseInt(firstPiece.position.top, 10) + 5
      ctx.drawImage(pieceImage, x, y, 40, 40)

      if (piecesOnSpot.length >= 2) {
        const pieceNumbers = piecesOnSpot
          .map(p => parseInt(p.id.split("-")[1], 10) + 1)
          .sort((a, b) => a - b)
          .join(",")

        ctx.font = "bold 18px sans-serif"
        ctx.fillText(pieceNumbers, x + 20, y + 20)
        ctx.font = "bold 20px sans-serif"
      } else {
        const pieceIndex = parseInt(firstPiece.id.split("-")[1], 10) + 1
        ctx.fillText(pieceIndex.toString(), x + 20, y + 20)
      }
    }
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
