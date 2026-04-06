import { useRef, useEffect, useState } from "react";
import "./Calendar.css";

const SLOT_HEIGHT = 44;       // px за 30 минут
const SLOTS = 48;             // слотов в сутках
const GUTTER_WIDTH = 52;      // ширина колонки времени
const TIMEBLOCK_WIDTH = 44;   // ширина колонки таймблоков

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // пн = начало недели
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatWeekRange(weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (weekStart.getMonth() === weekEnd.getMonth()) {
    return `${months[weekStart.getMonth()]} ${weekStart.getDate()}–${weekEnd.getDate()}, ${weekStart.getFullYear()}`;
  }
  return `${months[weekStart.getMonth()]} ${weekStart.getDate()} – ${months[weekEnd.getMonth()]} ${weekEnd.getDate()}, ${weekStart.getFullYear()}`;
}

function slotLabel(slotIndex) {
  const totalMin = slotIndex * 30;
  const h = String(Math.floor(totalMin / 60)).padStart(2, "0");
  const m = String(totalMin % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function getNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export default function Calendar({ weekStart, onPrev, onNext, onToday }) {
  const scrollRef = useRef(null);
  const today = localDateStr(new Date());
  const [nowMinutes, setNowMinutes] = useState(getNowMinutes);

  // Скроллим к текущему времени - 1 час при монтировании
  useEffect(() => {
    if (scrollRef.current) {
      const offsetMin = Math.max(0, nowMinutes - 60);
      scrollRef.current.scrollTop = (offsetMin / 30) * SLOT_HEIGHT;
    }
  }, []);

  // Обновляем текущее время каждую минуту
  useEffect(() => {
    const id = setInterval(() => setNowMinutes(getNowMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="calendar">
      {/* Шапка с навигацией */}
      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={onPrev}>‹</button>
        <button className="cal-today-btn" onClick={onToday}>Today</button>
        <button className="cal-nav-btn" onClick={onNext}>›</button>
        <span className="cal-nav-label">{formatWeekRange(weekStart)}</span>
      </div>

      {/* Заголовки дней */}
      <div className="cal-header" style={{ paddingLeft: GUTTER_WIDTH }}>
        {days.map((day) => {
          const dateStr = localDateStr(day);
          const isToday = dateStr === today;
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          return (
            <div key={dateStr} className={`cal-day-header${isWeekend ? " weekend" : ""}`}>
              <div className={`cal-day-header-inner${isToday ? " today" : ""}`}>
                <span className="cal-day-name">{DAY_NAMES[day.getDay() === 0 ? 6 : day.getDay() - 1]}</span>
                <span className="cal-day-num">{day.getDate()}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Тело: время + колонки */}
      <div className="cal-body" ref={scrollRef}>
        {/* Временная ось */}
        <div className="cal-gutter" style={{ width: GUTTER_WIDTH, minHeight: SLOTS * SLOT_HEIGHT + 16 }}>
          {Array.from({ length: SLOTS }, (_, i) => (
            <div key={i} className="cal-time-label" style={{ height: SLOT_HEIGHT }}>
              {i % 2 === 0 ? slotLabel(i) : null}
            </div>
          ))}
        </div>

        {/* Колонки дней */}
        <div className="cal-days">
          {/* Линия текущего времени — на всю неделю */}
          <div className="cal-now-line" style={{ top: (nowMinutes / 30) * SLOT_HEIGHT + 8 }}>
            <span className="cal-now-label">
              {String(Math.floor(nowMinutes / 60)).padStart(2, "0")}:{String(nowMinutes % 60).padStart(2, "0")}
            </span>
          </div>
          {days.map((day) => {
            const dateStr = localDateStr(day);
            const isToday = dateStr === today;
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            return (
              <div
                key={dateStr}
                className={`cal-day${isToday ? " today" : ""}${isWeekend ? " weekend" : ""}`}
                style={{ height: SLOTS * SLOT_HEIGHT }}
              >
                {/* Колонка таймблоков */}
                <div
                  className="cal-timeblock-col"
                  style={{ width: TIMEBLOCK_WIDTH, minWidth: TIMEBLOCK_WIDTH, height: SLOTS * SLOT_HEIGHT }}
                >
                  {/* Слоты для визуальной сетки */}
                  {Array.from({ length: SLOTS }, (_, i) => (
                    <div key={i} className={`cal-slot${i % 2 === 1 ? " cal-slot-hour" : ""}`} style={{ height: SLOT_HEIGHT }} />
                  ))}
                </div>

                {/* Колонка событий */}
                <div className="cal-event-col">
                  {Array.from({ length: SLOTS }, (_, i) => (
                    <div
                      key={i}
                      className={`cal-slot${i % 2 === 1 ? " cal-slot-hour" : ""}`}
                      style={{ height: SLOT_HEIGHT }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
