import fs from "fs"
import path from "path"

const dataPath = path.resolve(
  process.cwd(),
  "plugins/sakura-plugin/resources/flychess/position.json",
)

class Position {
  constructor({ id, top, left, color, super: s, r, state }) {
    this.id = id

    this.top = top

    this.left = left

    this.color = color

    this.s = s

    this.r = r

    this.state = state
  }

  intLeft() {
    return Math.floor(parseFloat(this.left))
  }

  intTop() {
    return Math.floor(parseFloat(this.top))
  }

  toString() {
    return `Position{id=${this.id}, top='${this.top}', left='${this.left}', color='${this.color}', s='${this.s}', r='${this.r}', state='${this.state}'}`
  }

  equals(other) {
    if (this === other) return true
    if (!other || typeof other.id === "undefined") return false
    return this.id === other.id
  }
}

let POSITIONS = []

let ID2POSITION = new Map()

try {
  if (fs.existsSync(dataPath)) {
    const jsonString = fs.readFileSync(dataPath, "utf-8")
    const rawPositions = JSON.parse(jsonString)

    POSITIONS = rawPositions.map(p => new Position(p))

    for (const position of POSITIONS) {
      ID2POSITION.set(position.id, position)
    }
  } else {
    logger.error(`[飞行棋] 错误: 未在以下路径找到 position.json: ${dataPath}`)
    logger.error("[飞行棋] 请确保数据文件存在且路径配置正确。")
  }
} catch (e) {
  logger.error("[飞行棋] 加载或解析 position.json 时出错:", e)
}

export { Position, POSITIONS, ID2POSITION }
