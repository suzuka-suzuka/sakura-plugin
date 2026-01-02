import { AbstractTool } from "./AbstractTool.js";
import EconomyManager from "../../economy/EconomyManager.js";
import EconomyImageGenerator from "../../economy/ImageGenerator.js";

export class TransferCoinTool extends AbstractTool {
  name = "TransferCoin";
  parameters = {
    properties: {
      targetQQ: {
        type: "string",
        description: "要转账的目标用户的QQ号",
      },
      amount: {
        type: "number",
        description: "要转账的樱花币数量，必须是正整数",
      },
    },
    required: ["targetQQ", "amount"],
  };
  description =
    "当你需要给群成员转账樱花币时使用此工具。樱花币是群内虚拟货币，没有实际价值，转账将从你的账户扣除。";

  func = async function (opts, e) {
    const { targetQQ, amount } = opts;

    if (!/^\d{5,11}$/.test(targetQQ)) {
      return `参数错误：提供的QQ号 "${targetQQ}" 格式不正确。`;
    }

    const transferAmount = Math.floor(Number(amount));
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return `参数错误：转账金额必须是大于0的正整数。`;
    }

    if (targetQQ === String(e.self_id)) {
      return `无法给自己转账。`;
    }

    try {
      const economyManager = new EconomyManager(e);

      const botE = {
        user_id: e.self_id,
        group_id: e.group_id,
      };

      const botCoins = economyManager.getCoins(botE);

      if (botCoins < 100) {
        return `转账失败：你现在没什么钱，改天再说吧~`;
      }

      const randomPercent = Math.random() * 0.19 + 0.01;
      const maxTransferAmount = Math.floor(botCoins * randomPercent);

      if (transferAmount > maxTransferAmount) {
        return `转账失败：这个金额有点多，你不太想给那么多...`;
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
        console.error(`[TransferCoinTool] 生成转账图片失败: ${err}`);
      }

      return `转账成功！已向 ${receiverNickname}(${targetQQ}) 转账 ${transferAmount} 樱花币。`;
    } catch (error) {
      console.error(`[TransferCoinTool] 转账时发生错误: ${error.message}`);
      return `转账失败：发生内部错误 - ${error.message}`;
    }
  };
}
