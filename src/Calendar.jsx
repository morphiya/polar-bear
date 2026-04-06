import { useRef, useEffect, useState, useCallback } from "react";
import { getTimeblocks, createTimeblock, updateTimeblock, deleteTimeblock } from "./db";
import { TimePicker, DatePicker } from "./Pickers";
import "./Calendar.css";

const SLOT_HEIGHT = 44;
const SLOTS = 48;
const GUTTER_WIDTH = 52;
const TIMEBLOCK_WIDTH = 44;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PRESET_COLORS = ["#a78bfa", "#f87171", "#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#e879f9"];

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

function minToLabel(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function getNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export default function Calendar({ weekStart, onPrev, onNext, onToday }) {
  const scrollRef = useRef(null);
  const today = localDateStr(new Date());
  const [nowMinutes, setNowMinutes] = useState(getNowMinutes);
  const [timeblocks, setTimeblocks] = useState([]);
  const [creatingBlock, setCreatingBlock] = useState(null); // { dateStr, startMin, endMin }
  const [dragState, setDragState] = useState(null);
  const [resizeState, setResizeState] = useState(null);
  const [selectedBlock, setSelectedBlock] = useState(null); // { ...block, clickX, clickY }
  const dragConfirmed = useRef(false);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Скролл к текущему времени - 1 час
  useEffect(() => {
    if (scrollRef.current) {
      const offsetMin = Math.max(0, nowMinutes - 60);
      scrollRef.current.scrollTop = (offsetMin / 30) * SLOT_HEIGHT;
    }
  }, []);

  // Обновление текущего времени
  useEffect(() => {
    const id = setInterval(() => setNowMinutes(getNowMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Загрузка таймблоков
  const loadTimeblocks = useCallback(async () => {
    const dates = days.map(localDateStr);
    const blocks = await getTimeblocks(dates);
    setTimeblocks(blocks);
  }, [weekStart]);

  useEffect(() => { loadTimeblocks(); }, [loadTimeblocks]);

  // Drag и resize через document
  useEffect(() => {
    if (!dragState && !resizeState) return;

    const onMove = (e) => {
      if (dragState) {
        const deltaX = e.clientX - dragState.startX;
        const deltaY = e.clientY - dragState.startY;
        if (!dragConfirmed.current && (Math.abs(deltaY) > 5 || Math.abs(deltaX) > 5)) {
          dragConfirmed.current = true;
          document.body.style.userSelect = "none";
        }
        if (dragConfirmed.current) {
          const deltaMin = Math.round(deltaY / SLOT_HEIGHT) * 30;
          const duration = dragState.origEndMin - dragState.origStartMin;
          const newStart = Math.max(0, Math.min(24 * 60 - duration, dragState.origStartMin + deltaMin));

          // Определяем день под курсором
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const dayEl = el?.closest("[data-date]");
          const currentDate = dayEl?.dataset.date ?? dragState.origDate;

          setDragState((s) => ({ ...s, currentStartMin: newStart, currentEndMin: newStart + duration, currentDate }));
        }
      }
      if (resizeState) {
        const deltaY = e.clientY - resizeState.startY;
        const deltaMin = Math.round(deltaY / SLOT_HEIGHT) * 30;
        const newEnd = Math.min(24 * 60, Math.max(resizeState.origStartMin + 30, resizeState.origEndMin + deltaMin));
        setResizeState((s) => ({ ...s, currentEndMin: newEnd }));
      }
    };

    const onUp = async () => {
      if (dragState) {
        if (dragConfirmed.current) {
          const block = timeblocks.find((b) => b.id === dragState.id);
          await updateTimeblock(dragState.id, {
            date: dragState.currentDate ?? block.date,
            start_min: dragState.currentStartMin,
            end_min: dragState.currentEndMin,
            type: block.type,
            color: block.color,
          });
          await loadTimeblocks();
        } else {
          // Это клик — открываем модалку
          const block = timeblocks.find((b) => b.id === dragState.id);
          setSelectedBlock({ ...block, clickX: dragState.clickX, clickY: dragState.clickY });
        }
        dragConfirmed.current = false;
        document.body.style.userSelect = "";
        setDragState(null);
      }
      if (resizeState) {
        const block = timeblocks.find((b) => b.id === resizeState.id);
        await updateTimeblock(resizeState.id, {
          date: block.date,
          start_min: block.start_min,
          end_min: resizeState.currentEndMin,
          type: block.type,
          color: block.color,
        });
        setResizeState(null);
        await loadTimeblocks();
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragState, resizeState, timeblocks]);

  const handleSlotClick = (dateStr, slotIndex) => {
    const startMin = slotIndex * 30;
    const hasBlock = timeblocks.some(
      (b) => b.date === dateStr && b.start_min < startMin + 30 && b.end_min > startMin
    );
    if (hasBlock) return;
    setCreatingBlock({ dateStr, startMin, endMin: startMin + 60 });
  };

  const handleCreate = async ({ type, color, startMin, endMin, dateStr }) => {
    await createTimeblock({ date: dateStr, type, start_min: startMin, end_min: endMin, color });
    setCreatingBlock(null);
    await loadTimeblocks();
  };

  const handleDeleteBlock = async (id) => {
    await deleteTimeblock(id);
    setSelectedBlock(null);
    await loadTimeblocks();
  };

  const handleEditBlock = async (id, updates) => {
    await updateTimeblock(id, updates);
    setSelectedBlock(null);
    await loadTimeblocks();
  };

  const handleCopyBlock = async ({ type, color, dateStr, startMin, endMin }) => {
    await createTimeblock({ date: dateStr, type, start_min: startMin, end_min: endMin, color });
    setSelectedBlock(null);
    await loadTimeblocks();
  };

  return (
    <div className="calendar">
      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={onPrev}>‹</button>
        <button className="cal-today-btn" onClick={onToday}>Today</button>
        <button className="cal-nav-btn" onClick={onNext}>›</button>
        <span className="cal-nav-label">{formatWeekRange(weekStart)}</span>
      </div>

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

      <div className="cal-body" ref={scrollRef}>
        <div className="cal-gutter" style={{ width: GUTTER_WIDTH, minHeight: SLOTS * SLOT_HEIGHT + 16 }}>
          {Array.from({ length: SLOTS }, (_, i) => (
            <div key={i} className="cal-time-label" style={{ height: SLOT_HEIGHT }}>
              {i % 2 === 0 ? slotLabel(i) : null}
            </div>
          ))}
        </div>

        <div className="cal-days">
          <div className="cal-now-line" style={{ top: (nowMinutes / 30) * SLOT_HEIGHT + 8 }}>
            <span className="cal-now-label">{minToLabel(nowMinutes)}</span>
          </div>

          {days.map((day) => {
            const dateStr = localDateStr(day);
            const isToday = dateStr === today;
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            // Блоки этого дня + драгаемый блок если он сейчас над этим днём
            const dayBlocks = timeblocks.filter((b) => {
              if (dragState?.id === b.id) return dragState.currentDate === dateStr;
              return b.date === dateStr;
            });

            return (
              <div
                key={dateStr}
                data-date={dateStr}
                className={`cal-day${isToday ? " today" : ""}${isWeekend ? " weekend" : ""}`}
                style={{ height: SLOTS * SLOT_HEIGHT }}
              >
                {/* Колонка таймблоков */}
                <div
                  className="cal-timeblock-col"
                  data-date={dateStr}
                  style={{ width: TIMEBLOCK_WIDTH, minWidth: TIMEBLOCK_WIDTH, height: SLOTS * SLOT_HEIGHT }}
                >
                  {Array.from({ length: SLOTS }, (_, i) => (
                    <div
                      key={i}
                      className={`cal-slot${i % 2 === 1 ? " cal-slot-hour" : ""}`}
                      style={{ height: SLOT_HEIGHT }}
                      onClick={() => handleSlotClick(dateStr, i)}
                    />
                  ))}

                  {/* Таймблоки */}
                  {dayBlocks.map((block) => {
                    const isDragging = dragState?.id === block.id;
                    const isResizing = resizeState?.id === block.id;
                    const startMin = isDragging ? dragState.currentStartMin : block.start_min;
                    const endMin = isResizing
                      ? resizeState.currentEndMin
                      : isDragging
                      ? dragState.currentEndMin
                      : block.end_min;

                    return (
                      <div
                        key={block.id}
                        className={`cal-timeblock${isDragging ? " dragging" : ""}`}
                        style={{
                          top: (startMin / 30) * SLOT_HEIGHT,
                          height: ((endMin - startMin) / 30) * SLOT_HEIGHT,
                          background: block.color + "28",
                          borderColor: block.color,
                        }}
                        onMouseDown={(e) => {
                          if (e.target.classList.contains("cal-timeblock-resize")) return;
                          e.stopPropagation();
                          dragConfirmed.current = false;
                          setDragState({
                            id: block.id,
                            origDate: block.date,
                            origStartMin: block.start_min,
                            origEndMin: block.end_min,
                            startX: e.clientX,
                            startY: e.clientY,
                            clickX: e.clientX,
                            clickY: e.clientY,
                            currentDate: block.date,
                            currentStartMin: block.start_min,
                            currentEndMin: block.end_min,
                          });
                        }}
                      >
                        <span className="cal-timeblock-label" style={{ color: block.color }}>
                          {block.type}
                        </span>
                        <div
                          className="cal-timeblock-resize"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setResizeState({
                              id: block.id,
                              origStartMin: block.start_min,
                              origEndMin: block.end_min,
                              startY: e.clientY,
                              currentEndMin: block.end_min,
                            });
                          }}
                        />
                      </div>
                    );
                  })}
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

      {creatingBlock && (
        <TimeblockModal
          {...creatingBlock}
          onSave={handleCreate}
          onClose={() => setCreatingBlock(null)}
        />
      )}

      {selectedBlock && (
        <TimeblockDetailModal
          block={selectedBlock}
          clickX={selectedBlock.clickX}
          clickY={selectedBlock.clickY}
          onDelete={() => handleDeleteBlock(selectedBlock.id)}
          onEdit={(updates) => handleEditBlock(selectedBlock.id, updates)}
          onCopy={handleCopyBlock}
          onClose={() => setSelectedBlock(null)}
        />
      )}
    </div>
  );
}

const DETAIL_W = 260;
const DETAIL_H = 160;

function TimeblockDetailModal({ block, clickX, clickY, onDelete, onEdit, onCopy, onClose }) {
  const [mode, setMode] = useState("view"); // "view" | "edit" | "copy"
  const [type, setType] = useState(block.type);
  const [color, setColor] = useState(block.color);
  const [start, setStart] = useState(block.start_min);
  const [end, setEnd] = useState(block.end_min);

  const duration = block.end_min - block.start_min;
  const hours = Math.floor(duration / 60);
  const mins = duration % 60;
  const durationLabel = hours > 0
    ? `${hours}h${mins > 0 ? ` ${mins}m` : ""}`
    : `${mins}m`;

  const [y, mo, d] = block.date.split("-").map(Number);
  const dateObj = new Date(y, mo - 1, d);
  const DAY_NAMES_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dateFormatted = `${String(d).padStart(2,"0")}.${String(mo).padStart(2,"0")}.${y}, ${DAY_NAMES_FULL[dateObj.getDay()]}`;

  const handleKeyDown = (e) => {
    if (e.key === "Escape") onClose();
  };

  const posX = Math.max(12, Math.min(clickX + 12, window.innerWidth - DETAIL_W - 12));
  const posY = Math.max(12, Math.min(clickY + 12, window.innerHeight - DETAIL_H - 12));

  return (
    <div className="note-modal-overlay" onClick={onClose}>
      <div className="note-modal tb-detail-modal" style={{ left: posX, top: posY }} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        {mode === "view" && (
          <>
            <div className="tb-detail-header">
              <div className="tb-detail-color" style={{ background: block.color }} />
              <div className="tb-detail-name">{block.type}</div>
            </div>
            <div className="tb-detail-info">
              <div className="tb-detail-row">{dateFormatted}</div>
              <div className="tb-detail-row">{minToLabel(block.start_min)} – {minToLabel(block.end_min)}</div>
              <div className="tb-detail-row muted">{durationLabel}</div>
            </div>
            <div className="tb-detail-actions">
              <button className="tb-action-btn" onClick={() => setMode("edit")}>Edit</button>
              <button className="tb-action-btn" onClick={() => setMode("copy")}>Copy</button>
              <button className="tb-action-btn danger" onClick={onDelete}>Delete</button>
            </div>
          </>
        )}
        {mode === "edit" && (
          <TimeblockForm
            key="edit"
            date={block.date}
            startMin={start}
            endMin={end}
            type={type}
            color={color}
            submitLabel="Save"
            onSave={({ type: t, color: c, dateStr, startMin, endMin }) => {
              setType(t); setColor(c); setStart(startMin); setEnd(endMin);
              onEdit({ date: dateStr, start_min: startMin, end_min: endMin, type: t, color: c });
            }}
            onClose={() => setMode("view")}
          />
        )}
        {mode === "copy" && (
          <TimeblockForm
            key="copy"
            date={block.date}
            startMin={block.start_min}
            endMin={block.end_min}
            type={block.type}
            color={block.color}
            submitLabel="Create copy"
            onSave={onCopy}
            onClose={() => setMode("view")}
          />
        )}
      </div>
    </div>
  );
}

const DEFAULT_COLOR = "#a78bfa";

function parseTimeInput(val) {
  const [h, m] = val.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function TimeblockForm({ title, date, startMin, endMin, type: initType, color: initColor, submitLabel, onSave, onClose, autoFocusName = true }) {
  const [type, setType] = useState(initType ?? "");
  const [color, setColor] = useState(initColor ?? DEFAULT_COLOR);
  const [date_, setDate] = useState(date);
  const [startText, setStartText] = useState(minToLabel(startMin));
  const [endText, setEndText] = useState(minToLabel(endMin));
  const inputRef = useRef(null);

  useEffect(() => { if (autoFocusName) inputRef.current?.focus(); }, []);

  const startMin_ = parseTimeInput(startText) ?? startMin;
  const endMin_ = parseTimeInput(endText) ?? endMin;
  const valid = type.trim() && endMin_ > startMin_ && date_;

  const handleKeyDown = (e) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && valid) {
      onSave({ type: type.trim(), color, dateStr: date_, startMin: startMin_, endMin: endMin_ });
    }
  };

  return (
    <div onKeyDown={handleKeyDown}>
      {title && <div className="note-modal-date">{title}</div>}

      <input
        ref={inputRef}
        className="note-modal-input tb-modal-input"
        placeholder="Block name (Work, Rest…)"
        value={type}
        onChange={(e) => setType(e.target.value)}
      />

      <div className="tb-modal-field">
        <span className="tb-modal-field-label">Date</span>
        <DatePicker value={date_} onChange={setDate} />
      </div>

      <div className="tb-modal-times">
        <label>
          <span>Start</span>
          <TimePicker value={startText} onChange={setStartText} />
        </label>
        <label>
          <span>End</span>
          <TimePicker value={endText} onChange={setEndText} />
        </label>
      </div>

      <div className="tb-modal-colors">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            className={`tb-color-btn${color === c ? " selected" : ""}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>

      <div className="note-modal-actions">
        <button className="note-modal-cancel" onClick={onClose}>Cancel</button>
        <button
          className="note-modal-save"
          disabled={!valid}
          onClick={() => onSave({ type: type.trim(), color, dateStr: date_, startMin: startMin_, endMin: endMin_ })}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function TimeblockModal({ dateStr, startMin, endMin, onSave, onClose }) {
  return (
    <div className="note-modal-overlay" onClick={onClose}>
      <div className="note-modal tb-modal" onClick={(e) => e.stopPropagation()}>
        <TimeblockForm
          title="New block"
          date={dateStr}
          startMin={startMin}
          endMin={endMin}
          submitLabel="Add"
          onSave={onSave}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
