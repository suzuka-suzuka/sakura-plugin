import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import template from "art-template";
import { pluginresources } from "../lib/path.js";
import Setting from "../lib/setting.js";
import { buildMenuData, buildMenuOverviewData, resolveMenuFilter } from "../lib/menu.js";

function buildFullMenuCategoryPages(menuConfig) {
  const groups = menuConfig.menu.filter((group) => group.id !== "owner");
  return groups.map((group, index) => ({
    ...menuConfig,
    title: menuConfig.title + " " + (index + 1) + "/" + groups.length + " - " + group.title,
    subtitle: "完整菜单已按分类转发，当前分类：" + group.title + "。",
    menu: [group],
    totalCount: group.commands.length,
    pageIndex: index + 1,
    pageCount: groups.length,
  }));
}

function getForwardSender(e) {
  const sender = e.sender || {};
  return {
    user_id: e.self_id || e.bot?.self_id || sender.user_id || 0,
    nickname: e.bot?.nickname || sender.card || sender.nickname || "Sakura",
  };
}

async function sendForwardImages(e, imageNodes) {
  const sender = getForwardSender(e);
  const nodes = imageNodes.map((node) => ({
    user_id: sender.user_id,
    nickname: sender.nickname,
    content: segment.image(node.buffer),
  }));

  try {
    await e.sendForwardMsg(nodes, {
      source: "Sakura 全部菜单",
      prompt: "点击查看全部菜单分类",
      news: imageNodes.slice(0, 4).map((node) => ({ text: node.title })),
    });
  } catch (err) {
    logger.warn("[Menu] forward send failed, fallback to direct images:", err);
    for (const node of imageNodes) {
      await e.reply(segment.image(node.buffer));
    }
  }
}

export class SakuraMenu extends plugin {
  constructor() {
    super({
      name: "Sakura-Plugin-Menu",
      event: "message",
      priority: 50,
    });
  }

  showMenu = Command(/^#?(?:sakura|樱花)?\s*(?:(全部|完整|全|AI|创作|图片|表情|经济|钓鱼|群管|主人|维护|工具|自动)\s*)?(?:菜单|帮助)\s*(.*)$/i, async (e) => {
    const prefixFilter = e.match?.[1]?.trim() || "";
    const suffixFilter = e.match?.[2]?.trim() || "";
    const filterText = prefixFilter || suffixFilter;
    const wantsFullMenu =
      /^(全部|完整|全)$/i.test(prefixFilter) ||
      /^(全部|完整|全)$/i.test(filterText);
    const filterId = wantsFullMenu ? null : resolveMenuFilter(filterText);

    if (filterText && !filterId && !wantsFullMenu) {
      await e.reply(
        "没有找到这个菜单分类，可用：AI、创作、图片、表情、经济、钓鱼、群管、主人、维护、工具、自动。",
        10,
        true
      );
      return true;
    }

    const economyConfig = Setting.getConfig("economy");
    const menuConfig = !filterText && !wantsFullMenu
      ? buildMenuOverviewData({ economyConfig, groupId: e.group_id })
      : buildMenuData({
          economyConfig,
          groupId: e.group_id,
          filter: wantsFullMenu ? "" : filterText,
        });
    const menuPages = wantsFullMenu ? buildFullMenuCategoryPages(menuConfig) : [menuConfig];

    await e.react(124);

    const htmlPath = path.join(pluginresources, "menu", "menu.html");
    let templateHtml;

    try {
      templateHtml = fs.readFileSync(htmlPath, "utf8");
    } catch (err) {
      logger.error("[Menu] read template failed:", err);
      await e.reply("菜单模板读取失败，请检查 menu.html。", 10, true);
      return true;
    }

    let browser;
    try {
      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1360, height: 900, deviceScaleFactor: 2 });
      const imageNodes = [];

      for (const pageConfig of menuPages) {
        const htmlContent = template.render(templateHtml, pageConfig);
        await page.setContent(htmlContent, { waitUntil: "domcontentloaded" });

        const element = await page.$("#capture-area");
        const imageBuffer = await element.screenshot({ type: "png" });
        imageNodes.push({ title: pageConfig.menu[0]?.title || pageConfig.title, buffer: imageBuffer });
      }

      if (wantsFullMenu) {
        await sendForwardImages(e, imageNodes);
      } else {
        await e.reply(segment.image(imageNodes[0].buffer));
      }
    } catch (err) {
      logger.error("[Menu] screenshot failed:", err);
      await e.reply("生成菜单截图时出错：" + err.message, 10, true);
    } finally {
      if (browser) {
        await browser.close();
      }
    }

    return true;
  });
}
