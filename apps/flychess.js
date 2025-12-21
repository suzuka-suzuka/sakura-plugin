import { GameManager } from "../lib/flychess/Rule.js"
import { loadAssets } from "../lib/flychess/ImageDrawer.js"

const activeGames = new Map()

export class Ludo extends plugin {
  constructor() {
    super({
      name: "飞行棋",
      event: "message.group",
      priority: 1135,
    })
  }

  async init() {
    logger.info("[飞行棋] 插件启动，开始加载图像资源...")
    await loadAssets()
  }
  createLudoGame = Command(/^#创建飞行棋$/, async (e) => {
    if (!(e.isMaster || e.isAdmin)) {
      return false
    }
    if (activeGames.has(e.group_id)) {
      await e.reply("本群已经有一局飞行棋正在进行中啦。")
      return true
    }

    const gameManager = new GameManager(e.group, () => {
      activeGames.delete(e.group_id)
      logger.info(`[飞行棋] 群 ${e.group_id} 的游戏已结束并自动清理。`)
    })
    const response = gameManager.createGame()
    activeGames.set(e.group_id, gameManager)

    await e.reply(response)
    return true
  });

  joinLudoGame = Command(/^#?加入飞行棋$/, async (e) => {
    const gameManager = activeGames.get(e.group_id)
    if (!gameManager) {
      return false
    }

    const response = await gameManager.joinGame(e.user_id)
    await e.reply(response)
    return true
  });

  startLudoGame = Command(/^#?开始飞行棋$/, async (e) => {
    const gameManager = activeGames.get(e.group_id)
    if (!gameManager) {
      return false
    }
    await gameManager.startGame()
    return true
  });

  selectPiece = Command(/^[1-4]$/, async (e) => {
    const gameManager = activeGames.get(e.group_id)
    if (!gameManager || !gameManager.isStarted) {
      return false
    }

    const pieceIndex = parseInt(e.msg)
    await gameManager.selectPiece(e.user_id, pieceIndex)
    return true
  });

  endLudoGame = Command(/^#结束飞行棋$/, async (e) => {
    if (!(e.isMaster || e.isAdmin)) {
      return false
    }
    if (activeGames.has(e.group_id)) {
      activeGames.delete(e.group_id)
      await e.reply("飞行棋游戏已由管理员强制结束。")
    } else {
      await e.reply("本群当前没有正在进行的飞行棋游戏。")
    }
    return true
  });
}
