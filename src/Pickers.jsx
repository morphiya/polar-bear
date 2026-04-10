import { useState, useRef, useEffect } from "react";
import "./Pickers.css";

const TIME_W = 120;
const TIME_H = 200;
const DATE_W = 230;
const DATE_H = 260;

function useDropdownPos(ref, open, dropW, dropH) {
  const [pos, setPos] = useState({ top: null, bottom: null, left: 0 });

  useEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceRight = window.innerWidth - rect.left;

    const left = spaceRight >= dropW ? 0 : rect.width - dropW;
    if (spaceBelow >= dropH) {
      setPos({ top: rect.height + 4, bottom: null, left });
    } else {
      setPos({ top: null, bottom: rect.height + 4, left });
    }
  }, [open]);

  return pos;
}

// ─── TimePicker ────────────────────────────────────────────────────────────

export function TimePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const hourRef = useRef(null);
  const minRef = useRef(null);

  const [h, m] = value.split(":").map(Number);
  const pos = useDropdownPos(ref, open, TIME_W, TIME_H);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    hourRef.current?.querySelector(".selected")?.scrollIntoView({ block: "center" });
    minRef.current?.querySelector(".selected")?.scrollIntoView({ block: "center" });
  }, [open]);

  const set = (newH, newM) => {
    onChange(`${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`);
  };

  return (
    <div className="picker-root" ref={ref}>
      <button className="picker-trigger" onClick={() => setOpen((o) => !o)}>
        {value}
      </button>
      {open && (
        <div
          className="picker-dropdown time-dropdown"
          style={{ top: pos.top ?? "auto", bottom: pos.bottom ?? "auto", left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="time-col" ref={hourRef}>
            {Array.from({ length: 24 }, (_, i) => (
              <div
                key={i}
                className={`time-item${i === h ? " selected" : ""}`}
                onClick={() => { set(i, m); }}
              >
                {String(i).padStart(2, "0")}
              </div>
            ))}
          </div>
          <div className="time-sep">:</div>
          <div className="time-col" ref={minRef}>
            {Array.from({ length: 12 }, (_, i) => i * 5).map((min) => (
              <div
                key={min}
                className={`time-item${min === m ? " selected" : ""}`}
                onClick={() => { set(h, min); }}
              >
                {String(min).padStart(2, "0")}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DatePicker ────────────────────────────────────────────────────────────

const MONTHS = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
const DAY_HEADS = ["Mo","Tu","We","Th","Fr","Sa","Su"];

function parseDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return { y, m, d };
}

function formatDate(y, m, d) {
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function getDaysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

function getWeekDayOf1st(y, m) {
  const day = new Date(y, m - 1, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

export function DatePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const { y, m, d } = parseDate(value);
  const [viewY, setViewY] = useState(y);
  const [viewM, setViewM] = useState(m);
  const pos = useDropdownPos(ref, open, DATE_W, DATE_H);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const prevMonth = () => {
    if (viewM === 1) { setViewM(12); setViewY(viewY - 1); }
    else setViewM(viewM - 1);
  };
  const nextMonth = () => {
    if (viewM === 12) { setViewM(1); setViewY(viewY + 1); }
    else setViewM(viewM + 1);
  };

  const daysInMonth = getDaysInMonth(viewY, viewM);
  const firstWeekDay = getWeekDayOf1st(viewY, viewM);
  const cells = Array.from({ length: firstWeekDay }, () => null)
    .concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <div className="picker-root" ref={ref}>
      <button className="picker-trigger" onClick={() => setOpen((o) => !o)}>
        {value}
      </button>
      {open && (
        <div
          className="picker-dropdown date-dropdown"
          style={{ top: pos.top ?? "auto", bottom: pos.bottom ?? "auto", left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="date-nav">
            <button className="date-nav-btn" onClick={prevMonth}>‹</button>
            <span className="date-nav-label">{MONTHS[viewM - 1]} {viewY}</span>
            <button className="date-nav-btn" onClick={nextMonth}>›</button>
          </div>
          <div className="date-grid">
            {DAY_HEADS.map((dh) => (
              <div key={dh} className="date-head">{dh}</div>
            ))}
            {cells.map((day, i) => {
              if (!day) return <div key={`e${i}`} />;
              const str = formatDate(viewY, viewM, day);
              const isSelected = str === value;
              const isToday = str === todayStr;
              return (
                <div
                  key={str}
                  className={`date-cell${isSelected ? " selected" : ""}${isToday ? " today" : ""}`}
                  onClick={() => { onChange(str); setOpen(false); }}
                >
                  {day}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
