import Setting from '../lib/setting.js';

export class forwardMessage extends plugin {
  constructor() {
    super({
      name: "转发消息插件",
      dsc: "监听指定群聊的消息并将其转发到另一个群聊",
      event: "message.group",
      priority: 35,
      rule: [
        {
          reg: '',
          fnc: "handleForwardedMessage",
          log: false
        },
      ],
    });
  }

  get appconfig() {
    return Setting.getConfig("forwardMessage");
  }

  async handleForwardedMessage(e) {
    const forwardRules = this.appconfig.forwardRules || [];
    const rule = forwardRules.find(r => r.sourceGroupIds && r.sourceGroupIds.includes(e.group_id));

    if (!rule || !rule.targetGroupIds || rule.targetGroupIds.length === 0) {
      return false;
    }

    const { enableImage = true, enableVideo = true, enableRecord = true } = rule;
    let shouldForward = false;

    if (Array.isArray(e.message)) {
      if (e.message.some(m => m.type === 'forward')) {
        if (enableRecord) shouldForward = true;
      } else if (e.message.some(m => m.type === 'video')) {
        if (enableVideo) shouldForward = true;
      } else if (e.message.some(m => m.type === 'image' && !(m.asface === true || m.sub_type === 1))) {
        if (enableImage) shouldForward = true;
      }
    }

    if (!shouldForward) {
      return false;
    }

    for (const targetId of rule.targetGroupIds) {
      try {
        const targetGroup = e.bot.pickGroup(targetId);
        if (targetGroup) {
          await targetGroup.forwardSingleMsg(e.message_id);
        } else {
          logger.warn(`[转发消息] 目标群聊 ${targetId} 未找到，跳过。`);
        }
      } catch (error) {
        logger.error(
          `[转发消息] 转发到群聊 ${targetId} 时发生错误: ${error}`
        );
      }
    }

    return false;
  }
}
