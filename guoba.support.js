import lodash from "lodash"
import setting from "./lib/setting.js"

export function supportGuoba() {
  return {
    pluginInfo: {
      name: "sakura-plugin",
      title: "35插件",
      description: "一个简单插件",
      author: "suzuka",
      isV3: true,
      isV2: false,
      showInMenu: "auto",
      icon: "twemoji:cherry-blossom",
    },

    configInfo: {
      schemas: [
        {
          label: "图片功能",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          label: "冷群",
          component: "Divider",
        },
        {
          field: "cool.Groups",
          label: "启用群",
          component: "GSelectGroup",
          required: false,
          componentProps: {
            multiple: true,
          },
        },
        {
          field: "cool.randomIntervalMin",
          label: "最小间隔 (分钟)",
          bottomHelpMessage: "判断冷群的时间",
          component: "InputNumber",
          required: true,
          componentProps: {
            min: 0,
          },
        },
        {
          field: "cool.randomIntervalMax",
          label: "最大间隔 (分钟)",
          bottomHelpMessage: "判断冷群的时间",
          component: "InputNumber",
          required: true,
          componentProps: {
            min: 0,
          },
        },
        {
          label: "下午茶",
          component: "Divider",
        },
        {
          field: "teatime.Groups",
          label: "启用群",
          component: "GSelectGroup",
          required: false,
          componentProps: {
            multiple: true,
          },
        },
        {
          field: "teatime.cron",
          label: "下午茶cron表达式",
          bottomHelpMessage: "修改完重启生效",
          component: "Input",
          required: true,
        },
        {
          label: "表情包小偷",
          component: "Divider",
        },
        {
          field: "EmojiThief.Groups",
          label: "启用群",
          component: "GSelectGroup",
          required: false,
          componentProps: {
            multiple: true,
          },
        },
        {
          field: "EmojiThief.rate",
          label: "概率",
          bottomHelpMessage: "发送表情包概率",
          component: "InputNumber",
          required: true,
          componentProps: {
            min: 0,
            max: 1,
          },
        },
        {
          label: "图片外显",
          component: "Divider",
        },
        {
          field: "summary.enable",
          label: "启用",
          component: "Switch",
          required: true,
        },
        {
          field: "summary.Summaries",
          label: "外显文本列表",
          component: "GTags",
          required: true,
          componentProps: {
            allowAdd: true,
            allowDel: true,
          },
        },
        {
          label: "AI渠道",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          field: "Channels.openai",
          label: "openai",
          bottomHelpMessage: "openai API 类型的渠道。",
          component: "GSubForm",
          required: false,
          componentProps: {
            multiple: true,
            schemas: [
              { field: "name", label: "渠道名称", component: "Input", required: true },
              { field: "baseURL", label: "基本地址", component: "Input", required: true },
              { field: "model", label: "模型名称", component: "Input", required: true },
              {
                field: "api",
                label: "API Key",
                component: "InputTextArea",
                required: true,
                bottomHelpMessage: "支持多个apikey轮询，一行一个",
              },
            ],
          },
        },
        {
          field: "Channels.gemini",
          label: "Gemini",
          bottomHelpMessage: "Gemini API 类型的渠道。",
          component: "GSubForm",
          required: false,
          componentProps: {
            multiple: true,
            schemas: [
              { field: "name", label: "渠道名称", component: "Input", required: true },
              { field: "model", label: "模型名称", component: "Input", required: true },
              {
                field: "api",
                label: "API Key",
                component: "InputTextArea",
                required: true,
                bottomHelpMessage: "支持多个apikey轮询，一行一个",
              },
            ],
          },
        },
        {
          field: "Channels.vertex",
          label: "Vertex",
          bottomHelpMessage: "Vertex AI 类型的渠道。",
          component: "GSubForm",
          required: false,
          componentProps: {
            multiple: true,
            schemas: [
              { field: "name", label: "渠道名称", component: "Input", required: true },
              { field: "model", label: "模型名称", component: "Input", required: true },
            ],
          },
        },
        {
          field: "Vertex.PROJECT_ID",
          label: "项目id",
          bottomHelpMessage: "GCP的项目id，用于Vertex AI",
          component: "Input",
          required: true,
        },
        {
          field: "Vertex.LOCATION",
          label: "地区",
          component: "Input",
          bottomHelpMessage: "Vertex AI的地区",
          required: true,
        },
        {
          label: "AI设定",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          field: "AI.profiles",
          label: "角色配置",
          bottomHelpMessage: "配置不同的人格和其设定，可新增或删除角色。",
          component: "GSubForm",
          required: true,
          componentProps: {
            multiple: true,
            schemas: [
              { field: "name", label: "角色名称", component: "Input", required: true },
              {
                field: "prefix",
                label: "触发前缀",
                component: "Input",
                required: true,
                bottomHelpMessage: "用于触发该角色的命令前缀",
              },
              {
                field: "Channel",
                label: "渠道",
                component: "Input",
                required: true,
                bottomHelpMessage: "使用的渠道名称，必须与上方渠道配置中的名称一致",
              },
              {
                field: "Prompt",
                label: "预设提示词",
                component: "InputTextArea",
                required: true,
                bottomHelpMessage: "角色的核心设定，例如：你是一个可爱的猫娘...",
              },
              {
                field: "GroupContext",
                label: "启用群聊上下文",
                component: "Switch",
                required: true,
              },
              { field: "History", label: "启用历史记录", component: "Switch", required: true },
              { field: "Tool", label: "启用工具", component: "Switch", required: true },
            ],
          },
        },
        {
          field: "AI.groupContextLength",
          label: "群聊上下文长度",
          component: "InputNumber",
          required: true,
          componentProps: {
            min: 1,
          },
        },
        {
          field: "mimic.Channel",
          label: "伪人渠道",
          component: "Input",
          required: true,
        },
        {
          field: "mimic.Prompt",
          label: "伪人预设",
          component: "InputTextArea",
          required: true,
          bottomHelpMessage: "默认预设",
        },
        {
          field: "mimic.alternatePrompt",
          label: "反差预设",
          component: "InputTextArea",
          required: true,
          bottomHelpMessage: "伪人有概率触发的其他预设",
        },
        {
          field: "mimic.triggerWords",
          label: "伪人必定触发词",
          component: "GTags",
          required: false,
          componentProps: {
            allowAdd: true,
            allowDel: true,
          },
        },
        {
          field: "mimic.replyProbability",
          label: "回复概率",
          component: "InputNumber",
          required: true,
          componentProps: {
            min: 0,
            max: 1,
          },
        },
        {
          field: "mimic.alternatePromptProbability",
          label: "反差回复概率",
          component: "InputNumber",
          required: true,
          componentProps: {
            min: 0,
            max: 1,
          },
        },
        {
          label: "其他",
          component: "SOFT_GROUP_BEGIN",
        },
        {
          label: "戳一戳回复",
          component: "Divider",
        },
        {
          field: "poke.enable",
          label: "戳一戳总开关",
          component: "Switch",
          required: true,
        },
        {
          field: "poke.MASTER_REPLIES",
          label: "戳主人回复",
          component: "InputTextArea",
          required: true,
          bottomHelpMessage: "一行一个回复",
        },
        {
          field: "poke.GENERIC_TEXT_REPLIES",
          label: "戳一戳通用回复",
          component: "InputTextArea",
          required: true,
          bottomHelpMessage: "一行一个回复",
        },
        {
          field: "poke.COUNT_REPLIES_GROUP",
          label: "群计数回复",
          component: "InputTextArea",
          required: true,
          bottomHelpMessage: "一行一个回复。回复中的 _num_ 会被替换为实际数字",
        },
        {
          field: "poke.COUNT_REPLIES_USER",
          label: "个人计数回复",
          component: "InputTextArea",
          required: true,
          bottomHelpMessage: "一行一个回复。回复中的 _num_ 会被替换为实际数字",
        },
        {
          field: "poke.POKE_BACK_TEXT_REPLIES",
          label: "戳回去回复",
          component: "InputTextArea",
          required: true,
          bottomHelpMessage: "一行一个回复",
        },
        {
          field: "poke.personas",
          label: "戳一戳设定",
          bottomHelpMessage: "配置不同的人格和其设定",
          component: "GSubForm",
          required: true,
          componentProps: {
            multiple: true,
            schemas: [
              { field: "name", label: "角色名称", component: "Input", required: true },
              {
                field: "Prompt",
                label: "预设提示词",
                component: "InputTextArea",
                required: true,
                bottomHelpMessage: "角色的核心设定",
              },
            ],
          },
        },
        {
          label: "消息转发",
          component: "Divider",
        },
        {
          field: "forwardMessage.forwardRules",
          label: "转发规则",
          component: "GSubForm",
          required: false,
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "sourceGroupIds",
                label: "来源群组",
                component: "GSelectGroup",
                required: true,
                componentProps: {
                  multiple: true,
                },
              },
              {
                field: "targetGroupIds",
                label: "目标群组",
                component: "GSelectGroup",
                required: true,
                componentProps: {
                  multiple: true,
                },
              },
            ],
          },
        },
        {
          label: "杂项",
          component: "Divider",
        },
        {
          field: "repeat.enable",
          label: "复读",
          component: "Switch",
          required: true,
        },
        {
          field: "60sNews.Groups",
          label: "每日新闻启用群",
          component: "GSelectGroup",
          required: false,
          componentProps: {
            multiple: true,
          },
        },
      ],

      getConfigData() {
        return setting.merge()
      },

      setConfigData(data, { Result }) {
        let config = {}
        for (let [keyPath, value] of Object.entries(data)) {
          lodash.set(config, keyPath, value)
        }
        setting.analysis(config)
        return Result.ok({}, "保存成功~")
      },
    },
  }
}
