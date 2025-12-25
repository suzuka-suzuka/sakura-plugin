import Setting from "../setting.js";
import { bot } from "../../../../src/api/client.js";
import { logger } from "../../../../src/utils/logger.js";

const roleMap = {
  owner: "群主",
  admin: "管理员",
  member: "普通成员",
};

const formatDate = (timestamp) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString("zh-CN", { hour12: false });
};

async function getChatHistoryGroup(group, num) {
  if (!group) return [];

  try {
    const allowedMessageTypes = [
      "text",
      "at",
      "image",
      "video",
      "forward",
      "json",
    ];
    const seenMessageIds = new Set();

    const processChats = (rawChats) => {
      return rawChats.filter((chat) => {
        const messageId = chat.seq || chat.message_seq || chat.message_id;
        if (seenMessageIds.has(messageId)) {
          return false;
        }
        if (!chat.sender?.user_id || !chat.message?.length) {
          return false;
        }
        if (
          !chat.message.some((msgPart) =>
            allowedMessageTypes.includes(msgPart.type)
          )
        ) {
          return false;
        }
        seenMessageIds.add(messageId);
        return true;
      });
    };

    let res = await group.getMsgHistory(0);
    let initialChats = res?.messages || [];

    if (initialChats.length === 0) {
      return [];
    }

    let chats = processChats(initialChats);
    let seq =
      initialChats[0].message_seq ||
      initialChats[0].message_id;

    while (chats.length < num) {
      const res = await group.getMsgHistory(seq);
      const chatHistory = res?.messages || [];

      const newSeq =
        chatHistory[0]?.message_seq ||
        chatHistory[0]?.message_id;

      if (chatHistory.length === 0 || seq === newSeq) {
        break;
      }

      seq = newSeq;
      const newChats = processChats(chatHistory);

      if (newChats.length === 0) {
        break;
      }

      chats.unshift(...newChats);
    }

    chats = chats.slice(Math.max(0, chats.length - num));

    return chats;
  } catch (err) {
    logger.error("获取群聊天记录时出错:", err);
    return [];
  }
}

async function formatChatMessageContent(group, chat) {
  const sender = chat.sender || {};
  const chatTime =
    chat.time || (chat.message_id ? Math.floor(Date.now() / 1000) : 0);
  const senderId = sender.user_id;
  let memberInfo;
  try {
    memberInfo = await group.getMemberInfo(senderId, false);
  } catch {
  }
  const senderName =
    memberInfo?.card || memberInfo?.nickname || senderId || "未知用户";
  const senderRole = roleMap[sender.role] || "普通成员";

  let messageHeader = `【${senderName}】(QQ:${senderId}, 角色:${senderRole}`;
  if (sender.title) {
    messageHeader += `, 头衔:${sender.title}`;
  }
  messageHeader += `, 时间:${formatDate(chatTime)}`;
  const seq = chat.seq || chat.message_seq;
  if (seq) {
    messageHeader += `, seq:${seq}`;
  }

  let originalMsg = null;
  const replyPart = chat.message?.find((msg) => msg.type === "reply");
  if (replyPart && replyPart.id) {
    try {
      const message_id = replyPart.id;
      const res = await group.getMsgHistory(message_id);
      const originalMsgArray = res?.messages || [];
      originalMsg = originalMsgArray.length > 0 ? originalMsgArray[0] : null;
    } catch (error) {
      logger.error("获取被回复的原始消息时出错:", error);
    }
  }

  if (originalMsg && originalMsg.message) {
    const originalSenderId = originalMsg.sender?.user_id;
    let originalMemberInfo;
    try {
      originalMemberInfo = await group.getMemberInfo(originalSenderId, false);
    } catch {
    }
    const originalSenderName =
      originalMemberInfo?.card ||
      originalMemberInfo?.nickname ||
      originalSenderId ||
      "未知用户";
    const originalContentParts = [];
    for (const msgPart of originalMsg.message) {
      switch (msgPart.type) {
        case "text":
          originalContentParts.push(msgPart.data?.text || "");
          break;
        case "at":
          originalContentParts.push(`@${msgPart.data?.qq}`);
          break;
        case "image": {
          const isAnimated = msgPart.data?.sub_type === 1;
          originalContentParts.push(isAnimated ? `[动画表情]` : `[图片]`);
          break;
        }
        case "video": {
          originalContentParts.push(`[视频]`);
          break;
        }
        case "forward":
          originalContentParts.push("[聊天记录]");
          break;
        case "json":
          try {
            const jsonData = JSON.parse(msgPart?.data);
            if (jsonData?.meta?.detail?.resid) {
              originalContentParts.push("[聊天记录]");
            }
          } catch (e) {}
          break;
      }
    }

    const fullOriginalMessage = originalContentParts.join("").trim();
    const originalMessageContent = fullOriginalMessage.replace(/\n/g, " ");

    messageHeader += `， 引用了${originalSenderName}(QQ:${originalSenderId})的消息"${originalMessageContent}"`;
    const originalSeq = originalMsg.seq || originalMsg.message_seq;
    if (originalSeq) {
      messageHeader += `(seq:${originalSeq})`;
    }
  }

  messageHeader += `) 说：`;

  let contentParts = [];
  const messageContentParts = chat.message.filter(
    (msg) => msg.type !== "reply"
  );

  if (messageContentParts.length > 0) {
    for (const msgPart of messageContentParts) {
      switch (msgPart.type) {
        case "text":
          contentParts.push(msgPart.data?.text || "");
          break;
        case "at":
          contentParts.push(`@${msgPart.data?.qq}`);
          break;
        case "image": {
          const isAnimated = msgPart.data?.sub_type === 1;
          contentParts.push(isAnimated ? `[动画表情]` : `[图片]`);
          break;
        }
        case "video": {
          contentParts.push(`[视频]`);
          break;
        }
        case "forward":
          contentParts.push("[聊天记录]");
          break;
        case "json":
          try {
            const jsonData = JSON.parse(msgPart?.data);
            if (jsonData?.meta?.detail?.resid) {
              contentParts.push("[聊天记录]");
            }
          } catch (e) {}
          break;
      }
    }
  }

  const messageContent = contentParts.join("");

  return `${messageHeader}${messageContent}`;
}

