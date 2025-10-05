import { Game } from "./Chess.js"
import { drawGameBoard } from "./ImageDrawer.js"

const GAME_STATE = {
  IDLE: 0,
  WAITING_FOR_ROLL: 1,
  WAITING_FOR_SELECT: 2,
}

class GameManager {
  constructor(group, onGameEndCallback) {
    this.context = group
    this.game = null
    this.isStarted = false
    this.startTime = 0
    this.gameState = GAME_STATE.IDLE
    this.lastDiceRoll = 0
    this.winRanking = []
    this.onGameEnd = onGameEndCallback
  }

  createGame() {
    if (this.game) {
      return "棋盘已经创建，请先加入游戏。"
    }
    this.game = new Game()
    this.startTime = Date.now()
    return "飞行棋盘创建完成！\n发送【加入飞行棋】即可加入游戏。"
  }

  async joinGame(userId) {
    if (this.isStarted) {
      await this.context.sendMsg("游戏已经开始，无法加入。")
      return
    }
    if (!this.game) {
      await this.context.sendMsg("游戏还未创建，请发送【创建飞行棋】。")
      return
    }
    if (this.game.sides.some(s => s.q === userId)) {
      await this.context.sendMsg("你已经加入了。")
      return
    }

    const colors = ["blue", "yellow", "green", "red"]
    const currentColor = colors[this.game.sides.length]

    if (!currentColor) {
      await this.context.sendMsg("房间已满（最多4人）。")
      return
    }

    this.game.addPlayer(userId, currentColor)

    await this.context.sendMsg([segment.at(userId), ` 你成功加入了【${currentColor}】方！`])

    const imageBuffer = await drawGameBoard(this.game)
    if (imageBuffer) {
      await this.context.sendMsg(segment.image(imageBuffer))
    }

    if (this.game.sides.length === 4) {
      await this.context.sendMsg("人数已满，游戏自动开始！")
      await this.startGame()
    }
  }

  async startGame() {
    if (!this.game || this.game.sides.length < 2) {
      await this.context.sendMsg("人数不足两人，无法开始游戏。")
      return
    }
    if (this.isStarted) {
      await this.context.sendMsg("游戏已经开始了。")
      return
    }

    this.isStarted = true
    this.game.nextTurn()
    await this.processTurn()
  }

  async selectPiece(userId, pieceIndex) {
    if (this.gameState !== GAME_STATE.WAITING_FOR_SELECT) {
      await this.context.sendMsg([segment.at(userId), " 现在不是选择棋子的时候。"])
      return
    }
    if (userId !== this.game.currentSide.q) {
      await this.context.sendMsg([segment.at(userId), " 还没轮到你呢！"])
      return
    }

    const side = this.game.currentSide
    const piece = side.pieces[pieceIndex - 1]

    if (!piece) {
      await this.context.sendMsg("无效的棋子编号。")
      return
    }

    const movablePieces = this.getMovablePieces(side, this.lastDiceRoll)
    if (!movablePieces.some(p => p.index === pieceIndex)) {
      await this.context.sendMsg("这个棋子现在无法移动哦。")
      return
    }

    await this.movePiece(side, piece, pieceIndex)
    this.checkPlayerWin(side)

    if (this.isStarted) {
      if (this.lastDiceRoll === 6) {
        await this.processTurn(true)
      } else {
        await this.nextTurn()
      }
    }
  }

  async movePiece(side, piece, pieceIndex) {
    if (piece.win) {
      await this.context.sendMsg("这个棋子已经到达终点啦。")
      return
    }

    if (!piece.isReady) {
      if (this.lastDiceRoll > 4) {
        piece.ready()
        await this.context.sendMsg(`【${side.color}】方的 ${pieceIndex} 号棋子起飞！`)
      } else {
        await this.context.sendMsg("只有掷出5点或6点才能起飞哦。")
        return
      }
    } else {
      const allPieces = this.game.getAllPieces()
      const ruleCallbacks = {
        attack: isStackCollision => {
          if (isStackCollision) {
            this.context.sendMsg("💥 迭子碰撞！双方棋子都返回了停机坪！")
          } else {
            this.context.sendMsg("💥 击退了一个敌方棋子！")
          }
        },
        tipsJump: () => this.context.sendMsg("🚀 踩中同色格子，向前跳跃！"),
        tipsFly: () => this.context.sendMsg("✈️ 触发飞行航线，超级飞行！"),
        win: p => this.handlePieceWin(p),
      }
      piece.jumpStep(this.lastDiceRoll, allPieces, ruleCallbacks)
    }
  }

