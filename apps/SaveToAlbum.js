import { getImg } from "../lib/utils.js";
import { plugindata } from "../lib/path.js";
import fs from "fs";
import path from "path";

const dataFile = path.join(plugindata, "albumData.json");

export class SaveToAlbum extends plugin {
  constructor() {
    super({
      name: "存相册",
      event: "message.group",
      priority: 1135,
    });
  }

  refreshAlbum = Command(/^#?刷新群相册$/, async (e) => {
    const albumList = await e.group.getAlbumMainList();

    if (!albumList || albumList.length === 0) {
      return e.reply("本群没有相册,请先创建相册", 10);
    }

    let data = {};
    if (fs.existsSync(dataFile)) {
      try {
        data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
      } catch (err) {
        data = {};
      }
    }

    data[e.group_id] = albumList.map((item) => ({
      album_id: item.album_id,
      name: item.name,
    }));

    if (!fs.existsSync(path.dirname(dataFile))) {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    }

    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

    e.react(124);
  });

  saveToAlbum = Command(/^#?传相册\s*(.*)$/, async (e) => {
    const albumName = e.match[1].trim();

    const images = await getImg(e);

    if (!images || images.length === 0) {
      return false;
    }

    e.react(124);
    let data = {};
    if (fs.existsSync(dataFile)) {
      try {
        data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
      } catch (err) {
        data = {};
      }
    }

    const groupAlbums = data[e.group_id];

    if (!groupAlbums || groupAlbums.length === 0) {
      return e.reply("本群暂无相册缓存，请先发送【刷新群相册】", 10);
    }

    let targetAlbum = null;
    if (albumName) {
      targetAlbum = groupAlbums.find(
        (a) => a.name && a.name.includes(albumName)
      );
      if (!targetAlbum) return false;
    } else {
      return false;
    }

    const albumId = targetAlbum.album_id;
    const name = targetAlbum.name;
    for (const imgUrl of images) {
      await e.group.uploadAlbumImage(albumId, name, imgUrl);
    }

    return true;
  });
}
