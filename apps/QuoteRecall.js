export class QuoteRecall extends plugin {
  constructor() {
    super({
      name: "QuoteRecall",
      event: "message.group",
      priority: 35,
    });
  }

  handler = Command(/^撤回$/, async (e) => {
    if (e.reply_id) {
      try {
        await e.recall(e.reply_id);
        await e.recall();
        return true;
      } catch (err) {
        return false;
      }
    }
    return false;
  });
}
