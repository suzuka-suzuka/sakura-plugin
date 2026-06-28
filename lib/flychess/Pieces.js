import { ID2POSITION } from "./Position.js"

const Rule = {
  win: (piece, color) => logger.info(`${color}方棋子 ${piece.id} 获胜了！`),
  tipsJump: () => logger.info("跳到了下一个同色格！"),
  tipsFly: () => logger.info("超级飞行！"),
  attack: () => logger.info("攻击了对方棋子！"),
}

// 飞行路径经过的终点通道中点。
// 飞行途中只会撞击这条飞行线实际穿过的颜色通道，避免打到旁边错位显示的其他颜色棋子。
const FLY_PATH_COLLISIONS = {
  5: { positionId: 73, targetColor: "blue" },    // 绿色飞行 5→17，经过蓝色终点通道中点
  18: { positionId: 83, targetColor: "yellow" }, // 红色飞行 18→30，经过黄色终点通道中点
  31: { positionId: 93, targetColor: "green" },  // 蓝色飞行 31→43，经过绿色终点通道中点
  44: { positionId: 63, targetColor: "red" },    // 黄色飞行 44→4，经过红色终点通道中点
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

  async jumpStep(r, allPieces, ruleCallbacks = Rule) {
    if (this.win || !this.isReady) {
      return
    }

    if (this.isReadyDoorBlocked(allPieces, r)) {
      if (ruleCallbacks.tipsBlock) {
        await ruleCallbacks.tipsBlock()
      }
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
          if (ruleCallbacks.tipsBlock) {
            await ruleCallbacks.tipsBlock()
          }
          logger.info(`点数大于与叠子的距离，从叠子处后退 ${excessSteps} 步。`)
          const stackRoadIndex = nextStepIndex
          const newIndex = stackRoadIndex - excessSteps
          this.position = this.road.list[Math.max(0, newIndex)]
          this.road.update(this.position.id)
        } else {
          this.position = this.road.next(r)
        }

        await this._testState(allPieces, ruleCallbacks, r)
        this._updateStackStatusAtPosition(originalPositionId, allPieces)
        this._updateStackStatusAtPosition(this.position.id, allPieces)
        return
      }
    }

    this.position = this.road.next(r)
    await this._testState(allPieces, ruleCallbacks, r)

    this._updateStackStatusAtPosition(originalPositionId, allPieces)
    this._updateStackStatusAtPosition(this.position.id, allPieces)
  }

  ready() {
    this.isReady = true
    this.position = this.road.start()
  }

  isReadyDoorBlocked(allPieces = [], steps = Number.POSITIVE_INFINITY) {
    if (!this.isReady || this.win || this.position.state !== "ready") {
      return false
    }

    if (steps === 1) {
      return false
    }

    const doorPosition = this.road.getPositionAt(1)
    if (!doorPosition || doorPosition.id === this.position.id) {
      return false
    }

    const opponentsAtDoor = allPieces.filter(
      p => p.position.id === doorPosition.id && p.color !== this.color && !p.win,
    )

    return opponentsAtDoor.length >= 2 || opponentsAtDoor.some(p => p.isStacked)
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
  async _testState(allPieces, R, r) {
    if (this.position.state === "win") {
      this.win = true
      await R.win(this, this.color)
      this.road.update(this.position.id)
      return
    }

    const selfResetByLandingAttack = await this._tryAttack(allPieces, R, r)
    if (selfResetByLandingAttack) {
      this.road.update(this.position.id)
      return
    }

    let firstMoveWasFly = false
    let firstMoveWasJump = false

    if (this.position.color === this.color && this.position.s) {
      const flyFromId = this.position.id
      const flyToId = parseInt(this.position.s, 10)
      this.position = ID2POSITION.get(flyToId)
      await R.tipsFly()
      const selfReset = await this._checkFlyPathCollision(flyFromId, allPieces, R)
      if (selfReset) {
        this.road.update(this.position.id)
        return
      }
      firstMoveWasFly = true
    } else if (this.position.color === this.color && !this.position.r) {
      const nextPos = await this._getNextColor(allPieces, R)
      if (nextPos) {
        this.position = nextPos
        await R.tipsJump()
        firstMoveWasJump = true
      }
    }

    if (!firstMoveWasFly && !firstMoveWasJump) {
      this.road.update(this.position.id)
      return
    }

    const selfResetAfterFirstMove = await this._tryAttack(allPieces, R, r)
    if (selfResetAfterFirstMove) {
      this.road.update(this.position.id)
      return
    }

    if (this.position.color === this.color) {
      if (firstMoveWasJump && this.position.s) {
        const flyFromId = this.position.id
        const flyToId = parseInt(this.position.s, 10)
        this.position = ID2POSITION.get(flyToId)
        await R.tipsFly()
        const selfReset = await this._checkFlyPathCollision(flyFromId, allPieces, R)
        if (!selfReset) await this._tryAttack(allPieces, R, r)
      } else if (firstMoveWasFly && !this.position.r) {
        const nextPos = await this._getNextColor(allPieces, R)
        if (nextPos) {
          this.position = nextPos
          await R.tipsJump()
          await this._tryAttack(allPieces, R, r)
        }
      }
    }

    this.road.update(this.position.id)
  }

  async _checkFlyPathCollision(flyFromId, allPieces, R) {
    const collision = FLY_PATH_COLLISIONS[flyFromId]
    if (!collision) return false

    const opponentsOnPath = allPieces.filter(
      p =>
        p.position.id === collision.positionId &&
        p.color === collision.targetColor &&
        p.color !== this.color &&
        !p.win,
    )

    if (opponentsOnPath.length === 0) return false

    if (opponentsOnPath.length >= 2) {
      // 飞行途中撞到叠子，双方全部返回
      logger.info(`飞行途中在位置 ${collision.positionId} 撞到敌方叠子！双方均返回停机坪。`)
      opponentsOnPath.forEach(opponent => {
        this._updateStackStatusAtPosition(opponent.position.id, allPieces)
        opponent.reset()
      })
      this.reset()
      await R.attack(true, opponentsOnPath)
      return true // 自己也被送回了停机坪
    } else {
      // 飞行途中撞到单个棋子，击退对方，自己继续飞
      logger.info(`飞行途中在位置 ${collision.positionId} 撞到敌方棋子！击退！`)
      const opponent = opponentsOnPath[0]
      this._updateStackStatusAtPosition(opponent.position.id, allPieces)
      await R.attack(false, opponentsOnPath)
      opponent.reset()
      return false // 自己不受影响，继续飞行
    }
  }

  // 返回 true 仅表示当前棋子也被送回基地，普通 1v1 攻击不应打断后续跳跃/飞行。
  async _tryAttack(allPieces, R, r) {
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
      await R.attack(true, opponentsOnSpot)
      return true
    }

    if (opponentsOnSpot.length === 1) {
      logger.info("1v1碰撞，击退敌方！")
      await R.attack(false, opponentsOnSpot)
      opponentsOnSpot[0].reset()
      return false
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

  async _getNextColor(allPieces, R) {
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
          if (R && R.tipsBlock) await R.tipsBlock()
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
