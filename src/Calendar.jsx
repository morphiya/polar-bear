import { useRef, useEffect, useState, useCallback } from "react";
import { getTimeblocks, createTimeblock, updateTimeblock, deleteTimeblock, createRecurringTimeblock, deleteTimeblockScoped, updateTimeblockScoped } from "./db";
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

function fmtShortDate(str) {
  const [y, m, d] = str.split("-");
  return `${d}.${m}.${y}`;
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
  const [blockPicker, setBlockPicker] = useState(null); // { blocks, clickX, clickY }
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

          // Определяем день под курсором и сдвигаем end_date на ту же разницу
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const dayEl = el?.closest("[data-date]");
          const currentDate = dayEl?.dataset.date ?? dragState.currentDate;

          // Сдвигаем end_date на разницу дней
          const origDateObj = new Date(dragState.origDate);
          const newDateObj = new Date(currentDate);
          const dayDelta = Math.round((newDateObj - origDateObj) / 86400000);
          const origEndDateObj = new Date(dragState.origEndDate);
          origEndDateObj.setDate(origEndDateObj.getDate() + dayDelta);
          const currentEndDate = localDateStr(origEndDateObj);

          setDragState((s) => ({ ...s, currentStartMin: newStart, currentEndMin: newStart + duration, currentDate, currentEndDate }));
        }
      }
      if (resizeState) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const dayEl = el?.closest("[data-date]");
        const currentEndDate = dayEl?.dataset.date ?? resizeState.currentEndDate;

        const deltaY = e.clientY - resizeState.startY;
        const deltaMin = Math.round(deltaY / SLOT_HEIGHT) * 30;
        const newEnd = Math.min(24 * 60, Math.max(30, resizeState.origEndMin + deltaMin));
        setResizeState((s) => ({ ...s, currentEndMin: newEnd, currentEndDate }));
      }
    };

    const onUp = async () => {
      if (dragState) {
        if (dragConfirmed.current) {
          const block = timeblocks.find((b) => b.id === dragState.id);
          await updateTimeblock(dragState.id, {
            date: dragState.currentDate ?? block.date,
            end_date: dragState.currentEndDate ?? block.end_date ?? block.date,
            start_min: dragState.currentStartMin,
            end_min: dragState.currentEndMin,
            type: block.type,
            color: block.color,
          });
          await loadTimeblocks();
        } else {
          // Это клик — ищем все перекрывающиеся блоки
          const block = timeblocks.find((b) => b.id === dragState.id);
          const overlapping = timeblocks.filter((b) => {
            if (b.id === block.id) return true;
            const bDate = b.date;
            const bEndDate = b.end_date ?? b.date;
            // Блок пересекает дату кликнутого блока
            if (bDate > block.date || bEndDate < block.date) return false;
            // Временное пересечение
            return b.start_min < block.end_min && b.end_min > block.start_min;
          });

          if (overlapping.length > 1) {
            setBlockPicker({ blocks: overlapping, clickX: dragState.clickX, clickY: dragState.clickY });
          } else {
            setSelectedBlock({ ...block, clickX: dragState.clickX, clickY: dragState.clickY });
          }
        }
        dragConfirmed.current = false;
        document.body.style.userSelect = "";
        setDragState(null);
      }
      if (resizeState) {
        const block = timeblocks.find((b) => b.id === resizeState.id);
        await updateTimeblock(resizeState.id, {
          date: block.date,
          end_date: resizeState.currentEndDate,
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

  const handleSlotClick = (dateStr, slotIndex, e) => {
    const startMin = slotIndex * 30;
    const hasBlock = timeblocks.some(
      (b) => b.date === dateStr && b.start_min < startMin + 30 && b.end_min > startMin
    );
    if (hasBlock) return;
    setCreatingBlock({ dateStr, startMin, endMin: startMin + 60, clickX: e.clientX, clickY: e.clientY });
  };

  const handleCreate = async ({ type, color, startMin, endMin, dateStr, endDateStr, recurrence }) => {
    if (recurrence) {
      await createRecurringTimeblock({
        date: dateStr, end_date: endDateStr ?? dateStr,
        type, start_min: startMin, end_min: endMin, color,
        freq: recurrence.freq,
        until_date: recurrence.endType === "until" ? recurrence.until : null,
        count: recurrence.endType === "count" ? recurrence.count : null,
      });
    } else {
      await createTimeblock({ date: dateStr, type, start_min: startMin, end_min: endMin, color, end_date: endDateStr ?? dateStr });
    }
    setCreatingBlock(null);
    await loadTimeblocks();
  };

  const [scopeModal, setScopeModal] = useState(null); // { action: "delete"|"edit", block, updates? }

  const handleDeleteBlock = (block) => {
    if (block.recurrence_id != null && block.recurrence_id !== 0) {
      const { clickX, clickY } = block;
      setSelectedBlock(null);
      setScopeModal({ action: "delete", block, clickX, clickY });
    } else {
      deleteTimeblock(block.id).then(() => { setSelectedBlock(null); loadTimeblocks(); });
    }
  };

  const handleEditBlock = (block, updates) => {
    if (block.recurrence_id != null && block.recurrence_id !== 0) {
      const { clickX, clickY } = block;
      setSelectedBlock(null);
      setScopeModal({ action: "edit", block, updates, clickX, clickY });
    } else {
      updateTimeblock(block.id, updates).then(() => { setSelectedBlock(null); loadTimeblocks(); });
    }
  };

  const handleScopeConfirm = async (scope) => {
    const { action, block, updates } = scopeModal;
    if (action === "delete") {
      await deleteTimeblockScoped(block, scope);
    } else {
      await updateTimeblockScoped(block, updates, scope);
    }
    setScopeModal(null);
    setSelectedBlock(null);
    await loadTimeblocks();
  };

  const handleCopyBlock = async ({ type, color, dateStr, endDateStr, startMin, endMin }) => {
    await createTimeblock({ date: dateStr, type, start_min: startMin, end_min: endMin, color, end_date: endDateStr ?? dateStr });
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
            // Блоки которые пересекают этот день
            const dayBlocks = timeblocks.filter((b) => {
              const bDate = dragState?.id === b.id ? dragState.currentDate : b.date;
              const bEndDate = dragState?.id === b.id ? dragState.currentEndDate : (b.end_date ?? b.date);
              return bDate <= dateStr && bEndDate >= dateStr;
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
                      onClick={(e) => handleSlotClick(dateStr, i, e)}
                    />
                  ))}

                  {/* Таймблоки */}
                  {dayBlocks.map((block) => {
                    const isDragging = dragState?.id === block.id;
                    const isResizing = resizeState?.id === block.id;

                    const bDate = isDragging ? dragState.currentDate : block.date;
                    const bEndDate = isResizing ? resizeState.currentEndDate
                      : isDragging ? dragState.currentEndDate : (block.end_date ?? block.date);
                    const startMin = isDragging ? dragState.currentStartMin : block.start_min;
                    const endMin = isResizing ? resizeState.currentEndMin
                      : isDragging ? dragState.currentEndMin : block.end_min;

                    const isStart = bDate === dateStr;
                    const isEnd = bEndDate === dateStr;
                    const isSingle = isStart && isEnd;

                    const top = isStart ? (startMin / 30) * SLOT_HEIGHT : 0;
                    const bottom = isEnd ? ((24 * 60 - endMin) / 30) * SLOT_HEIGHT : 0;
                    const height = SLOTS * SLOT_HEIGHT - top - bottom;

                    return (
                      <div
                        key={block.id}
                        className={`cal-timeblock${isDragging ? " dragging" : ""}${!isStart ? " continues-from" : ""}${!isEnd ? " continues-to" : ""}`}
                        style={{
                          top,
                          height,
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
                            origEndDate: block.end_date ?? block.date,
                            origStartMin: block.start_min,
                            origEndMin: block.end_min,
                            startX: e.clientX,
                            startY: e.clientY,
                            clickX: e.clientX,
                            clickY: e.clientY,
                            currentDate: block.date,
                            currentEndDate: block.end_date ?? block.date,
                            currentStartMin: block.start_min,
                            currentEndMin: block.end_min,
                          });
                        }}
                      >
                        <span className="cal-timeblock-label" style={{ color: block.color }}>
                          {block.type}
                          {block.recurrence_id != null && block.recurrence_id !== 0 && <span className="cal-timeblock-repeat">↻</span>}
                        </span>
                        <div
                          className="cal-timeblock-resize"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setResizeState({
                              id: block.id,
                              origStartMin: block.start_min,
                              origEndMin: block.end_min,
                              origEndDate: block.end_date ?? block.date,
                              startY: e.clientY,
                              currentEndMin: block.end_min,
                              currentEndDate: block.end_date ?? block.date,
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
          onDelete={() => handleDeleteBlock(selectedBlock)}
          onEdit={(updates) => handleEditBlock(selectedBlock, updates)}
          onCopy={handleCopyBlock}
          onClose={() => setSelectedBlock(null)}
        />
      )}

      {scopeModal && (
        <ScopeModal
          action={scopeModal.action}
          clickX={scopeModal.clickX}
          clickY={scopeModal.clickY}
          onConfirm={handleScopeConfirm}
          onClose={() => setScopeModal(null)}
        />
      )}

      {blockPicker && (
        <BlockPickerModal
          blocks={blockPicker.blocks}
          clickX={blockPicker.clickX}
          clickY={blockPicker.clickY}
          onSelect={(block) => {
            setBlockPicker(null);
            setSelectedBlock({ ...block, clickX: blockPicker.clickX, clickY: blockPicker.clickY });
          }}
          onClose={() => setBlockPicker(null)}
        />
      )}
    </div>
  );
}

const DETAIL_W = 260;

function TimeblockDetailModal({ block, clickX, clickY, onDelete, onEdit, onCopy, onClose }) {
  const [mode, setMode] = useState("view"); // "view" | "edit" | "copy"
  const [type, setType] = useState(block.type);
  const [color, setColor] = useState(block.color);
  const [start, setStart] = useState(block.start_min);
  const [end, setEnd] = useState(block.end_min);

  const DAY_NAMES_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  function fmtDate(str) {
    const [y, mo, d] = str.split("-").map(Number);
    const dow = new Date(y, mo - 1, d).getDay();
    return `${String(d).padStart(2,"0")}.${String(mo).padStart(2,"0")}.${y}, ${DAY_NAMES_FULL[dow]}`;
  }

  const endDate = block.end_date ?? block.date;
  const multiDay = endDate !== block.date;

  // Длительность в минутах с учётом дней
  const startDateObj = new Date(block.date);
  const endDateObj = new Date(endDate);
  const daysDiff = Math.round((endDateObj - startDateObj) / 86400000);
  const totalMin = daysDiff * 24 * 60 + block.end_min - block.start_min;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const durationLabel = hours > 0
    ? `${hours}h${mins > 0 ? ` ${mins}m` : ""}`
    : `${mins}m`;

  const handleKeyDown = (e) => {
    if (e.key === "Escape") onClose();
  };

  const posX = Math.max(12, Math.min(clickX + 12, window.innerWidth - DETAIL_W - 12));
  const posY = Math.max(12, Math.min(clickY + 12, window.innerHeight - TB_MODAL_H - 12));

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
              {multiDay ? (
                <>
                  <div className="tb-detail-row">{fmtDate(block.date)} – </div>
                  <div className="tb-detail-row">{fmtDate(endDate)}</div>
                </>
              ) : (
                <div className="tb-detail-row">{fmtDate(block.date)}</div>
              )}
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
            endDate={block.end_date ?? block.date}
            startMin={start}
            endMin={end}
            type={type}
            color={color}
            submitLabel="Save"
            onSave={({ type: t, color: c, dateStr, endDateStr, startMin, endMin }) => {
              setType(t); setColor(c); setStart(startMin); setEnd(endMin);
              onEdit({ date: dateStr, end_date: endDateStr, start_min: startMin, end_min: endMin, type: t, color: c });
            }}
            onClose={() => setMode("view")}
          />
        )}
        {mode === "copy" && (
          <TimeblockForm
            key="copy"
            date={block.date}
            endDate={block.end_date ?? block.date}
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

function TimeblockForm({ title, date, endDate, startMin, endMin, type: initType, color: initColor, submitLabel, onSave, onClose, showRecurrence = false, autoFocusName = true }) {
  const [type, setType] = useState(initType ?? "");
  const [color, setColor] = useState(initColor ?? DEFAULT_COLOR);
  const [date_, setDate] = useState(date);
  const [endDate_, setEndDate] = useState(endDate ?? date);
  const [startText, setStartText] = useState(minToLabel(startMin));
  const [endText, setEndText] = useState(minToLabel(endMin));
  const [repeat, setRepeat] = useState(false);
  const [freq, setFreq] = useState("daily");
  const [endType, setEndType] = useState("until");
  const [until, setUntil] = useState(() => {
    const d = new Date(date);
    d.setMonth(d.getMonth() + 1);
    return localDateStr(d);
  });
  const [count, setCount] = useState(10);
  const inputRef = useRef(null);

  useEffect(() => { if (autoFocusName) inputRef.current?.focus(); }, []);

  const startMin_ = parseTimeInput(startText) ?? startMin;
  const endMin_ = parseTimeInput(endText) ?? endMin;
  const multiDay = endDate_ !== date_;
  const valid = type.trim() && date_ && endDate_ >= date_ && (multiDay || endMin_ > startMin_);

  const handleSave = () => {
    onSave({
      type: type.trim(), color,
      dateStr: date_, endDateStr: endDate_,
      startMin: startMin_, endMin: endMin_,
      recurrence: repeat ? { freq, endType, until, count: Number(count) } : null,
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && valid) handleSave();
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

      <div className="tb-modal-times">
        <div className="tb-picker-field">
          <span>Start date</span>
          <DatePicker value={date_} onChange={(v) => { setDate(v); if (v > endDate_) setEndDate(v); }} />
        </div>
        <div className="tb-picker-field">
          <span>End date</span>
          <DatePicker value={endDate_} onChange={(v) => { if (v >= date_) setEndDate(v); }} />
        </div>
      </div>

      <div className="tb-modal-times">
        <div className="tb-picker-field">
          <span>Start time</span>
          <TimePicker value={startText} onChange={setStartText} />
        </div>
        <div className="tb-picker-field">
          <span>End time</span>
          <TimePicker value={endText} onChange={setEndText} />
        </div>
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

      {showRecurrence && (
        <div className="tb-recurrence">
          <label className="tb-recurrence-toggle">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            <span>Repeat</span>
          </label>

          {repeat && (
            <div className="tb-recurrence-fields">
              <div className="tb-recurrence-row">
                {["daily","weekly","monthly"].map((f) => (
                  <button
                    key={f}
                    className={`tb-freq-btn${freq === f ? " active" : ""}`}
                    onClick={() => setFreq(f)}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>

              <div className="tb-recurrence-row">
                <button className={`tb-endtype-btn${endType === "until" ? " active" : ""}`} onClick={() => setEndType("until")}>Until</button>
                <button className={`tb-endtype-btn${endType === "count" ? " active" : ""}`} onClick={() => setEndType("count")}>Times</button>
              </div>

              {endType === "until" && (
                <DatePicker value={until} onChange={setUntil} />
              )}
              {endType === "count" && (
                <input
                  type="number"
                  className="note-modal-input tb-count-input"
                  min={2} max={365}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              )}
            </div>
          )}
        </div>
      )}

      <div className="note-modal-actions">
        <button className="note-modal-cancel" onClick={onClose}>Cancel</button>
        <button className="note-modal-save" disabled={!valid} onClick={handleSave}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

const TB_MODAL_W = 260;
const TB_MODAL_H = 380;

function TimeblockModal({ dateStr, startMin, endMin, clickX, clickY, onSave, onClose }) {
  const posX = Math.max(12, Math.min((clickX ?? window.innerWidth / 2) + 12, window.innerWidth - TB_MODAL_W - 12));
  const posY = Math.max(12, Math.min((clickY ?? window.innerHeight / 2) + 12, window.innerHeight - TB_MODAL_H - 12));
  return (
    <div className="note-modal-overlay" onClick={onClose}>
      <div className="note-modal tb-modal" style={{ left: posX, top: posY, transform: "none" }} onClick={(e) => e.stopPropagation()}>
        <TimeblockForm
          title="New block"
          date={dateStr}
          startMin={startMin}
          endMin={endMin}
          submitLabel="Add"
          showRecurrence
          onSave={onSave}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

const SCOPE_W = 280;
const SCOPE_H = 200;

function ScopeModal({ action, clickX, clickY, onConfirm, onClose }) {
  const verb = action === "delete" ? "Delete" : "Edit";
  const posX = Math.max(12, Math.min((clickX ?? window.innerWidth / 2) + 12, window.innerWidth - SCOPE_W - 12));
  const posY = Math.max(12, Math.min((clickY ?? window.innerHeight / 2) + 12, window.innerHeight - SCOPE_H - 12));
  return (
    <div className="note-modal-overlay" onClick={onClose}>
      <div className="note-modal scope-modal" style={{ left: posX, top: posY, transform: "none" }} onClick={(e) => e.stopPropagation()}>
        <div className="scope-modal-title">{verb} recurring block</div>
        <div className="scope-modal-options">
          <button className="scope-btn" onClick={() => onConfirm("this")}>
            <span className="scope-btn-label">This event</span>
            <span className="scope-btn-desc">Only this occurrence</span>
          </button>
          <button className="scope-btn" onClick={() => onConfirm("following")}>
            <span className="scope-btn-label">This and following</span>
            <span className="scope-btn-desc">This and all future occurrences</span>
          </button>
          <button className="scope-btn" onClick={() => onConfirm("all")}>
            <span className="scope-btn-label">All events</span>
            <span className="scope-btn-desc">Every occurrence in the series</span>
          </button>
        </div>
        <button className="note-modal-cancel scope-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

const PICKER_W = 220;
const PICKER_H = 40; // минимум, растёт с числом блоков

function BlockPickerModal({ blocks, clickX, clickY, onSelect, onClose }) {
  const posX = Math.max(12, Math.min(clickX + 12, window.innerWidth - PICKER_W - 12));
  const posY = Math.max(12, Math.min(clickY + 12, window.innerHeight - (blocks.length * 44 + 20) - 12));

  return (
    <div className="note-modal-overlay" onClick={onClose}>
      <div
        className="note-modal block-picker-modal"
        style={{ left: posX, top: posY }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="block-picker-title">Select block</div>
        {blocks.map((block) => (
          <div
            key={block.id}
            className="block-picker-item"
            onClick={() => onSelect(block)}
          >
            <div className="block-picker-color" style={{ background: block.color }} />
            <div className="block-picker-info">
              <span className="block-picker-name">{block.type}</span>
              <span className="block-picker-time">
                {block.end_date && block.end_date !== block.date
                  ? `${fmtShortDate(block.date)} ${minToLabel(block.start_min)} – ${fmtShortDate(block.end_date)} ${minToLabel(block.end_min)}`
                  : `${minToLabel(block.start_min)}–${minToLabel(block.end_min)}`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
