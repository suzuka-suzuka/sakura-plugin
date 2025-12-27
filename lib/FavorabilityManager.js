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
    if (this.cache.has(groupId)) {
      return _.cloneDeep(this.cache.get(groupId));
    }

    const file = this.getDataFile(groupId);
    if (!fs.existsSync(file)) {
      return { favorability: {} };
    }
    try {
      const data = fs.readFileSync(file, "utf-8");
      const parsedData = JSON.parse(data);
      this.cache.set(groupId, parsedData);
      return parsedData;
    } catch (err) {
      console.error(`[好感度] 读取数据失败: ${err}`);
      return { favorability: {} };
    }
  }

  saveData(groupId, data) {
    this.cache.set(groupId, data);

    if (!this.saveTasks.has(groupId)) {
      const debouncedWrite = _.debounce((gId, dataToWrite) => {
        const file = this.getDataFile(gId);
        try {
          fs.writeFileSync(file, JSON.stringify(dataToWrite, null, 2), "utf-8");
        } catch (err) {
          console.error(`[好感度] 保存数据失败: ${err}`);
        }
      }, 60000);
      this.saveTasks.set(groupId, debouncedWrite);
    }

    this.saveTasks.get(groupId)(groupId, data);
  }

  addFavorability(groupId, from, to, value) {
    const data = this.readData(groupId);

    if (!data.favorability) {
      data.favorability = {};
    }

    if (!data.favorability[from]) {
      data.favorability[from] = {};
    }

    if (!data.favorability[from][to]) {
      data.favorability[from][to] = 0;
    }

    data.favorability[from][to] += value;

    this.saveData(groupId, data);
  }

  getFavorability(groupId, from, to) {
    const data = this.readData(groupId);
    return data.favorability[from]?.[to] || 0;
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
