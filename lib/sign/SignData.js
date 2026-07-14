import fs from "node:fs";
import path from "node:path";

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCompatibleDateKeys(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return new Set([
    formatLocalDate(date),
    date.toLocaleDateString(),
    `${year}/${month}/${day}`,
  ]);
}

function matchesLocalDate(value, date) {
  return typeof value === "string" && getCompatibleDateKeys(date).has(value);
}

export default class SignData {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, "{}", "utf8");
    }
    this.load();
  }

  load() {
    this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
  }

  save() {
    const tempFile = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(tempFile, this.file);
  }

  getUserData(groupId, userId) {
    if (!this.data[groupId]) {
      this.data[groupId] = {};
    }
    if (!this.data[groupId][userId]) {
      this.data[groupId][userId] = {
        lastSign: "",
        lastingTimes: 0,
      };
    }
    return this.data[groupId][userId];
  }

  hasSigned(groupId, userId, date = new Date()) {
    const userData = this.data[groupId]?.[userId];
    return matchesLocalDate(userData?.lastSign, date);
  }

  getSignCount(groupId, date = new Date()) {
    let count = 0;
    for (const userData of Object.values(this.data[groupId] || {})) {
      if (matchesLocalDate(userData?.lastSign, date)) {
        count++;
      }
    }
    return count;
  }

  recordSign(groupId, userId, date = new Date()) {
    // 每次事务都从磁盘刷新，避免热重载或并发请求持有旧快照后覆盖他人记录。
    this.load();

    const userData = this.getUserData(groupId, userId);
    if (matchesLocalDate(userData.lastSign, date)) {
      return { accepted: false };
    }

    const signRanking = this.getSignCount(groupId, date) + 1;
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);

    if (matchesLocalDate(userData.lastSign, yesterday)) {
      userData.lastingTimes = Math.max(0, Number(userData.lastingTimes) || 0) + 1;
    } else {
      userData.lastingTimes = 1;
    }
    userData.lastSign = formatLocalDate(date);

    this.save();
    return {
      accepted: true,
      signRanking,
      lastingTimes: userData.lastingTimes,
    };
  }
}
