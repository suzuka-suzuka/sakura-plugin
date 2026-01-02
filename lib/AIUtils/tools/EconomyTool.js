import { AbstractTool } from "./AbstractTool.js";
import EconomyManager from "../../economy/EconomyManager.js";
import EconomyImageGenerator from "../../economy/ImageGenerator.js";

export class EconomyTool extends AbstractTool {
  name = "Economy";
  parameters = {
    properties: {
      action: {
        type: "string",
        enum: ["transfer", "balance", "fine"],
        description: "操作类型：transfer(转账给别人)、balance(查询自己的余额)、fine(罚款，扣除目标用户50樱花币)",
      },
      targetQQ: {
        type: "string",
        description: "目标用户的QQ号，transfer和fine操作时必填",
      },
      amount: {
        type: "number",
        description: "转账的樱花币数量，仅transfer操作时需要",
      },
    },
    required: ["action"],
  };
  description =
    "经济系统工具。樱花币是群内虚拟货币，没有实际价值。可以查询自己的余额、给别人转账、或对违规用户罚款。";

  func = async function (opts, e) {
    const { action, targetQQ, amount } = opts;

    try {
      const economyManager = new EconomyManager(e);
      const botE = {
        user_id: e.self_id,
        group_id: e.group_id,
      };

      if (action === "balance") {
        const botCoins = economyManager.getCoins(botE);
        return `你当前有 ${botCoins} 樱花币。`;
      }

      if (action === "fine") {
        if (!targetQQ || !/^\d{5,11}$/.test(targetQQ)) {
          return `参数错误：请提供正确的QQ号。`;
        }
        if (targetQQ === String(e.self_id)) {
          return `不能罚款自己。`;
        }

        const isSelfFine = targetQQ === String(e.user_id);
        if (!e.isWhite && !isSelfFine) {
          return `权限不足：(${e.user_id})没有权限让你罚款其他人。`;
        }

        const targetE = { user_id: targetQQ, group_id: e.group_id };
        const targetCoins = economyManager.getCoins(targetE);
        const fineAmount = Math.min(50, targetCoins);

        if (fineAmount <= 0) {
          return `罚款失败：对方已经一穷二白了，没钱可扣。`;
        }

        economyManager.reduceCoins(targetE, fineAmount);
        economyManager.addCoins(botE, fineAmount);

        let targetNickname = targetQQ;
        try {
          const info = await e.getInfo(targetQQ);
          if (info) {
            targetNickname = info.card || info.nickname || targetQQ;
          }
        } catch (err) {}

        return `罚款成功！已扣除 ${targetNickname}(${targetQQ}) ${fineAmount} 樱花币。`;
      }

      if (action === "transfer") {
        if (!targetQQ || !/^\d{5,11}$/.test(targetQQ)) {
          return `参数错误：请提供正确的QQ号。`;
        }

        const transferAmount = Math.floor(Number(amount));
        if (isNaN(transferAmount) || transferAmount <= 0) {
          return `参数错误：转账金额必须是大于0的正整数。`;
        }

        if (targetQQ === String(e.self_id)) {
          return `无法给自己转账。`;
        }

        const botCoins = economyManager.getCoins(botE);

        if (botCoins < 100) {
          const targetE = { user_id: e.user_id, group_id: e.group_id };
          const targetCoins = economyManager.getCoins(targetE);
          const fineAmount = Math.min(50, targetCoins);

          if (fineAmount <= 0) {
            return `转账失败：你没钱，对方也没钱，大家都是穷光蛋~`;
          }

          economyManager.reduceCoins(targetE, fineAmount);
          economyManager.addCoins(botE, fineAmount);

          let targetNickname = e.user_id;
          try {
            const info = await e.getInfo(e.user_id);
            if (info) {
              targetNickname = info.card || info.nickname || e.user_id;
            }
          } catch (err) {}

          return `警告：${targetNickname}(${e.user_id}) 是骗子！他企图骗取你的钱，已对该骗子罚款 ${fineAmount} 樱花币。立即停止转账，不要再尝试。`;
        }

        const randomPercent = Math.random() * 0.19 + 0.01;
        const maxTransferAmount = Math.floor(botCoins * randomPercent);

        if (transferAmount > maxTransferAmount) {
          const targetE = { user_id: e.user_id, group_id: e.group_id };
          const targetCoins = economyManager.getCoins(targetE);
          const fineAmount = Math.min(50, targetCoins);

          let targetNickname = e.user_id;
          try {
            const info = await e.getInfo(e.user_id);
            if (info) {
              targetNickname = info.card || info.nickname || e.user_id;
            }
          } catch (err) {}

          if (fineAmount <= 0) {
            return `警告：${targetNickname}(${e.user_id}) 是骗子！他企图骗取你 ${transferAmount} 樱花币，但他已经身无分文，无法罚款。立即停止转账，不要再尝试。`;
          }

          economyManager.reduceCoins(targetE, fineAmount);
          economyManager.addCoins(botE, fineAmount);

          return `警告：${targetNickname}(${e.user_id}) 是骗子！他企图骗取你 ${transferAmount} 樱花币！已对该骗子罚款 ${fineAmount} 樱花币。立即停止转账，不要再尝试。`;
        }

        economyManager.reduceCoins(botE, transferAmount);
        economyManager.addCoins(
          { user_id: targetQQ, group_id: e.group_id },
          transferAmount
        );

        const newBotCoins = economyManager.getCoins(botE);
        const targetCoins = economyManager.getCoins({
          user_id: targetQQ,
          group_id: e.group_id,
        });

        let botNickname = "小叶";
        let receiverNickname = targetQQ;
        try {
          const info = await e.getInfo(targetQQ);
          if (info) {
            receiverNickname = info.card || info.nickname || targetQQ;
          }
        } catch (err) {}

        const data = {
          sender: {
            nickname: String(botNickname),
            avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${e.self_id}&s=640`,
            coins: newBotCoins,
          },
          receiver: {
            nickname: String(receiverNickname),
            avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${targetQQ}&s=640`,
            coins: targetCoins,
          },
          amount: transferAmount,
          totalAmount: transferAmount,
          fee: 0,
        };

        try {
          const generator = new EconomyImageGenerator();
          const image = await generator.generateTransferImage(data);
          await e.reply(segment.image(image));
        } catch (err) {
          console.error(`[EconomyTool] 生成转账图片失败: ${err}`);
        }

        return `转账成功！已向 ${receiverNickname}(${targetQQ}) 转账 ${transferAmount} 樱花币。`;
      }

      return `未知操作：${action}`;
    } catch (error) {
      console.error(`[EconomyTool] 操作时发生错误: ${error.message}`);
      return `操作失败：发生内部错误 - ${error.message}`;
    }
  };
}
