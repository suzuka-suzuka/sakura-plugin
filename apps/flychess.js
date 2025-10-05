import { GameManager } from "../lib/flychess/Rule.js"
import { loadAssets } from "../lib/flychess/ImageDrawer.js"

const activeGames = new Map()

export class Ludo extends plugin {
  constructor() {
    super({
      name: "飞行棋",
      dsc: "多人在线飞行棋游戏",
      event: "message.group",
      priority: 1135,
      rule: [
        {
          reg: "^#创建飞行棋$",
          fnc: "createLudoGame",
          log: false,
        },
        {
          reg: "^#?加入飞行棋$",
          fnc: "joinLudoGame",
          log: false,
        },
        {
          reg: "^#?开始飞行棋$",
          fnc: "startLudoGame",
          log: false,
        },
        {
          reg: "^[1-4]$",
          fnc: "selectPiece",
          log: false,
        },
        {
          reg: "^#结束飞行棋$",
          fnc: "endLudoGame",
          log: false,
        },
      ],
    })
  }

  async init() {
    logger.info("[飞行棋] 插件启动，开始加载图像资源...")
    await loadAssets()
  }
  async createLudoGame(e) {
    if (!(e.isMaster || e.isAdmin || e.isOwner)) {
      return false
    }
    if (activeGames.has(e.group_id)) {
      await this.reply("本群已经有一局飞行棋正在进行中啦。")
      return true
    }

    const gameManager = new GameManager(e.group, () => {
      activeGames.delete(e.group_id)
      logger.info(`[飞行棋] 群 ${e.group_id} 的游戏已结束并自动清理。`)
    })
    const response = gameManager.createGame()
    activeGames.set(e.group_id, gameManager)

    await this.reply(response)
    return true
  }

  async joinLudoGame(e) {
    const gameManager = activeGames.get(e.group_id)
    if (!gameManager) {
      return false
    }

    const response = await gameManager.joinGame(e.user_id)
    await this.reply(response)
    return true
  }

  async startLudoGame(e) {
    const gameManager = activeGames.get(e.group_id)
    if (!gameManager) {
      return false
    }
    await gameManager.startGame()
    return true
  }

  async selectPiece(e) {
    const gameManager = activeGames.get(e.group_id)
    if (!gameManager || !gameManager.isStarted) {
      return false
    }

    const pieceIndex = parseInt(e.msg)
    await gameManager.selectPiece(e.user_id, pieceIndex)
    return true
  }

  async endLudoGame(e) {
    if (!(e.isMaster || e.isAdmin || e.isOwner)) {
      return false
    }
    if (activeGames.has(e.group_id)) {
      activeGames.delete(e.group_id)
      await this.reply("飞行棋游戏已由管理员强制结束。")
    } else {
      await this.reply("本群当前没有正在进行的飞行棋游戏。")
    }
    return true
  }
}
