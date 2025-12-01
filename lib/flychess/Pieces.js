import { ID2POSITION } from "./Position.js"

const Rule = {
  win: (piece, color) => logger.info(`${color}方棋子 ${piece.id} 获胜了！`),
  tipsJump: () => logger.info("跳到了下一个同色格！"),
  tipsFly: () => logger.info("超级飞行！"),
  attack: () => logger.info("攻击了对方棋子！"),
}

class Piece {
  constructor(initialPosition, color, roadTemplate, id) {
    this.id = id
    this.position = initialPosition
    this.oPosition = initialPosition
    this.color = color
    this.road = roadTemplate.copy()
    this.isReady = false
    this.win = false
    this.isStacked = false
  }

  jumpStep(r, allPieces, ruleCallbacks = Rule) {
    if (this.win || !this.isReady) {
      return
    }

    const originalPositionId = this.position.id

    const currentRoadIndex = this.road.index
    for (let i = 1; i <= r; i++) {
      const nextStepIndex = currentRoadIndex + i
      if (nextStepIndex >= this.road.list.length) break

      const pathPos = this.road.list[nextStepIndex]
      const opponentsOnPathPos = allPieces.filter(
        p => p.position.id === pathPos.id && p.color !== this.color && !p.win && p.isStacked,
      )

      if (opponentsOnPathPos.length > 0) {
        const stepsToStack = i
        logger.info(`路径上在 ${stepsToStack} 步处遇到敌方叠子!`)
        const excessSteps = r - stepsToStack

        if (excessSteps > 0) {
          logger.info(`点数大于与叠子的距离，从叠子处后退 ${excessSteps} 步。`)
          const stackRoadIndex = nextStepIndex
          const newIndex = stackRoadIndex - excessSteps
          this.position = this.road.list[Math.max(0, newIndex)]
          this.road.update(this.position.id)
        } else {
          this.position = this.road.next(r)
        }

        this._testState(allPieces, ruleCallbacks, r)
        this._updateStackStatusAtPosition(originalPositionId, allPieces)
        this._updateStackStatusAtPosition(this.position.id, allPieces)
        return
      }
    }

    this.position = this.road.next(r)
    this._testState(allPieces, ruleCallbacks, r)

    this._updateStackStatusAtPosition(originalPositionId, allPieces)
    this._updateStackStatusAtPosition(this.position.id, allPieces)
  }

  ready() {
    this.isReady = true
    this.position = this.road.start()
  }

  reset() {
    if (this.road.setIndex) {
      this.road.setIndex(0)
    }
    this.isReady = false
    this.win = false
    this.position = this.oPosition
    this.isStacked = false
    logger.info(`棋子 ${this.id} 被送回了基地。`)
  }
  _testState(allPieces, R, r) {
    if (this.position.state === "win") {
      this.win = true
      R.win(this, this.color)
      this.road.update(this.position.id)
      return
    }

    if (this._tryAttack(allPieces, R, r)) {
      this.road.update(this.position.id)
      return
    }

    let firstMoveWasFly = false
    let firstMoveWasJump = false

    if (this.position.color === this.color && this.position.s) {
      const flyToId = parseInt(this.position.s, 10)
      this.position = ID2POSITION.get(flyToId)
      R.tipsFly()
      firstMoveWasFly = true
    } else if (this.position.color === this.color && !this.position.r) {
      const nextPos = this._getNextColor(allPieces)
      if (nextPos) {
        this.position = nextPos
        R.tipsJump()
        firstMoveWasJump = true
      }
    }

    if (!firstMoveWasFly && !firstMoveWasJump) {
      this.road.update(this.position.id)
      return
    }

    if (this._tryAttack(allPieces, R, r)) {
      this.road.update(this.position.id)
    if (firstMoveWasFly && this.position.color === this.color && !this.position.r) {
      const nextPos = this._getNextColor(allPieces)
      if (nextPos) {
        this.position = nextPos
        R.tipsJump()
        this._tryAttack(allPieces, R, r)
      }
    } this.position = this._getNextColor(allPieces)
      R.tipsJump()
      this._tryAttack(allPieces, R, r)
    } else if (firstMoveWasJump && this.position.color === this.color && this.position.s) {
      const flyToId = parseInt(this.position.s, 10)
      this.position = ID2POSITION.get(flyToId)
      R.tipsFly()
      this._tryAttack(allPieces, R, r)
    }

    this.road.update(this.position.id)
  }

  _tryAttack(allPieces, R, r) {
    if (this.position.id === null || typeof this.position.id === "undefined" || this.position.r) {
      return false
    }

    const opponentsOnSpot = allPieces.filter(
      p => p.position.id === this.position.id && p.color !== this.color && !p.win,
    )

    if (opponentsOnSpot.length === 0) {
      return false
    }

    if (opponentsOnSpot.length >= 2) {
      logger.info(`降落在敌方叠子上！攻击方与叠子均返回停机坪。`)
      opponentsOnSpot.forEach(opponent => {
        opponent.reset()
      })
      this.reset()
      R.attack(true, opponentsOnSpot)
      return true
    }

    if (opponentsOnSpot.length === 1) {
      logger.info("1v1碰撞，击退敌方！")
      R.attack(false, opponentsOnSpot)
      opponentsOnSpot[0].reset()
      return true
    }

    return false
  }

  _updateStackStatusAtPosition(positionId, allPieces) {
    if (positionId === null || typeof positionId === "undefined") return

    const piecesOnSpot = allPieces.filter(p => p.position.id === positionId && !p.win)
    const colorsOnSpot = [...new Set(piecesOnSpot.map(p => p.color))]

    colorsOnSpot.forEach(color => {
      const sameColorPieces = piecesOnSpot.filter(p => p.color === color)
      const isNowStacked = sameColorPieces.length >= 2

      if (isNowStacked && !sameColorPieces[0].isStacked) {
        logger.info(`颜色 ${color} 在位置 ${positionId} 形成了叠子。`)
      }

      sameColorPieces.forEach(p => (p.isStacked = isNowStacked))
    })
  }

  _getNextColor(allPieces) {
    let currentIndex = this.position.id
    while (true) {
      currentIndex++
      if (!ID2POSITION.has(currentIndex)) {
        currentIndex = 1
      }

      const nextPos = ID2POSITION.get(currentIndex)
      const isTarget = nextPos && nextPos.color === this.color

      if (allPieces) {
        const opponentsOnSpot = allPieces.filter(
          p => p.position.id === currentIndex && p.color !== this.color && !p.win && p.isStacked,
        )

        if (opponentsOnSpot.length > 0) {
          if (isTarget) {
            return nextPos
          }
          logger.info(`同色跳跃路径上遇到敌方叠子 (位置 ${currentIndex})，跳跃被阻止!`)
          return null
        }
      }

      if (isTarget) {
        return nextPos
      }
    }
  }
}

const PIECE_ASSETS = {
  RED: { color: "red", image: "img/red.png" },
  BLUE: { color: "blue", image: "img/blue.png" },
  GREEN: { color: "green", image: "img/green.png" },
  YELLOW: { color: "yellow", image: "img/yellow.png" },
}

export { Piece, PIECE_ASSETS }
