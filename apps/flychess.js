import { GameManager } from "../lib/flychess/Rule.js"
import { loadAssets } from "../lib/flychess/ImageDrawer.js"
import { plugindata } from "../lib/path.js"
import fsp from "fs/promises"
import path from "path"

const activeGames = new Map()
const defaultSaveSlot = "默认"
const saveDir = path.join(plugindata, "flychess-saves")

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

  getSaveSlot(e) {
    return (e.match?.[1] || defaultSaveSlot).trim() || defaultSaveSlot
  }

  sanitizeFilePart(value) {
    const safe = String(value)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\.+$/g, "")
      .slice(0, 80)

    return safe || "default"
  }

  getSavePath(e, slot) {
    const scope = this.sanitizeFilePart(this.getGameKey(e))
    const safeSlot = this.sanitizeFilePart(slot)
    return path.join(saveDir, `${scope}__${safeSlot}.json`)
  }

  canSaveGame(e, gameManager) {
    if (e.isWhite || e.isAdmin) {
      return true
    }

    return gameManager.game?.sides.some((side) => String(side.q) === String(e.user_id))
  }

  async writeSave(e, slot, state) {
    await fsp.mkdir(saveDir, { recursive: true })
    await fsp.writeFile(
      this.getSavePath(e, slot),
      JSON.stringify(
        {
          ...state,
          archive: {
            slot,
            groupId: e.group_id,
            scopeKey: this.getGameKey(e),
            savedBy: e.user_id,
            savedAt: Date.now(),
          },
        },
        null,
        2
      ),
      "utf-8"
    )
  }

  async readSave(e, slot) {
    const raw = await fsp.readFile(this.getSavePath(e, slot), "utf-8")
    return JSON.parse(raw)
  }

  async deleteSave(e, slot) {
    await fsp.unlink(this.getSavePath(e, slot))
  }

  async listSaves(e) {
    const scope = `${this.sanitizeFilePart(this.getGameKey(e))}__`

    let files = []
    try {
      files = await fsp.readdir(saveDir)
    } catch (error) {
      if (error.code === "ENOENT") {
        return []
      }
      throw error
    }

    const saves = []
    for (const file of files) {
      if (!file.startsWith(scope) || !file.endsWith(".json")) {
        continue
      }

      try {
        const data = JSON.parse(
          await fsp.readFile(path.join(saveDir, file), "utf-8")
        )
        saves.push({
          slot: data.archive?.slot || file.slice(scope.length, -5),
          savedAt: data.archive?.savedAt || data.savedAt || 0,
        })
      } catch (error) {
        logger.warn(`[飞行棋] 读取存档 ${file} 失败: ${error.message}`)
      }
    }

    return saves.sort((a, b) => b.savedAt - a.savedAt)
  }

  createLudoGame = Command(/^#创建飞行棋$/, async (e) => {
    if (!(e.isWhite || e.isAdmin)) {
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

  saveLudoGame = Command(/^#?存档飞行棋(?:\s+(.+))?$/, async (e) => {
    const gameManager = activeGames.get(this.getGameKey(e))
    if (!gameManager?.game) {
      return false
    }

    if (!this.canSaveGame(e, gameManager)) {
      await e.reply("只有本局玩家或管理员可以存档飞行棋。")
      return true
    }

    const state = gameManager.exportState()
    if (!state) {
      await e.reply("当前棋盘状态为空，存档失败。")
      return true
    }

    const slot = this.getSaveSlot(e)
    const gameKey = this.getGameKey(e)
    await this.writeSave(e, slot, state)
    activeGames.delete(gameKey)
    logger.info(`[飞行棋] 群 ${e.group_id} 的游戏已存档到「${slot}」并结束当前局。`)
    await e.reply(`飞行棋已存档到「${slot}」，当前局已结束。之后发送【复原飞行棋${slot === defaultSaveSlot ? "" : ` ${slot}`}】可以恢复。`)
    return true
  });

  restoreLudoGame = Command(/^#?(?:复原|恢复|读档)飞行棋(?:\s+(.+))?$/, async (e) => {
    if (!(e.isWhite || e.isAdmin)) {
      return false
    }

    const gameKey = this.getGameKey(e)
    if (activeGames.has(gameKey)) {
      await e.reply("本群已有飞行棋正在进行，不能复原存档。请先结束当前游戏。")
      return true
    }

    const slot = this.getSaveSlot(e)
    let state
    try {
      state = await this.readSave(e, slot)
    } catch (error) {
      if (error.code === "ENOENT") {
        await e.reply(`没有找到「${slot}」这个飞行棋存档。`)
        return true
      }

      logger.error(`[飞行棋] 读取存档失败: ${error.stack || error}`)
      await e.reply("读取飞行棋存档失败，请查看日志。")
      return true
    }

    const gameManager = new GameManager(e.group, () => {
      activeGames.delete(gameKey)
      logger.info(`[飞行棋] 群 ${e.group_id} 的复原游戏已结束并自动清理。`)
    })

    try {
      gameManager.restoreState(state)
    } catch (error) {
      logger.error(`[飞行棋] 复原存档失败: ${error.stack || error}`)
      await e.reply(`复原飞行棋存档失败：${error.message}`)
      return true
    }

    activeGames.set(gameKey, gameManager)

    const currentSide = gameManager.game?.currentSide
    const turnText = currentSide
      ? `当前轮到【${currentSide.color}】方，点数 ${gameManager.lastDiceRoll || "未掷"}。`
      : "当前没有进行中的回合。"

    await e.reply(`已复原飞行棋存档「${slot}」。${turnText}`)
    await gameManager.sendCurrentBoard()
    return true
  });

  listLudoSaves = Command(/^#?飞行棋存档列表$/, async (e) => {
    const saves = await this.listSaves(e)
    if (saves.length === 0) {
      await e.reply("本群还没有飞行棋存档。")
      return true
    }

    const lines = saves.map((save, index) => {
      const timeText = save.savedAt
        ? new Date(save.savedAt).toLocaleString("zh-CN", { hour12: false })
        : "未知时间"
      return `${index + 1}. ${save.slot}（${timeText}）`
    })

    await e.reply(`飞行棋存档列表：\n${lines.join("\n")}`)
    return true
  });

  deleteLudoSave = Command(/^#?(?:删除|移除)飞行棋存档(?:\s+(.+))?$/, async (e) => {
    if (!(e.isWhite || e.isAdmin)) {
      return false
    }

    const slot = this.getSaveSlot(e)

    try {
      await this.deleteSave(e, slot)
    } catch (error) {
      if (error.code === "ENOENT") {
        await e.reply(`没有找到「${slot}」这个飞行棋存档。`)
        return true
      }

      logger.error(`[飞行棋] 删除存档失败: ${error.stack || error}`)
      await e.reply("删除飞行棋存档失败，请查看日志。")
      return true
    }

    await e.reply(`已删除飞行棋存档「${slot}」。`)
    return true
  });

  endLudoGame = Command(/^#结束飞行棋$/, async (e) => {
    if (!(e.isWhite || e.isAdmin)) {
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
