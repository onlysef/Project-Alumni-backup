export const PHILIPPINES_HOLIDAYS = {
  "01-01": "New Year's Day",
  "02-10": "EDSA Revolution Anniversary",
  "04-09": "Day of Valor",
  "06-12": "Independence Day",
  "08-21": "Ninoy Aquino Day",
  "09-09": "Araw ng Kagitingan",
  "11-01": "All Saints' Day",
  "11-30": "Bonifacio Day",
  "12-08": "Feast of the Immaculate Conception",
  "12-25": "Christmas Day",
  "12-30": "Rizal Day",
};

export function getHolidaysForMonth(year, month) {
  const monthStr = String(month).padStart(2, "0");
  return Object.entries(PHILIPPINES_HOLIDAYS)
    .filter(([date]) => date.startsWith(monthStr))
    .map(([date, name]) => ({
      date: `${year}-${date}`,
      name,
    }));
}
