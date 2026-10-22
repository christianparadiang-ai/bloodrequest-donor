/**
 * LIFE DROP: REPORTING DATE PERIOD CALCULATOR
 *
 * Implements strict calendar period calculations with ISO week conventions:
 * - Week is Monday 00:00:00 UTC through Sunday 23:59:59.999 UTC.
 * - Month is 1st of month 00:00:00 UTC through last calendar day 23:59:59.999 UTC.
 * - Year is Jan 1 00:00:00 UTC through Dec 31 23:59:59.999 UTC.
 * - Day is 00:00:00 UTC through 23:59:59.999 UTC.
 * - Custom range validates startDate <= endDate.
 */

export type PeriodType = "day" | "week" | "month" | "year" | "custom";

export interface DateRangeResult {
  periodType: PeriodType;
  startDate: string; // ISO string with time
  endDate: string;   // ISO string with time
  label: string;
  formattedStart: string; // YYYY-MM-DD
  formattedEnd: string;   // YYYY-MM-DD
}

function pad(num: number): string {
  return num.toString().padStart(2, "0");
}

export function formatDateYMD(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Calculates deterministic start and end timestamps for a selected reporting period.
 */
export function calculateDateRange(options: {
  periodType: PeriodType;
  date?: string;       // YYYY-MM-DD
  year?: number;       // e.g. 2026
  month?: number;      // 1-12
  customStart?: string; // YYYY-MM-DD
  customEnd?: string;   // YYYY-MM-DD
}): DateRangeResult {
  const period = String(options.periodType || "custom").toLowerCase();
  const now = new Date();

  if (period === "day") {
    const baseDate = options.date ? new Date(`${options.date}T00:00:00Z`) : now;
    const ymd = formatDateYMD(baseDate);
    const start = new Date(`${ymd}T00:00:00.000Z`);
    const end = new Date(`${ymd}T23:59:59.999Z`);

    return {
      periodType: "day",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: `Day: ${ymd}`,
      formattedStart: ymd,
      formattedEnd: ymd,
    };
  }

  if (period === "week") {
    // ISO week convention: Monday 00:00:00 to Sunday 23:59:59
    const baseDate = options.date ? new Date(`${options.date}T00:00:00Z`) : now;
    const dayOfWeek = baseDate.getUTCDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
    // Calculate distance to Monday
    const distanceToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(baseDate);
    monday.setUTCDate(baseDate.getUTCDate() + distanceToMonday);
    const mondayYMD = formatDateYMD(monday);

    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const sundayYMD = formatDateYMD(sunday);

    const start = new Date(`${mondayYMD}T00:00:00.000Z`);
    const end = new Date(`${sundayYMD}T23:59:59.999Z`);

    return {
      periodType: "week",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: `Week: ${mondayYMD} (Mon) to ${sundayYMD} (Sun)`,
      formattedStart: mondayYMD,
      formattedEnd: sundayYMD,
    };
  }

  if (period === "month") {
    const y = options.year || now.getUTCFullYear();
    const m = options.month !== undefined ? options.month : now.getUTCMonth() + 1;
    const startYMD = `${y}-${pad(m)}-01`;
    // Last day of month
    const nextMonthFirst = new Date(Date.UTC(y, m, 1));
    const lastDay = new Date(nextMonthFirst.getTime() - 1);
    const endYMD = formatDateYMD(lastDay);

    const start = new Date(`${startYMD}T00:00:00.000Z`);
    const end = new Date(`${endYMD}T23:59:59.999Z`);

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    return {
      periodType: "month",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: `Month: ${monthNames[m - 1]} ${y}`,
      formattedStart: startYMD,
      formattedEnd: endYMD,
    };
  }

  if (period === "year") {
    const y = options.year || now.getUTCFullYear();
    const startYMD = `${y}-01-01`;
    const endYMD = `${y}-12-31`;

    const start = new Date(`${startYMD}T00:00:00.000Z`);
    const end = new Date(`${endYMD}T23:59:59.999Z`);

    return {
      periodType: "year",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: `Year: ${y}`,
      formattedStart: startYMD,
      formattedEnd: endYMD,
    };
  }

  // Custom range
  let startYMD = options.customStart || formatDateYMD(new Date(now.getTime() - 30 * 86400000));
  let endYMD = options.customEnd || formatDateYMD(now);

  if (startYMD > endYMD) {
    // Validate start is not after end; if inverted, swap
    const temp = startYMD;
    startYMD = endYMD;
    endYMD = temp;
  }

  const start = new Date(`${startYMD}T00:00:00.000Z`);
  const end = new Date(`${endYMD}T23:59:59.999Z`);

  return {
    periodType: "custom",
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    label: `Custom Range: ${startYMD} to ${endYMD}`,
    formattedStart: startYMD,
    formattedEnd: endYMD,
  };
}
