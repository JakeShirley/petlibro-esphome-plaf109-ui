const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Local calendar date as whole days since the epoch, like the firmware's to_day
 */
export function dayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/**
 * web_server sends date entities as "YYYY-MM-DD", anything else (e.g. an unset date) is null
 */
export function parseDateToDay(value: string | undefined): number | null {
  const m = value === undefined ? null : /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

/**
 * Seconds since midnight from "HH:MM" or "HH:MM:SS"
 */
export function parseTimeToSeconds(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const [hh, mm, ss = "0"] = value.split(":");
  const h = Number(hh);
  const m = Number(mm);
  const s = Number(ss);
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  return h * 3600 + m * 60 + s;
}

export function atLocalTime(day: number, secondsOfDay: number): Date {
  const date = new Date(day * DAY_MS);
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    Math.floor(secondsOfDay / 3600),
    Math.floor(secondsOfDay / 60) % 60,
    secondsOfDay % 60,
  );
}

export interface MealSlot {
  date: number | null; // day number of the meal's date entity, null if unset
  time: number | null; // seconds since midnight, null if unset
}

export interface ScheduledMeal {
  index: number; // 0 = meal one
  day: number;
  time: number;
}

export interface Schedule {
  period: number; // days per cycle, 1 for a daily schedule
  meals: ScheduledMeal[]; // soonest first
}

/**
 * Mirrors the firmware's refresh_schedule: a cycle runs from the earliest meal date through the latest,
 * then repeats, so every meal is served once each `period` days. Unset dates count as today.
 */
export function projectSchedule(slots: readonly MealSlot[], now: Date, count: number): Schedule {
  if (slots.length === 0) return { period: 1, meals: [] };
  const today = dayNumber(now);
  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const days = slots.map((slot) => slot.date ?? today);
  const first = Math.min(...days);
  const last = Math.max(...days);
  const period = last - first + 1;
  // once the last meal's day is over, the firmware moves every date forward by whole cycles
  const shift = today > last ? Math.floor((today - first) / period) * period : 0;

  const meals: ScheduledMeal[] = [];
  slots.forEach((slot, index) => {
    if (slot.time === null) return;
    let day = (days[index] ?? today) + shift;
    if (day < today || (day === today && slot.time <= nowSeconds)) day += period; // already served this cycle
    for (let i = 0; i < count; i++) meals.push({ index, day: day + i * period, time: slot.time });
  });
  meals.sort((a, b) => a.day - b.day || a.time - b.time || a.index - b.index);
  return { period, meals: meals.slice(0, count) };
}

export interface ScheduleDay {
  day: number;
  lastDay: number; // after `day` only for a run of days without meals
  meals: ScheduledMeal[]; // empty for days without meals
}

/**
 * Groups meals by day, with one entry for each run of days without meals in between
 */
export function groupByDay(meals: readonly ScheduledMeal[]): ScheduleDay[] {
  const days: ScheduleDay[] = [];
  for (const meal of meals) {
    const prev = days[days.length - 1];
    if (prev?.day === meal.day) {
      prev.meals.push(meal);
      continue;
    }
    if (prev && meal.day > prev.lastDay + 1) days.push({ day: prev.lastDay + 1, lastDay: meal.day - 1, meals: [] });
    days.push({ day: meal.day, lastDay: meal.day, meals: [meal] });
  }
  return days;
}
