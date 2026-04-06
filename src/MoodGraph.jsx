import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { getDb } from "./db";

const MARGIN = { top: 40, right: 40, bottom: 75, left: 60 };
const Y_TICKS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];

function today() {
  return localDateStr(new Date());
}

function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

export default function MoodGraph() {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [points, setPoints] = useState([]);
  const [tooltip, setTooltip] = useState(null);
  const [hoverTooltip, setHoverTooltip] = useState(null);
  const [noteModal, setNoteModal] = useState(null);
  const dbRef = useRef(null);

  // Инициализация БД
  useEffect(() => {
    async function initDb() {
      const db = await getDb();
      dbRef.current = db;
      await loadMonth(db, currentMonth);
    }
    initDb();
  }, []);

  // Загрузка записей за месяц
  const loadMonth = useCallback(async (db, { year, month }) => {
    const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const end = `${year}-${String(month + 1).padStart(2, "0")}-31`;
    const rows = await db.select(
      "SELECT date, mood, note FROM entries WHERE date >= $1 AND date <= $2 ORDER BY date",
      [start, end]
    );
    setPoints(rows);
  }, []);

  useEffect(() => {
    if (dbRef.current) loadMonth(dbRef.current, currentMonth);
  }, [currentMonth, loadMonth]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDimensions({ width, height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const prevMonth = () => setCurrentMonth(({ year, month }) =>
    month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
  );
  const nextMonth = () => setCurrentMonth(({ year, month }) =>
    month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
  );
  const isCurrentMonth = currentMonth.year === now.getFullYear() && currentMonth.month === now.getMonth();

  const upsertPoint = useCallback(async (date, mood) => {
    const db = dbRef.current;
    if (!db) return;
    await db.execute(
      "INSERT INTO entries (date, mood, note) VALUES ($1, $2, '') ON CONFLICT(date) DO UPDATE SET mood = $2",
      [date, mood]
    );
    await loadMonth(db, currentMonth);
  }, [currentMonth, loadMonth]);

  const deletePoint = useCallback(async (date) => {
    const db = dbRef.current;
    if (!db) return;
    await db.execute("DELETE FROM entries WHERE date = $1", [date]);
    await loadMonth(db, currentMonth);
  }, [currentMonth, loadMonth]);

  const saveNote = useCallback(async (date, note) => {
    const db = dbRef.current;
    if (!db) return;
    await db.execute(
      "UPDATE entries SET note = $1 WHERE date = $2",
      [note, date]
    );
    await loadMonth(db, currentMonth);
    setNoteModal(null);
  }, [currentMonth, loadMonth]);

  useEffect(() => {
    if (!svgRef.current || !dimensions.width || !dimensions.height) return;

    const { width: containerWidth, height: containerHeight } = dimensions;

    const width = containerWidth - MARGIN.left - MARGIN.right;
    const height = containerHeight - MARGIN.top - MARGIN.bottom;

    const svgEl = d3.select(svgRef.current);
    svgEl.selectAll("*").remove();

    const svg = svgEl
      .attr("width", containerWidth)
      .attr("height", containerHeight)
      .append("g")
      .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    // Шкалы — выбранный месяц
    const monthStart = new Date(currentMonth.year, currentMonth.month, 1);
    const monthEnd = new Date(currentMonth.year, currentMonth.month + 1, 0);

    const xScale = d3.scaleTime().domain([monthStart, monthEnd]).range([0, width]);
    const yScale = d3.scaleLinear().domain([-5.5, 5.5]).range([height, 0]);

    // Горизонтальная сетка
    svg
      .append("g")
      .selectAll("line")
      .data(Y_TICKS)
      .join("line")
      .attr("x1", 0).attr("x2", width)
      .attr("y1", (d) => yScale(d)).attr("y2", (d) => yScale(d))
      .attr("stroke", (d) => d === 0 ? "#3a3a5a" : "#2a2a3a")
      .attr("stroke-width", (d) => d === 0 ? 1.5 : 1)
      .attr("stroke-dasharray", "4,4");

    // Вертикальная сетка по дням
    const days = d3.timeDays(monthStart, new Date(monthEnd.getTime() + 1));
    svg
      .append("g")
      .selectAll("line")
      .data(days)
      .join("line")
      .attr("x1", (d) => xScale(d)).attr("x2", (d) => xScale(d))
      .attr("y1", 0).attr("y2", height)
      .attr("stroke", (d) => isCurrentMonth && d.getDate() === now.getDate() ? "#3a3a5a" : "#1e1e2a")
      .attr("stroke-width", (d) => isCurrentMonth && d.getDate() === now.getDate() ? 1.5 : 1);

    // Ось X
    const xAxis = svg
      .append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(xScale).ticks(d3.timeDay.every(1)).tickFormat(d3.timeFormat("%d")))
      .call((g) => g.select(".domain").attr("stroke", "#3a3a4a"))
      .call((g) => g.selectAll(".tick line").attr("stroke", "#3a3a4a"))
      .call((g) => g.selectAll(".tick text").attr("fill", "#666680").attr("font-size", 12).attr("y", 14));

    // Дни недели под датами
    const dayFormat = d3.timeFormat("%a");
    xAxis.selectAll(".tick").append("text")
      .attr("y", 38)
      .attr("text-anchor", "middle")
      .attr("font-size", 9)
      .attr("fill", (d) => {
        const dow = d.getDay();
        return dow === 0 || dow === 6 ? "#554466" : "#3a3a50";
      })
      .text((d) => dayFormat(d).toUpperCase());

    // Ось Y
    svg
      .append("g")
      .call(
        d3.axisLeft(yScale)
          .tickValues(Y_TICKS)
          .tickFormat((d) => d > 0 ? `+${d}` : `${d}`)
      )
      .call((g) => g.select(".domain").attr("stroke", "#3a3a4a"))
      .call((g) => g.selectAll(".tick line").attr("stroke", "#3a3a4a"))
      .call((g) => g.selectAll(".tick text").attr("fill", "#666680").attr("font-size", 12));

    if (points.length >= 2) {
      const lineGen = d3
        .line()
        .x((d) => xScale(new Date(d.date)))
        .y((d) => yScale(d.mood))
        .curve(d3.curveCatmullRom.alpha(0.5));

      const path = svg
        .append("path")
        .datum(points)
        .attr("fill", "none")
        .attr("stroke", "#c9b8ff")
        .attr("stroke-width", 2.5)
        .attr("stroke-linecap", "round")
        .attr("d", lineGen(points));

      const totalLength = path.node().getTotalLength();
      path
        .attr("stroke-dasharray", totalLength)
        .attr("stroke-dashoffset", totalLength)
        .transition().duration(700).ease(d3.easeCubicOut)
        .attr("stroke-dashoffset", 0);

      const areaGen = d3
        .area()
        .x((d) => xScale(new Date(d.date)))
        .y0(height).y1((d) => yScale(d.mood))
        .curve(d3.curveCatmullRom.alpha(0.5));

      const gradientId = "mood-gradient";
      const defs = svgEl.append("defs");
      const gradient = defs.append("linearGradient")
        .attr("id", gradientId)
        .attr("x1", "0").attr("y1", "0").attr("x2", "0").attr("y2", "1");
      gradient.append("stop").attr("offset", "0%").attr("stop-color", "#c9b8ff").attr("stop-opacity", 0.15);
      gradient.append("stop").attr("offset", "100%").attr("stop-color", "#c9b8ff").attr("stop-opacity", 0);

      svg.append("path").datum(points)
        .attr("fill", `url(#${gradientId})`).attr("d", areaGen)
        .attr("opacity", 0).transition().delay(400).duration(400).attr("opacity", 1);
    }

    drawNodes(svg, points, xScale, yScale);

    // Вертикальная линия под курсором
    const cursorLine = svg
      .append("line")
      .attr("class", "cursor-line")
      .attr("y1", 0).attr("y2", height)
      .attr("stroke", "#c9b8ff22")
      .attr("stroke-width", 1)
      .attr("pointer-events", "none")
      .attr("display", "none");

    // Прозрачный rect — ловит клики и hover
    svg
      .append("rect")
      .attr("width", width).attr("height", height)
      .attr("fill", "transparent")
      .style("cursor", "crosshair")
      .on("mousemove", function (event) {
        const [mx, my] = d3.pointer(event);
        const hoveredDate = xScale.invert(mx);

        // Снаппим к ближайшему дню
        const snappedDate = d3.timeDay.round(hoveredDate);
        const snappedX = xScale(snappedDate);
        const hasPoint = points.some(
          (p) => p.date === localDateStr(snappedDate)
        );

        cursorLine
          .attr("display", null)
          .attr("x1", snappedX).attr("x2", snappedX)
          .attr("stroke", hasPoint ? "#ff888844" : "#c9b8ff22");

        // Ищем ближайшую точку по дате
        const nearest = points.reduce((best, p) => {
          const dist = Math.abs(new Date(p.date) - hoveredDate);
          return dist < Math.abs(new Date(best.date) - hoveredDate) ? p : best;
        }, points[0]);

        if (!nearest) return;

        const px = xScale(new Date(nearest.date));
        const py = yScale(nearest.mood);
        const distPx = Math.abs(mx - px);

        if (distPx < 20) {
          setHoverTooltip({
            x: px + MARGIN.left,
            y: py + MARGIN.top,
            mood: nearest.mood > 0 ? `+${nearest.mood}` : `${nearest.mood}`,
            note: nearest.note,
            date: nearest.date,
          });
        } else {
          setHoverTooltip(null);
        }
      })
      .on("mouseleave", () => {
        setHoverTooltip(null);
        cursorLine.attr("display", "none");
      })
      .on("click", function (event) {
        const [mx, my] = d3.pointer(event);
        const snappedDate = d3.timeDay.round(xScale.invert(mx));
        const clickedMood = Math.max(-5, Math.min(5, Math.round(yScale.invert(my))));
        const dateStr = localDateStr(snappedDate);

        const existing = points.find((p) => p.date === dateStr);
        if (existing) {
          deletePoint(dateStr);
          setHoverTooltip(null);
          return;
        }

        upsertPoint(dateStr, clickedMood);
        const moodStr = clickedMood > 0 ? `+${clickedMood}` : `${clickedMood}`;
        setTooltip({ x: mx + MARGIN.left, y: my + MARGIN.top, text: `${dateStr} — ${moodStr}` });
        setTimeout(() => setTooltip(null), 2000);
      })
      .on("contextmenu", function (event) {
        event.preventDefault();
        const [mx] = d3.pointer(event);
        const snappedDate = d3.timeDay.floor(xScale.invert(mx));
        const dateStr = localDateStr(snappedDate);
        const existing = points.find((p) => p.date === dateStr);

        if (!existing) return; // notes can only be added to existing points

        setNoteModal({
          date: dateStr,
          note: existing.note || "",
          x: event.clientX,
          y: event.clientY,
        });
      });
  }, [points, currentMonth, dimensions, upsertPoint, deletePoint]);

  return (
    <div ref={containerRef} className="graph-container">
      <div className="month-nav">
        <button className="month-nav-btn" onClick={prevMonth}>‹</button>
        <span className="month-nav-label">
          {MONTH_NAMES[currentMonth.month]} {currentMonth.year}
        </span>
        <button className="month-nav-btn" onClick={nextMonth}>›</button>
      </div>
      <svg ref={svgRef} />

      {hoverTooltip && (
        <HoverTooltip {...hoverTooltip} />
      )}

      {tooltip && (
        <div className="tooltip" style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}>
          {tooltip.text}
        </div>
      )}

      {noteModal && (
        <NoteModal
          {...noteModal}
          onSave={saveNote}
          onClose={() => setNoteModal(null)}
        />
      )}

      <div className="graph-hint">
        Click — add point · Click on point — remove · Right click — add note
      </div>
    </div>
  );
}

function drawNodes(svg, points, xScale, yScale) {
  const nodes = svg
    .selectAll(".node")
    .data(points)
    .join("g")
    .attr("class", "node")
    .attr("transform", (d) => `translate(${xScale(new Date(d.date))},${yScale(d.mood)})`);

  nodes.append("circle")
    .attr("r", 0)
    .attr("fill", (d) => d.note ? "#ffcc88" : "#c9b8ff")
    .attr("stroke", "#0f0f13").attr("stroke-width", 2)
    .transition().delay((_, i) => i * 80).duration(300).attr("r", 6);

  nodes.append("circle")
    .attr("r", 0).attr("fill", "none")
    .attr("stroke", (d) => d.note ? "#ffcc88" : "#c9b8ff")
    .attr("stroke-width", 1).attr("opacity", 0.3)
    .transition().delay((_, i) => i * 80).duration(300).attr("r", 12);
}

function HoverTooltip({ x, y, mood, note, date }) {
  return (
    <div
      className="hover-tooltip"
      style={{ left: x + 14, top: y - 16 }}
    >
      <div className="hover-tooltip-date">{date}</div>
      <div className="hover-tooltip-mood">{mood}</div>
      {note && <div className="hover-tooltip-note">{note}</div>}
    </div>
  );
}

const MODAL_WIDTH = 260;
const MODAL_HEIGHT = 180; // приблизительная высота

function NoteModal({ date, note, x, y, onSave, onClose }) {
  const [value, setValue] = useState(note);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(date, value);
  };

  const clampedX = Math.min(x, window.innerWidth - MODAL_WIDTH - 12);
  const clampedY = Math.min(y, window.innerHeight - MODAL_HEIGHT - 12);

  return (
    <div className="note-modal-overlay" onClick={onClose}>
      <div
        className="note-modal"
        style={{ left: clampedX, top: clampedY }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="note-modal-date">{date}</div>
        <textarea
          ref={inputRef}
          className="note-modal-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a note..."
          rows={3}
        />
        <div className="note-modal-actions">
          <button className="note-modal-cancel" onClick={onClose}>Cancel</button>
          <button className="note-modal-save" onClick={() => onSave(date, value)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
