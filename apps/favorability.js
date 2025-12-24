import fs from "fs";
import path from "path";
import _ from "lodash";
import { plugindata } from "../lib/path.js";
import FavorabilityImageGenerator from "../lib/favorability/ImageGenerator.js";

const dataPath = path.join(plugindata, "favorability");

const lastSender = new Map();
const penaltyTimers = new Map();

export class Favorability extends plugin {
  constructor() {
    super({
      name: "好感度",
      event: "message.group",
      priority: 35,
    });
    this.cache = new Map();
    this.saveTasks = new Map();
  }

  cleanupFavorabilityTask = Cron("0 0 4 * * *", async () => {
    this.cleanupFavorability();
  });

  async cleanupFavorability() {
    const files = fs
      .readdirSync(dataPath)
      .filter((file) => file.endsWith(".json"));
    for (const file of files) {
      const groupId = path.basename(file, ".json");
      const data = this.readData(groupId);

      if (!data.favorability || Object.keys(data.favorability).length === 0) {
        continue;
      }

      let minFavorability = Infinity;
      let minFrom = null;
      let minTo = null;

      for (const from in data.favorability) {
        for (const to in data.favorability[from]) {
          if (data.favorability[from][to] < minFavorability) {
            minFavorability = data.favorability[from][to];
            minFrom = from;
            minTo = to;
          }
        }
      }

      if (minFrom && minTo) {
        delete data.favorability[minFrom][minTo];
        if (Object.keys(data.favorability[minFrom]).length === 0) {
          delete data.favorability[minFrom];
        }
        this.saveData(groupId, data);
      }
    }
    this.cache.clear();
    this.saveTasks.clear();
  }
  getDataFile(groupId) {
    return path.join(dataPath, `${groupId}.json`);
  }

  readData(groupId) {
    if (this.cache.has(groupId)) {
      return _.cloneDeep(this.cache.get(groupId));
    }

    const file = this.getDataFile(groupId);
    if (!fs.existsSync(file)) {
      return { favorability: {} };
    }
    try {
      const data = fs.readFileSync(file, "utf-8");
      const parsedData = JSON.parse(data);
      this.cache.set(groupId, parsedData);
      return parsedData;
    } catch (err) {
      logger.error(`[好感度] 读取数据失败: ${err}`);
      return { favorability: {} };
    }
  }

  saveData(groupId, data) {
    this.cache.set(groupId, data);

    if (!this.saveTasks.has(groupId)) {
      const debouncedWrite = _.debounce((gId, dataToWrite) => {
        const file = this.getDataFile(gId);
        try {
          fs.writeFileSync(file, JSON.stringify(dataToWrite, null, 2), "utf-8");
        } catch (err) {
          logger.error(`[好感度] 保存数据失败: ${err}`);
        }
      }, 60000);
      this.saveTasks.set(groupId, debouncedWrite);
    }

    this.saveTasks.get(groupId)(groupId, data);
  }

  addFavorability(groupId, from, to, value) {
    const data = this.readData(groupId);

    if (!data.favorability) {
      data.favorability = {};
    }

    if (!data.favorability[from]) {
      data.favorability[from] = {};
    }

    if (!data.favorability[from][to]) {
      data.favorability[from][to] = 0;
    }

    data.favorability[from][to] += value;

    this.saveData(groupId, data);
  }

  getFavorability(groupId, from, to) {
    const data = this.readData(groupId);
    return data.favorability[from]?.[to] || 0;
  }

  applyConsecutiveMessagePenalty(groupId, userId) {
    const data = this.readData(groupId);
    let hasChange = false;

    if (data.favorability) {
      for (const fromUser in data.favorability) {
        if (data.favorability[fromUser][userId] !== undefined) {
          data.favorability[fromUser][userId] -= 1;
          hasChange = true;
        }
      }
    }

    if (hasChange) {
      this.saveData(groupId, data);
    }
  }

