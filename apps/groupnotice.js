import { getAI } from "../lib/AIUtils/getAI.js";
import { parseAtMessage } from "../lib/AIUtils/messaging.js";
import Setting from "../lib/setting.js";

const AI_PROMPT =
  "你是一个QQ群的成员。你的任务是根据群成员的变动（新成员加入或成员离开）以及最近的群聊记录，生成一个自然、得体的回应。\n" +
  "重要提示：\n" +
  "1. 直接输出你要说的话，不要包含任何格式前缀（如'xx说：'）。\n" +
  "2. 语气要像真人一样自然、简短、友好，不要过于机械或正式。\n" +
  "3. 当有新人加入时，可以根据最近的聊天内容，简单告知新人大家在聊什么，并艾特(@)新人表示欢迎。\n" +
  "4. 当有成员离开时，可以根据聊天内容推测可能的原因，或者仅仅表达惋惜。\n" +
  "下面是具体的情景和聊天记录：";

async function checkCD(groupId, cdSeconds = 30) {
  const key = `sakura:group_notice:cd:${groupId}`;
  if (await redis.get(key)) {
    return false;
  }
  await redis.set(key, "1", "EX", cdSeconds);
  return true;
}

export class GroupNotice extends plugin {
  constructor() {
    super({
      name: "群成员变动",
      priority: 1135,
    });
  }

  handleIncrease = OnEvent("notice.group_increase", async (e) => {
    if (e.user_id === e.self_id) return;

    const config = Setting.getConfig("groupnotice");
    if (!config.joinEnable) return;
    if (!(await checkCD(e.group_id))) return;

    const memberInfo = await e
      .getGroupMemberInfo(e.group_id, e.user_id, true)
      .catch(() => null);
    const name =
      memberInfo?.card || memberInfo?.nickname || e.nickname || "新朋友";

    const query = `新成员 ${name}(QQ:${e.user_id})刚刚加入了群聊。请根据聊天上下文，直接写一句欢迎词欢迎他。注意：直接输出内容，不要带任何格式或前缀，不要模仿聊天记录的格式。`;

    try {
      const aiResponse = await getAI(
        Setting.getConfig("AI").appschannel,
        e,
        [{ text: query }],
        AI_PROMPT,
        { noHeader: true },
        false,
        []
      );

      if (aiResponse?.text) {
        const msg = parseAtMessage(aiResponse.text);
        await e.reply(msg);
      } else {
        await e.reply([Segment.at(e.user_id), " 欢迎新人！"]);
      }
    } catch (error) {
      logger.error(`欢迎新人时出错: ${error}`);
      await e.reply([Segment.at(e.user_id), " 欢迎新人！"]);
    }
  });

  handleDecrease = OnEvent("notice.group_decrease", async (e) => {
    if (e.user_id === e.self_id) return;
    if (e.operator_id !== e.user_id) return;

    const config = Setting.getConfig("groupnotice");
    if (!config.leaveEnable) return;
    if (!(await checkCD(e.group_id))) return;

    const strangerInfo = await e
      .getStrangerInfo(e.user_id, true)
      .catch(() => null);
    const name = strangerInfo?.nickname || e.nickname || "未知用户";
    const avatar = Segment.image(
      `https://q1.qlogo.cn/g?b=qq&s=0&nk=${e.user_id}`
    );

    try {
      const query = `成员${name}(QQ:${e.user_id}) 刚刚离开了群聊。请根据聊天上下文，直接写一句简短的告别。注意：直接输出内容，不要带任何格式或前缀，不要模仿聊天记录的格式。`;

      const aiResponse = await getAI(
        Setting.getConfig("AI").appschannel,
        e,
        [{ text: query }],
        AI_PROMPT,
        { noHeader: true },
        false,
        []
      );

      if (aiResponse?.text) {
        const msg = parseAtMessage(aiResponse.text);
        await e.reply([avatar, `${name}(${e.user_id}) 退群了\n`, ...msg]);
      } else {
        await e.reply([avatar, `${name}(${e.user_id}) 退群了`]);
      }
    } catch (error) {
      logger.error(`告别时出错: ${error}`);
      await e.reply([avatar, `${name}(${e.user_id}) 退群了`]);
    }
  });
}
