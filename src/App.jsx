import { useState } from "react";
import MoodGraph from "./MoodGraph";
import Calendar from "./Calendar";
import "./MoodGraph.css";
import "./App.css";

const SCREENS = [
  { id: "mood", label: "Mood Board" },
  { id: "calendar", label: "Calendar" },
];

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function App() {
  const [screen, setScreen] = useState("mood");
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));

  const prevWeek = () => setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
  const nextWeek = () => setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });
  const toToday  = () => setWeekStart(getWeekStart(new Date()));

  return (
    <div className="app">
      <nav className="app-nav">
        {SCREENS.map((s) => (
          <button
            key={s.id}
            className={`app-nav-btn${screen === s.id ? " active" : ""}`}
            onClick={() => setScreen(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {screen === "mood" && <MoodGraph />}
      {screen === "calendar" && (
        <Calendar
          weekStart={weekStart}
          onPrev={prevWeek}
          onNext={nextWeek}
          onToday={toToday}
        />
      )}
    </div>
  );
}
