
export async function makeForwardMsg(e, messagesWithSender = [], dec = "") {
  if (!Array.isArray(messagesWithSender)) {
    messagesWithSender = [{
      text: String(messagesWithSender),
      senderId: e.user_id,
      senderName: e.sender?.card || e.sender?.nickname || e.user_id
    }];
  }

  const messages = [];
  for (const item of messagesWithSender) {
    if (!item || !item.text) {
      continue;
    }

    let currentSenderId = item.senderId;
    let currentSenderName = item.senderName;

    if (e.isGroup && currentSenderId) {
      try {
        const member = e.bot.pickMember(e.group_id, currentSenderId);
        const info = await member.getInfo();
        currentSenderName = info.card || info.nickname || currentSenderId;
      } catch (err) {
        logger.error(`获取群成员 ${currentSenderId} 信息失败:`, err);
      }
    }

    messages.push({
      user_id: currentSenderId,
      nickname: currentSenderName,
      message: item.text,
    });
  }

  const forwardData = {
    messages: messages,
    summary: "聊天记录",
    source: "喵",
    prompt: "可爱",
    news: [{ text: dec || "..." }],
  };

  try {
    if (e?.group?.sendForwardMsg) {
      return await e.group.sendForwardMsg(forwardData);
    } else if (e?.friend?.sendForwardMsg) {
      return await e.friend.sendForwardMsg(forwardData);
    } 
  } catch (err) {
    logger.error("发送转发消息时出错:", err);
  }
}

export async function getImg(e) {
  if (!e.message || !Array.isArray(e.message)) {
    return null;
  }

  const directImageUrls = e.message
    .filter(segment => segment.type === 'image' && segment.url)
    .map(segment => segment.url);

  if (directImageUrls.length > 0) {
    e.img = directImageUrls;
    return directImageUrls;
  }

  const replySegment = e.message.find(segment => segment.type === 'reply');

  if (replySegment?.id) {
    const message_id = replySegment.id;

    try {
      const sourceMessageData = e.isGroup
        ? await e.group.getMsg(message_id)
        : await e.friend.getMsg(message_id);

      const messageSegments = sourceMessageData?.message;

      if (messageSegments && Array.isArray(messageSegments)) {
        const repliedImageUrls = messageSegments
          .filter(segment => segment.type === 'image' && segment.url)
          .map(segment => segment.url);

        if (repliedImageUrls.length > 0) {
          e.img = repliedImageUrls;
          return repliedImageUrls;
        }
      }
    } catch (error) {
      return null;
    }
  }

  return null;
}
