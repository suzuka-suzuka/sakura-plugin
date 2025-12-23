import { Command } from "../../../src/core/plugin.js";
import { getImg } from "../lib/utils.js";

const conversationStateNeverSpoken = {};
const conversationStateInactive = {};
const conversationStateLevel = {};

export class GroupManager extends plugin {
  constructor() {
    super({
      name: "群管插件",
      event: "message.group",
      priority: 1135,
    });
  }

  prepareCleanupNeverSpoken = Command(
    /^#?清理从未发言的人$/,
    "message.group",
    1135,
    async (e) => {
      if (!e.isAdmin && !e.isWhite) {
        return false;
      }

      const bot = await e.getInfo(e.self_id);
      if (bot.role === "member") {
        return false;
      }
      if (conversationStateNeverSpoken[e.user_id]) {
        delete conversationStateNeverSpoken[e.user_id];
        this.finish("confirmCleanupNeverSpoken", true);
      }

      const memberMap = await e.group.getMemberList(true);
      if (!memberMap) {
        logger.error(`[清理从未发言] 获取群成员列表失败`);
        return await e.reply("获取群成员列表失败，请稍后再试。", 10);
      }

      const inactiveMembers = [];
      memberMap.forEach((member) => {
        if (member.user_id === e.bot.self_id) {
          return;
        }
        if (member.join_time === member.last_sent_time) {
          inactiveMembers.push({
            user_id: member.user_id,
            nickname: member.card || member.nickname,
          });
        }
      });

      if (inactiveMembers.length === 0) {
        return await e.reply("非常棒！本群所有成员都发言过啦！", 10);
      }

      const forwardMsgNodes = [
        {
          message: `检测到 ${inactiveMembers.length} 位从未发言的成员，详情如下：`,
          nickname: bot.card || bot.nickname,
          user_id: e.bot.self_id,
        },
      ];

      for (const member of inactiveMembers) {
        forwardMsgNodes.push({
          message: [
            segment.image(
              `https://q1.qlogo.cn/g?b=qq&s=100&nk=${member.user_id}`
            ),
            `\n昵称: ${member.nickname}`,
            `\nQQ: ${member.user_id}`,
          ],
          nickname: bot.card || bot.nickname,
          user_id: e.bot.self_id,
        });
      }

      await e.sendForwardMsg(
        forwardMsgNodes.map((n) => ({
          user_id: n.user_id,
          nickname: n.nickname,
          content: n.message,
        })),
        {
          source: "从未发言成员列表",
          prompt: "快来看看是谁在潜水！",
          news: [{ text: `共检测到 ${inactiveMembers.length} 人` }],
        }
      );

      conversationStateNeverSpoken[e.user_id] = { inactiveMembers };
      this.setContext("confirmCleanupNeverSpoken", true, 30);

      await e.reply(
        `以上是所有从未发言的成员列表共${inactiveMembers.length}人。\n发送【取消】或【确认清理】来取消或确认清理这些成员。`
      );
    }
  );

  async confirmCleanupNeverSpoken() {
    const e = this.e;
    const userInput = e.raw_message?.trim();
    const state = conversationStateNeverSpoken[e.user_id];

    if (!state) return;

    if (userInput === "取消") {
      delete conversationStateNeverSpoken[e.user_id];
      this.finish("confirmCleanupNeverSpoken", true);
      await e.reply("操作已取消。", 10);
      return;
    }

    if (userInput !== "确认清理") return;

    const { inactiveMembers } = state;

    delete conversationStateNeverSpoken[e.user_id];
    this.finish("confirmCleanupNeverSpoken", true);

    await e.reply(
      `正在开始清理 ${inactiveMembers.length} 位从未发言的成员...`,
      10
    );

    for (const member of inactiveMembers) {
      await e.kick(member.user_id);
    }

    await e.reply(`清理完成。成功清理 ${inactiveMembers.length} 人。`, 10);
  }