  async accept(e) {
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true });
    }

    if (/^#?好感度.*$/.test(e.msg)) {
      return false;
    }

    if (/^#?(谁在意我|喜欢我的人|我在意谁|我喜欢的人)$/.test(e.msg)) {
      return false;
    }

    const groupId = e.group_id.toString();
    const currentSender = e.user_id.toString();

    if (penaltyTimers.has(groupId)) {
      clearTimeout(penaltyTimers.get(groupId));
      penaltyTimers.delete(groupId);
    }

    let targetUsers = [];
    let shouldAddFavorability = false;

    const atMsgs = e.message?.filter(
      (msg) =>
        msg.type === "at" &&
        msg.data?.qq &&
        !isNaN(msg.data?.qq) &&
        msg.data?.qq != e.self_id
    );
    if (atMsgs && atMsgs.length > 0) {
      targetUsers = [
        ...new Set(atMsgs.map((msg) => msg.data?.qq.toString())),
      ].filter((qq) => qq !== currentSender);

      if (targetUsers.length > 0) {
        shouldAddFavorability = true;
      }
    }

    if (targetUsers.length === 0) {
      if (e.reply_id) {
        try {
          const sourceMessageData = await e.getReplyMsg();

          if (sourceMessageData?.user_id) {
            const sourceUserId = sourceMessageData.user_id.toString();
            if (sourceUserId !== currentSender && sourceUserId != e.self_id) {
              targetUsers.push(sourceUserId);
              shouldAddFavorability = true;
            }
          }
        } catch (err) {}
      }
    }

    const lastSenderInfo = lastSender.get(groupId);

    if (lastSenderInfo && lastSenderInfo.userId === currentSender) {
      const newStreak = (lastSenderInfo.streak || 1) + 1;
      lastSender.set(groupId, { userId: currentSender, streak: newStreak });

      if (newStreak > 1) {
        const timer = setTimeout(() => {
          this.applyConsecutiveMessagePenalty(groupId, currentSender);
          penaltyTimers.delete(groupId);
        }, 2 * 60 * 1000);
        penaltyTimers.set(groupId, timer);
      }
    } else {
      lastSender.set(groupId, { userId: currentSender, streak: 1 });

      if (shouldAddFavorability && targetUsers.length > 0) {
        for (const targetUser of targetUsers) {
          this.addFavorability(groupId, currentSender, targetUser, 2);
        }
      } else if (lastSenderInfo) {
        this.addFavorability(groupId, currentSender, lastSenderInfo.userId, 1);
      }
    }

    return false;
  }

  queryFavorability = Command(/^#?好感度$/, async (e) => {
    const groupId = e.group_id.toString();
    const currentUser = e.user_id.toString();

    let targetUser = null;
    const atMsg = e.message?.find(
      (msg) => msg.type === "at" && msg.data?.qq && !isNaN(msg.data?.qq)
    );
    if (atMsg) {
      targetUser = atMsg.data?.qq.toString();
    }

    if (targetUser == e.self_id) {
      await e.reply("对我产生好感是不行哦~ 笨蛋！");
      return true;
    }

    if (!targetUser) {
      return false;
    }

    const favorabilityAtoB = this.getFavorability(
      groupId,
      currentUser,
      targetUser
    );
    const favorabilityBtoA = this.getFavorability(
      groupId,
      targetUser,
      currentUser
    );

    const currentUserName = e.sender?.card || e.sender?.nickname || currentUser;

    let targetUserName = targetUser;
    try {
      const targetInfo = await e.getInfo(targetUser);
      targetUserName = targetInfo?.card || targetInfo?.nickname || targetUser;
    } catch (err) {
      logger.error(`[好感度] 获取用户 ${targetUser} 信息失败:`, err);
    }

    const generator = new FavorabilityImageGenerator();
    const imageBuffer = await generator.generate(
      currentUserName,
      targetUserName,
      favorabilityAtoB,
      favorabilityBtoA,
      currentUser,
      targetUser
    );

    await e.reply(segment.image(imageBuffer));
    return true;
  });

  whoLikesMe = Command(/^#?(谁在意我|喜欢我的人)$/, async (e) => {
    const groupId = e.group_id.toString();
    const currentUser = e.user_id.toString();
    const data = this.readData(groupId);

    const othersToMe = [];
    for (const fromUser in data.favorability) {
      if (data.favorability[fromUser][currentUser] !== undefined) {
        othersToMe.push({
          userId: fromUser,
          favorability: data.favorability[fromUser][currentUser],
        });
      }
    }
    othersToMe.sort((a, b) => b.favorability - a.favorability);

    if (othersToMe.length === 0) {
      await e.reply("还没有人对你有好感哦~");
      return true;
    }

    const top10 = othersToMe.slice(0, 10);
    const rankingData = [];
    for (const item of top10) {
      const userName = await this.getUserName(e, item.userId);
      rankingData.push({
        name: userName,
        favorability: item.favorability,
        userId: item.userId,
      });
    }

    const generator = new FavorabilityImageGenerator();
    const imageBuffer = await generator.generateRanking(
      "谁在意我",
      rankingData,
      e.sender?.card || e.sender?.nickname || currentUser
    );

    await e.reply(segment.image(imageBuffer));
    return true;
  });

  whoILike = Command(/^#?(我在意谁|我喜欢的人)$/, async (e) => {
    const groupId = e.group_id.toString();
    const currentUser = e.user_id.toString();
    const data = this.readData(groupId);

    const myToOthers = [];
    if (data.favorability[currentUser]) {
      for (const targetUser in data.favorability[currentUser]) {
        myToOthers.push({
          userId: targetUser,
          favorability: data.favorability[currentUser][targetUser],
        });
      }
    }
    myToOthers.sort((a, b) => b.favorability - a.favorability);

    if (myToOthers.length === 0) {
      await e.reply("你还没有对任何人产生好感哦~");
      return true;
    }

    const top10 = myToOthers.slice(0, 10);
    const rankingData = [];
    for (const item of top10) {
      const userName = await this.getUserName(e, item.userId);
      rankingData.push({
        name: userName,
        favorability: item.favorability,
        userId: item.userId,
      });
    }

    const generator = new FavorabilityImageGenerator();
    const imageBuffer = await generator.generateRanking(
      "我在意谁",
      rankingData,
      e.sender?.card || e.sender?.nickname || currentUser
    );

    await e.reply(segment.image(imageBuffer));
    return true;
  });

  async getUserName(e, userId) {
    try {
      let userInfo = await e.getInfo(userId);
      return userInfo?.card || userInfo?.nickname || userId;
    } catch (err) {
      return userId;
    }
  }
}