export async function buildGroupPrompt(groupId, options = {}) {
  const config = Setting.getConfig("AI");
  const { groupContextLength } = config;
  let systemPromptWithContext = "";

  if (!bot) return "";

  const group = bot.pickGroup(groupId);
  if (!group) return "";

  let groupInfo;
  try {
    groupInfo = await group.getInfo(false);
  } catch (e) {
    return "";
  }

  const { sender, promptHeader } = options;

  if (promptHeader) {
    systemPromptWithContext += promptHeader;
  } else {
    let botMemberInfo;
    try {
      botMemberInfo = await group.getMemberInfo(bot.self_id, false);
    } catch {}
    const botName =
      botMemberInfo?.card || botMemberInfo?.nickname || bot.self_id;

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    systemPromptWithContext += `今天是 ${year}年${month}月${day}日。`;

    systemPromptWithContext += `你目前正在一个QQ群聊中。`;
    systemPromptWithContext += `\n群名称: ${groupInfo.group_name}, 群号: ${groupId}。`;
    systemPromptWithContext += `你现在是这个QQ群的成员，你的昵称是“${botName}”(QQ:${bot.self_id})。`;

    if (sender) {
      const latestSenderName = sender.card || sender.nickname || sender.user_id;
      systemPromptWithContext += `\n当前向你提问的用户是: ${latestSenderName}(QQ:${sender.user_id})。`;
      systemPromptWithContext += ` (角色: ${
        roleMap[sender.role] || "普通成员"
      }`;
      if (sender.title) systemPromptWithContext += `, 群头衔: ${sender.title}`;
      systemPromptWithContext += `)。\n`;
    }
  }

  let chats = [];
  try {
    chats = await getChatHistoryGroup(group, groupContextLength);
  } catch (historyError) {}

  if (chats && chats.length > 0) {
    systemPromptWithContext += `当你需要艾特(@)别人时，可以直接在回复中添加‘@QQ’，其中QQ为你需要艾特(@)的人的QQ号，如‘@123456’。以下是最近群内的聊天记录。请你仔细阅读这些记录，理解群内成员的对话内容和趋势，并以此为基础来生成你的回复。你的回复应该自然融入当前对话，就像一个真正的群成员一样：\n`;
    const formattedChats = await Promise.all(
      chats.map((chat) => formatChatMessageContent(group, chat))
    );
    systemPromptWithContext += formattedChats.join("\n");
  }
  return systemPromptWithContext;
}
