import Setting from './setting.js';

/**
 * 根据角色名和群号获取最终提示词（包含群专属补充）
 *
 * 查找逻辑：
 * 1. 根据 roleName 在 roles 配置中查找对应角色
 * 2. 如果找到角色，取 role.prompt 作为基础提示词
 * 3. 如果传入了有效的 groupId 且角色配置了 groupOverrides，
 *    则在群号匹配时将对应补充提示词拼接到基础提示词之后
 *
 * 注意：当角色存在但 role.prompt 为空时，返回空字符串；
 * 调用方通过 truthy 判断决定是否覆盖原有 Prompt，避免误清空预设。
 *
 * @param {string} roleName - 角色名称
 * @param {string|number|null|undefined} groupId - 群号（私聊或不可用时可为空，此时跳过群组覆盖）
 * @param {object[]} [rolesArray] - 可选，预取的角色数组，传入则跳过 getConfig 调用（避免重复磁盘读取）
 * @returns {string} - 最终提示词，若角色不存在返回空字符串
 */
export function getRolePrompt(roleName, groupId, rolesArray) {
    if (!roleName) return '';
    const roles = rolesArray || (Setting.getConfig('roles')?.roles || []);
    const role = roles.find(r => r.name === roleName);
    if (!role) return '';

    let prompt = role.prompt || '';

    // 仅在 groupId 有效时查找群组覆盖；私聊等场景下 groupId 为 undefined/null，直接跳过
    if (groupId != null && role.groupOverrides && Array.isArray(role.groupOverrides)) {
        const groupIdStr = String(groupId);
        const override = role.groupOverrides.find(item => String(item.groupId) === groupIdStr);
        if (override && override.prompt && typeof override.prompt === 'string') {
            const trimmedPrompt = override.prompt.trim();
            if (trimmedPrompt) {
                prompt += `\n\n${trimmedPrompt}`;
            }
        }
    }
    return prompt;
}
