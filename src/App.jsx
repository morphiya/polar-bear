import MoodGraph from "./MoodGraph";
import "./MoodGraph.css";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Mood Graph</h1>
        <p>Click to add a mood entry</p>
      </header>
      <MoodGraph />
    </div>
  );
}
