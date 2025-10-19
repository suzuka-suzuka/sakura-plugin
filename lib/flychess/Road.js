import { ID2POSITION } from "./Position.js"

class Road {
  constructor() {
    this.list = []
    this.index = 0
  }

  next(r) {
    this.index += r
    const max = this.list.length - 1

    if (this.index >= max) {
      const overshoot = this.index - max
      this.index = max - overshoot
    }

    if (this.index < 0) {
      this.index = 0
    }

    return this.list[this.index]
  }
  update(id) {
    const foundIndex = this.list.findIndex(pos => pos && pos.id === id)
    if (foundIndex !== -1) {
      this.index = foundIndex
    }
  }

  start() {
    this.index = 0
    return this.list[0]
  }

  copy() {
    const r = new Road()
    r.list = [...this.list]
    r.index = this.index
    return r
  }

  peekPath(r) {
    const pathIds = []
    if (r <= 0) return []
    for (let i = 1; i <= r; i++) {
      const nextIndex = this.index + i
      if (nextIndex < this.list.length) {
        pathIds.push(this.list[nextIndex].id)
      } else {
        break
      }
    }
    return pathIds
  }

  getPositionAt(relativeIndex) {
    const targetIndex = this.index + relativeIndex
    if (targetIndex >= 0 && targetIndex < this.list.length) {
      return this.list[targetIndex]
    }
    return this.list[this.index]
  }
}

const RED = new Road()
RED.list.push(ID2POSITION.get("red-ready"))
for (let i = 1; i <= 50; i++) {
  RED.list.push(ID2POSITION.get(i))
}
for (let i = 61; i <= 66; i++) {
  RED.list.push(ID2POSITION.get(i))
}

const GREEN = new Road()
GREEN.list.push(ID2POSITION.get("green-ready"))
for (let i = 40; i <= 52; i++) {
  GREEN.list.push(ID2POSITION.get(i))
}
for (let i = 1; i <= 37; i++) {
  GREEN.list.push(ID2POSITION.get(i))
}
for (let i = 91; i <= 96; i++) {
  GREEN.list.push(ID2POSITION.get(i))
}

const YELLOW = new Road()
YELLOW.list.push(ID2POSITION.get("yellow-ready"))
for (let i = 27; i <= 52; i++) {
  YELLOW.list.push(ID2POSITION.get(i))
}
for (let i = 1; i <= 24; i++) {
  YELLOW.list.push(ID2POSITION.get(i))
}
for (let i = 81; i <= 86; i++) {
  YELLOW.list.push(ID2POSITION.get(i))
}

const BLUE = new Road()
BLUE.list.push(ID2POSITION.get("blue-ready"))
for (let i = 14; i <= 52; i++) {
  BLUE.list.push(ID2POSITION.get(i))
}
for (let i = 1; i <= 11; i++) {
  BLUE.list.push(ID2POSITION.get(i))
}
for (let i = 71; i <= 76; i++) {
  BLUE.list.push(ID2POSITION.get(i))
}

export { Road, RED, GREEN, YELLOW, BLUE }
