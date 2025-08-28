import YAML from 'yaml'
import chokidar from 'chokidar'
import fs from 'node:fs'
import { _path, pluginRoot } from "./path.js";
import lodash from 'lodash';
class Setting {
  constructor () {
    this.defPath = `${_path}/plugins/sakura-plugin/defSet/`
    this.defSet = {}

    this.configPath = `${_path}/plugins/sakura-plugin/config/`;
    this.config = {};

    this.watcher = { config: {}, defSet: {} };
  }

  merge () {
    let sets = {};
    let appsConfig = fs.readdirSync(this.defPath).filter(file => file.endsWith(".yaml"));
    for (let appConfig of appsConfig) {
      let filename = appConfig.replace(/.yaml/g, '').trim();
      sets[filename] = this.getConfig(filename);
    }
    return sets;
  }

  analysis(config) {
    for (let key of Object.keys(config)){
      this.setConfig(key, config[key]);
    }
  }

  getdefSet (app) {
    return this.getYaml(app, 'defSet');
  }

  _getRawConfig (app) {
    return this.getYaml(app, 'config', true);
  }

  getConfig (app) {
    const defSetConfig = this.getdefSet(app);
    const rawUserConfig = this._getRawConfig(app);
    if (Array.isArray(rawUserConfig)) {
      return rawUserConfig;
    }
    return { ...defSetConfig, ...rawUserConfig };
  }

  setConfig (app, newObjectFromUI) {
    const currentRawUserConfig = this._getRawConfig(app);

    if (lodash.isArray(newObjectFromUI)) {
      if (lodash.isEqual(currentRawUserConfig, newObjectFromUI)) {
        return false; 
      }
      return this.setYaml(app, 'config', newObjectFromUI);
    }

    const customizer = (objValue, srcValue) => {
      if (lodash.isArray(srcValue)) {
        return srcValue;
      }
      return undefined;
    };

    const newMergedUserConfig = lodash.mergeWith({}, currentRawUserConfig, newObjectFromUI, customizer);

    if (lodash.isEqual(currentRawUserConfig, newMergedUserConfig)) {
      return false;
    }

    return this.setYaml(app, 'config', newMergedUserConfig);
  }



  setYaml (app, type, objectToWrite){
    let file = this.getFilePath(app, type);
    try {
      const currentFileContent = fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8')) : {};
      if (lodash.isEqual(currentFileContent, objectToWrite)) {
          return false;
      }
      fs.writeFileSync(file, YAML.stringify(objectToWrite),'utf8');
      return true;
    } catch (error) {
      logger.error(`[${app}] 写入失败 ${error}`);
      return false;
    }
  }

  getYaml (app, type, forceRead = false) {
    let file = this.getFilePath(app, type);

    if (!forceRead && this[type][app]) {
      return this[type][app];
    }

    try {
      if (!fs.existsSync(file)) {
        if (type === 'config') {
          return {};
        } else {
          logger.error(`[${app}] 默认配置文件缺失: ${file}`);
          return {};
        }
      }

      const parsedYaml = YAML.parse(fs.readFileSync(file, 'utf8'));
      if (type !== 'config') {
          this[type][app] = parsedYaml;
      }
      this.watch(file, app, type);
      return parsedYaml || {}; 
    } catch (error) {
      logger.error(`[${app}] 格式错误或读取失败: ${error}`);
      return {};
    }
  }

  getFilePath (app, type) {
    if (type === 'defSet') return `${this.defPath}${app}.yaml`;
    else {
      const configFilePath = `${this.configPath}${app}.yaml`;
      const defFilePath = `${this.defPath}${app}.yaml`;
      try {
        if (!fs.existsSync(configFilePath)) {
          if (fs.existsSync(defFilePath)) {
            fs.copyFileSync(defFilePath, configFilePath);
            logger.mark(`[${app}] 已创建用户配置文件`);
          } else {
            fs.writeFileSync(configFilePath, YAML.stringify({}), 'utf8');
            logger.warn(`[${app}] 默认配置文件缺失，已创建空的配置文件`);
          }
        }
      } catch (error) {
        logger.error(`拓展插件缺失默认文件[${app}]或创建失败: ${error}`);
      }
      return configFilePath;
    }
  }

  watch (file, app, type = 'defSet') {
    if (this.watcher[type][app]) return;

    const watcher = chokidar.watch(file);
    watcher.on('change', path => {
      delete this[type][app];
      logger.mark(`[修改配置文件][${type}][${app}]`);
      if (this[`change_${app}`]) {
        this[`change_${app}`]();
      }
    });
    this.watcher[type][app] = watcher;
  }
}

export default new Setting();

