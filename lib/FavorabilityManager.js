import fs from "fs";
import path from "path";
import _ from "lodash";
import { plugindata } from "./path.js";

const dataPath = path.join(plugindata, "favorability");

class FavorabilityManager {
  constructor() {
    this.cache = new Map();
    this.saveTasks = new Map();
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true });
    }
  }

  getDataFile(groupId) {
    return path.join(dataPath, `${groupId}.json`);
  }

  readData(groupId) {
    const gId = String(groupId);
    if (this.cache.has(gId)) {
      return _.cloneDeep(this.cache.get(gId));
    }

    const file = this.getDataFile(gId);
    if (!fs.existsSync(file)) {
      return { favorability: {} };
    }
    try {
      const data = fs.readFileSync(file, "utf-8");
      const parsedData = JSON.parse(data);
      this.cache.set(gId, parsedData);
      return parsedData;
    } catch (err) {
      console.error(`[好感度] 读取数据失败: ${err}`);
      return { favorability: {} };
    }
  }

  saveData(groupId, data) {
    const gId = String(groupId);
    this.cache.set(gId, data);

    if (!this.saveTasks.has(gId)) {
      const debouncedWrite = _.debounce((id, dataToWrite) => {
        const file = this.getDataFile(id);
        try {
          fs.writeFileSync(file, JSON.stringify(dataToWrite, null, 2), "utf-8");
        } catch (err) {
          console.error(`[好感度] 保存数据失败: ${err}`);
        }
      }, 60000);
      this.saveTasks.set(gId, debouncedWrite);
    }

    this.saveTasks.get(gId)(gId, data);
  }

  addFavorability(groupId, from, to, value) {
    const gId = String(groupId);
    const fromId = String(from);
    const toId = String(to);
    
    const data = this.readData(gId);

    if (!data.favorability) {
      data.favorability = {};
    }

    if (!data.favorability[fromId]) {
      data.favorability[fromId] = {};
    }

    if (!data.favorability[fromId][toId]) {
      data.favorability[fromId][toId] = 0;
    }

    data.favorability[fromId][toId] += value;

    this.saveData(gId, data);
  }

  getFavorability(groupId, from, to) {
    const gId = String(groupId);
    const fromId = String(from);
    const toId = String(to);

    const data = this.readData(gId);
    return data.favorability[fromId]?.[toId] || 0;
  }

  cleanupFavorability() {
    if (!fs.existsSync(dataPath)) return;
    
    const files = fs
      .readdirSync(dataPath)
      .filter((file) => file.endsWith(".json"));
    for (const file of files) {
      const groupId = path.basename(file, ".json");
      const data = this.readData(groupId);

      if (!data.favorability || Object.keys(data.favorability).length === 0) {
        continue;
      }

      let minFavorability = Infinity;
      let minFrom = null;
      let minTo = null;

      for (const from in data.favorability) {
        for (const to in data.favorability[from]) {
          if (data.favorability[from][to] < minFavorability) {
            minFavorability = data.favorability[from][to];
            minFrom = from;
            minTo = to;
          }
        }
      }

      if (minFrom && minTo) {
        delete data.favorability[minFrom][minTo];
        if (Object.keys(data.favorability[minFrom]).length === 0) {
          delete data.favorability[minFrom];
        }
        this.saveData(groupId, data);
      }
    }
    this.cache.clear();
    this.saveTasks.clear();
  }
}

export default new FavorabilityManager();
