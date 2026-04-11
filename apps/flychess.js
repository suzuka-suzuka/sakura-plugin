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
    await loadAssets()
  }

  getGameKey(e) {
    return this.getScopeKey(e.group_id)
  }
  createLudoGame = Command(/^#创建飞行棋$/, async (e) => {
    if (!(e.isMaster || e.isAdmin)) {
      return false
    }
    const gameKey = this.getGameKey(e)
    if (activeGames.has(gameKey)) {
      await e.reply("本群已经有一局飞行棋正在进行中啦。")
      return true
    }

    const gameManager = new GameManager(e.group, () => {
      activeGames.delete(gameKey)
      logger.info(`[飞行棋] 群 ${e.group_id} 的游戏已结束并自动清理。`)
    })
    const response = gameManager.createGame()
    activeGames.set(gameKey, gameManager)

    await e.reply(response)
    return true
  });

  joinLudoGame = Command(/^#?加入飞行棋$/, async (e) => {
    const gameManager = activeGames.get(this.getGameKey(e))
    if (!gameManager) {
      return false
    }

    await gameManager.joinGame(e.user_id)
    return true
  });

  startLudoGame = Command(/^#?开始飞行棋$/, async (e) => {
    const gameManager = activeGames.get(this.getGameKey(e))
    if (!gameManager) {
      return false
    }
    await gameManager.startGame()
    return true
  });

  selectPiece = Command(/^[1-4]$/, async (e) => {
    const gameManager = activeGames.get(this.getGameKey(e))
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
    const gameKey = this.getGameKey(e)
    if (activeGames.has(gameKey)) {
      activeGames.delete(gameKey)
      await e.reply("飞行棋游戏已由管理员强制结束。")
    } else {
      await e.reply("本群当前没有正在进行的飞行棋游戏。")
    }
    return true
  });
}
