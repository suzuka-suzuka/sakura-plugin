import puppeteer from "puppeteer";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import template from "art-template";

const _path = process.cwd();

export class SakuraMenu extends plugin {
    constructor() {
        super({
            name: "Sakura-Plugin-Menu",
            event: "message",
            priority: 50,
        });
    }

    showMenu = Command(/^#?(sakura|樱花)?(菜单|帮助)$/, async (e) => {
        const yamlPath = path.join(
            _path,
            "plugins",
            "sakura-plugin",
            "resources",
            "menu",
            "menu.yaml"
        );

        let menuData = [];
        let title = "🌸 Sakura 菜单 🌸";
        let subtitle = "『落樱飘雪，为你服务』 - 指令大纲";
        try {
            const fileContent = fs.readFileSync(yamlPath, "utf8");
            const config = yaml.load(fileContent);
            menuData = config.menu || [];
            if (config.title) title = config.title;
            if (config.subtitle) subtitle = config.subtitle;
        } catch (err) {
            logger.error("读取 menu.yaml 失败:", err);
            return e.reply(
                "菜单配置文件读取失败，请检查 plugins/sakura-plugin/resources/menu/menu.yaml"
            );
        }
        e.react(124)
        const htmlPath = path.join(
            _path,
            "plugins",
            "sakura-plugin",
            "resources",
            "menu",
            "menu.html"
        );

        let htmlContent;
        try {
            const templateHtml = fs.readFileSync(htmlPath, "utf8");
            htmlContent = template.render(templateHtml, { menuData, title, subtitle });
        } catch (err) {
            logger.error("渲染模板失败:", err);
            return e.reply("菜单模板渲染失败，请检查 html 文件。");
        }

        try {
            // 启动原生的 Puppeteer 进行截图
            const browser = await puppeteer.launch({
                args: ["--no-sandbox", "--disable-setuid-sandbox"],
            });
            const page = await browser.newPage();
            await page.setContent(htmlContent, { waitUntil: "networkidle0" });

            const element = await page.$("#capture-area");
            const imageBuffer = await element.screenshot();

            await browser.close();

            await e.reply(segment.image(imageBuffer));
        } catch (err) {
            logger.error("生成菜单截图时出错:", err);
            await e.reply(`生成菜单截图时出错: ${err.message}`);
        }

        return true;
    });
}
