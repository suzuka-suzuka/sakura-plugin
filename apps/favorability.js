import fs from "fs";
import path from "path";
import _ from "lodash";
import { plugindata } from "../lib/path.js";
import FavorabilityImageGenerator from "../lib/favorability/ImageGenerator.js";
import FavorabilityManager from "../lib/favorability/FavorabilityManager.js";

const dataPath = path.join(plugindata, "favorability");

const lastSender = new Map();
const penaltyTimers = new Map();

export class Favorability extends plugin {
  constructor() {
    super({
      name: "好感度",
      event: "message.group",
      priority: 1135,
    });
  }

  cleanupFavorabilityTask = Cron("0 0 4 * * *", async () => {
    FavorabilityManager.cleanupFavorability();
  });

  applyConsecutiveMessagePenalty(groupId, userId) {
    const data = FavorabilityManager.readData(groupId);
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
      FavorabilityManager.saveData(groupId, data);
    }
  }

  accept = OnEvent("message.group", 35, async (e) => {
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
          FavorabilityManager.addFavorability(
            groupId,
            currentSender,
            targetUser,
            2
          );
        }
      } else if (lastSenderInfo) {
        FavorabilityManager.addFavorability(
          groupId,
          currentSender,
          lastSenderInfo.userId,
          1
        );
      }
    }

    return false;
  });

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

    const favorabilityAtoB = FavorabilityManager.getFavorability(
      groupId,
      currentUser,
      targetUser
    );
    const favorabilityBtoA = FavorabilityManager.getFavorability(
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
    const data = FavorabilityManager.readData(groupId);

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
    const data = FavorabilityManager.readData(groupId);

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
