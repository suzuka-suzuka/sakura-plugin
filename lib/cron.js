import { CronExpressionParser } from "cron-parser";

export function isCronDue(cronExpression, fireDate = new Date()) {
  const expression = String(cronExpression || "").trim();
  if (!expression) return false;

  const target = new Date(fireDate);
  if (!Number.isFinite(target.getTime())) return false;
  target.setSeconds(0, 0);

  try {
    const interval = CronExpressionParser.parse(expression, {
      currentDate: new Date(target.getTime() - 1),
    });
    return interval.next().toDate().getTime() === target.getTime();
  } catch {
    return false;
  }
}
