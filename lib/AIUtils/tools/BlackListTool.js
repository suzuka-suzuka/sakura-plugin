import { AbstractTool } from "./AbstractTool.js";
import {
  blockUser,
  unblockUser,
} from "../../../../../plugins/system/permission.js";

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

    if (isNaN(targetQQ)) {
      return "QQ号格式不正确";
    }

    if (!e.isMaster) {
      return "只有主人可以使用此功能";
    }

    let result;

    if (time === 0) {
      result = await unblockUser(targetQQ);
    } else {
      result = await blockUser(targetQQ, time);
    }

    return result.message;
  };
}
