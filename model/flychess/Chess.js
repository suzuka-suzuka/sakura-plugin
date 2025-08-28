import { initSide } from "./Side.js"

class Game {
  constructor(players = []) {
    this.sides = []

    this.turnIndex = -1

    this.currentSide = null

    players.forEach(player => this.addPlayer(player.id, player.color))

    if (this.sides.length > 0) {
      this.nextTurn()
    }
  }

  addPlayer(playerId, color) {
    if (this.sides.some(s => s.color === color || s.q === playerId)) {
      logger.warn(`警告：颜色为 ${color} 或 ID 为 ${playerId} 的玩家已存在。`);
      return false
    }
    const newSide = initSide(color, playerId)
    if (newSide) {
      this.sides.push(newSide)
      return true
    }
    return false
  }

  nextTurn() {
    if (this.sides.length === 0) {
      logger.info("游戏中没有玩家。");
      return
    }

    this.turnIndex++
    if (this.turnIndex >= this.sides.length) {
      this.turnIndex = 0
    }

    this.currentSide = this.sides[this.turnIndex]

    if (this.currentSide.win) {
      this.nextTurn()
    }
  }

  getAllPieces() {
    return this.sides.flatMap(side => side.pieces)
  }

  getGameState() {
    const pieceStates = this.getAllPieces().map(piece => ({
      id: piece.id,
      color: piece.color,
      isReady: piece.isReady,
      isWin: piece.win,
      position: {
        id: piece.position.id,
        top: piece.position.top,
        left: piece.position.left,
      },
    }))

    return {
      currentPlayerId: this.currentSide ? this.currentSide.q : null,
      currentPlayerColor: this.currentSide ? this.currentSide.color : null,
      turnIndex: this.turnIndex,
      pieces: pieceStates,
    }
  }
}

export { Game }
