import { AbstractTool } from './AbstractTool.js';

export class MuteTool extends AbstractTool {
  name = 'Mute';

  parameters = {
    properties: {
      qq: {
        type: 'string',
        description: '你想禁言的那个人的QQ号',
      },
      time: {
        type: 'string',
        description: '禁言时长，单位为秒。如果需要解除禁言则填0。',
      },
    },
    required: ['qq', 'time'],
  };
  description = '当你想要禁言某个群成员时可以使用此工具。';
  func = async function (opts, e) {
    let { qq, time } = opts;
	if (!e.isGroup) {
        return '这个功能只能在群聊中使用，喵~';
    }
    const senderId = e.sender.user_id;
    const groupId = e.group_id;

    qq = parseInt(qq.trim());

    if (typeof time === 'undefined' || time === null) {
      return '请告诉我禁言多长时间。';
    }
    
    time = parseInt(time.trim());
    if (time > 86400 * 30) {
      time = 86400 * 30;
    }

    const memberMap = await e.group.getMemberMap(true)

    if (!memberMap.has(qq)) {
      return `操作失败，用户 ${qq} 不在群 ${groupId} 中。`;
    }

    if (memberMap.get(e.bot.uin).role === 'member') {
      return `操作失败，机器人 ${e.bot.uin} 在群 ${groupId} 中没有禁言权限。`;
    }

    const senderRole = memberMap.get(senderId)?.role;
    const targetRole = memberMap.get(qq)?.role;
    const isSenderAdminOrOwner = senderRole === 'admin' || senderRole === 'owner';
    const isTargetAdminOrOwner = targetRole === 'admin' || targetRole === 'owner';

    if (isTargetAdminOrOwner) {
      if (!isSenderAdminOrOwner) {
        await e.group.muteMember(senderId, time);
        return `操作失败：${senderId} 没有权限禁言管理员或群主。作为惩罚，${senderId} 已你被禁言 ${time} 秒。`;
      } else {
        return `操作失败：无法禁言同为管理员或群主 ${qq}。`;
      }
    }

    await e.group.muteMember(qq, time);
    const action = time === 0 ? '解除禁言' : `禁言 ${time} 秒`;
    return `操作成功：用户 ${qq} 已被${action}。`;
  };
}
