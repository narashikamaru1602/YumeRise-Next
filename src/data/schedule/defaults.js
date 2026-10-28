/**
 * Configurable personal routine defaults for the daily schedule generator.
 * These are starting points — the planner UI lets the user toggle and edit them.
 */

/** @typedef {{ id: string, label: string, defaultMinutes?: number, priority?: string, description?: string }} ActivityDef */

export const ACTIVITY = Object.freeze({
  wake: { id: 'wake', label: 'Wake & prepare', defaultMinutes: 30, priority: 'Medium', description: 'Get ready for the day.' },
  breakfast: { id: 'breakfast', label: 'Breakfast', defaultMinutes: 25, priority: 'High', description: 'Eat before leaving.' },
  school: { id: 'school', label: 'School', defaultMinutes: 480, priority: 'High', description: 'Class 9 school day (~7:00–15:00).' },
  travelHome: { id: 'travelHome', label: 'Travel home / settle', defaultMinutes: 30, priority: 'Medium', description: 'Commute and settle in.' },
  lunch: { id: 'lunch', label: 'Lunch', defaultMinutes: 30, priority: 'High', description: 'Midday meal.' },
  homework: { id: 'homework', label: 'Homework & Class 9 study', defaultMinutes: 60, priority: 'High', description: 'Assignments and review.' },
  snack: { id: 'snack', label: 'Snack / short break', defaultMinutes: 20, priority: 'Low', description: 'Rest before the next block.' },
  coaching: { id: 'coaching', label: 'Coaching', defaultMinutes: 180, priority: 'High', description: 'Coaching session (~17:00–20:00).' },
  dinner: { id: 'dinner', label: 'Dinner', defaultMinutes: 35, priority: 'High', description: 'Evening meal.' },
  strength: { id: 'strength', label: 'Strength training', defaultMinutes: 20, priority: 'Medium', description: 'Short strength session.' },
  volleyball: { id: 'volleyball', label: 'Volleyball', defaultMinutes: 20, priority: 'Medium', description: 'Practice when practical.' },
  python: { id: 'python', label: 'Python practice', defaultMinutes: 20, priority: 'Medium', description: 'Coding practice.' },
  japanese: { id: 'japanese', label: 'Japanese practice', defaultMinutes: 20, priority: 'Medium', description: 'Language study.' },
  yumerise: { id: 'yumerise', label: 'YumeRise — plan tomorrow', defaultMinutes: 30, priority: 'Medium', description: 'Review today and plan the next day.' },
  minecraft: { id: 'minecraft', label: 'Minecraft (reward)', defaultMinutes: 60, priority: 'Low', description: 'Reward time when priorities are done.' },
  windDown: { id: 'windDown', label: 'Wind down for sleep', defaultMinutes: 30, priority: 'High', description: 'Screens off, prepare for sleep.' },
});

/**
 * Default planner options for a calendar date label (YYYY-MM-DD).
 * School/coaching default on for Mon–Fri; off on weekends.
 */
export function defaultOptionsForDate(dateLabel) {
  const [y, m, d] = dateLabel.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).getDay(); // 0=Sun … 6=Sat
  const isWeekend = weekday === 0 || weekday === 6;
  return {
    date: dateLabel,
    hasSchool: !isWeekend,
    hasCoaching: !isWeekend,
    includeStrength: true,
    includeVolleyball: !isWeekend,
    includePython: true,
    includeJapanese: true,
    includeMinecraft: !isWeekend,
    includeYumerise: true,
    schoolStart: '07:00',
    schoolEnd: '15:00',
    coachingStart: '17:00',
    coachingEnd: '20:00',
    sleepTarget: '23:00',
  };
}
