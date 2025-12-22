import { plugindata } from "../lib/path.js";
import setting from "../lib/setting.js";
import fsp from "fs/promises";
import path from "path";
import axios from "axios";
import _ from "lodash";
import crypto from "crypto";
export class TextMsg extends plugin {
  constructor() {
    super({
      name: "表情包小偷",
      dsc: "表情包小偷",
      event: "message.group",
      priority: 35,
    });

    this.rootDir = path.join(plugindata, `EmojiThief`);
    this.jsonDbPath = path.join(this.rootDir, "EmojiThief.json");
  }

  clearAllEmojisTask = Cron("0 0 * * 0", async () => {
    await this.clearAllEmojis();
  });

  get appconfig() {
    return setting.getConfig("EmojiThief");
  }

  async readMd5Db() {
    try {
      await fsp.access(this.jsonDbPath);
      const data = await fsp.readFile(this.jsonDbPath, "utf-8");
      return new Set(JSON.parse(data));
    } catch (error) {
      return new Set();
    }
  }

  async writeMd5Db(md5Set) {
    const dataArray = Array.from(md5Set);
    await fsp.writeFile(this.jsonDbPath, JSON.stringify(dataArray, null, 2));
  }

  表情包小偷 = OnEvent("message.group", async (e) => {
    const EmojiThiefConfig = this.appconfig;
    let rate = EmojiThiefConfig.rate;
    let groups = EmojiThiefConfig.Groups;

    if (!groups || groups.length === 0 || !groups.includes(e.group_id)) {
      return false;
    }

    await fsp.mkdir(this.rootDir, { recursive: true }).catch(() => {});

    const md5Db = await this.readMd5Db();
    let hasNewEmoji = false;

    for (const item of e.message) {
      if (item.type === "image" && (item.data?.sub_type === 1 || item.data?.emoji_id)) {
        try {
          const response = await axios.get(item.data?.url, {
            responseType: "arraybuffer",
            timeout: 10000,
          });
          const buffer = response.data;

          const hash = crypto.createHash("md5").update(buffer).digest("hex");

          if (md5Db.has(hash)) {
            continue;
          }

          const groupDir = path.join(this.rootDir, `${e.group_id}`);
          await fsp.mkdir(groupDir, { recursive: true }).catch(() => {});

          const fileName = `${hash}.gif`;
          const filePath = path.join(groupDir, fileName);

          await fsp.writeFile(filePath, buffer);

          md5Db.add(hash);
          hasNewEmoji = true;
        } catch (error) {
          logger.error(`处理表情包失败: ${error}`);
        }
      }
    }

    if (hasNewEmoji) {
      await this.writeMd5Db(md5Db);
    }

    if (_.random(true) < rate) {
      try {
        let emojiPath;
        const groupDirs = (
          await fsp.readdir(this.rootDir, { withFileTypes: true })
        )
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name);

        if (groupDirs.length > 0) {
          const randomGroupDir = groupDirs[_.random(0, groupDirs.length - 1)];
          const groupDirPath = path.join(this.rootDir, randomGroupDir);
          const files = await fsp.readdir(groupDirPath);
          if (files.length > 0) {
            const randomIndex = _.random(0, files.length - 1);
            emojiPath = path.join(groupDirPath, files[randomIndex]);
          }
        }
        if (!emojiPath) {
          return false;
        }
        logger.info(`触发表情包`);
        await e.reply(segment.image(emojiPath, 1));
      } catch (error) {
        logger.error(`表情包发送失败: ${error}`);
      }
    }

    return false;
  });

  async clearAllEmojis() {
    try {
      await fsp.access(this.rootDir);

      const entries = await fsp.readdir(this.rootDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(this.rootDir, entry.name);
        if (entry.isDirectory()) {
          await fsp.rm(fullPath, { recursive: true, force: true });
        } else if (entry.name === "EmojiThief.json") {
          await fsp.rm(fullPath);
        }
      }
      logger.mark("定时清理任务已完成，图片及数据库均已清除。");
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.error(`清理失败: ${error.stack}`);
      }
    }
  }
}
