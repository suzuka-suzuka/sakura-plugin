import { AbstractTool } from "./AbstractTool.js";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "../../../../../config/config.yaml");

export class BlackListTool extends AbstractTool {
  name = "BlackList";
  parameters = {
    properties: {
      qq: {
        type: "string",
        description: "目标QQ号",
      },
      time: {
        type: "number",
        description: "拉黑时长（秒）。0表示解除拉黑，正数表示拉黑指定时长。",
      },
    },
    required: ["qq", "time"],
  };

  description = "当你想不再理会某人（即拉黑），或者解除拉黑时使用此工具。";

  func = async function (opts, e) {
    const { qq: qqStr, time } = opts;
    const targetQQ = Number(qqStr);
    const senderId = e.user_id || e.sender?.user_id;

    if (isNaN(targetQQ)) {
      return "QQ号格式不正确";
    }

    if (!e.isMaster) {
      return "只有主人可以使用此功能";
    }

    let config = {};
    try {
      const file = fs.readFileSync(CONFIG_PATH, "utf8");
      config = yaml.load(file);
    } catch (err) {
      logger.error(`[BlackListTool] 读取配置文件失败: ${err}`);
      return "读取配置文件失败";
    }

    if (!config.blackUsers) {
      config.blackUsers = [];
    }
    config.blackUsers = config.blackUsers.map(Number);

    if (time === 0) {
      if (!config.blackUsers.includes(targetQQ)) {
        return `${targetQQ} 不在黑名单中`;
      }
      config.blackUsers = config.blackUsers.filter((id) => id !== targetQQ);

      try {
        const yamlStr = yaml.dump(config);
        fs.writeFileSync(CONFIG_PATH, yamlStr, "utf8");
        return `已将 ${targetQQ} 移出黑名单`;
      } catch (err) {
        logger.error(`[BlackListTool] 保存配置文件失败: ${err}`);
        return "保存配置文件失败";
      }
    } else {
      if (config.blackUsers.includes(targetQQ)) {
        return `${targetQQ} 已经在黑名单中了`;
      }
      config.blackUsers.push(targetQQ);

      try {
        const yamlStr = yaml.dump(config);
        fs.writeFileSync(CONFIG_PATH, yamlStr, "utf8");

        let msg = `已将 ${targetQQ} 加入黑名单`;
        if (time > 0) {
          msg += `，时长 ${time} 秒`;
          setTimeout(() => {
            try {
              const currentFile = fs.readFileSync(CONFIG_PATH, "utf8");
              const currentConfig = yaml.load(currentFile);
              if (
                currentConfig.blackUsers &&
                currentConfig.blackUsers.includes(targetQQ)
              ) {
                currentConfig.blackUsers = currentConfig.blackUsers.filter(
                  (id) => id !== targetQQ
                );
                fs.writeFileSync(CONFIG_PATH, yaml.dump(currentConfig), "utf8");
                logger.info(`[BlackListTool] 定时解除黑名单: ${targetQQ}`);
              }
            } catch (err) {
              logger.error(`[BlackListTool] 定时解除黑名单失败: ${err}`);
            }
          }, time * 1000);
        }
        return msg;
      } catch (err) {
        logger.error(`[BlackListTool] 保存配置文件失败: ${err}`);
        return "保存配置文件失败";
      }
    }
  };
}
