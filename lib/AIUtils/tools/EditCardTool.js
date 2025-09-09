import { AbstractTool } from './AbstractTool.js';

export class EditCardTool extends AbstractTool {
    name = 'editCard';
    parameters = {
        properties: {
            qq: {
                type: 'string',
                description: 'QQ号。'
            },
            card: {
                type: 'string',
                description: '新的群昵称（群名片）。'
            },
            groupId: {
                type: 'string',
                description: '群号。'
            }
        },
        required: ['qq','card','groupId']
    };

    description = '当你想要修改群内成员的群昵称（群名片）时，可以使用此工具。';
    
    func = async function (opts, e) {
        let { qq, card, groupId } = opts;
        if (!e.isGroup) {
            return '这个功能只能在群聊中使用，喵~';
        }
        
        qq = Number(qq);
        groupId = Number(groupId);
        const senderId = e.sender.user_id; 

        let group = await e.bot.pickGroup(groupId);
        if (!group) {
            return `未找到群 ${groupId}，喵~`;
        }

        try {
            let mm = await e.group.getMemberMap(true)
            if (!mm.has(qq)) {
                return `失败了，用户 ${qq} 不在群 ${groupId} 中`;
            }
            if (mm.get(e.bot.uin) && mm.get(e.bot.uin).role === 'member') {
                return `失败了，机器人没有权限在群 ${groupId} 中修改名片`;
            }

            const senderRole = mm.get(senderId)?.role;
            const targetRole = mm.get(qq)?.role;
            const isSenderAdminOrOwner = senderRole === 'admin' || senderRole === 'owner';
            const isTargetAdminOrOwner = targetRole === 'admin' || targetRole === 'owner';


            if (isTargetAdminOrOwner && !isSenderAdminOrOwner) {
                await group.setCard(senderId, card);
                return `操作失败：用户 ${qq} 没有权限修改管理员或群主 ${qq} 的名片。作为惩罚，用户 ${qq} 的名片已被修改为"${card}"。`;
            }
            

            await group.setCard(qq, card);
            
        } catch (err) {
            console.error(`获取群信息或设置名片失败:`, err);
            return '获取群信息或设置名片失败，可能是底层协议问题或权限不足';
        }
        return `用户 ${qq} 的群名片已成功修改为 "${card}"`;
    }
}