  prepareCleanupInactive = Command(
    /^#?清理(\d+)(天|个月)未发言的人$/,
    "message.group",
    1135,
    async (e) => {
      if (!e.isAdmin && !e.isWhite) {
        return false;
      }

      const bot = await e.getInfo(e.self_id);
      if (bot.role === "member") {
        return false;
      }
      const match = e.msg.match(/^#?清理(\d+)(天|个月)未发言的人$/);
      const value = parseInt(match[1]);
      const unit = match[2];

      let days;
      if (unit === "天") {
        days = value;
      } else if (unit === "个月") {
        days = value * 30;
      }

      if (isNaN(days) || days <= 0) {
        return await e.reply("请输入有效的时间！", 10);
      }

      if (conversationStateInactive[e.user_id]) {
        delete conversationStateInactive[e.user_id];
        this.finish("confirmCleanupInactive", true);
      }

      const memberMap = await e.group.getMemberList(true);
      if (!memberMap) {
        logger.error(`[清理长时间未发言] 获取群成员列表失败`);
        return await e.reply("获取群成员列表失败，请稍后再试。", 10);
      }

      const currentTime = Math.floor(Date.now() / 1000);
      const inactiveThreshold = days * 24 * 60 * 60;
      const inactiveMembers = [];

      memberMap.forEach((member) => {
        if (member.user_id === e.bot.self_id) {
          return;
        }
        const timeDifference = currentTime - member.last_sent_time;
        if (timeDifference > inactiveThreshold) {
          inactiveMembers.push({
            user_id: member.user_id,
            nickname: member.card || member.nickname,
            last_sent_time: member.last_sent_time,
          });
        }
      });

      if (inactiveMembers.length === 0) {
        return await e.reply(
          `非常棒！本群所有成员在最近 ${value}${unit} 内都发言过啦！`,
          10
        );
      }

      const forwardMsgNodes = [
        {
          message: `检测到 ${inactiveMembers.length} 位超过 ${value}${unit} 未发言的成员，详情如下：`,
          nickname: bot.card || bot.nickname,
          user_id: e.bot.self_id,
        },
      ];

      for (const member of inactiveMembers) {
        const lastSentDate = new Date(
          member.last_sent_time * 1000
        ).toLocaleString();
        forwardMsgNodes.push({
          message: [
            segment.image(
              `https://q1.qlogo.cn/g?b=qq&s=100&nk=${member.user_id}`
            ),
            `\n昵称: ${member.nickname}`,
            `\nQQ: ${member.user_id}`,
            `\n最后发言: ${lastSentDate}`,
          ],
          nickname: bot.card || bot.nickname,
          user_id: e.bot.self_id,
        });
      }

      await e.sendForwardMsg(
        forwardMsgNodes.map((n) => ({
          user_id: n.user_id,
          nickname: n.nickname,
          content: n.message,
        })),
        {
          source: "长期潜水成员列表",
          prompt: "这些人都好久没说话了...",
          news: [{ text: `共检测到 ${inactiveMembers.length} 人` }],
        }
      );

      conversationStateInactive[e.user_id] = { inactiveMembers };
      this.setContext("confirmCleanupInactive", true, 30);

      await e.reply(
        `以上是超过 ${value}${unit} 未发言的成员列表共${inactiveMembers.length}人。\n发送【取消】或【确认清理】来取消或确认清理这些成员。`
      );
    }
  );

  async confirmCleanupInactive() {
    const e = this.e;
    const userInput = e.raw_message?.trim();
    const state = conversationStateInactive[e.user_id];

    if (!state) return;

    if (userInput === "取消") {
      delete conversationStateInactive[e.user_id];
      this.finish("confirmCleanupInactive", true);
      await e.reply("操作已取消。", 10);
      return;
    }

    if (userInput !== "确认清理") return;

    const { inactiveMembers } = state;

    delete conversationStateInactive[e.user_id];
    this.finish("confirmCleanupInactive", true);

    await e.reply(
      `正在开始清理 ${inactiveMembers.length} 位长时间未发言的成员...`,
      10
    );

    for (const member of inactiveMembers) {
      await e.kick(member.user_id);
    }

    await e.reply(`清理完成。成功清理 ${inactiveMembers.length} 人。`, 10);
  }

  prepareCleanupByLevel = Command(
    /^#?清理低于(\d+)级的人$/,
    "message.group",
    1135,
    async (e) => {
      if (!e.isAdmin && !e.isWhite) {
        return false;
      }

      const bot = await e.getInfo(e.self_id);
      if (bot.role === "member") {
        return false;
      }
      const match = e.msg.match(/^#?清理低于(\d+)级的人$/);
      const level = parseInt(match[1]);

      if (isNaN(level) || level <= 0) {
        return await e.reply("请输入有效的等级！", 10);
      }

      if (conversationStateLevel[e.user_id]) {
        delete conversationStateLevel[e.user_id];
        this.finish("confirmCleanupByLevel", true);
      }

      const memberMap = await e.group.getMemberList(true);
      if (!memberMap) {
        logger.error(`[清理低等级成员] 获取群成员列表失败`);
        return await e.reply("获取群成员列表失败，请稍后再试。", 10);
      }

      const lowLevelMembers = [];
      memberMap.forEach((member) => {
        if (member.user_id === e.bot.self_id || member.role !== "member") {
          return;
        }
        if (member.level < level) {
          lowLevelMembers.push({
            user_id: member.user_id,
            nickname: member.card || member.nickname,
            level: member.level,
          });
        }
      });

      if (lowLevelMembers.length === 0) {
        return await e.reply(`本群没有群等级低于 ${level} 级的成员。`, 10);
      }

      const forwardMsgNodes = [
        {
          message: `检测到 ${lowLevelMembers.length} 位群等级低于 ${level} 级的成员，详情如下：`,
          nickname: bot.card || bot.nickname,
          user_id: e.bot.self_id,
        },
      ];

      for (const member of lowLevelMembers) {
        forwardMsgNodes.push({
          message: [
            segment.image(
              `https://q1.qlogo.cn/g?b=qq&s=100&nk=${member.user_id}`
            ),
            `\n昵称: ${member.nickname}`,
            `\nQQ: ${member.user_id}`,
            `\n群等级: ${member.level}`,
          ],
          nickname: bot.card || bot.nickname,
          user_id: e.bot.self_id,
        });
      }

      await e.sendForwardMsg(
        forwardMsgNodes.map((n) => ({
          user_id: n.user_id,
          nickname: n.nickname,
          content: n.message,
        })),
        {
          source: "低等级成员列表",
          prompt: "萌新抓捕行动！",
          news: [{ text: `共检测到 ${lowLevelMembers.length} 人` }],
        }
      );

      conversationStateLevel[e.user_id] = { lowLevelMembers };
      this.setContext("confirmCleanupByLevel", true, 30);

      await e.reply(
        `以上是群等级低于 ${level} 级的成员列表共${lowLevelMembers.length}人。\n发送【取消】或【确认清理】来取消或确认清理这些成员。`
      );
    }
  );

  async confirmCleanupByLevel() {
    const e = this.e;
    const userInput = e.raw_message?.trim();
    const state = conversationStateLevel[e.user_id];

    if (!state) return;

    if (userInput === "取消") {
      delete conversationStateLevel[e.user_id];
      this.finish("confirmCleanupByLevel", true);
      await e.reply("操作已取消。", 10);
      return;
    }

    if (userInput !== "确认清理") return;

    const { lowLevelMembers } = state;

    delete conversationStateLevel[e.user_id];
    this.finish("confirmCleanupByLevel", true);

    await e.reply(
      `正在开始清理 ${lowLevelMembers.length} 位低等级的成员...`,
      10
    );

    for (const member of lowLevelMembers) {
      await e.kick(member.user_id);
    }

    await e.reply(`清理完成。成功清理 ${lowLevelMembers.length} 人。`, 10);
  }

  handleMuteAction = Command(
    /^#?(禁言|解禁)/,
    "message.group",
    1135,
    async (e) => {
      if (!e.isAdmin && !e.isWhite) {
        return false;
      }

      const bot = await e.getInfo(e.self_id);
      if (bot.role === "member") {
        return false;
      }

      const cleanMsg = e.msg.replace(/^#?/, "");
      const isMute = cleanMsg.startsWith("禁言");

      if (isMute) {
        let { targetQQ, duration, unit } = this.parseMuteCommand(cleanMsg);
        if (!targetQQ) return false;

        if (duration === 0) {
          if (!/^禁言\s*(\d+|@[\s\S]*)?$/.test(cleanMsg.trim())) {
            return false;
          }
          duration = 300;
          unit = "5分钟";
        }

        const memberInfo = await e.getInfo(targetQQ);
        const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ;
        if (memberInfo?.role !== "member") {
          return false;
        }

        await e.ban(duration, targetQQ);
        await e.reply(`✅ 已将「${memberName}」禁言${unit}。`, 10);
      } else {
        const targetQQ =
          cleanMsg.replace(/解禁/g, "").trim().replace("@", "") || e.at;
        if (!targetQQ) return false;

        const memberInfo = await e.getInfo(targetQQ);
        const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ;
        if (memberInfo?.role !== "member") {
          return false;
        }

        await e.ban(0, targetQQ);
        await e.reply(`✅ 已将「${memberName}」解除禁言。`, 10);
      }
      return true;
    }
  );

  kickMember = Command(/^#?(踢|踢黑)/, "message.group", 1135, async (e) => {
    if (!e.isAdmin && !e.isWhite) {
      return false;
    }

    const bot = await e.getInfo(e.self_id);
    if (bot.role === "member") {
      return false;
    }

    const cleanMsg = e.msg.replace(/^#?/, "");
    const isBlacklist = cleanMsg.startsWith("踢黑");
    const command = isBlacklist ? "踢黑" : "踢";
    const targetQQ =
      cleanMsg.replace(command, "").trim().replace("@", "") || e.at;

    if (!targetQQ) return false;

    const memberInfo = await e.getInfo(targetQQ);

    if (memberInfo.user_id === e.self_id) {
      return false;
    }

    const memberName = memberInfo?.card || memberInfo?.nickname || targetQQ;
    if (memberInfo?.role !== "member") {
      return false;
    }

    await e.kick(targetQQ, isBlacklist);

    if (isBlacklist) {
      await e.reply(`✅ 已将「${memberName}」移出本群并加入黑名单。`, 10);
    } else {
      await e.reply(`✅ 已将「${memberName}」移出本群。`, 10);
    }
    return true;
  });

  handleEssenceMessage = Command(
    /^#?(设为|移出)精华$/,
    "message.group",
    1135,
    async (e) => {
      const bot = await e.getInfo(e.self_id);
      if (bot.role === "member" || !e.reply_id) {
        return false;
      }

      const action = e.msg.replace(/^#?/, "").includes("设为精华")
        ? "set"
        : "remove";

      if (action === "set") {
        await e.setGroupEssence(e.reply_id);
        await e.reply("✅ 已将该消息设为群精华！", 10);
      } else {
        await e.deleteGroupEssence(e.reply_id);
        await e.reply("✅ 已取消该消息的精华状态。", 10);
      }
      return true;
    }
  );

  parseMuteCommand(msg) {
    let targetQQ = msg.match(/(\d{5,12})/)
      ? msg.match(/(\d{5,12})/)[1]
      : this.e.at;
    let timeMatch = msg.match(/(\d+)\s*(分钟|小时|天|分|时|秒)?/);
    let duration = 0;
    let unitText = "";
    const maxDuration = 2592000;

    if (timeMatch) {
      const time = parseInt(timeMatch[1]);
      const unit = timeMatch[2] || "秒";

      switch (unit) {
        case "秒":
          duration = time;
          unitText = `${time}秒`;
          break;
        case "分":
        case "分钟":
          duration = time * 60;
          unitText = `${time}分钟`;
          break;
        case "时":
        case "小时":
          duration = time * 3600;
          unitText = `${time}小时`;
          break;
        case "天":
          duration = time * 86400;
          unitText = `${time}天`;
          break;
      }

      if (duration > maxDuration) {
        duration = maxDuration;
        unitText = "30天(已达上限)";
      }
    }

    return { targetQQ, duration, unit: unitText };
  }

  handleMuteAll = Command(
    /^#?(全员禁言|全员解禁)$/,
    "message.group",
    1135,
    async (e) => {
      if (e.sender.role === "member" || !e.isMaster) {
        return false;
      }

      const bot = await e.getInfo(e.self_id);
      if (bot.role === "member") {
        return false;
      }

      const isMute = e.msg.includes("全员禁言");

      try {
        await e.wholeBan(isMute);
        if (isMute) {
          await e.reply("✅已开启全员禁言。", 10);
        } else {
          await e.reply("✅已关闭全员禁言。", 10);
        }
      } catch (err) {
        logger.error("全体禁言/解禁操作失败:", err);
      }
    }
  );

  handleGroupNotice = Command(
    /^#?发群公告.*$/,
    "message.group",
    1135,
    async (e) => {
      if (!e.isAdmin && !e.isWhite) {
        return false;
      }

      const bot = await e.getInfo(e.self_id);
      if (bot.role === "member") {
        return false;
      }

      const match = e.msg.match(/^#?发群公告(.*)$/);
      if (!match) return false;

      const paramsStr = match[1];
      let content = match[2].trim();

      let image = null;
      const imgList = await getImg(e, false);
      if (imgList && imgList.length > 0) {
        image = imgList[0];
      }

      if (!content) {
        return false;
      }

      try {
        await e.group.sendNotice(content, image);
        await e.reply("✅ 群公告发送成功！", 10);
      } catch (err) {
        logger.error("发送群公告失败:", err);
      }
      return true;
    }
  );
}