  async nextTurn() {
    this.game.nextTurn()
    if (!this.isStarted) return
    await this.processTurn()
  }

  async processTurn(isExtraTurn = false) {
    this.gameState = GAME_STATE.WAITING_FOR_ROLL
    const side = this.game.currentSide

    let initialMessage = []
    if (isExtraTurn) {
      initialMessage.push("你掷出了6，可以再行动一次！\n")
    }
    initialMessage.push(`轮到【${side.color}】方 `, segment.at(side.q), "，正在自动为你掷骰子...")
    await this.context.sendMsg(initialMessage)

    this.lastDiceRoll = Math.ceil(Math.random() * 6)

    if (this.game.currentSide.test(this.lastDiceRoll)) {
      this.rollbackAllPieces(this.game.currentSide)
      await this.nextTurn()
      return
    }

    const movablePieces = this.getMovablePieces(this.game.currentSide, this.lastDiceRoll)

    if (movablePieces.length === 0) {
      await this.context.sendMsg([
        segment.at(side.q),
        ` 你掷出的点数是：${this.lastDiceRoll}。\n没有可以移动的棋子，回合结束。`,
      ])

      await this.nextTurn()
      return
    }

    this.gameState = GAME_STATE.WAITING_FOR_SELECT
    await this.context.sendMsg([
      segment.at(side.q),
      ` 你掷出的点数是：${this.lastDiceRoll}。\n请发送【棋子编号】(${movablePieces.map(p => p.index).join("/")})来移动棋子。`,
    ])
    const imageBuffer = await drawGameBoard(this.game, this.lastDiceRoll)
    if (imageBuffer) {
      await this.context.sendMsg(segment.image(imageBuffer))
    }
  }

  getMovablePieces(side, diceRoll) {
    return side.pieces
      .map((p, index) => ({ piece: p, index: index + 1 }))
      .filter(item => {
        if (item.piece.win) return false
        if (item.piece.isReady) return true
        if (!item.piece.isReady && diceRoll > 4) return true
        return false
      })
  }

  rollbackAllPieces(side) {
    side.pieces.forEach(p => {
      p.reset()
    })
    this.context.sendMsg([segment.at(side.q), " 不好！你连续掷出了3个6，所有棋子都返回了停机坪！"])
  }

  handlePieceWin(piece) {
    this.context.sendMsg(
      `🎉 恭喜【${piece.color}】方的 ${parseInt(piece.id.split("-")[1], 10) + 1} 号棋子到达终点！`,
    )
  }

  checkPlayerWin(side) {
    if (side.win) return

    if (side.pieces.every(p => p.win)) {
      side.win = true
      this.winRanking.push(side.q)
      this.context.sendMsg(segment.at(side.q), ` 的所有棋子都已到达终点，获得了胜利！`)
      this.checkGameEnd()
    }
  }

  checkGameEnd() {
    const activePlayers = this.game.sides.filter(s => !s.win).length
    if (activePlayers <= 1) {
      if (this.isStarted) {
        const lastPlayer = this.game.sides.find(s => !s.win)
        if (lastPlayer && !this.winRanking.includes(lastPlayer.q)) {
          this.winRanking.push(lastPlayer.q)
        }
        this.endGame()
      }
    }
  }

  endGame() {
    this.isStarted = false
    const duration = this.formatTime(Date.now() - this.startTime)

    const messageParts = []

    messageParts.push("游戏结束！\n")
    messageParts.push(`本局用时：${duration}\n`)
    messageParts.push("最终排名：\n")

    this.winRanking.forEach((userId, index) => {
      messageParts.push(`第 ${index + 1} 名: `)
      messageParts.push(segment.at(userId))
      messageParts.push("\n")
    })

    this.context.sendMsg(messageParts)
    if (this.onGameEnd) {
      this.onGameEnd()
    }
    this.game = null
    this.gameState = GAME_STATE.IDLE
    this.winRanking = []
  }

  formatTime(ms) {
    let seconds = Math.floor(ms / 1000)
    let minutes = Math.floor(seconds / 60)
    let hours = Math.floor(minutes / 60)
    seconds %= 60
    minutes %= 60
    let result = ""
    if (hours > 0) result += `${hours}小时`
    if (minutes > 0) result += `${minutes}分钟`
    result += `${seconds}秒`
    return result
  }
}

export { GameManager }
