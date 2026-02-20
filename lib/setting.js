import YAML from 'js-yaml'
import chokidar from 'chokidar'
import fs from 'node:fs'
import { _path, pluginresources } from "./path.js";
import pluginConfigManager from '../../../src/core/pluginConfig.js';

const PLUGIN_NAME = 'sakura-plugin';

import EconomyManager from './economy/EconomyManager.js';

/**
 * Setting — 薄 shim 层
 * 所有配置读写全部委托给框架的 pluginConfigManager
 * 仅保留 economy 等非配置 YAML 的工具方法
 */
class Setting {
  constructor() {
    this.economyPath = `${pluginresources}/economy/`;
    this.economy = {};
    this.watcher = { economy: {} };
  }

  // ===== 配置相关：全部转发给框架 =====

  getConfig(app) {
    return pluginConfigManager.getConfig(PLUGIN_NAME, app) || {};
  }

  setConfig(app, data) {
    const result = pluginConfigManager.setConfig(PLUGIN_NAME, app, data);
    return result.success;
  }

  merge() {
    return pluginConfigManager.getAll(PLUGIN_NAME) || {};
  }

  analysis(config) {
    for (const [key, value] of Object.entries(config)) {
      this.setConfig(key, value);
    }
  }

  // ===== 指令消耗工具方法 =====

  /**
   * 检查并消耗樱花币（供插件内部调用）
   * @param {object} e - 事件对象
   * @param {string} commandName - 指令的中文显示名（需要与 yaml 中配置的一致）
   * @returns {boolean} - true: 可以继续执行（消耗成功或无需消耗）, false: 余额不足
   */
  payForCommand(e, commandName) {
    try {
      // Master 不消耗
      if (e.isMaster) return true;

      // 获取经济系统配置
      const economyConfig = this.getConfig('economy');
      if (!economyConfig?.enable) return true;

      // 检查群是否启用了经济系统
      const groupId = e.group_id;
      if (!groupId || !economyConfig.Groups?.includes(Number(groupId))) return true;

      // 查找该指令的消耗配置
      const commandCosts = economyConfig.commandCosts || [];
      const costConfig = commandCosts.find(c => c.command === commandName);

      // 如果没有配置消耗或消耗为 0，直接通过
      if (!costConfig || !costConfig.cost || costConfig.cost <= 0) return true;

      // 静态导入 EconomyManager，实例化
      const economyManager = new EconomyManager(e);

      // 检查余额
      const userCoins = economyManager.getCoins(e);
      if (userCoins < costConfig.cost) {
        // 余额不足
        return false;
      }

      // 消耗樱花币
      economyManager.reduceCoins(e, costConfig.cost);
      return true;
    } catch (err) {
      logger.error(`[Setting] 检查指令消耗出错: ${err}`);
      return true; // 出错时允许通过
    }
  }

  /**
   * 获取指令配置的消耗数量（不消耗，仅查询）
   * @param {string} commandName - 指令的中文显示名
   * @returns {number} - 消耗数量，未配置返回 0
   */
  getCommandCost(commandName) {
    try {
      const economyConfig = this.getConfig('economy');
      if (!economyConfig?.enable) return 0;

      const commandCosts = economyConfig.commandCosts || [];
      const costConfig = commandCosts.find(c => c.command === commandName);
      return costConfig?.cost || 0;
    } catch {
      return 0;
    }
  }

  // ===== Economy 相关：保留旧逻辑 =====

  getEconomy(app) {
    return this._getYaml(app, 'economy');
  }

  setEconomy(app, data) {
    const file = `${this.economyPath}${app}.yaml`;
    try {
      fs.writeFileSync(file, YAML.dump(data), 'utf8');
      return true;
    } catch (e) {
      logger.error(`[${app}] economy 写入失败: ${e}`);
      return false;
    }
  }

  _getYaml(app, type) {
    if (this[type]?.[app]) return this[type][app];

    const file = `${this.economyPath}${app}.yaml`;
    try {
      if (!fs.existsSync(file)) return {};
      const data = YAML.load(fs.readFileSync(file, 'utf8'));
      this[type][app] = data;
      this._watch(file, app, type);
      return data || {};
    } catch (e) {
      logger.error(`[${app}] 读取失败: ${e}`);
      return {};
    }
  }

  _watch(file, app, type) {
    if (this.watcher[type]?.[app]) return;
    const watcher = chokidar.watch(file);
    watcher.on('change', () => {
      delete this[type][app];
      logger.mark(`[修改配置文件][${type}][${app}]`);
    });
    if (!this.watcher[type]) this.watcher[type] = {};
    this.watcher[type][app] = watcher;
  }
}

export default new Setting();
